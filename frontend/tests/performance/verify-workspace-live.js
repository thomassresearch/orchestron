// English preview, stopped UX Baseline Legacy, Chromium with browser-clock audio.
// The same physical keyboard and Manual device run at desktop and phone sizes.
async page => {
  const button = (name, within = page) => within.getByRole("button", { name, exact: true });
  const group = name => page.getByRole("group", { name, exact: true });
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const viewport = page.viewportSize();
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(() => {
    window.liveMidi = [];
    const original = Worker.prototype.postMessage;
    window.restoreLiveMidi = () => { Worker.prototype.postMessage = original; delete window.liveKey; delete window.liveMidi; delete window.restoreLiveMidi; };
    Worker.prototype.postMessage = function(message, ...args) {
      if (message?.type === "manual_midi") window.liveMidi.push(message.midi);
      return original.call(this, message, ...args);
    };
  });
  try {
    await button("Live").click();
    const manual = group("Manual lead"), transport = group("Song transport");
    await button("Start Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
    await button("Add Controller").click();
    const controller = page.getByRole("article").filter({ has: page.getByRole("button", { name: /controller knob value/i }) });
    const channel = controller.getByRole("checkbox", { name: "MIDI channel 4", exact: true });
    await channel.check();
    if (await button("Start", controller).count()) await button("Start", controller).click();
    const knob = controller.getByRole("button", { name: /controller knob value/i });
    const initial = await page.evaluate(() => window.__workspaceTest.store.getState().sequencer.midiControllers[0].value);
    const box = await knob.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + (initial > 63 ? 24 : -24), { steps: 3 });
    await page.mouse.up();
    await page.waitForFunction(initial => window.liveMidi.some(m => m.type === "control_change" && m.channel === 4 && m.value !== initial), initial);
    const cc = await page.evaluate(() => window.__workspaceTest.store.getState().sequencer.midiControllers[0].value);
    await button("Mix").click();
    await button("Live").click();
    check(await channel.isChecked() && (await knob.getAttribute("aria-label")).endsWith(String(cc)), "Live lost the MIDI controller settings");
    await button("Pad 1", manual).click();
    await button("Keyboard").click();
    const keyboard = page.getByRole("region", { name: "Keyboard", exact: true });
    const details = keyboard.locator("details").filter({ has: page.locator("summary", { hasText: "Keyboard settings" }) });
    await details.locator("summary").click();
    await details.getByRole("checkbox", { name: /autochord/i }).check();
    await details.locator("summary").click();
    const piano = button("C4", keyboard);
    const touch = (type, touchPoints) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
    const point = async (el, id) => {
      const box = await el.boundingBox();
      return { id, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height - 12) };
    };
    const logs = [];
    for (const phone of [false, true]) {
      if (phone) {
        await page.setViewportSize({ width: 390, height: 844 });
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
        await page.getByRole("combobox", { name: "Device", exact: true }).selectOption("manual");
      }
      await button("Pad 1", manual).click();
      await button("Play", manual).click();
      await manual.locator('[data-sounding][aria-label="Pad 1"]').waitFor();
      await piano.scrollIntoViewIfNeeded();
      const note = await point(piano, 0);
      await piano.evaluate(el => { window.liveKey = el; window.liveMidi.length = 0; });
      if (phone) await touch("touchStart", [note]);
      else { await piano.focus(); await page.keyboard.down("Space"); }
      await page.waitForFunction(() => window.liveMidi.filter(m => m.type === "note_on").length >= 3);
      const started = await page.evaluate(() => window.liveMidi.filter(m => m.type === "note_on"));
      if (phone) {
        const picker = page.getByRole("combobox", { name: "Device", exact: true });
        await picker.selectOption("phrase");
        await picker.selectOption("manual");
      } else {
        await button("Pad 4", group("Routed phrase")).click();
      }
      check(await piano.evaluate(el => window.liveKey === el && el.getAttribute("aria-pressed") === "true"), "Changing the launch device replaced the keyboard");
      for (const pad of [2, 3]) {
        const target = button("Pad " + pad, manual);
        if (phone) {
          const tap = await point(target, 1);
          await touch("touchStart", [note, tap]);
          await touch("touchEnd", [tap]);
        } else await target.click();
        await manual.locator('[data-queued][aria-label="Pad ' + pad + '"]').waitFor();
        if (pad === 2) await page.screenshot({ path: 'screenshots/perform-workspace-live-' + (phone ? 'keyboard' : 'launcher') + '.png' });
        await manual.locator('[data-sounding][aria-label="Pad ' + pad + '"]').waitFor({ timeout: 10000 });
        check(await piano.evaluate(el => window.liveKey === el && el.getAttribute("aria-pressed") === "true" &&
          !window.liveMidi.some(m => m.type === "note_off")), "Launch interrupted the held chord");
      }
      // Song controls operate on the arranged track, while the independently started device runs.
      await button("Play", transport).click();
      await button("Fast forward 1 beat", transport).click();
      await button("Stop", transport).click();
      await manual.locator('[data-sounding][aria-label="Pad 3"]').waitFor();
      await button("Mix").click();
      if (phone) await touch("touchEnd", []); else await page.keyboard.up("Space");
      const pitches = events => events.map(m => [m.source_id, m.channel, m.note].join("/")).sort().join(" ");
      await page.waitForFunction(n => window.liveMidi.filter(m => m.type === "note_off").length >= n, started.length);
      await button("Live").click();
      await keyboard.waitFor();
      const events = await page.evaluate(() => window.liveMidi);
      check(pitches(started) === pitches(events.filter(m => m.type === "note_off")) && pitches(started) === pitches(events.filter(m => m.type === "note_on")), "A note leaked or replayed on view change");
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Workspace overflows browser horizontally");
      await button("Stop", manual).click();
      await button("Play", manual).waitFor();
      logs.push({ viewport: phone ? "phone" : "desktop", pitches: pitches(started), pads: [1, 2, 3] });
    }
    await button("Edit", manual).click();
    await page.getByRole("heading", { name: "Manual lead / Pad 3" }).waitFor();
    await page.getByText("Pad saved in performance", { exact: true }).waitFor();
    await button("HOLD").first().click();
    await page.getByText("Unsaved pad changes", { exact: true }).waitFor();
    await button("Stop Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
    return logs;
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
    if (viewport) await page.setViewportSize(viewport);
    await page.evaluate(() => window.restoreLiveMidi());
  }
}
