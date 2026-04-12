mod config;
mod platform;
mod protocol;

use std::time::Duration;

use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use http::Request;
use tokio::sync::mpsc;
use tokio::time::{interval, MissedTickBehavior};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{self, Message};
use tracing::{debug, error, info, warn};
use tracing_subscriber::EnvFilter;

use crate::config::Config;
use crate::platform::{CapturedMidiEvent, MidiDiscovery, PlatformError};
use crate::protocol::{
    ClockSyncRequest,
    DeviceInventoryRequest,
    MidiEventsRequest,
    RegisterHostRequest,
};

#[derive(Debug, thiserror::Error)]
enum BridgeError {
    #[error("websocket setup failed: {0}")]
    Connect(String),
    #[error("websocket IO failed: {0}")]
    WebSocket(#[from] tungstenite::Error),
    #[error("json serialization failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("MIDI backend failed: {0}")]
    Platform(#[from] PlatformError),
}

#[tokio::main]
async fn main() -> Result<(), BridgeError> {
    let config = Config::parse();
    init_tracing(&config);
    run(config).await
}

async fn run(config: Config) -> Result<(), BridgeError> {
    let host_id = config.resolved_host_id();
    let host_name = config.resolved_host_name();
    let request = Request::builder()
        .uri(config.backend_ws.as_str())
        .header("Authorization", format!("Bearer {}", config.token))
        .body(())
        .map_err(|err| BridgeError::Connect(err.to_string()))?;

    let (stream, response) = connect_async(request)
        .await
        .map_err(|err| BridgeError::Connect(err.to_string()))?;
    info!(
        backend_ws = %config.backend_ws,
        status = ?response.status(),
        "Connected to VisualCSound host MIDI websocket"
    );

    let (mut write, mut read) = stream.split();
    send_json(
        &mut write,
        &RegisterHostRequest {
            kind: "register_host",
            host_id: &host_id,
            host_name: &host_name,
            protocol_version: config.protocol_version,
        },
    )
    .await?;

    let (event_sender, mut event_receiver) = mpsc::unbounded_channel::<CapturedMidiEvent>();
    let mut discovery = MidiDiscovery::new(event_sender);
    let mut inventory = discovery.rescan(&host_id)?;
    let mut protocol_inventory: Vec<_> = inventory
        .iter()
        .cloned()
        .map(|device| device.into_protocol())
        .collect();
    send_json(
        &mut write,
        &DeviceInventoryRequest {
            kind: "device_inventory",
            devices: &protocol_inventory,
        },
    )
    .await?;

    let mut clock_sync_interval = interval(Duration::from_millis(config.clock_sync_interval_ms.max(1)));
    clock_sync_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut scan_interval = interval(Duration::from_millis(config.scan_interval_ms.max(250)));
    scan_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut batch_interval = interval(Duration::from_millis(config.batch_interval_ms.max(1)));
    batch_interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

    let mut pending_events = Vec::with_capacity(config.max_batch_size.max(1));
    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("Received Ctrl-C, shutting down host MIDI helper.");
                break;
            }
            message = read.next() => {
                match message {
                    Some(Ok(Message::Text(payload))) => debug!(payload = %payload, "Received websocket text message"),
                    Some(Ok(Message::Close(frame))) => {
                        info!(?frame, "Backend closed host MIDI websocket");
                        break;
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(Message::Ping(_))) | Some(Ok(Message::Pong(_))) => {}
                    Some(Ok(Message::Frame(_))) => {}
                    Some(Err(err)) => return Err(BridgeError::WebSocket(err)),
                    None => break,
                }
            }
            _ = clock_sync_interval.tick() => {
                send_json(
                    &mut write,
                    &ClockSyncRequest {
                        kind: "clock_sync",
                        client_monotonic_ns: monotonic_now_ns(),
                    },
                ).await?;
            }
            _ = scan_interval.tick() => {
                let rescanned = discovery.rescan(&host_id)?;
                if rescanned != inventory {
                    inventory = rescanned;
                    protocol_inventory = inventory
                        .iter()
                        .cloned()
                        .map(|device| device.into_protocol())
                        .collect();
                    send_json(
                        &mut write,
                        &DeviceInventoryRequest {
                            kind: "device_inventory",
                            devices: &protocol_inventory,
                        },
                    ).await?;
                    info!(device_count = protocol_inventory.len(), "Published refreshed MIDI inventory");
                }
            }
            _ = batch_interval.tick(), if !pending_events.is_empty() => {
                flush_events(&mut write, &mut pending_events).await?;
            }
            maybe_event = event_receiver.recv() => {
                match maybe_event {
                    Some(event) => {
                        pending_events.push(event.into_protocol());
                        if pending_events.len() >= config.max_batch_size.max(1) {
                            flush_events(&mut write, &mut pending_events).await?;
                        }
                    }
                    None => {
                        warn!("MIDI event channel closed unexpectedly");
                        break;
                    }
                }
            }
        }
    }

    if !pending_events.is_empty() {
        flush_events(&mut write, &mut pending_events).await?;
    }
    Ok(())
}

async fn flush_events<S>(
    write: &mut S,
    pending_events: &mut Vec<crate::protocol::HostMidiEvent>,
) -> Result<(), BridgeError>
where
    S: futures_util::Sink<Message, Error = tungstenite::Error> + Unpin,
{
    send_json(
        write,
        &MidiEventsRequest {
            kind: "midi_events",
            events: pending_events.as_slice(),
        },
    )
    .await?;
    pending_events.clear();
    Ok(())
}

async fn send_json<S, T>(write: &mut S, value: &T) -> Result<(), BridgeError>
where
    S: futures_util::Sink<Message, Error = tungstenite::Error> + Unpin,
    T: serde::Serialize,
{
    let payload = serde_json::to_string(value)?;
    write.send(Message::Text(payload.into())).await?;
    Ok(())
}

fn init_tracing(config: &Config) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(config.log_filter.clone()));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .compact()
        .init();
}

fn monotonic_now_ns() -> u64 {
    use std::sync::OnceLock;
    use std::time::Instant;

    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    start.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64
}
