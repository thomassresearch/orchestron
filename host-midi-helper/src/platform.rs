use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use midir::{Ignore, MidiInput, MidiInputConnection, MidiInputPort};
use tokio::sync::mpsc;

use crate::config::sanitize_identifier;
use crate::protocol::{HostMidiDeviceRef, HostMidiEvent, TimestampQuality};

const HOST_BRIDGE_BACKEND: &str = "host_bridge";

#[derive(Debug, thiserror::Error)]
pub enum PlatformError {
    #[error("failed to initialize MIDI input backend: {0}")]
    Init(String),
    #[error("failed to enumerate MIDI ports: {0}")]
    Enumerate(String),
    #[error("failed to connect MIDI input '{device_name}': {detail}")]
    Connect { device_name: String, detail: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MidiDevice {
    pub device_id: String,
    pub display_name: String,
    pub timestamp_quality: TimestampQuality,
}

impl MidiDevice {
    pub fn into_protocol(self) -> HostMidiDeviceRef {
        HostMidiDeviceRef {
            device_id: self.device_id,
            display_name: self.display_name,
            backend: HOST_BRIDGE_BACKEND.to_string(),
            timestamp_quality: self.timestamp_quality,
        }
    }
}

#[derive(Debug, Clone)]
pub struct CapturedMidiEvent {
    pub device_id: String,
    pub message: Vec<u8>,
    pub event_timestamp_ns: u64,
    pub timestamp_quality: TimestampQuality,
}

impl CapturedMidiEvent {
    pub fn into_protocol(self) -> HostMidiEvent {
        HostMidiEvent {
            device_id: self.device_id,
            message: self.message,
            event_timestamp_ns: self.event_timestamp_ns,
            timestamp_quality: self.timestamp_quality,
        }
    }
}

pub struct MidiDiscovery {
    event_sender: mpsc::UnboundedSender<CapturedMidiEvent>,
    connections: HashMap<String, MidiConnection>,
}

struct MidiConnection {
    _connection: MidiInputConnection<()>,
}

#[derive(Clone)]
struct PortSpec {
    device: MidiDevice,
    port_index: usize,
}

struct TimestampResolver {
    port_opened_ns: u64,
    last_event_ns: u64,
}

impl TimestampResolver {
    fn new() -> Self {
        let opened_ns = monotonic_now_ns();
        Self {
            port_opened_ns: opened_ns,
            last_event_ns: opened_ns,
        }
    }

    fn resolve(&mut self, stamp_us: u64) -> u64 {
        let from_origin = self
            .port_opened_ns
            .saturating_add(stamp_us.saturating_mul(1_000));
        let now_ns = monotonic_now_ns();
        let resolved = if from_origin >= self.last_event_ns.saturating_sub(10_000_000) {
            from_origin.min(now_ns)
        } else {
            self.last_event_ns
                .saturating_add(stamp_us.saturating_mul(1_000))
                .min(now_ns)
        };
        let monotonic = resolved.max(self.last_event_ns);
        self.last_event_ns = monotonic;
        monotonic
    }
}

impl MidiDiscovery {
    pub fn new(event_sender: mpsc::UnboundedSender<CapturedMidiEvent>) -> Self {
        Self {
            event_sender,
            connections: HashMap::new(),
        }
    }

    pub fn rescan(&mut self, host_id: &str) -> Result<Vec<MidiDevice>, PlatformError> {
        let specs = enumerate_specs(host_id)?;
        let live_ids: HashSet<String> = specs.iter().map(|spec| spec.device.device_id.clone()).collect();
        self.connections.retain(|device_id, _| live_ids.contains(device_id));

        for spec in &specs {
            if self.connections.contains_key(&spec.device.device_id) {
                continue;
            }
            let connection = connect_input(spec.clone(), self.event_sender.clone())?;
            self.connections
                .insert(spec.device.device_id.clone(), connection);
        }

        Ok(specs.into_iter().map(|spec| spec.device).collect())
    }
}

fn enumerate_specs(host_id: &str) -> Result<Vec<PortSpec>, PlatformError> {
    let mut probe = MidiInput::new("VisualCSound Host MIDI Inventory")
        .map_err(|err| PlatformError::Init(err.to_string()))?;
    probe.ignore(Ignore::None);

    let ports = probe.ports();
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut specs = Vec::with_capacity(ports.len());
    for (port_index, port) in ports.into_iter().enumerate() {
        let display_name = probe
            .port_name(&port)
            .map_err(|err| PlatformError::Enumerate(err.to_string()))?;
        let slug = sanitize_identifier(&display_name);
        let occurrence = counts.entry(slug.clone()).or_insert(0);
        *occurrence += 1;
        let unique_slug = if *occurrence == 1 {
            slug
        } else {
            format!("{slug}-{}", occurrence)
        };
        specs.push(PortSpec {
            device: MidiDevice {
                device_id: format!("{host_id}:{unique_slug}"),
                display_name,
                timestamp_quality: platform_timestamp_quality(),
            },
            port_index,
        });
    }

    Ok(specs)
}

fn connect_input(
    spec: PortSpec,
    event_sender: mpsc::UnboundedSender<CapturedMidiEvent>,
) -> Result<MidiConnection, PlatformError> {
    let mut midi_in = MidiInput::new("VisualCSound Host MIDI Input")
        .map_err(|err| PlatformError::Init(err.to_string()))?;
    midi_in.ignore(Ignore::None);

    let ports = midi_in.ports();
    let port = ports.get(spec.port_index).cloned().ok_or_else(|| PlatformError::Connect {
        device_name: spec.device.display_name.clone(),
        detail: "port disappeared during rescan".to_string(),
    })?;

    let device = spec.device.clone();
    let quality = device.timestamp_quality;
    let device_id = device.device_id.clone();
    let resolver = Mutex::new(TimestampResolver::new());
    let connection_name = format!("VisualCSound {}", device.display_name);
    let connection = midi_in
        .connect(
            &port,
            &connection_name,
            move |stamp_us, message, _| {
                let mut resolver = match resolver.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let event = CapturedMidiEvent {
                    device_id: device_id.clone(),
                    message: message.to_vec(),
                    event_timestamp_ns: resolver.resolve(stamp_us),
                    timestamp_quality: quality,
                };
                let _ = event_sender.send(event);
            },
            (),
        )
        .map_err(|err| PlatformError::Connect {
            device_name: spec.device.display_name.clone(),
            detail: err.to_string(),
        })?;

    Ok(MidiConnection {
        _connection: connection,
    })
}

#[allow(dead_code)]
fn port_name(input: &MidiInput, port: &MidiInputPort) -> Result<String, PlatformError> {
    input
        .port_name(port)
        .map_err(|err| PlatformError::Enumerate(err.to_string()))
}

fn monotonic_now_ns() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    let start = START.get_or_init(Instant::now);
    start.elapsed().as_nanos().min(u128::from(u64::MAX)) as u64
}

fn platform_timestamp_quality() -> TimestampQuality {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        TimestampQuality::Native
    }
    #[cfg(target_os = "windows")]
    {
        TimestampQuality::BestEffort
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        TimestampQuality::Immediate
    }
}
