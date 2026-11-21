// English workspace, disposable UX Baseline Legacy. Run verify-workspace-roundtrip.js afterwards.
async page => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const row = id => page.locator('.ws-launcher [data-live-device="' + id + '"]');
  const order = () => page.evaluate(() => window.__workspaceTest.store.getState().sequencer.tracks.map(t => t.id).join());
  const bounded = () => page.evaluate(() => {
    const doc = document.scrollingElement;
    return !doc.scrollTop && !doc.scrollLeft && doc.scrollHeight <= innerHeight + 1 && doc.scrollWidth <= innerWidth + 1;
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    const state = window.__workspaceTest.store.getState();
    const config = state.buildSequencerConfigSnapshot();
    const [lead, manual] = config.sequencer.tracks;
    const pad = padIndex => ({ type: "pad", padIndex });
    const group = groupId => ({ type: "group", groupId });
    const phrases = { groups: [{ id: "A", sequence: [pad(0), pad(1)] }, { id: "B", sequence: [pad(1)] }],
      superGroups: [{ id: "I", sequence: [group("A"), pad(1)] }], rootSequence: [group("A"), group("A")] };
    config.sequencer.tracks = [{ ...lead, padLoopPattern: phrases }, manual,
      ...["Pulse", "Countermelody", "Chords", "Sub bass"].map((name, i) => ({ ...manual, name, id: "voice" + i,
        enabled: false, midiChannel: 3 + i, syncToTrackId: i === 3 ? lead.id : null, padLoopPattern: structuredClone(phrases) }))];
    state.applySequencerConfigSnapshot(config);
  });
  const lane = page.locator('section:has(> div [data-arrangement-lane="voice3"])').filter({ has: page.locator('button[title="Sub bass"]') }).last();
  await button("Routed phrase").click();
  // Arrange previously had a different lane open, a collapsed overview, and an expanded editor.
  await page.locator('[data-arrangement-lane="manual"] [data-arrangement-occurrence]').first().dblclick({ position: { x: 5, y: 8 } });
  await page.locator("#multitrack-arranger button[aria-controls]").first().click();
  await button("Expand", page.locator(".ws-dock")).click();
  await button("Live").click();
  const manual = row("manual"), bass = row("voice3");
  await button("Edit", bass).click();
  await button("Settings", page.locator(".ws-dock")).click();
  await page.locator('.ws-dock summary', { hasText: "Pattern workspace" }).click();
  check(await page.locator(".ws-dock").getByRole("combobox", { name: "Sync To" }).inputValue() === "phrase", "Editor lost the sync destination");
  const workspace = page.getByRole("region", { name: "Pattern workspace" });
  await button("Group B", workspace).click();
  await workspace.getByRole("combobox", { name: "Insert pad…" }).selectOption("0");
  check(await button("Apply", workspace).isEnabled(), "Missing draft");
  const original = await order();
  check(await button("Move up", row("phrase")).isDisabled() && await button("Move down", bass).isDisabled(), "Wrong end stops");
  await button("Move up", bass).press("Enter");
  check(await order() === "phrase,manual,voice0,voice1,voice3,voice2", "Keyboard move missed its neighbor");
  check(await button("Move up", bass).evaluate(el => el === document.activeElement), "Moved row lost keyboard focus");
  const grip = row("voice2").getByRole("img", { name: "Drag to reorder melodic devices" });
  await grip.dragTo(bass, { targetPosition: { x: 35, y: 3 } });
  check(await order() === original, "Drop before did not restore the original order");

  // Verify edge scrolling, Escape and payload isolation while the editor limits the launcher height.
  const launcher = page.locator(".ws-launcher");
  const pane = page.locator(".ws-overview");
  await pane.evaluate(el => { el.scrollTop = 0; });
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await row("phrase").locator("[draggable=true]").first().dispatchEvent("dragstart", { dataTransfer: dt });
  const bounds = await pane.boundingBox();
  const point = { x: bounds.x + 38, y: bounds.y + bounds.height - 4 };
  await page.evaluate(({ x, y, dt }) => document.elementFromPoint(x, y).dispatchEvent(new DragEvent("dragover", {
    bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y
  })), { ...point, dt });
  await page.waitForFunction(() => document.querySelector(".ws-overview").scrollTop > 30);
  await page.keyboard.press("Escape");
  await bass.dispatchEvent("drop", { dataTransfer: dt, clientY: 0 });
  check(await order() === original && !await launcher.locator("[data-drop-position]").count(), "Escape left an active drop");
  await dt.dispose();
  // Hold at the edge until a previously hidden melodic row is exposed; then drop below it.
  const edgeDrag = await page.evaluateHandle(() => new DataTransfer());
  await pane.evaluate(el => { el.scrollTop = 0; });
  await row("phrase").getByRole("img").dispatchEvent("dragstart", { dataTransfer: edgeDrag });
  await page.evaluate(({ x, y, dt }) => document.elementFromPoint(x, y).dispatchEvent(new DragEvent("dragover", {
    bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y
  })), { ...point, dt: edgeDrag });
  await page.waitForFunction(() => {
    const pane = document.querySelector(".ws-overview").getBoundingClientRect(), last = document.querySelector('.ws-launcher [data-live-device="voice3"]').getBoundingClientRect();
    return last.bottom <= pane.bottom;
  });
  const bottom = await bass.boundingBox();
  await bass.dispatchEvent("drop", { dataTransfer: edgeDrag, clientY: bottom.y + bottom.height - 2 });
  check((await order()).endsWith("voice3,phrase") && await bounded(), "Drop past scroll edge failed");
  await edgeDrag.dispose();
  for (let i = 0; i < original.split(",").length - 1; ++i) await button("Move up", row("phrase")).click();
  check(await order() === original, "Moving back to the first position failed");
  await row("phrase").getByRole("img").dragTo(page.locator(".ws-dock h3").first());
  check(await order() === original, "Editor accepted a row drag");

  for (let i = 0; i < original.split(",").length - 1; ++i) await button("Move up", bass).click();
  await pane.evaluate(el => { el.scrollTop = 0; });
  check(await bounded(), "Desktop launcher scrolled the document");
  await page.screenshot({ path: "screenshots/perform-live-device-order.png" });
  for (let i = 0; i < original.split(",").length - 1; ++i) await button("Move down", bass).click();

  const stateFingerprint = () => page.evaluate(() => {
    const s = window.__workspaceTest.store.getState();
    return JSON.stringify([s.buildSequencerConfigSnapshot(), s.sequencerEditRevision, s.sequencerRuntime.arrangerTransportSubunit]);
  });
  const writes = [];
  const watchWrites = request => {
    const url = new URL(request.url());
    if (request.method() !== "GET" && /\/api\/(sessions|performances)(\/|$)/.test(url.pathname)) writes.push(url.pathname);
  };
  const reveal = async key => {
    const before = await stateFingerprint();
    page.on("request", watchWrites);
    try {
      await button("Open in arranger", workspace).click();
      await page.waitForFunction(key => {
        const el = document.activeElement, scroller = el.closest(".ws-overview");
        if (!scroller || el.dataset.definition !== key || !el.closest("section")?.querySelector('[data-arrangement-lane="voice3"]')) return false;
        const rect = el.getBoundingClientRect(), bounds = scroller.getBoundingClientRect();
        return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
      }, key);
      check(await bounded() && await stateFingerprint() === before && !writes.length, "Handoff changed the song, transport or page bounds");
    } finally { page.off("request", watchWrites); }
  };
  await reveal("group:B");  // Unused, dirty, and another lane has the same group ID.
  await page.locator(".ws-inspector").getByText("Group B", { exact: true }).waitFor();
  await page.screenshot({ path: "screenshots/perform-arrange-legacy-phrase.png" });
  await button("Live").click();
  await button("Settings", page.locator(".ws-dock")).click();
  check(await button("Apply", workspace).isEnabled() && await button("Group B", workspace).getAttribute("aria-pressed") === "true", "Lost source draft");
  await button("Group A", workspace).click();
  await reveal("group:A"); // Repeated group.
  await page.setViewportSize({ width: 390, height: 700 });
  await button("Live").click();
  await button("Settings", page.locator(".ws-dock")).click();
  await button("Supergroup I", workspace).click();
  await reveal("super:I");
  await button("Live").click();
  await button("Settings", page.locator(".ws-dock")).click();
  await button("Free workspace", workspace).click();
  await button("Back to overview").click();
  await button("Pad 7", bass).click();
  await button("Edit", bass).click();
  await button("Settings", page.locator(".ws-dock")).click();
  await reveal("pad:6"); // The physical pad being edited can be empty and different from the playing pad.
  await lane.locator("button[title='Sub bass']").click();
  await button("Live").click(); await button("Arrange").click();
  check(await lane.locator("button[title='Sub bass']").getAttribute("aria-expanded") === "false", "Ordinary navigation replayed the handoff");
  await button("Live").click();
  await button("Back to overview").click();
  await button("Move up", bass).click();
  check(await order() === "phrase,manual,voice0,voice1,voice3,voice2" && await bounded(), "Phone reorder broke the workspace");
  await button("Edit", bass).click();
  await button("Settings", page.locator(".ws-dock")).click();
  await button("Group B", workspace).click();
  await page.evaluate(() => {
    const s = window.__workspaceTest.store.getState();
    const pattern = s.sequencer.tracks.find(t => t.id === "voice3").padLoopPattern;
    s.setSequencerTrackPadLoopPattern("voice3", { ...pattern, groups: pattern.groups.filter(g => g.id !== "B") });
  });
  await button("Open in arranger", workspace).click();
  await lane.getByRole("status").filter({ hasText: "This phrase is no longer in the lane." }).waitFor();
  check(await lane.locator("button[title='Sub bass']").evaluate(el => el === document.activeElement) && await bounded(), "Missing phrase did not focus its lane");
  await page.setViewportSize({ width: 1440, height: 900 });
  await button("Live").click();
  await page.getByRole("spinbutton", { name: "BPM" }).fill("60");
  await button("Play", manual).click();
  await manual.locator('[data-sounding][aria-label="Pad 1"]').waitFor();
  await button("Pad 2", manual).click();
  await manual.locator('[data-queued][aria-label="Pad 2"]').waitFor();
  const revision = await page.evaluate(() => window.__workspaceTest.store.getState().sequencerEditRevision);
  await button("Move up", manual).click();
  check((await order()).startsWith("manual,phrase,"), "Playing row did not move");
  await manual.locator('[data-sounding][aria-label="Pad 2"]').waitFor({ timeout: 15000 });
  check(await page.evaluate(rev => {
    const s = window.__workspaceTest.store.getState(), bass = s.sequencer.tracks.find(t => t.id === "voice3");
    return s.sequencerEditRevision === rev && s.sequencerRuntime.isPlaying && bass.syncToTrackId === "phrase" && bass.midiChannel === 6;
  }, revision), "Reorder changed audio configuration or routing");
  const target = row("phrase"), box = await target.boundingBox();
  await manual.getByRole("img").dragTo(target, { targetPosition: { x: 34, y: box.height - 3 } });
  check((await order()).startsWith("phrase,manual,"), "Drop after failed");
  await button("Stop", manual).click();
  await button("Play", manual).waitFor();
  if (await button("Stop Instruments").isVisible()) await button("Stop Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  return { order: await order(), phraseTargets: ["unused group", "repeated group", "supergroup", "physical pad"], handoffWrites: writes };
}
