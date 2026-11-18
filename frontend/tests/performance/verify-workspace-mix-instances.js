// Use a disposable backend and UX Baseline Clip. Run from the repository root.
// Read versioned patch fixtures with the same browser file API used for native imports.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const tools = page.locator(".ws-mix-tools"), dock = page.locator(".ws-dock");
  const pick = id => page.locator('[data-rack-instance="' + id + '"]').click();
  const check = (ok, message) => { if (!ok) throw Error(message); };
  async function addPair(file) {
    const input = await page.evaluateHandle(() => {
      const el = document.createElement("input"); el.type = "file"; return el;
    });
    await input.asElement().setInputFiles("backend/tests/fixtures/patches/" + file + ".patch.json");
    const patch = await input.evaluate(async el => JSON.parse(await el.files[0].text()));
    await input.dispose();
    const url = new URL("/api/patches", page.url()).href;
    const existing = (await (await page.request.get(url)).json()).find(p => p.name === patch.name);
    const res = !existing && await page.request.post(url, {
      data: { name: patch.name, description: "", always_on: false,
        is_template: false, instrument_type: patch.instrument_type, schema_version: 1, graph: patch.graph }
    });
    if (res && !res.ok()) throw Error(await res.text());
    const { id } = existing || await res.json();
    return page.evaluate(async id => {
      const s = window.__workspaceTest.store.getState(); await s.refreshPatches();
      s.addSequencerInstrument(id); s.addSequencerInstrument(id);
      return window.__workspaceTest.store.getState().sequencerInstruments.filter(b => b.patchId === id).map(b => b.id);
    }, id);
  }
  const kits = await addPair("sample_player"), controllers = await addPair("performance_controller_midi");
  const previews = [];
  const event = (id, action) => page.waitForResponse(r => r.url().includes("/instruments/" + id + "/sample-preview") &&
    r.request().postDataJSON().action === action && r.ok());
  async function assign(file) {
    const chooser = page.waitForEvent("filechooser");
    await button("Assign file", dock).click();
    await (await chooser).setFiles("backend/tests/fixtures/sample_player/" + file);
    await dock.getByText(file, { exact: true }).waitFor();
  }
  try {
    // A rack selection in Arrange leaves the song editor alone. Its Samples action targets Mix.
    await button("Compact rack").click();
    await pick(kits[0]);
    check(!await dock.count(), "compact selection opened a detail");
    await button("Samples", page.locator(".ws-compact-rack")).click();
    await dock.getByRole("heading", {name: "Samples", exact:true}).waitFor();
    await assign("mono.wav");
    await pick(kits[1]);
    await assign("stereo.wav");
    await page.screenshot({ path: "screenshots/perform-workspace-mix-samples.png" });
    const pair = await page.evaluate(ids => ids.map(id => {
      const b = window.__workspaceTest.store.getState().sequencerInstruments.find(b => b.id === id);
      return b.sampleMap.entries.map(row => [row.note, b.sampleAssets[row.assetId].source.original_name]);
    }), kits);
    check(JSON.stringify(pair) === JSON.stringify([[[36,"mono.wav"]],[[36,"stereo.wav"]]]), "sample maps crossed instances");
    await button("Start Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
    for (const [i,id] of kits.entries()) {
      await pick(id);
      check(await button("Assign file", dock).isDisabled(), "sample topology editable during playback");
      const [start] = await Promise.all([event(id, "start"), button("Preview", dock).click()]);
      const [stop] = await Promise.all([event(id, "stop"), i ? button("Close", dock).click() : pick(kits[1])]);
      const on = start.request().postDataJSON(), off = stop.request().postDataJSON();
      check(on.note === 36 && on.gesture === off.gesture, "wrong sample ownership on exit");
      previews.push([id,on.note]);
    }
    check(await button("Stop Instruments").count() === 1, "closing the sample stopped the performance");
    await button("Stop Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
    await pick(controllers[0]);
    check(!await button("Samples", tools).count(), "Samples appeared on an incapable patch");
    await button("Instrument controls", tools).click();
    const amount = dock.getByRole("spinbutton", { name: /^Amount/ });
    const cc = dock.getByRole("combobox", { name: /^Amount/ });
    await amount.fill("0.625"); await amount.press("Enter"); await cc.selectOption("17");
    await pick(controllers[1]);
    check(await amount.inputValue() === "0.2" && await cc.inputValue() === "", "controls crossed instances");
    await pick(controllers[0]);
    check(await amount.inputValue() === "0.625" && await cc.inputValue() === "17", "controls failed to restore");
    await button("Edit patch", dock).click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activePage === "instrument");
    await button("Perform").click();
    await amount.waitFor();
    check(await amount.inputValue() === "0.625" && await cc.inputValue() === "17", "Instrument Design return lost instance");
    return { samples: pair, previews, amount: await amount.inputValue(), cc: await cc.inputValue() };
  } finally {
    if (await button("Stop Instruments").count()) await button("Stop Instruments").click();
  }
}
