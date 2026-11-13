//! Private float64 Csound batch experiment. No linking dependencies or fast-math.
//!
//! Safety contract: Python validates and retains every descriptor, name, function
//! and buffer for the native owner's lifetime. Calls are serialized on its render
//! thread. Csound callbacks are synchronous; TLS is installed only during a batch.
//! No borrowed Csound address crosses processes. No allocation in the render loop.

use std::cell::{Cell, UnsafeCell};
use std::ffi::{c_char, c_int, c_void};
use std::ptr;

type ReadMidi = unsafe extern "C" fn(*mut c_void, *mut c_void, *mut u8, c_int) -> c_int;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Bus {
    name: *const c_char,
    slots: [*mut f64; 2],
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Config {
    cs: *mut c_void,
    ksmps: usize,
    max_blocks: usize,
    inputs: *const Bus,
    input_count: usize,
    outputs: *const Bus,
    output_count: usize,
    meter_ptrs: *const *const f64,
    meter_count: usize,
    meters: [*mut f64; 2],
    final_audio: [*mut f64; 2],
    pcm: [*mut f32; 2],
    spout: *const f64,
    perform: unsafe extern "C" fn(*mut c_void) -> c_int,
    set_audio: unsafe extern "C" fn(*mut c_void, *const c_char, *mut f64),
    get_audio: unsafe extern "C" fn(*mut c_void, *const c_char, *mut f64),
    set_control: unsafe extern "C" fn(*mut c_void, *const c_char, f64),
    set_read: unsafe extern "C" fn(*mut c_void, ReadMidi),
}

#[repr(C)]
pub struct Control {
    name: *const c_char,
    value: f64,
}

#[repr(C)]
pub struct Events {
    midi: *const u8,
    midi_len: usize,
    controls: *const Control,
    control_count: usize,
}

struct Midi {
    bytes: Box<[u8]>,
    read: usize,
    len: usize,
    cs: *mut c_void,
}

pub struct BatchLoop {
    config: Config,
    // The synchronous C callback may mutate only this cell, with no outstanding
    // Rust reference to its contents across perform(). All other config is fixed.
    midi: UnsafeCell<Midi>,
}

thread_local! {
    static ACTIVE: Cell<*mut Midi> = const { Cell::new(ptr::null_mut()) };
}

unsafe extern "C" fn read_midi(cs: *mut c_void, _: *mut c_void, dest: *mut u8, cap: c_int) -> c_int {
    ACTIVE.with(|active| {
        let address = active.get();
        if address.is_null() || cap <= 0 || dest.is_null() {
            return 0;
        }
        let state = &mut *address;
        if state.cs != cs {
            return 0;
        }
        let count = (state.len - state.read).min(cap as usize);
        ptr::copy_nonoverlapping(state.bytes.as_ptr().add(state.read), dest, count);
        state.read += count;
        count as c_int
    })
}

#[no_mangle]
pub extern "C" fn worker_abi() -> u32 {
    1
}

/// # Safety
/// Config and all referenced storage/functions must satisfy the module contract.
#[no_mangle]
pub unsafe extern "C" fn worker_create(config: *const Config) -> *mut BatchLoop {
    if config.is_null() {
        return ptr::null_mut();
    }
    let cfg = *config;
    if cfg.cs.is_null() || cfg.ksmps == 0 || cfg.ksmps > 192000 || cfg.max_blocks == 0 || cfg.max_blocks > 1024 {
        return ptr::null_mut();
    }
    let state = Box::new(BatchLoop {
        config: cfg,
        midi: UnsafeCell::new(Midi {
            bytes: vec![0; 16384 * 3].into_boxed_slice(),
            read: 0,
            len: 0,
            cs: cfg.cs,
        }),
    });
    (cfg.set_read)(cfg.cs, read_midi);
    Box::into_raw(state)
}

/// # Safety
/// Call only on the owning thread; events are validated and live through return.
/// Null events means an entirely empty batch. Status: 1 bounds, 2 unread MIDI,
/// 3 native end, 4 PCM overflow, 5 nonfinite bus/meter, 6 reentrant call.
#[no_mangle]
pub unsafe extern "C" fn worker_render(state: *mut BatchLoop, slot: usize, blocks: usize, events: *const Events) -> c_int {
    if state.is_null() {
        return 1;
    }
    let owner = &*state;
    let cfg = &owner.config;
    if slot > 1 || blocks == 0 || blocks > cfg.max_blocks {
        return 1;
    }
    ACTIVE.with(|active| {
        if !active.get().is_null() {
            return 6;
        }
        active.set(owner.midi.get());
        let result = render(cfg, owner.midi.get(), slot, blocks, events);
        active.set(ptr::null_mut());
        result
    })
}

unsafe fn render(cfg: &Config, midi: *mut Midi, slot: usize, blocks: usize, events: *const Events) -> c_int {
    for block in 0..blocks {
        let offset = block * cfg.ksmps;
        // Match Python's channel-input -> perform(midi, controls) ordering.
        for index in 0..cfg.input_count {
            let bus = &*cfg.inputs.add(index);
            (cfg.set_audio)(cfg.cs, bus.name, bus.slots[slot].add(offset));
        }
        {
            let pending = &mut *midi;
            if pending.read != pending.len {
                return 2;
            }
            pending.read = 0;
            pending.len = 0;
            if !events.is_null() {
                let step = &*events.add(block);
                if step.midi_len > pending.bytes.len() || step.control_count > 16384
                    || (step.midi_len > 0 && step.midi.is_null())
                    || (step.control_count > 0 && step.controls.is_null()) {
                    return 1;
                }
                if step.midi_len > 0 {
                    ptr::copy_nonoverlapping(step.midi, pending.bytes.as_mut_ptr(), step.midi_len);
                    pending.len = step.midi_len;
                }
                for index in 0..step.control_count {
                    let control = &*step.controls.add(index);
                    (cfg.set_control)(cfg.cs, control.name, control.value);
                }
            }
        } // No mutable MIDI reference remains during the native callback.
        if (cfg.perform)(cfg.cs) != 0 {
            return 3;
        }
        for index in 0..cfg.output_count {
            let bus = &*cfg.outputs.add(index);
            (cfg.get_audio)(cfg.cs, bus.name, bus.slots[slot].add(offset));
        }
        if !cfg.spout.is_null() {
            let final_audio = cfg.final_audio[slot].add(offset * 2);
            let pcm = cfg.pcm[slot].add(offset * 2);
            ptr::copy_nonoverlapping(cfg.spout, final_audio, cfg.ksmps * 2);
            for sample in 0..cfg.ksmps * 2 {
                let value = *final_audio.add(sample) as f32;
                *pcm.add(sample) = value;
                if !value.is_finite() {
                    return 4;
                }
            }
        }
        for index in 0..cfg.meter_count {
            let value = **cfg.meter_ptrs.add(index);
            *cfg.meters[slot].add(block * cfg.meter_count + index) = value;
            if !value.is_finite() {
                return 5;
            }
        }
        for index in 0..cfg.output_count {
            let bus = &*cfg.outputs.add(index);
            for sample in 0..cfg.ksmps {
                if !(*bus.slots[slot].add(offset + sample)).is_finite() {
                    return 5;
                }
            }
        }
    }
    0
}

/// # Safety
/// Destroy once, after native owner shutdown; no render may be in progress.
#[no_mangle]
pub unsafe extern "C" fn worker_destroy(state: *mut BatchLoop) {
    if !state.is_null() {
        drop(Box::from_raw(state));
    }
}
