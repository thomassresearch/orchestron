use clap::Parser;

#[derive(Debug, Clone, Parser)]
#[command(name = "host-midi-helper", about = "VisualCSound host MIDI bridge daemon")]
pub struct Config {
    #[arg(
        long,
        env = "VISUALCSOUND_HOST_MIDI_WS",
        default_value = "ws://127.0.0.1:8000/ws/host-midi"
    )]
    pub backend_ws: String,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_TOKEN")]
    pub token: String,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_HOST_ID")]
    pub host_id: Option<String>,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_HOST_NAME")]
    pub host_name: Option<String>,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_PROTOCOL_VERSION", default_value_t = 1)]
    pub protocol_version: u32,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_CLOCK_SYNC_INTERVAL_MS", default_value_t = 250)]
    pub clock_sync_interval_ms: u64,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_SCAN_INTERVAL_MS", default_value_t = 1_500)]
    pub scan_interval_ms: u64,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_BATCH_INTERVAL_MS", default_value_t = 4)]
    pub batch_interval_ms: u64,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_MAX_BATCH_SIZE", default_value_t = 128)]
    pub max_batch_size: usize,

    #[arg(long, env = "VISUALCSOUND_HOST_MIDI_LOG", default_value = "info")]
    pub log_filter: String,
}

impl Config {
    pub fn resolved_host_id(&self) -> String {
        self.host_id
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                let hostname = hostname::get()
                    .ok()
                    .and_then(|value| value.into_string().ok())
                    .unwrap_or_else(|| "visualcsound-host".to_string());
                sanitize_identifier(&hostname)
            })
    }

    pub fn resolved_host_name(&self) -> String {
        self.host_name
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| {
                hostname::get()
                    .ok()
                    .and_then(|value| value.into_string().ok())
                    .unwrap_or_else(|| "VisualCSound Host".to_string())
            })
    }
}

pub fn sanitize_identifier(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    for ch in value.chars() {
        let normalized = ch.to_ascii_lowercase();
        if normalized.is_ascii_alphanumeric() {
            sanitized.push(normalized);
        } else if !sanitized.ends_with('-') {
            sanitized.push('-');
        }
    }
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "visualcsound-host".to_string()
    } else {
        trimmed.to_string()
    }
}
