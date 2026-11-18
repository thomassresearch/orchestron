// English workspace, stopped UX Baseline Clip. Extend an in-memory snapshot with a repeated group.
async page => {
  const button = (name, area = page) => area.getByRole("button", { name, exact: true });
  const edit = page.getByRole("region", { name: "Editing", exact: true });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const transport = page.getByRole("group", { name: "Song transport" });
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const timeline = page.locator("[data-arranger-viewport]");
  await page.evaluate(() => {
    const s = window.__workspaceTest.store.getState(), config = s.buildSequencerConfigSnapshot();
    const model = config.sequencer.clipArrangement, lane = model.lanes.find(l => l.id === "phrase");
    const pattern = lane.definitions[0];
    lane.definitions.push({ id: "verse-group", kind: "group", revision: 0, name: "Phrase group", children: [{ id: "leaf", definitionId: pattern.id }] });
    for (const clip of lane.clips) clip.children[0].definitionId = "verse-group";
    lane.clips[1].mode = "loop"; lane.clips[1].length = 12 * 20160; model.end = 48 * 20160;
    config.sequencer.arrangerLoopSelection = null;
    s.applySequencerConfigSnapshot(config);
    s.setPerformanceControllerMidiCC("routed", "sax_tone", 12);
  });
  const chorus = page.locator('[data-arranger-clip="phrase-1"]');
  const verse = page.locator('[data-arranger-clip="phrase-0"]');
  const nested = chorus.getByTitle("pattern: #1", { exact: true });
  const zoom = page.getByRole("slider", { name: "Zoom" });
  await zoom.fill("88");
  await chorus.getByTitle(/Chorus · Drag clip/).click();
  const groups = chorus.getByTitle("group: Phrase group", { exact: true });
  await groups.first().click();
  await groups.nth(1).click({ modifiers: ["Shift"] });
  check(await button("Editor").isDisabled(), "A range of occurrences offered an unrelated editor");
  await nested.nth(1).click();
  check(!await page.locator(".ws-dock").count(), "Selection opened a closed dock");
  check((await inspector.innerText()).includes("#1 · Pass 2"), "Inspector lost nested target");
  await button("Loop", transport).click();
  await button("Editor").click();
  await button("Create variation here", edit).click();
  await button("Start Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
  await button("Play", transport).click();
  try {
    await page.waitForFunction(() => {
      const s = window.__workspaceTest.store.getState();
      return s.sequencerRuntime.arrangerActive && s.sequencerRuntime.arrangerTransportSubunit > 0;
    });
    await button("HOLD", edit).nth(2).click();
    await button("Step properties 3", edit).click();
    await nested.nth(2).click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().clipDrafts[window.__workspaceTest.store.getState().clipEditingKey].target.pass === 2);
    await nested.nth(1).click();
    await button("Save variation here", edit).waitFor();
    await timeline.evaluate(el => { el.scrollLeft = 160; });
    await page.locator(".ws-dock-scroll").evaluate(el => { el.scrollTop = 240; });
    const before = await page.evaluate(() => {
      const s = window.__workspaceTest.store.getState(), h = window.__workspaceTest;
      h.clip = s.clipDrafts[s.clipEditingKey]; h.pad = s.sequencer.tracks.find(t => t.id === "phrase").pads[2];
      return { top: document.querySelector(".ws-dock-scroll").scrollTop, x: document.querySelector("[data-arranger-viewport]").scrollLeft, zoom: document.querySelector('[aria-label="Zoom"]').value, session: s.activeSessionId };
    });
    check(before.top > 0 && before.x > 0, "Timeline fixture must scroll horizontally");
    await button("Live").click();
    const phrase = page.getByRole("group", { name: "Routed phrase", exact: true });
    await button("Pad 3", phrase).click();
    await button("Edit", phrase).click();
    await button("HOLD").first().click();
    await button("Arrange").click();
    await edit.waitFor();
    await page.waitForFunction(({ x, zoom, top }) => document.querySelector(".ws-dock-scroll").scrollTop === top && document.querySelector("[data-arranger-viewport]").scrollLeft === x && document.querySelector('[aria-label="Zoom"]').value === zoom, before);
    check((await edit.getByRole("group", { name: "Step properties" }).innerText()).includes("Step 3"), "Selected step lost");
    const restored = await page.evaluate(session => {
      const h = window.__workspaceTest, s = h.store.getState(), d = s.clipDrafts[s.clipEditingKey];
      return { sameDraft: d === h.clip, pass: d.target.pass, depth: d.target.path.length, scope: d.editIntent.scope,
        padChanged: s.sequencer.tracks.find(t => t.id === "phrase").pads[2].steps[0].hold !== h.pad.steps[0].hold,
        sameSession: s.activeSessionId === session, playing: s.sequencerRuntime.arrangerActive };
    }, before.session);
    check(restored.sameDraft && restored.pass === 1 && restored.depth === 2 && restored.scope === "local" &&
      restored.padChanged && restored.sameSession && restored.playing, "Draft, pad or playback changed on return " + JSON.stringify(restored));
    await button("Save variation here", edit).click();
    await page.waitForFunction(() => {
      const l = window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes[0];
      return l.clips.length === 4 && l.definitions.some(d => d.name.includes("variation"));
    });
    check(await page.evaluate(() => {
      const h = window.__workspaceTest, lane = h.store.getState().sequencer.clipArrangement.lanes[0];
      const use = cl => {
        const group = lane.definitions.find(d => d.id === cl.children[0].definitionId);
        return lane.definitions.find(d => d.id === group.children[0].definitionId);
      };
      const [verse, before, variation, after] = lane.clips.map(use);
      return verse === before && verse === after && verse.id !== variation.id && verse.payload.steps[2].hold !== variation.payload.steps[2].hold;
    }), "Local save changed a sibling or missed its own repeat");
    await verse.getByTitle("pattern: #1", { exact: true }).dblclick();
    await button("Edit linked pattern (3)", edit).click();
    await button("Save linked pattern (3 uses)", edit).waitFor();
    // Starting a structural edit while this musical draft is dirty must require explicit resolution.
    await button("HOLD", edit).first().click();
    await verse.getByTitle("group: Phrase group", { exact: true }).dblclick();
    await button("Edit linked group (3)", edit).click();
    const desktop = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const conflict = page.getByRole("dialog", { name: "Unsaved musical draft" });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await button("Rest +1", edit).click();
      await button("Cancel", conflict).click();
    } finally {
      await page.setViewportSize(desktop);
    }
    check(await page.evaluate(() => Object.values(window.__workspaceTest.store.getState().clipDrafts).some(d => d.definition.kind === "pattern" && d.editIntent.scope === "all")), "Cancel lost the musical draft");
    // Rename in place so every linked group keeps its original musical boundaries.
    const name = edit.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("Linked phrase"); await name.press("Tab");
    await button("Discard", conflict).click();
    const save = edit.getByRole("button", { name: "Save linked structure (3 uses)" });
    await save.click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes[0].definitions.some(d => d.name === "Linked phrase"));
    check(await page.evaluate(() => {
      const lane = window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes[0];
      const names = lane.clips.map(c => lane.definitions.find(d => d.id === c.children[0].definitionId).name);
      return names.filter(n => n === "Linked phrase").length === 3;
    }), "Linked structure save missed a use");
  } finally {
    if (await button("Arrange").getAttribute("aria-pressed") !== "true") await button("Arrange").click();
    await button("Stop", transport).click();
    await page.waitForFunction(() => !window.__workspaceTest.store.getState().sequencerRuntime.arrangerActive);
    await button("Stop Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  }
  await verse.getByTitle(/Verse · Drag clip/).click();
  await button("Generate automation", inspector).click();
  const lane = page.locator("[data-clip-lane]").filter({ has: page.getByRole("button", { name: /UX Baseline Routed · CC 12/ }) });
  await lane.getByRole("button", { name: /UX Baseline Routed · CC 12/, expanded: false }).click();
  await lane.getByRole("button", { name: /^Edit:/ }).first().click();
  const rect = lane.locator("svg rect").filter({ visible: true }).first();
  const box = await rect.boundingBox();
  await rect.click({ position: { x: box.width * .48, y: box.height * .4 } });
  await edit.getByText("Curve points: 3/10", { exact: true }).waitFor();
  await button("Save pattern here", edit).click();
  check(await page.evaluate(() => window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes.some(l => l.definitions.some(d => d.payload?.keypoints?.length === 3))), "Inline curve failed to commit");
  const arranger = page.locator("[data-workspace-arranger]");
  await button("Undo", arranger).click();
  await page.waitForFunction(() => !window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes.some(l => l.definitions.some(d => d.payload?.keypoints?.length === 3)));
  await button("Mix").click();
  await button("Arrange").click();
  await button("Redo", arranger).click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes.some(l => l.definitions.some(d => d.payload?.keypoints?.length === 3)));
  return "Nested pass, scoped Save, conflict cancellation, Live isolation, inline curve and Undo/Redo across views verified";
}
