// English clip-enabled workspace. Use an isolated database; the empty-library case creates a starter instrument.
async page => {
  const b = (name, area = page) => area.getByRole("button", { name, exact: true });
  await page.locator(".ws-project summary").click(); await b("New").click();
  const add = page.getByRole("combobox", { name: "Add track", exact: true });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const edit = page.getByRole("region", { name: "Editing", exact: true });
  await add.selectOption("sequencer");
  const choose = inspector.getByRole("combobox", { name: "Add Instrument", exact: true });
  await choose.selectOption({ label: "UX Baseline Direct" });
  await page.waitForFunction(() => window.__workspaceTest.store.getState().sequencerInstruments.length === 1);
  const assigned = await page.evaluate(() => {
    const s = window.__workspaceTest.store.getState();
    return s.sequencer.tracks[0].midiChannel === s.sequencerInstruments[0].midiChannel;
  });
  if (!assigned) throw Error("The new track did not receive the instrument's channel");
  for (const kind of ["drummer", "score", "controller", "arpeggiator"]) {
    await add.selectOption(kind);
    await page.waitForFunction(kind => {
      const s = window.__workspaceTest.store.getState();
      return s.clipDrafts[s.clipEditingKey]?.definition.source === kind;
    }, kind);
    if (!await edit.isVisible()) throw Error("Missing dock for " + kind);
  }
  const arpId = await page.evaluate(() => {
    const s = window.__workspaceTest.store.getState(), arp = s.sequencer.arpeggiators[0], roll = s.sequencer.pianoRolls[0];
    s.setPianoRollMidiChannel(roll.id, arp.inputChannel); s.setPianoRollEnabled(roll.id, true);
    return arp.id;
  });
  await b("Start Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
  try {
    await b("Play edit", edit).click();
    await page.waitForFunction(id => window.__workspaceTest.store.getState().performanceAuditions[id]?.workspace_active, arpId);
    await b("Keyboard").click();
    const key = b("C4", page.getByRole("region", { name: "Keyboard" }));
    await key.focus(); await page.keyboard.down("Space");
    await page.waitForFunction(id => {
      const s = window.__workspaceTest.store.getState(), arp = s.sequencerRuntime.arpeggiatorStatusById[id];
      return s.performanceAuditions[id]?.workspace_active && arp?.heldNotes.includes(60) &&
        (arp.activeNote != null || arp.status?.active_notes?.length);
    }, arpId, { timeout: 8000 }).catch(async error => {
      const current = await page.evaluate(id => window.__workspaceTest.store.getState().sequencerRuntime.arpeggiatorStatusById[id], arpId);
      throw Error("No generated arpeggio while holding C4: " + JSON.stringify(current), { cause: error });
    });
    await page.keyboard.up("Space");
    await b("Keyboard").click(); await b("Stop edit", edit).click();
  } finally {
    await page.keyboard.up("Space");
    await b("Stop Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  }

  await page.locator(".ws-project summary").click(); await b("New").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes.length === 0);
  // Simulate the initial library of a new installation without removing anything from the backend.
  await page.evaluate(() => window.__workspaceTest.store.setState({ patches: [] }));
  await add.selectOption("sequencer");
  await b("Create playable instrument", inspector).click();
  await page.waitForFunction(() => {
    const s = window.__workspaceTest.store.getState();
    return s.sequencerInstruments.length === 1 && s.audioGraph.routes.length === 2;
  });
  const step = b("Step properties 1", edit).locator("../..").getByRole("combobox").first();
  await step.selectOption({ value: "0" });
  await b("Start Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
  try {
    await b("Play edit", edit).click();
    await page.waitForFunction(() => Object.values(window.__workspaceTest.store.getState().performanceAuditions).some(a => a.workspace_active));
    await b("Stop edit", edit).click();
    await b("Save pattern here", edit).click();
    const saved = await page.evaluate(() => window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes[0].definitions[0].payload.steps[0].note);
    if (saved == null) throw Error("First note did not save");
  } finally {
    await b("Stop Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  }
  const ordinary = await page.context().browser().newPage();
  try {
    await ordinary.goto(new URL("/", page.url()).href);
    await b("Perform", ordinary).click();
    await ordinary.getByRole("navigation", { name: "Perform views" }).getByRole("button", { name: "Arrange", exact: true }).waitFor();
    await ordinary.getByRole("group", { name: "Song transport" }).waitFor();
  } finally { await ordinary.close(); }
  return "Five device editors, rack assignment, built-in starter, Play edit and ordinary Perform entry verified";
}
