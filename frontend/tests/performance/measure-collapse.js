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
  const workspace = await page.locator(".ws-workspace").count() > 0;
  const names = ["Instrument Rack", "Melodic Sequencers", "Drummer Sequencers", "Controller Sequencers",
    "Arpeggiators", "Piano Rolls", /^MIDI Controllers/, "Multitrack Arranger"];
  for (const name of workspace ? [] : names) {
    const button = page.getByRole("button", { name, exact: true });
    if (await button.getAttribute("aria-expanded") === "false") await button.click();
  }
  const mixer = page.locator("details").filter({ has: page.locator(":scope > summary").filter({ hasText: /^Mixer$/ }) }).first();
  if (!workspace && !await mixer.evaluate(node => node.open)) await mixer.locator(":scope > summary").click();
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
  if (workspace) {
    const button = name => page.getByRole("button", { name, exact: true });
    await button("Live").click();
    await button("Edit").first().click();
    const expanded = await measure("device-editor");
    await button("Close").click();
    for (let i = 0; i < 3; i++) {
      await button("Mix").click();
      await page.locator('[data-meter-id="$output"] [aria-label]').waitFor();
      await button("Arrange").click();
      await button("Live").click();
    }
    const closed = await measure("launcher-after-switches");
    if (closed.after.counts.Meter || closed.after.counts.MelodicSequencersBody ||
        !closed.after.runtime.isPlaying || closed.after.maximumAudioPeak <= 0) {
      throw Error("Hidden editor or meter still rendering, or the audio stopped");
    }
    return { browser: await page.context().browser().version(), durationSeconds: 15, results: [expanded, closed] };
  }
  const results = [await measure("expanded")];
  for (const name of names) await page.getByRole("button", { name, exact: true }).click();
  await page.locator("summary").filter({ hasText: /^Mixer$/ }).click();
  results.push(await measure("collapsed"));
  await page.screenshot({ path: "output/playwright/collapsed-profile.png" });
  return { browser: await page.context().browser().version(), durationSeconds: 15, results };
}
