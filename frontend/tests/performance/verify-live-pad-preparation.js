// Run on the stopped UX Baseline Legacy fixture with the browser-clock backend.
async page => {
  const check = (value, message) => { if (!value) throw Error(message); };
  const button = (name, within = page) => within.getByRole("button", { name, exact: true });
  const manual = page.getByRole("group", { name: "Manual lead", exact: true });
  const mode = manual.getByRole("combobox", { name: "Pad mode" });
  const data = () => page.evaluate(() => {
    const state = window.__workspaceTest.store.getState();
    const track = state.sequencer.tracks.find(t => t.id === "manual");
    return { pads: track.pads, pattern: track.padLoopPattern, editing: state.sequencerEditingPads.manual ?? track.activePad };
  });
  const bounded = () => page.evaluate(() => {
    const doc = document.scrollingElement;
    return doc.scrollHeight <= innerHeight + 1 && doc.scrollWidth <= innerWidth + 1;
  });
  await button("Live").click();
  const before = await data();
  check(await button("Pad 1", manual).getAttribute("aria-description").then(s => s.includes("Populated")), "Missing content mark");
  check(await button("Pad 3", manual).getAttribute("aria-description").then(s => s.includes("Empty")), "Missing empty mark");
  await mode.selectOption("actions");
  await button("Pad actions · Pad 1", manual).click();
  await button("Pad actions · Pad 1", manual).dragTo(button("Pad actions · Pad 2", manual));
  check(JSON.stringify((await data()).pads) === JSON.stringify(before.pads), "Occupied drop overwrote immediately");
  await button("Replace · 1 → 2", manual).click();
  await button("Pad actions · Pad 2", manual).click();
  const pitch = before.pads[0].steps[0].note;
  await button("Notes in scale · Up · Pad 2", manual).click();
  check((await data()).pads[1].steps[0].note > pitch, "In-scale transpose missed physical pad 2");
  await button("Notes in scale · Down · Pad 2", manual).click();
  const down = button("Notes in scale · Down · Pad 2", manual);
  const arrow = await down.boundingBox();
  await page.mouse.move(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2);
  await page.mouse.down(); await page.waitForTimeout(400); await page.mouse.up();
  check((await data()).pads[1].scaleRoot !== before.pads[0].scaleRoot, "Holding the arrow did not shift the key");
  await manual.getByRole("combobox", { name: "Transpose" }).selectOption("key");
  await button("Move key by degree · Up · Pad 2", manual).press("Enter");
  check((await data()).pads[1].scaleRoot === before.pads[0].scaleRoot, "Explicit key-step did not reverse the hold");
  await button("Edit", manual).click();
  const disclosure = page.locator("summary", { hasText: "Pattern workspace" });
  await disclosure.click();
  const workspace = page.getByRole("region", { name: "Pattern workspace" });
  const insert = workspace.getByRole("combobox", { name: "Insert pad…" });
  await insert.selectOption("0"); await insert.selectOption("1");
  const strip = workspace.getByRole("list", { name: "Free workspace" });
  const stripBox = await strip.boundingBox();
  await button("Pad actions · Pad 1", manual).dragTo(strip, { targetPosition: { x: stripBox.width - 6, y: stripBox.height / 2 } });
  await button("Select all", workspace).click();
  await button("Group", workspace).click();
  const group = (await data()).pattern.groups.at(-1);
  check(group.sequence.map(item => item.padIndex).join() === "0,1,0", "Wrong grouped references");
  await button("Group " + group.id, workspace).click();
  await insert.selectOption("1");
  await button("Apply", workspace).click();
  const after = await data();
  check(after.pattern.groups.at(-1).sequence.length === 4 && JSON.stringify(before.pattern.rootSequence) === JSON.stringify(after.pattern.rootSequence), "Apply changed song order");
  check(JSON.stringify(before.pads[0]) === JSON.stringify(after.pads[0]) && after.editing === before.editing, "Preparation changed source or editing selection");
  await page.screenshot({ path: "screenshots/perform-workspace-live-pad-actions.png" });
  check(await bounded(), "Desktop document overflow");
  await mode.selectOption("preview");
  const speaker = button("Audition Manual lead · Pad 3", manual);
  await speaker.press("Space");
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__workspaceTest.store.getState().activeSessionState !== "running"), "Short speaker press started instruments");
  await speaker.focus(); await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__workspaceTest.store.getState().performanceAuditions.manual?.preview_active);
  check(await button("Play", manual).isVisible(), "Standalone preview started the Manual device");
  await page.keyboard.press("Escape"); await page.keyboard.up("Space");
  await page.waitForFunction(() => !window.__workspaceTest.store.getState().performanceAuditions.manual?.preview_gesture);
  check((await data()).editing === before.editing, "Cold preview changed the editing pad");
  await mode.selectOption("launch");
  await button("Pad 1", manual).click();
  await button("Play", manual).click();
  await manual.locator('[data-sounding][aria-label="Pad 1"]').waitFor();
  await button("Pad 2", manual).click();
  await manual.locator('[data-queued][aria-label="Pad 2"]').waitFor();
  await mode.selectOption("preview");
  await speaker.focus(); await page.keyboard.down("Enter");
  await page.waitForFunction(() => window.__workspaceTest.store.getState().performanceAuditions.manual?.preview_active);
  try {
    await page.waitForFunction(() => window.__workspaceTest.store.getState().performanceAuditions.manual?.manual_active_pad === 1, null, {timeout:12000});
  } catch (error) {
    throw Error("Queued launch under speaker: " + JSON.stringify(await page.evaluate(async () => {
      const state = window.__workspaceTest.store.getState();
      const status = await fetch("/api/sessions/" + state.activeSessionId + "/sequencer/status").then(r => r.json());
      return { audible: state.performanceAuditions.manual, engine: status.auditions.manual, track: status.tracks.find(t => t.track_id === "manual"), error: state.error };
    })), { cause: error });
  }
  await page.keyboard.up("Enter");
  await mode.selectOption("launch");
  await manual.locator('[data-sounding][aria-label="Pad 2"]').waitFor();
  check((await data()).editing === 1, "Speaker changed editing pad");
  await button("Stop", manual).click();
  await button("Play", manual).waitFor();
  await page.setViewportSize({ width:390, height:844 });
  await button("Keyboard").click();
  await page.getByRole("combobox", {name:"Device", exact:true}).selectOption("manual");
  await mode.selectOption("preview"); await speaker.waitFor();
  check(await bounded(), "Phone document overflow with keys and speakers");
  const piano = button("C4", page.getByRole("region", { name: "Keyboard", exact: true }));
  const cdp = await page.context().newCDPSession(page);
  const point = async (element, id) => {
    await element.scrollIntoViewIfNeeded();
    const box = await element.boundingBox();
    return { id, x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  };
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  try {
    const key = await point(piano, 0), pad = await point(speaker, 1);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [key] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [key, pad] });
    await page.waitForFunction(() => window.__workspaceTest.store.getState().performanceAuditions.manual?.preview_active);
    check(await piano.getAttribute("aria-pressed") === "true", "Preview released the held note");
    await page.screenshot({ path: "screenshots/perform-workspace-live-pad-preview.png" });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [pad] });
    await page.waitForFunction(() => !window.__workspaceTest.store.getState().performanceAuditions.manual?.preview_gesture);
    check(await piano.getAttribute("aria-pressed") === "true" && (await data()).editing === 1, "Speaker release changed the note or pad selection");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  }
  await button("Stop Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  // Save a disposable copy, leaving the named baseline available for the next replay.
  await page.evaluate(async () => {
    const store = window.__workspaceTest.store;
    store.setState({ currentPerformanceId: null, performanceName: "Live preparation " + crypto.randomUUID() });
    await store.getState().saveCurrentPerformance();
    if (store.getState().error) throw Error(store.getState().error);
    await store.getState().loadPerformance(store.getState().currentPerformanceId);
  });
  const loaded = await data();
  check(JSON.stringify(loaded.pattern) === JSON.stringify(after.pattern) &&
    JSON.stringify(loaded.pads.slice(0, 2)) === JSON.stringify(after.pads.slice(0, 2)), "Saved pads or phrase changed on reload");
  await page.setViewportSize({ width: 1440, height: 900 });
  await button("Live").click();
  const copiedDevices = [];
  for (const [kind, key] of [["drummer", "drummerTracks"], ["score", "scoreTracks"], ["controller", "controllerSequencers"], ["arpeggiator", "arpeggiators"]]) {
    await page.getByRole("combobox", { name: "Add live device" }).selectOption(kind);
    const fixture = await page.evaluate(({ kind, key }) => {
      const store = window.__workspaceTest.store, state = store.getState();
      const device = structuredClone(state.sequencer[key].at(-1)), pad = device.pads[0];
      if (kind === "drummer") Object.assign(pad.rows[0].steps[0], { active: true, velocity: 91 });
      if (kind === "controller") pad.keypoints[0].value = 76;
      if (kind === "arpeggiator") pad.rotation = 2;
      if (kind === "score") pad.notes = [
        { id: "heard", pitch: 64, velocity: 91, startTicks: 0, durationTicks: 1000 },
        { id: "hidden", pitch: 67, velocity: 85, startTicks: 2000000, durationTicks: 3000 }
      ];
      store.setState({ sequencer: { ...state.sequencer, [key]: state.sequencer[key].map(t => t.id === device.id ? device : t) } });
      return { id: device.id, pad };
    }, { kind, key });
    const row = page.locator('.ws-launcher [data-live-device="' + fixture.id + '"]');
    await row.getByRole("combobox", { name: "Pad mode" }).selectOption("actions");
    await button("Pad actions · Pad 1", row).click();
    await row.getByRole("combobox", { name: "Copy pad to…" }).selectOption("2");
    await row.getByRole("button", { name: /^(Copy|Replace) · 1 → 3$/ }).click();
    const copied = await page.evaluate(({ key, id }) => {
      const state = window.__workspaceTest.store.getState(), device = state.sequencer[key].find(t => t.id === id);
      return { source: device.pads[0], dest: device.pads[2], editing: state.sequencerEditingPads[id] ?? device.activePad,
        running: state.activeSessionState === "running" };
    }, { key, id: fixture.id });
    if (kind === "score") {
      check(copied.dest.notes.every(n => copied.source.notes.every(s => s.id !== n.id)), "Copy shared Score note IDs");
      copied.dest.notes.forEach((n, i) => { n.id = copied.source.notes[i].id; });
    }
    check(JSON.stringify(copied.source) === JSON.stringify(fixture.pad) && JSON.stringify(copied.dest) === JSON.stringify(copied.source)
      && copied.editing === 0 && !copied.running, "Copy changed source, editing or playback on " + kind);
    copiedDevices.push(kind);
  }
  return { phrase: group.sequence.map(i => i.padIndex + 1), desktopAndPhoneBounded: true, restoredPad: 2, copiedDevices };
}
