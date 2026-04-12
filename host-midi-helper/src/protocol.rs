use serde::Serialize;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimestampQuality {
    Native,
    BestEffort,
    Immediate,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HostMidiDeviceRef {
    pub device_id: String,
    pub display_name: String,
    pub backend: String,
    pub timestamp_quality: TimestampQuality,
}

#[derive(Debug, Clone, Serialize)]
pub struct HostMidiEvent {
    pub device_id: String,
    pub message: Vec<u8>,
    pub event_timestamp_ns: u64,
    pub timestamp_quality: TimestampQuality,
}

#[derive(Debug, Serialize)]
pub struct RegisterHostRequest<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub host_id: &'a str,
    pub host_name: &'a str,
    pub protocol_version: u32,
}

#[derive(Debug, Serialize)]
pub struct ClockSyncRequest {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub client_monotonic_ns: u64,
}

#[derive(Debug, Serialize)]
pub struct DeviceInventoryRequest<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub devices: &'a [HostMidiDeviceRef],
}

#[derive(Debug, Serialize)]
pub struct MidiEventsRequest<'a> {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub events: &'a [HostMidiEvent],
}
