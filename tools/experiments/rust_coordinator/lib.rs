// Benchmark-only parent of the existing shared-memory Rust/Csound workers.
mod sync;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{collections::HashSet, fmt::Write, ptr, slice, time::{Duration, Instant}};

#[derive(Deserialize)]
struct Worker {
    id: String, command: [usize; 2], reply: [usize; 2], token: [u8; 32],
    command_sem: usize, reply_sem: usize, reply_fd: Option<i32>, sentinel: i32,
    controls: HashSet<String>, channels: HashSet<u64>, buses: Vec<String>,
    meter_offset: [usize; 2], meter_count: usize,
}
#[derive(Deserialize)]
struct Config {
    epoch: u64, plan: String, workers: Vec<Worker>, edges: Vec<usize>,
    ksmps: usize, max_blocks: usize, pcm: [usize; 2], mode: [usize; 2],
}
#[derive(Deserialize)]
struct Input {
    control_revision: u64, midi: Vec<Value>, controls: Vec<Value>, samples: Vec<Value>,
}
#[derive(Default)]
struct Record { command: Vec<u8>, done: Vec<u8> }
struct Coordinator {
    cfg: Config, base: *mut u8, deaths: Vec<libc::pollfd>, wake_fds: Vec<libc::pollfd>,
    records: Vec<Record>, count: usize, sequence: u64,
}

fn pollfd(fd: i32) -> libc::pollfd { libc::pollfd { fd, events: libc::POLLIN, revents: 0 } }

impl Coordinator {
    fn new(cfg: Config, base: *mut u8, len: usize) -> Result<Self, String> {
        if base.is_null() || cfg.workers.is_empty() || cfg.workers.len() > 64 || cfg.ksmps == 0 ||
            cfg.ksmps > 192000 || !(1..=1024).contains(&cfg.max_blocks) { return Err("Invalid layout".into()); }
        let check = |offset: usize, elements: usize, width: usize| {
            if offset % width != 0 || elements.checked_mul(width).and_then(|s| offset.checked_add(s))
                .is_none_or(|end| end > len) { Err("Arena bounds/alignment mismatch") } else { Ok(()) }
        };
        for w in &cfg.workers {
            for [offset, size] in [w.command, w.reply] {
                if size < 68 { return Err("Invalid mailbox".into()); }
                check(offset, size, 1)?;
            }
            for offset in w.meter_offset {
                check(offset, w.meter_count.checked_mul(cfg.max_blocks).ok_or("Meter layout overflow")?, 8)?;
            }
            if w.command_sem == 0 || w.reply_sem == 0 { return Err("Missing semaphore".into()); }
        }
        for offset in cfg.pcm { check(offset, cfg.max_blocks * cfg.ksmps * 2, 4)?; }
        for offset in cfg.mode { check(offset, 1, 8)?; }
        let deaths = cfg.workers.iter().map(|w|pollfd(w.sentinel)).collect();
        let wake_fds = cfg.workers.iter().filter_map(|w|w.reply_fd.map(pollfd)).collect();
        Ok(Self { cfg, base, deaths, wake_fds, records: vec![], count: 0, sequence: 0 })
    }

