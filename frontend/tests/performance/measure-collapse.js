async page => {
  if (!await page.evaluate(() => window.__collapseProfile.snapshot().runtime.isPlaying)) {
    await page.getByRole("button", { name: "Start profile audio", exact: true }).click();
    await page.waitForFunction(() => {
      const result = window.__collapseProfile.snapshot();
      return result.runtime.isPlaying && result.diagnostics;
    });
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const names = ["Instrument Rack", "Melodic Sequencers", "Drummer Sequencers", "Controller Sequencers",
    "Arpeggiators", "Piano Rolls", /^MIDI Controllers/, "Multitrack Arranger"];
  for (const name of names) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.getAttribute("aria-expanded") === "false") await button.click();
  }
  const mixer = page.locator("details").filter({ has: page.locator(":scope > summary").filter({ hasText: /^Mixer$/ }) }).first();
  if (!await mixer.evaluate(node => node.open)) await mixer.locator(":scope > summary").click();
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
  const snapshot = () => page.evaluate(() => {
    const value = window.__collapseProfile.snapshot();
    const { isPlaying, transportSubunit } = value.runtime;
    return { ...value, runtime: { isPlaying, transportSubunit } };
  });
  async function measure(label) {
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__collapseProfile.reset());
    const before = await snapshot();
    const start = await metrics();
    await page.waitForTimeout(15000);
    const end = await metrics();
    const after = await snapshot();
    const delta = Object.fromEntries(["TaskDuration", "ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "LayoutCount", "RecalcStyleCount"]
      .map(key => [key, end[key] - start[key]]));
    return { label, before, after, mainThread: delta,
      underruns: before.diagnostics && after.diagnostics ? after.diagnostics.underrunCount - before.diagnostics.underrunCount : null };
  }
  const results = [await measure("expanded")];
  for (const name of names) await page.getByRole("button", { name, exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Mixer$/ }).click();
  results.push(await measure("collapsed"));
  await page.screenshot({ path: "output/playwright/collapsed-profile.png" });
  return { browser: await page.context().browser().version(), durationSeconds: 15, results };
}
