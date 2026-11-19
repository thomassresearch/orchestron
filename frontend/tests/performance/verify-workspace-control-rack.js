// Start with the disposable UX Baseline Clip performance and native browser-clock playback.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const tools = page.locator(".ws-mix-tools"), dock = page.locator(".ws-dock");
  const compact = id => page.locator(`[data-rack-instance="${id}"]`);
  const card = id => dock.locator(`[data-mix-detail-instance="${id}"]`);
  const check = (value, message) => { if (!value) throw Error(message); };
  const option = page.getByRole("checkbox", { name: "Parallel playback" });
  check(await option.isChecked(), "Expected automatic parallel rendering by default");
  await button("Start Instruments").click();
  let depth;
  try {
    const meter = page.getByRole("meter", { name: "Playback buffer" });
    await page.waitForFunction(() => Number(document.querySelector(".engine-buffer [role=meter]")?.getAttribute("aria-valuenow")) > 0);
    check(await option.isDisabled(), "Renderer choice unlocked during playback");
    depth = await meter.getAttribute("aria-valuetext");
    await page.locator(".ws-status").screenshot({path: "screenshots/perform-playback-status.png"});
  } finally {
    await button("Stop Instruments").click();
  }
  await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
  const names = [];
  for (const file of ["ambient_rounded_sub", "performance_controller_midi", "stereo_chorus", "tube_overdrive"]) {
    const input = await page.evaluateHandle(() => Object.assign(document.createElement("input"), { type: "file" }));
    await input.asElement().setInputFiles("backend/tests/fixtures/patches/" + file + ".patch.json");
    const patch = await input.evaluate(async el => JSON.parse(await el.files[0].text()));
    await input.dispose();
    const url = new URL("/api/patches", page.url()).href;
    if (!(await (await page.request.get(url)).json()).some(p => p.name === patch.name)) {
      const response = await page.request.post(url, { data: { name: patch.name, description: patch.description ?? "",
        graph: patch.graph, always_on: !!patch.always_on, instrument_type: patch.instrument_type, schema_version: 1 } });
      check(response.ok(), await response.text());
    }
    names.push(patch.name);
  }
  const [bass, lead, chorus, drive] = await page.evaluate(async names => {
    const store = window.__workspaceTest.store;
    await store.getState().refreshPatches();
    const ids = names.map(name => {
      const s = store.getState();
      const id = s.patches.find(p => p.name === name).id;
      s.addSequencerInstrument(id);
      return store.getState().sequencerInstruments.filter(b => b.patchId === id).at(-1).id;
    });
    const { wireInsertChain } = await import("/src/lib/insertRouting.ts");
    const s = store.getState();
    store.setState({ audioGraph: wireInsertChain(s.audioGraph, s.sequencerInstruments, s.patches, ids[0], ids.slice(2)) });
    return ids;
  }, names);
  await button("Mix").click();
  await compact(bass).click();
  await button("Instrument controls", tools).click();
  await card(chorus).waitFor();
  await button(names[1], page.locator(`[data-mixer-strip="${lead}"]`)).click({modifiers:["Shift"]});
  async function verifyCards(ids) {
    const found = await dock.locator("[data-mix-detail-instance]").evaluateAll(cards => cards.map(c => c.dataset.mixDetailInstance));
    check(JSON.stringify(found) === JSON.stringify(ids), "Wrong instrument/insert order: " + found);
    for (const id of ids) check(await card(id).getByRole("spinbutton").count(), "Missing controls on " + id);
  }
  await verifyCards([bass, chorus, drive, lead]);
  const value = card(lead).getByRole("spinbutton", { name: /^Amount/ });
  await value.fill("0.625"); await value.press("Enter");
  const gain = card(drive).getByRole("spinbutton", { name: /^Drive/ });
  await gain.fill("14"); await gain.press("Enter");
  check(await page.evaluate(id => window.__workspaceTest.store.getState().sequencerInstruments
    .find(b => b.id === id).performanceControllerValues.tube_drive_db === 14, drive), "Insert edit missed its instance");
  await button("Live").click(); await button("Mix").click();
  await verifyCards([bass, chorus, drive, lead]);
  check(await value.inputValue() === "0.625", "Lost separate instance settings");
  check(await gain.inputValue() === "14", "Lost insert settings");
  await button("Expand", dock).click();
  await dock.locator("[data-adaptive-instrument-rack]").waitFor();
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll(".ws-dock [data-mix-detail-instance]")];
    return cards.some((a, i) => cards.slice(i + 1).some(b => a.offsetTop === b.offsetTop && a.getBoundingClientRect().x !== b.getBoundingClientRect().x));
  });
  await page.screenshot({path:"screenshots/perform-mix-instrument-controls.png"});
  await compact(lead).press("Shift+Space");
  await verifyCards([bass, chorus, drive]);
  await compact(chorus).click({modifiers:["Shift"]});
  await verifyCards([bass, chorus, drive]);
  await compact(lead).click();
  await verifyCards([lead]);
  await button("Back to overview", dock).click();
  await button("Rack", tools).click();
  const rack = page.locator(".ws-mix-page");
  for (const id of [bass, lead, chorus, drive]) {
    check(await rack.locator(`[data-rack-binding-id="${id}"]`).getByRole("spinbutton").count() > 0, "Full rack missing device controls");
  }
  await page.screenshot({path:"screenshots/perform-mix-full-rack.png"});
  const patchNumber = id => rack.locator(`[data-rack-binding-id="${id}"] button[aria-pressed]`).first();
  await patchNumber(bass).click();
  await patchNumber(lead).press("Shift+Enter");
  check(!await page.locator('[data-mix-detail="instrument"]').count(), "Full Rack offers duplicate instrument controls");
  await button("Mixer", tools).click();
  await button("Instrument controls", tools).click();
  await verifyCards([bass, chorus, drive, lead]);
  for (const name of ["Instrument Design", "Config", "Perform"]) {
    await button(name, page.locator("[data-app-pages]")).click();
    const header = page.locator(".app-header");
    check(await header.getByText("Visual opcode patching with realtime CSound performance sessions").isVisible(), "Missing shared description");
    check(await button(name,header).getAttribute("aria-current") === "page", "Wrong active page");
    if (name === "Instrument Design") await header.screenshot({path:"screenshots/workspace-header.png"});
  }
  return { depth, instruments: names, amount: "0.625" };
}