    fn prepare(&mut self, sequence: u64, sample: u64, revision: u64, count: usize,
               sparse: &[(usize, Input)]) -> Result<usize, String> {
        if count == 0 || count > self.cfg.max_blocks { return Err("Invalid batch size".into()); }
        let mut previous = None;
        for (index, step) in sparse {
            if *index >= count || previous.is_some_and(|v| *index <= v) { return Err("Invalid sparse index".into()); }
            previous = Some(*index);
            let start = sample + (*index * self.cfg.ksmps) as u64;
            let mut last: Option<(u64, u64, bool)> = None;
            for m in &step.midi {
                let at = m["target_engine_sample"].as_u64().ok_or("Invalid MIDI deadline")?;
                let seq = m["sequence"].as_u64().ok_or("Invalid MIDI sequence")?;
                let late = m["late"].as_bool().ok_or("Invalid MIDI late flag")?;
                if at < start || at >= start + self.cfg.ksmps as u64 ||
                    last.is_some_and(|(t, s, l)| at < t || (at == t && !late && !l && seq < s)) {
                    return Err("Out-of-block or unordered MIDI".into());
                }
                last = Some((at, seq, late));
            }
        }
        let mut n = count;
        loop {
            self.records.clear();
            for w in &self.cfg.workers {
                match make_record(&self.cfg, w, sequence, sample, revision, n, sparse) {
                    Some(record) => self.records.push(record),
                    None => break,
                }
            }
            if self.records.len() == self.cfg.workers.len() {
                self.count = n;
                self.sequence = sequence;
                return Ok(n);
            }
            if n == 1 { return Err("Partition descriptor exceeds mailbox capacity".into()); }
            n /= 2;
        }
    }

    fn output(&self, dest: &mut [f32], previous_mode: i32) -> Result<i32, String> {
        let slot = (self.sequence % 2) as usize;
        let mode = unsafe { *self.base.add(self.cfg.mode[slot]).cast::<f64>() };
        if ![0.,1.,2.,3.].contains(&mode) || (previous_mode >= 0 && mode != f64::from(previous_mode)) {
            return Err("Invalid/changed native float32 conversion mode".into());
        }
        let frames = self.count * self.cfg.ksmps;
        if dest.len() != frames * 2 { return Err("Invalid PCM destination".into()); }
        let pcm = unsafe { slice::from_raw_parts(self.base.add(self.cfg.pcm[slot]).cast::<f32>(), dest.len()) };
        if !pcm.iter().all(|v|v.is_finite()) { return Err("Nonfinite audio".into()); }
        for w in &self.cfg.workers {
            let meters = unsafe { slice::from_raw_parts(self.base.add(w.meter_offset[slot]).cast::<f64>(), self.count*w.meter_count) };
            if !meters.iter().all(|v|v.is_finite()) { return Err("Nonfinite meters".into()); }
        }
        dest.copy_from_slice(pcm);
        Ok(mode as i32)
    }
}

