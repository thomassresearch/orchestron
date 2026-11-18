// English workspace preview, stopped UX Baseline Legacy. Run on both clip-enabled and compatibility builds.
async page => {
  const button = (name, parent = page) => parent.getByRole("button", { name, exact: true });
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const dock = page.locator(".ws-dock");
  const occurrence = page.locator('[data-arrangement-lane="phrase"] [data-arrangement-occurrence]').first();
  const library = async name => {
    await page.locator(".ws-project summary").click();
    await page.getByRole("combobox", { name: "Load Performance", exact: true }).selectOption({ label: name });
    await page.waitForFunction(n => window.__workspaceTest.store.getState().performanceName === n && !window.__workspaceTest.store.getState().loading, name);
  };
  const conversion = button("Convert to clip arranger");
  const enabled = await conversion.count() > 0;
  await occurrence.click({ position: { x: 6, y: 8 } });
  check(!await dock.count(), "Selection opened the legacy editor");
  await inspector.getByRole("heading", { name: "Routed phrase" }).waitFor();
  const old = await page.evaluate(() => {
    const s = window.__workspaceTest.store.getState();
    return { sequence: JSON.stringify(s.sequencer.tracks[0].padLoopPattern), hold: s.sequencer.tracks[0].pads[0].steps[0].hold };
  });
  // The focused occurrence can be selected with Space and opened from the shared toolbar.
  await occurrence.focus(); await page.keyboard.press("Space"); await button("Editor").click();
  await dock.getByRole("heading", { name: "Routed phrase / Pad 1" }).waitFor();
  await button("HOLD", dock).first().click();
  await button("Edit pad in Live", inspector).click();
  await page.getByRole("combobox", { name: "Editing pad", exact: true }).selectOption({ label: "3" });
  await button("Arrange").click();
  await dock.getByRole("heading", { name: "Routed phrase / Pad 1" }).waitFor();
  check(await page.evaluate(old => {
    const s = window.__workspaceTest.store.getState();
    return !s.sequencer.clipArrangement && JSON.stringify(s.sequencer.tracks[0].padLoopPattern) === old.sequence &&
      s.sequencer.tracks[0].pads[0].steps[0].hold !== old.hold && s.sequencerEditingPads.phrase === 0;
  }, old), "Pad edit changed legacy order or targeted another pad");
  await button("Live").click();
  check(await page.getByRole("combobox", { name: "Editing pad", exact: true }).inputValue() === "2", "Legacy editor overwrote Live selection");
  await button("Arrange").click(); await button("Close", dock).click();
  await occurrence.dblclick({ position: { x: 6, y: 8 } });
  await dock.getByRole("heading", { name: "Routed phrase / Pad 1" }).waitFor();
  if (enabled) {
    await conversion.click();
    await page.getByRole("alert").filter({ hasText: "manual-source:manual" }).waitFor();
    check(await page.evaluate(() => !window.__workspaceTest.store.getState().sequencer.clipArrangement), "Rejected conversion changed the project");
    await button("Manual lead").click();
    await button("Arrangement", inspector.getByRole("group", { name: "Playback source" })).click();
    const [download] = await Promise.all([page.waitForEvent("download"), conversion.click()]);
    check(download.suggestedFilename() === "orchestron-before-clip-migration.json", "Missing conversion backup");
    await page.waitForFunction(() => !!window.__workspaceTest.store.getState().sequencer.clipArrangement);
    check(!await dock.count(), "Conversion left an editor bound to legacy content");
  }
  await library("UX Baseline Clip");
  await page.locator('[data-arranger-clip="phrase-1"]').waitFor();
  await button("Editor").click();
  await page.getByRole("region", { name: "Editing", exact: true }).waitFor();
  return { legacyPad: 1, livePad: 3, conversionAvailable: enabled, storedClipOpened: true };
}
