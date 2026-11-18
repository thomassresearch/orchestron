// English workspace preview, UX Baseline Clip, isolated library. Creates a new performance copy.
async page => {
  const button = (name, parent = page) => parent.getByRole("button", { name, exact: true });
  const check = (condition, message) => { if (!condition) throw Error(message); };
  await page.locator(".ws-project summary").click();
  await button("Clone").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().performanceName.includes("(copy"));
  const name = await page.evaluate(() => window.__workspaceTest.store.getState().performanceName);
  await button("Live").click();
  await page.getByRole("combobox", { name: "Add live device" }).selectOption("sequencer");
  const selected = page.locator(".ws-launcher [data-live-device][data-selected]");
  const id = await selected.getAttribute("data-live-device");
  const lanes = await page.evaluate(() => JSON.stringify(window.__workspaceTest.store.getState().sequencer.clipArrangement.lanes));
  await button("Pad 4", selected).click();
  await button("Edit", selected).click();
  await button("HOLD").first().click();
  await page.getByText("Unsaved pad changes", { exact: true }).waitFor();
  check(await page.locator(".ws-dock summary", { hasText: "Pattern workspace" }).count() === 1, "Missing reusable definition workspace");
  const hold = await page.evaluate(id => window.__workspaceTest.store.getState().sequencer.tracks.find(t => t.id === id).pads[3].steps[0].hold, id);
  await button("Save Performance").click();
  await page.getByText("Pad saved in performance", { exact: true }).waitFor();
  const load = async label => {
    await page.locator(".ws-project summary").click();
    await page.getByRole("combobox", { name: "Load Performance", exact: true }).selectOption({ label });
    await page.waitForFunction(n => window.__workspaceTest.store.getState().performanceName === n && !window.__workspaceTest.store.getState().loading, label);
  };
  await load("UX Baseline Clip");
  await load(name);
  check(await page.evaluate(({ id, hold, lanes }) => {
    const state = window.__workspaceTest.store.getState().sequencer, track = state.tracks.find(t => t.id === id);
    return track && !track.padLoopEnabled && track.pads[3].steps[0].hold === hold && JSON.stringify(state.clipArrangement.lanes) === lanes;
  }, { id, hold, lanes }), "Save/Load changed source, pad, or arrangement");
  await button("Live").click();
  const restored = page.locator('.ws-launcher [data-live-device="' + id + '"]');
  await button("Pad 4", restored).click();
  await button("Play", restored).click();
  await restored.locator('[data-sounding][aria-label="Pad 4"]').waitFor();
  await button("Stop", restored).click();
  await button("Stop Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  await button("Keyboard").click();
  await button("Inspector").click();
  await button("Remove device", page.getByRole("complementary", { name: "Inspector" })).click();
  await restored.waitFor({ state: "detached" });
  await page.getByRole("region", { name: "Keyboard", exact: true }).waitFor();
  return { manualSourceRestored: true, playingPad: 4, clipLanesIntact: true };
}
