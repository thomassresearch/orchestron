// English workspace preview, stopped UX Baseline Legacy. Uses new, unsaved devices.
async page => {
  const button = (name, within = page) => within.getByRole("button", { name, exact: true });
  const devices = [
    ["score", "scoreTracks"], ["drummer", "drummerTracks"],
    ["controller", "controllerSequencers"], ["arpeggiator", "arpeggiators"]
  ];
  await button("Live").click();
  for (const [kind] of devices) await page.getByRole("combobox", { name: "Add live device" }).selectOption(kind);
  await button("Start Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
  for (const [kind, key] of devices) {
    const device = await page.evaluate(key => {
      const track = window.__workspaceTest.store.getState().sequencer[key].at(-1);
      return { name: track.name, inputChannel: track.inputChannel };
    }, key);
    const row = page.getByRole("group", { name: device.name, exact: true });
    await button("Pad 1", row).click();
    await button("Play", row).click();
    await button("Stop", row).waitFor();
    if (kind === "arpeggiator") {
      await button("Keyboard").click();
      const settings = page.locator(".ws-keyboard-settings");
      await settings.locator("summary").click();
      await settings.getByRole("spinbutton", { name: "MIDI Channel", exact: true }).fill(String(device.inputChannel));
      await settings.locator("summary").click();
      await button("C4").focus();
      await page.keyboard.down("Space");
    }
    await row.locator('[aria-label="Pad 1"][data-sounding]').waitFor();
    await button("Pad 2", row).click();
    await row.locator('[aria-label="Pad 2"][data-sounding]').waitFor({ timeout: 12000 });
    if (kind === "arpeggiator") await page.keyboard.up("Space");
    await button("Stop", row).click();
    await button("Play", row).waitFor();
  }
  await button("Stop Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  await page.goto(new URL("/", page.url()).href);
  await button("Perform").click();
  await button("Start Instruments").waitFor();
  if (await page.getByRole("navigation", { name: "Perform views" }).count()) throw Error("Preview became the default Perform page");
  return { launched: devices.map(([kind]) => kind), defaultPerform: true };
}
