// Borrow CPython's POSIX SemLock handles for one fenced batch. Python owns their lifetime.
use crate::{Coordinator, Worker};
use std::{io, time::{Duration, Instant}};

fn os_error() -> String { io::Error::last_os_error().to_string() }

fn try_sem(handle: usize) -> Result<bool, String> {
    loop {
        if unsafe { libc::sem_trywait(handle as *mut _) } == 0 { return Ok(true); }
        match io::Error::last_os_error().raw_os_error() {
            Some(libc::EAGAIN) => return Ok(false),
            Some(libc::EINTR) => continue,
            _ => return Err(os_error()),
        }
    }
}

fn take_reply(w: &Worker) -> Result<bool, String> {
    if let Some(fd) = w.reply_fd {
        let mut byte = 0u8;
        loop {
            let n = unsafe { libc::recv(fd, (&mut byte as *mut u8).cast(), 1, libc::MSG_DONTWAIT) };
            if n == 1 && byte == b'x' && try_sem(w.reply_sem)? { return Ok(true); }
            if n < 0 {
                let err = io::Error::last_os_error();
                if err.kind() == io::ErrorKind::WouldBlock { return Ok(false); }
                if err.kind() == io::ErrorKind::Interrupted { continue; }
            }
            return Err("Invalid completion notification".into());
        }
    }
    try_sem(w.reply_sem)
}

fn poll(fds: &mut [libc::pollfd], millis: i32) -> Result<bool, String> {
    let n = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as _, millis) };
    if n >= 0 { return Ok(n != 0); }
    if io::Error::last_os_error().kind() == io::ErrorKind::Interrupted { Ok(false) } else { Err(os_error()) }
}

impl Coordinator {
    pub fn quiescent(&mut self) -> Result<(), String> {
        if poll(&mut self.deaths, 0)? { return Err("Partition exited outside its completion barrier".into()); }
        for w in &self.cfg.workers {
            if take_reply(w)? { return Err("Duplicate/unsolicited partition completion".into()); }
        }
        for &edge in &self.cfg.edges {
            if try_sem(edge)? { return Err("Duplicate/unconsumed dependency publication".into()); }
        }
        Ok(())
    }

    pub fn dispatch(&self) -> Result<(), String> {
        for (w, record) in self.cfg.workers.iter().zip(&self.records) {
            let data = &record.command;
            let target = unsafe { self.base.add(w.command[0]) };
            unsafe {
                std::ptr::copy_nonoverlapping(data.as_ptr(), target.add(4), data.len());
                std::ptr::copy_nonoverlapping((data.len() as u32).to_le_bytes().as_ptr(), target, 4);
                if libc::sem_post(w.command_sem as *mut _) != 0 { return Err(os_error()); }
            }
        }
        Ok(())
    }

    fn verify(&self, i: usize) -> Result<(), String> {
        let w = &self.cfg.workers[i];
        let base = unsafe { self.base.add(w.reply[0]) };
        let n = u32::from_le_bytes(unsafe { std::ptr::read_unaligned(base.cast()) }) as usize;
        if n == 0 || n > w.reply[1]-4 { return Err("Invalid partition mailbox length".into()); }
        let actual = unsafe { std::slice::from_raw_parts(base.add(4), n) };
        let wanted = &self.records[i].done;
        if actual == wanted { return Ok(()); }
        // Preserve worker diagnostics. JSON field order is not an identity field.
        if actual.first() == Some(&b'{') {
            let value: serde_json::Value = serde_json::from_slice(actual).map_err(|e|e.to_string())?;
            if value["type"] == "ERROR" {
                return Err(format!("Partition {} {}: {}", w.id, value["code"], value["detail"]));
            }
            if serde_json::from_slice::<serde_json::Value>(wanted).ok().as_ref() == Some(&value) { return Ok(()); }
        }
        Err("Partition completion does not match sealed interval/artifact".into())
    }

    pub fn collect(&mut self, deadline: Instant, cancelled: extern "C" fn() -> bool) -> Result<(), String> {
        let mut pending = (1u64.checked_shl(self.cfg.workers.len() as u32).unwrap_or(0)).wrapping_sub(1);
        while pending != 0 {
            let now = Instant::now();
            if now >= deadline { return Err("Partition operation timed out".into()); }
            if cancelled() { return Err("Partition operation cancelled".into()); }
            for (i, w) in self.cfg.workers.iter().enumerate() {
                if pending & (1 << i) != 0 && take_reply(w)? {
                    self.verify(i)?;
                    pending &= !(1 << i);
                }
            }
            if pending == 0 { break; }
            if poll(&mut self.deaths, 0)? {
                // A child publishes its specific ERROR before exiting.
                for (i, w) in self.cfg.workers.iter().enumerate() {
                    if pending & (1 << i) != 0 && take_reply(w)? { self.verify(i)?; }
                }
                return Err("A partition exited unexpectedly".into());
            }
            let delay = deadline.saturating_duration_since(Instant::now()).min(Duration::from_millis(5));
            let first = pending.trailing_zeros() as usize;
            if self.cfg.workers[first].reply_fd.is_some() {
                // Darwin's completion datagrams wake poll immediately. Re-scan all
                // pending mailboxes after waking, preserving each semaphore fence.
                let _ = poll(&mut self.wake_fds, delay.as_millis().max(1) as i32)?;
            } else {
                #[cfg(target_os="linux")]
                {
                    let mut ts = libc::timespec { tv_sec: 0, tv_nsec: 0 };
                    if unsafe { libc::clock_gettime(libc::CLOCK_REALTIME, &mut ts) } != 0 { return Err(os_error()); }
                    ts.tv_nsec += delay.as_nanos() as libc::c_long;
                    ts.tv_sec += ts.tv_nsec / 1_000_000_000;
                    ts.tv_nsec %= 1_000_000_000;
                    if unsafe { libc::sem_timedwait(self.cfg.workers[first].reply_sem as *mut _, &ts) } == 0 {
                        self.verify(first)?;
                        pending &= !(1 << first);
                    } else if !matches!(io::Error::last_os_error().raw_os_error(), Some(libc::ETIMEDOUT | libc::EINTR)) {
                        return Err(os_error());
                    }
                }
                #[cfg(not(target_os="linux"))]
                return Err("Unsupported completion transport".into());
            }
        }
        self.quiescent()
    }
}
