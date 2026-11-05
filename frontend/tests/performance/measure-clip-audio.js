async page => {
  // Requires clip-audio.js to be imported and started with a real click first.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const results = [];
  for (const [label, beats, expanded] of [['compact',16,false],['dense-expanded',16000,true],['dense-collapsed',16000,false]]) {
    await page.evaluate(beats => {
      const app = window.__clipTest.store, sequencer = structuredClone(app.getState().sequencer);
      sequencer.clipArrangement.end = beats * 20160;
      for (const lane of sequencer.clipArrangement.lanes) {
        lane.cycleTicks = null;
        lane.clips[0].mode = 'loop';
        lane.clips[0].length = beats * 20160;
      }
      app.setState({ sequencer });
    }, beats);
    const expandedHeaders = page.locator('[data-clip-lane][data-expanded="true"] > div:first-child > button');
    while (await expandedHeaders.count()) await expandedHeaders.first().click();
    if (expanded) await page.getByRole('button', {name: '▸ Warm Lead', exact: true}).click();
    await page.waitForTimeout(2000);
    const before = await page.evaluate(() => window.__clipAudio.snapshot()), start = await metrics();
    await page.waitForTimeout(30000);
    const end = await metrics(), after = await page.evaluate(() => window.__clipAudio.snapshot());
    if (!after.finite || after.pcmPeak <= .001 || after.errors.length) throw Error(JSON.stringify(after));
    results.push({ label, seconds: 30, before, after,
      underruns: after.diagnostics.underrunCount - before.diagnostics.underrunCount,
      mainThread: Object.fromEntries(['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].map(k => [k,end[k]-start[k]])),
      nodes: await page.locator('*').count() });
  }
  await page.evaluate(async () => {
    await window.__clipAudio.audition(1,true);
    for (const pitch of [64,67,71,72]) await window.__clipAudio.edit(pitch);
    await window.__clipAudio.seek();
    await window.__clipAudio.audition(2,false);
    await window.__clipAudio.audition(3,true);
    await window.__clipAudio.audition(4,false);
    await window.__clipAudio.reconnect();
  });
  await page.waitForTimeout(5000);
  const recovered = await page.evaluate(() => window.__clipAudio.snapshot());
  if (recovered.status !== 'live' || !recovered.finite || recovered.pcmPeak <= .001 || recovered.errors.length) throw Error(JSON.stringify(recovered));
  await page.evaluate(() => window.__clipAudio.stop());
  return { browser: await page.context().browser().version(), results, recovered };
}
