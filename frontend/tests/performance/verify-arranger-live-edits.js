// Run on a stopped full-app workspace with a saved, playable arrangement.
async page => {
  await page.setViewportSize({width:1440,height:840});
  await page.evaluate(async () => {
    const app = window.__workspaceTest.store;
    await app.getState().loadPerformance(app.getState().currentPerformanceId);
  });
  const button = name => page.getByRole("button",{name,exact:true});
  const transport = page.getByRole("group",{name:"Song transport"});
  const end = page.getByRole("spinbutton",{name:"Song end"});
  await end.fill("128"); await end.press("Tab"); await button("Save").click();
  const read = () => page.evaluate(() => {
    const s = window.__workspaceTest.store.getState();
    return { position:s.sequencerRuntime.arrangerTransportSubunit, active:s.sequencerRuntime.arrangerActive,
      saved:s.buildSequencerConfigSnapshot().sequencer.clipArrangement.lanes[0].clips.length };
  });
  const track = page.locator("[data-clip-lane]").first(), windows = track.locator("[data-arranger-clip]");
  const count = await windows.count();
  await transport.getByRole("button",{name:"Play",exact:true}).click();
  try {
    await page.waitForFunction(()=>window.__workspaceTest.store.getState().sequencerRuntime.arrangerTransportSubunit>0);
    const before = await read();
    await windows.first().locator("[data-clip-header]").click({button:"right"});
    await page.getByRole("menuitem",{name:"Duplicate clip"}).click();
    await windows.nth(count).waitFor();
    await page.waitForFunction(t => window.__workspaceTest.store.getState().sequencerRuntime.arrangerTransportSubunit>t, before.position);
    const edited = await read();
    await button("Cancel").click();
    await page.waitForFunction(t => window.__workspaceTest.store.getState().sequencerRuntime.arrangerTransportSubunit>t, edited.position);
    const restored = await read();
    if (!restored.active || !edited.active || edited.saved!==count || restored.saved!==count || await windows.count()!==count) throw Error("Live Cancel lost transport state or leaked a clip into saved data");
    return {before,edited,restored};
  } finally {await transport.getByRole("button",{name:"Stop",exact:true}).click();}
}