// An empty block uses the worker's 64-byte bootstrap-bound wire format. Event
// blocks retain the JSON contract and the worker's ordinary Pydantic validation.
fn make_record(cfg: &Config, w: &Worker, seq: u64, sample: u64, initial_rev: u64, n: usize,
               sparse: &[(usize, Input)]) -> Option<Record> {
    let active = &sparse[..sparse.partition_point(|(i,_)| *i < n)];
    let revision = active.last().map_or(initial_rev, |(_, s)|s.control_revision);
    let control = |v: &Value| v["channel"].as_str().is_some_and(|c| w.controls.contains(c));
    let mapped = |v: &Value| v["channel"].as_u64().is_some_and(|c| w.channels.contains(&c));
    if !active.iter().any(|(_,s)| !s.midi.is_empty() || s.controls.iter().any(control) || s.samples.iter().any(mapped)) {
        let mut command = Vec::with_capacity(64);
        command.extend_from_slice(b"RBL2");
        command.extend_from_slice(&w.token);
        for v in [seq, sample, revision] { command.extend_from_slice(&v.to_le_bytes()); }
        command.extend_from_slice(&(n as u32).to_le_bytes());
        let mut done = command.clone();
        done[..4].copy_from_slice(b"DBL2");
        return Some(Record {command, done});
    }
    let slots = w.buses.iter().map(|bus|format!(r#"{{"bus_id":{},"slot":{},"generation":{}}}"#,
        json!(bus),seq%2,seq/2)).collect::<Vec<_>>().join(",");
    let envelope = format!(r#"{{"protocol_version":1,"epoch":{},"partition_id":{},"plan_hash":{},"sequence":{seq}"#,
                           cfg.epoch,json!(w.id),json!(cfg.plan));
    let header = |start,frames,rev| format!(r#"{envelope},"sample_start":{start},"frame_count":{frames},"control_revision":{rev},"slots":[{slots}]"#);
    let whole = header(sample,n*cfg.ksmps,revision);
    let done = format!(r#"{whole},"type":"DONE"}}"#).into_bytes();
    let mut command = if n == 1 { String::new() } else { format!(r#"{whole},"type":"RENDER_BATCH","blocks":["#) };
    let mut iter = active.iter().peekable();
    let mut rev = initial_rev;
    for i in 0..n {
        let mut fields = String::new();
        if iter.peek().is_some_and(|(index,_)|*index == i) {
            let (_, s) = iter.next().unwrap();
            rev = s.control_revision;
            let samples = s.samples.iter().filter(|v|mapped(v)).collect::<Vec<_>>();
            let controls = s.controls.iter().filter(|v|control(v)).collect::<Vec<_>>();
            write!(fields,r#""samples":{},"midi":{},"controls":{}"#,json!(samples),json!(s.midi),json!(controls)).unwrap();
        } else {
            fields.push_str(r#""samples":[],"midi":[],"controls":[]"#);
        }
        if i != 0 { command.push(','); }
        write!(command,r#"{},"type":"RENDER",{fields}}}"#, header(sample + (i*cfg.ksmps) as u64,cfg.ksmps,rev)).unwrap();
        if command.len() + 4 > w.command[1] { return None; }
    }
    if n > 1 { command.push_str("]}"); }
    (command.len()+4 <= w.command[1]).then(||Record {command:command.into_bytes(),done})
}

// Only bridge.py calls this private ABI. It keeps the arena, destination and
// POSIX handles alive, and serializes calls with the renderer's operation lock.
unsafe fn fail(msg: String, error: *mut u8) -> i32 {
    let n = msg.len().min(2047);
    ptr::copy_nonoverlapping(msg.as_ptr(), error, n);
    *error.add(n) = 0;
    -1
}
#[no_mangle]
unsafe extern "C" fn coord_new(config: *const u8, n: usize, base: *mut u8, len: usize, error: *mut u8) -> *mut Coordinator {
    let cfg = serde_json::from_slice(slice::from_raw_parts(config,n)).map_err(|e|e.to_string());
    match cfg.and_then(|cfg| Coordinator::new(cfg,base,len)) {
        Ok(c) => Box::into_raw(Box::new(c)), Err(e) => {fail(e,error); ptr::null_mut()}
    }
}
#[no_mangle]
unsafe extern "C" fn coord_free(c: *mut Coordinator) { drop(Box::from_raw(c)); }
#[no_mangle]
unsafe extern "C" fn coord_prepare(c: &mut Coordinator, seq:u64, sample:u64, rev:u64, count:usize,
                                    data:*const u8, len:usize, error:*mut u8) -> i32 {
    let sparse = if len==0 {Ok(Vec::new())} else {serde_json::from_slice(slice::from_raw_parts(data,len))};
    match sparse.map_err(|e|e.to_string()).and_then(|s|c.prepare(seq,sample,rev,count,&s)) {
        Ok(n) => n as i32, Err(e) => fail(e,error)
    }
}
#[no_mangle]
unsafe extern "C" fn coord_execute(c:&mut Coordinator, timeout_ns:u64, cancel:extern "C" fn()->bool,
                                    dest:*mut f32, elements:usize, mode:i32, error:*mut u8) -> i32 {
    let deadline = Instant::now() + Duration::from_nanos(timeout_ns);
    let result = c.quiescent().and_then(|()|c.dispatch()).and_then(|()|c.collect(deadline,cancel))
        .and_then(|()|c.output(slice::from_raw_parts_mut(dest,elements),mode));
    result.unwrap_or_else(|e|fail(e,error))
}
