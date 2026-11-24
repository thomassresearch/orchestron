// Isolated English workspace, empty arrangement, stopped engine and two library patches
// named Electric Piano and Finger Bass. Captures the manual screenshots.
async page => {
  await page.setViewportSize({width:1440,height:840});
  const button = (name, area = page) => area.getByRole("button", { name, exact: true });
  const state = fn => page.evaluate(fn);
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const add = page.getByRole("combobox", { name: "Add track", exact: true });
  const editor = page.getByRole("region", { name: "Editing", exact: true });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const name = inspector.getByRole("textbox", { name: "Pattern name", exact: true });
  const patternPencil = button("Rename pattern", inspector);
  const editorName = editor.getByRole("textbox", { name: "Pattern name", exact: true });
  const rack = page.locator(".ws-compact-rack");
  const choosePatch = async patch => {
    const dialog = page.getByRole("dialog", { name: "Add Instrument" });
    if (patch === "Electric Piano") await dialog.getByRole("button", { name: /Melody/ }).click();
    else await dialog.getByRole("searchbox").fill(patch);
    await button(patch, dialog).click();
  };
  const addTrack = async (patch, pattern) => {
    await add.selectOption("sequencer");
    const channel = page.locator("[data-track-channel]").last();
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-track-channel"));
    check(!await editor.count(), "Creating a track opened the editor");
    await channel.selectOption("add");
    await choosePatch(patch);
    await patternPencil.click();
    await name.fill(pattern);
    await name.press("Tab");
    check(!await editor.count() && (await patternPencil.innerText()).includes(pattern), "Inspector did not save the pattern name independently");
    await button("Editor").click();
    // Use actual note edits so the two saved previews can be distinguished in the manual.
    await page.evaluate(pitches => {
      const s = window.__workspaceTest.store.getState();
      const lane = s.clipDrafts[s.clipEditingKey].target.laneId;
      pitches.forEach((pitch, index) => s.setSequencerTrackStepNote(lane, index * 2, pitch));
    }, pattern === "Verse chords" ? [60, 64, 67, 72, 67, 64, 62, 67] : [36, 43, 40, 43, 41, 45, 43, 47]);
    await button("Save").click();
    await page.locator("[data-arranger-clip]").last().getByText(pattern, { exact: false }).first().waitFor();
  };
  await addTrack("Electric Piano", "Verse chords");
  await addTrack("Finger Bass", "Walking bass");
  check(await state(() => window.__workspaceTest.store.getState().sequencer.tracks.every((track,i) =>
    track.midiChannel === window.__workspaceTest.store.getState().sequencerInstruments[i].midiChannel)), "Incorrect channel assignment");
  await button("Compact rack").click();
  await button("Add Instrument", rack).click();
  await choosePatch("Electric Piano");
  const cards = rack.locator("[data-rack-instance]");
  await cards.last().focus();
  await page.keyboard.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Remove instrument" }).click();
  check(await cards.count() === 2, "Unused instrument was not removed");
  await cards.first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Remove instrument" }).click();
  await rack.getByRole("alert").waitFor();
  check(await cards.count() === 2, "Used instrument was removed");
  await button("Add Instrument", rack).click();
  await button("Cancel", page.getByRole("dialog")).click();
  // Verify both menu entry points and clear the warning before capturing the overview.
  const last = page.locator("[data-arranger-clip]").last();
  await last.locator("button").first().click();
  if (!await editor.count()) await button("Editor").click();
  if (!await editorName.isVisible()) await button("Settings", editor).click();
  await editorName.fill("Discard this");
  await page.locator(".ws-dock").getByRole("button", { name: "Close", exact: true }).click();
  if (!await editor.count()) await button("Editor").click();
  if (!await editorName.isVisible()) await button("Settings", editor).click();
  check(await editorName.inputValue() === "Discard this", "Closing the editor lost the staged name");
  await button("Cancel").click();
  await patternPencil.click();
  await name.fill("Canceled name");
  await name.press("Escape");
  check((await patternPencil.innerText()).includes("Walking bass"), "Escape changed the saved name");
  await patternPencil.click();
  await name.fill("Walking bassline");
  await name.press("Tab");
  await button("Save").click();
  await button("Save Performance").click();
  await page.waitForFunction(() => !!window.__workspaceTest.store.getState().currentPerformanceId && !window.__workspaceTest.store.getState().loading);
  await state(async () => {
    const s = window.__workspaceTest.store.getState();
    await s.loadPerformance(s.currentPerformanceId);
  });
  check(await state(() => window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes[1].definitions[0].name === "Walking bassline"), "Pattern rename did not survive reload");
  if (!await rack.count()) await button("Compact rack").click();
  await page.locator(".ws-workspace").screenshot({ path: "screenshots/arranger-track-channels.png" });
  await last.locator("button").first().click();
  const length = inspector.getByRole("spinbutton", { name: /Length/ });
  await length.fill("12");
  await length.press("Tab");
  await last.getByRole("img", { name: "Walking bassline" }).nth(1).dblclick();
  await button("Create variation here", editor).waitFor();
  check(!await editor.locator("details").filter({hasText:"Loop details"}).evaluate(el=>el.open), "Loop details should initially be compact");
  const dockHeight = await page.locator(".ws-dock").evaluate(el => el.getBoundingClientRect().height);
  check(dockHeight < 175, "The scope chooser reserved a full editor (" + dockHeight + "px)");
  await page.locator(".ws-workspace").screenshot({ path: "screenshots/arranger-pattern-scope.png" });
  await page.setViewportSize({width:390,height:844});
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Narrow editor overflow");
  await button("Create variation here", editor).click();
  await button("Settings", editor).click();
  const variation = editor.getByRole("textbox", { name: "Variation name" });
  await variation.fill("Bass turnaround");
  await button("Save").click();
  check(await state(() => window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes[1].definitions.some(d=>d.name==="Bass turnaround")), "Rename-only local variation was not saved");
  await page.getByRole("button",{name:"Back to overview",exact:true}).click();
  const destination = page.locator("select[data-track-channel]").last();
  await destination.selectOption("1");
  check(await state(() => window.__workspaceTest.store.getState().sequencerInstruments.length === 2), "Choosing an existing instrument duplicated it");
  await destination.selectOption("2");
  await state(() => {
    const s = window.__workspaceTest.store.getState();
    const piano = s.patches.find(p => p.name === "Electric Piano");
    for (let i = 0; i < 10; i++) s.addSequencerInstrument(piano.id);
  });
  const strip = rack.locator(".ws-rack-picker");
  check(await strip.evaluate(el => { el.scrollLeft = el.scrollWidth; return el.scrollLeft > 0; }), "Narrow rack did not scroll");
  await button("Add Instrument", rack).click();
  await choosePatch("Electric Piano");
  await add.selectOption("controller");
  const targets = page.locator("button[data-track-channel]").last();
  await targets.click();
  const targetsDialog = page.getByRole("dialog");
  await targetsDialog.getByText("CH02 · Finger Bass", { exact: true }).waitFor();
  await button("Close", targetsDialog).click();

}
