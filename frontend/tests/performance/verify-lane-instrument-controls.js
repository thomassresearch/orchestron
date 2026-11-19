// English, stopped UX Baseline Clip or Legacy, disposable library, 1440 × 900.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const rack = page.locator(".ws-compact-rack");
  const controllers = id => page.locator(`[data-lane-controllers="${id}"]`);
  const dock = page.locator(".ws-dock");
  const pick = id => rack.locator(`[data-rack-instance="${id}"]`);
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const openRack = async () => {
    if (!await rack.isVisible()) await button("Compact rack").click();
  };
  async function expectCards(...ids) {
    await page.waitForFunction(expected => {
      const cards = [...document.querySelectorAll(".ws-dock [data-mix-detail-instance]")];
      return cards.map(c => c.dataset.mixDetailInstance).join() === expected.join();
    }, ids);
  }
  const snapshot = () => page.evaluate(() => JSON.stringify(window.__workspaceTest.store.getState().buildSequencerConfigSnapshot()));
  const file = await page.evaluateHandle(() => Object.assign(document.createElement("input"), { type: "file" }));
  await file.asElement().setInputFiles("backend/tests/fixtures/patches/stereo_chorus.patch.json");
  const patch = await file.evaluate(async el => JSON.parse(await el.files[0].text()));
  await file.dispose();
  const url = new URL("/api/patches", page.url()).href;
  if (!(await (await page.request.get(url)).json()).some(p => p.name === patch.name)) {
    const response = await page.request.post(url, { data: { name: patch.name, graph: patch.graph,
      always_on: true, instrument_type: patch.instrument_type, schema_version: 1 } });
    check(response.ok(), await response.text());
  }
  const insert = await page.evaluate(async name => {
    const store = window.__workspaceTest.store;
    await store.getState().refreshPatches();
    const patchId = store.getState().patches.find(p => p.name === name).id;
    store.getState().addSequencerInstrument(patchId);
    const s = store.getState(), id = s.sequencerInstruments.find(b => b.patchId === patchId).id;
    const { wireInsertChain } = await import("/src/lib/insertRouting.ts");
    store.setState({ audioGraph: wireInsertChain(s.audioGraph, s.sequencerInstruments, s.patches, "routed", [id]) });
    return id;
  }, patch.name);

  const clip = page.locator('[data-arranger-clip="phrase-1"]');
  const clipBased = await clip.count() > 0;
  if (clipBased) await clip.getByTitle(/Chorus · Drag clip/).click();
  else await page.locator('[data-arrangement-lane="phrase"] [data-arrangement-occurrence]').first().click({ position: { x: 6, y: 8 } });
  await openRack();
  await pick("routed").click();
  await pick("direct").click({ modifiers: ["Shift"] });
  const before = await snapshot();
  check(await controllers("manual").isDisabled(), "A lane with no published controls offers Controllers");
  check(await page.locator(".ws-inspector [data-mix-detail]").count() === 0, "Inspector still offers instrument controls");
  await button("Instrument controls (2)", rack).click();
  await expectCards("routed", insert, "direct");
  check(await button("Arrange").getAttribute("aria-pressed") === "true", "Compact rack left Arrange");
  await button("Close", dock).click();
  await button("Editor").click();
  if (clipBased) {
    await button("Create variation here", dock).click();
    await button("HOLD", dock).nth(2).click();
  }
  const editor = await dock.innerText();
  const draft = () => page.evaluate(() => {
    const s = window.__workspaceTest.store.getState();
    return JSON.stringify([s.clipEditingKey, s.clipDrafts, s.sequencerEditingPads.phrase]);
  });
  const originalDraft = await draft();
  await controllers("phrase").click();
  await expectCards("routed", insert);
  check(await page.locator(".ws-overview").isVisible() && await button("Arrange").getAttribute("aria-pressed") === "true", "Lane controls hid the timeline");
  if (clipBased) await page.screenshot({ path: "screenshots/perform-arrange-instrument-controls.png" });
  check(await snapshot() === before, "Opening controls or an unsaved variation changed the authored configuration");
  const value = dock.locator(`[data-mix-detail-instance="${insert}"]`).getByRole("spinbutton").first();
  const originalValue = await value.inputValue();
  await value.press("ArrowUp");
  await value.press("Enter");
  check(await value.inputValue() !== originalValue, "Insert control did not accept an edit");
  await button("Back to editor", dock).click();
  check(await draft() === originalDraft && await dock.innerText() === editor, "Lost the open editor or its unsaved draft");
  if (clipBased) {
    await button("Start Instruments").click();
    try {
      await button("Play edit", dock).click();
      await page.waitForFunction(() => window.__workspaceTest.store.getState().performanceAuditions.phrase?.workspace_active);
      const session = await page.evaluate(() => window.__workspaceTest.store.getState().activeSessionId);
      await controllers("phrase").click();
      const effect = dock.locator(`[data-mix-detail-instance="${insert}"]`);
      const bypass = effect.getByRole("button", { name: /Bypass$/ });
      await bypass.click();
      check(await bypass.getAttribute("aria-pressed") === "true", "The insert did not bypass");
      await bypass.click();
      await button("Back to editor", dock).click();
      check(await page.evaluate(session => {
        const s = window.__workspaceTest.store.getState();
        return s.activeSessionId === session && s.performanceAuditions.phrase?.workspace_active;
      }, session), "Tweaking the insert interrupted the clip audition");
      await dock.getByRole("button", { name: /^Stop edit/ }).click();
    } finally {
      if (await button("Stop Instruments").count()) await button("Stop Instruments").click();
    }
  }
  await controllers("phrase").click();
  await button("Mix").click();
  check(await dock.count() === 0, "Arrange controls replaced the Mix layout");
  await button("Arrange").click();
  await expectCards("routed", insert);
  await button("Editor").click();
  check(await draft() === originalDraft, "View switch lost the draft");
  await button("Live").click();
  await openRack();
  await pick("direct").click();
  await pick("routed").press("Shift+Enter");
  await button("Instrument controls (2)", rack).click();
  await expectCards("direct", "routed", insert);
  await pick("direct").press("Shift+Space");
  await expectCards("routed", insert);

  await button("Arrange").click();
  await page.evaluate(() => {
    const store = window.__workspaceTest.store;
    store.getState().addArpeggiator();
    const s = store.getState(), arp = s.sequencer.arpeggiators.at(-1);
    s.updateArpeggiator(arp.id, { targetChannel: 1 });
    s.setSequencerTrackMidiChannel("manual", arp.inputChannel);
  });
  await controllers("manual").click();
  await expectCards("routed", insert);
  await controllers("manual").click();
  const controller = await page.evaluate(async () => {
    const store = window.__workspaceTest.store, s = store.getState();
    if (s.sequencer.clipArrangement) {
      const { addClipLane } = await import("/src/store/clipActions.ts");
      addClipLane("controller", s.addControllerSequencer);
    } else s.addControllerSequencer();
    const track = store.getState().sequencer.controllerSequencers.at(-1);
    store.getState().setControllerSequencerTargetChannels(track.id, [1, 2]);
    return track.id;
  });
  await controllers(controller).click();
  await expectCards("routed", insert, "direct");
  let target = controller;
  if (clipBased) {
    target = await page.evaluate(async () => {
      const s = window.__workspaceTest.store.getState();
      s.setPerformanceControllerMidiCC("routed", "sax_tone", 12);
      const { generateAutomation } = await import("/src/store/automationActions.ts");
      generateAutomation("phrase", "phrase-1", "routed");
      return window.__workspaceTest.store.getState().sequencer.controllerSequencers.find(t => t.automationTarget?.instrumentId === "routed").id;
    });
    await controllers(target).click();
    await expectCards("routed", insert);
  }
  await page.setViewportSize({ width: 640, height: 360 });
  await page.locator(".ws-panes[data-split]").waitFor();
  check(await page.locator(".ws-overview").isVisible() && await dock.isVisible(), "Short screen lost the split");
  await page.waitForFunction(id => {
    const lane = document.querySelector(`[data-lane-controllers="${CSS.escape(id)}"]`);
    const box = lane.getBoundingClientRect();
    return lane.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }, target);
  check(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight &&
    document.documentElement.scrollWidth === innerWidth && !scrollX && !scrollY), "Perform scrolls at page level");
  await page.setViewportSize({ width: 1440, height: 900 });
  if (clipBased) {
    await page.evaluate(() => {
      const s = window.__workspaceTest.store.getState();
      s.removeSequencerInstrument("routed");
      s.updateSequencerInstrumentChannel("direct", 1);
    });
  } else await page.evaluate(id => window.__workspaceTest.store.getState().setControllerSequencerTargetChannels(id, [16]), controller);
  check(await controllers(target).isDisabled(), "A lane without a playable controller opens unrelated instruments");
  check(await dock.locator("[data-mix-detail-instance]").count() === 0, "Stale instrument controls are visible");
  return { clipBased, draftRestored: true, shortSplit: [640, 360] };
}
