// UX Baseline Clip. Exercise the failure response while native playback continues.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const transport = page.getByRole("group", { name: "Song transport" });
  await button("Live").click();
  await button("Start Instruments").click();
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
  const endpoint = "**/api/sessions/*/sequencer/config";
  let rejected = 0;
  try {
    await button("Loop", transport).click();
    await button("Play", transport).click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().sequencerRuntime.arrangerActive);
    await page.route(endpoint, route => {
      if (route.request().method() !== "PUT") return route.continue();
      rejected++;
      return route.fulfill({ status: 422, json: { detail: "Preparation rejected for this edit" } });
    });
    const tempo = transport.getByRole("spinbutton", { name: "BPM" });
    await tempo.fill("99");
    const alert = page.locator(".ws-status [role=alert]");
    await alert.filter({ hasText: "Preparation rejected" }).waitFor();
    const frame = await page.evaluate(() => window.__workspaceTest.store.getState().sequencerRuntime.arrangerTransportSubunit);
    await button("Mix").click();
    await page.waitForFunction(frame => {
      const s = window.__workspaceTest.store.getState();
      return s.sequencerRuntime.arrangerActive && s.sequencerRuntime.arrangerTransportSubunit !== frame && s.sequencer.timing.tempoBPM === 99;
    }, frame);
    await button("Diagnostics").click();
    if (!(await page.getByRole("dialog", { name: "Diagnostics" }).innerText()).includes("Preparation rejected")) throw Error("Diagnostics lost the failed preparation");
    await page.keyboard.press("Escape");
    if (rejected !== 1) throw Error("Navigation retried the rejected edit");
    await page.unroute(endpoint);
    const applied = page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/sequencer/config") && r.ok());
    await tempo.fill("100");
    await applied;
    return { rejected, recoveredTempo: Number(await tempo.inputValue()) };
  } finally {
    await page.unroute(endpoint);
    await button("Stop Instruments").click();
  }
}
