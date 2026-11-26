// English workspace, disposable clip or legacy baseline. Uses real Csound and the 10-second sample fixture.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const dock = page.locator(".ws-dock"), bank = page.locator(".ws-strip-bank");
  const source = id => page.locator('[data-mixer-strip="' + id + '"]');
  const compare = id => page.locator('[data-detail-strip="' + id + '"]');
  const compact = id => page.locator('[data-rack-instance="' + id + '"]');
  const card = id => page.locator('[data-mix-detail-instance="' + id + '"]');
  const bounded = () => page.evaluate(() => !scrollX && !scrollY &&
    document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth + 1);
  const reachable = async el => {
    const result = await el.evaluate(n => {
      const r = n.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { hit: r.height > 0 && r.width > 0 && n.contains(document.elementFromPoint(x, y)), name: n.outerHTML.slice(0,140), x, y };
    });
    check(result.hit, "Control needs scrolling: " + JSON.stringify(result));
  };
  const file = async path => {
    const input = await page.evaluateHandle(() => Object.assign(document.createElement("input"), { type: "file" }));
    await input.asElement().setInputFiles(path);
    return input;
  };
  const names = [];
  const url = new URL("/api/patches", page.url()).href;
  for (const base of ["sample_player", "stereo_chorus", "tube_overdrive"]) {
    const input = await file("backend/tests/fixtures/patches/" + base + ".patch.json");
    const patch = await input.evaluate(async n => JSON.parse(await n.files[0].text()));
    await input.dispose(); names.push(patch.name);
    if (!(await (await page.request.get(url)).json()).some(p => p.name === patch.name)) {
      const response = await page.request.post(url, { data: { name: patch.name, graph: patch.graph,
        always_on: !!patch.always_on, instrument_type: patch.instrument_type, schema_version: 1 } });
      check(response.ok(), await response.text());
    }
  }
  const [kit, chorus, drive, nested, masterFx] = await page.evaluate(async names => {
    const store = window.__workspaceTest.store;
    await store.getState().refreshPatches();
    const add = name => {
      const s = store.getState(), patch = s.patches.find(p => p.name === name);
      s.addSequencerInstrument(patch.id); return store.getState().sequencerInstruments.findLast(b => b.patchId === patch.id).id;
    };
    const ids = [names[0],names[1],names[2],names[1],names[1]].map(add);
    for (let i = 0; i < 8; i++) add(names[0]);
    const { wireInsertChain } = await import("/src/lib/insertRouting.ts");
    const s = store.getState();
    let graph = s.audioGraph;
    for (const [owner, chain] of [[ids[0], [ids[1],ids[2]]], [ids[1], [ids[3]]], ["$master", [ids[4]]]]) {
      graph = wireInsertChain(graph, s.sequencerInstruments, s.patches, owner, chain);
    }
    store.setState({ audioGraph: graph });
    return ids;
  }, names);
  const wave = await file("backend/tests/fixtures/sample_player/long.wav");
  await wave.evaluate(async (el, id) => {
    const { api } = await import("/src/api/client.ts");
    const { asset, asset_id } = await api.uploadSample(el.files[0]);
    const s = window.__workspaceTest.store.getState(), binding = s.sequencerInstruments.find(b => b.id === id);
    s.applySampleMap(binding, s.performanceWorkspaceGeneration, { version: 1, entries: [{ note: 36, assetId: asset_id }] }, { [asset_id]: asset });
  }, kit);
  await wave.dispose();
  const bypass = root => root.locator(".ws-bypass").first();
  const picker = root => root.getByRole("combobox", { name: "Inserts", exact: true });
  const state = () => page.evaluate(() => window.__workspaceTest.store.getState().mixer.strips);
  const essential = async (root, master) => {
    for (const el of [root.getByRole("spinbutton", { name: "Gain dB" }), button("Mute", root), picker(root), bypass(root)]) await reachable(el);
    if (!master) await reachable(button("Solo", root));
  };
  const previewWrites = [];
  const levels = {};
  const sampleRequest = req => { if (req.url().includes("/sample-preview")) previewWrites.push(req.postDataJSON()); };
  page.on("request", sampleRequest);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await button("Mix").click();
    await compact(kit).click();
    await button("Samples", page.locator(".ws-mix-tools")).click();
    await dock.getByRole("button", { name: /^36 ·/ }).click();
    const strip = source(kit), master = source("$master");
    await essential(strip, false); await essential(master, true);
    const selectors = await picker(strip).locator("option").evaluateAll(os => os.map(o => [o.value,o.textContent]));
    check(selectors.map(([id]) => id).join() === [chorus,nested,drive].join() && selectors[0][1] !== selectors[1][1], "Nested or duplicate insert not identifiable");
    await picker(strip).selectOption(nested);
    await page.evaluate(async () => {
      const { meterSnapshot } = await import("/src/lib/mixerRuntime.ts");
      const connect = AudioNode.prototype.connect;
      let analyser;
      AudioNode.prototype.connect = function(destination, ...args) {
        if (destination === this.context.destination) {
          analyser = this.context.createAnalyser();
          connect.call(this, analyser);
        }
        return connect.call(this,destination,...args);
      };
      window.compareSignal = () => {
        const data = new Float32Array(analyser?.fftSize ?? 0);
        analyser?.getFloatTimeDomainData(data);
        return {output:meterSnapshot("$output").peakL, pcm:data.reduce((peak,v)=>Math.max(peak,Math.abs(v)),0)};
      };
      window.endCompareProbe = () => { AudioNode.prototype.connect = connect; analyser?.disconnect(); delete window.compareSignal; delete window.endCompareProbe; };
    });
    const signal = audible => page.waitForFunction(audible => {
      const v = window.compareSignal();
      return (audible ? v.output > .0001 && v.pcm > .0001 : v.output === 0 && v.pcm < .000001) && v;
    }, audible, {timeout:8000}).then(handle=>handle.jsonValue());
    async function previewAndMute() {
      const receive = page.waitForResponse(r => r.url().includes("/instruments/" + kit + "/sample-preview") && r.ok());
      await button("Preview", dock).click(); await receive;
      const preview = await signal(true);
      await button("Mute", strip).click();
      const muted = await signal(false);
      await button("Mute", strip).click();
      return { preview, muted, restored: await signal(true) };
    }
    levels.stoppedEngine = await previewAndMute();
    const deleted = page.waitForResponse(r => r.request().method() === "DELETE" && r.url().includes("/sessions/") && r.ok());
    await button("Stop preview", dock).click(); await deleted;
    check(previewWrites.length === 2 && previewWrites[0].gesture === previewWrites[1].gesture, "Private sample gesture changed");
    await button("Start Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
    levels.runningEngine = await previewAndMute();
    await button("Solo", strip).click();
    const gain = strip.getByRole("spinbutton", { name: "Gain dB" });
    const fader = strip.getByRole("slider", { name: "Gain", exact: true });
    const track = await fader.boundingBox();
    check(track && track.width > track.height, "Expected a compact horizontal gain fader");
    await fader.press("Home");
    check(await fader.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue("--gain-fill"))) === 0, "Silence still shows gain");
    const y = track.y + track.height / 2;
    await page.mouse.move(track.x + 6, y);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width / 2, y, { steps: 8 });
    await page.mouse.up();
    const fill = await fader.evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue("--gain-fill")));
    check(Math.abs(fill - 50) < 2, "Gain fill did not follow the drag to the midpoint");
    await gain.fill("-6"); await gain.press("Tab");
    await bypass(strip).click();
    const strips = await state();
    check(strips[kit].solo && strips[kit].gainDb === -6 && !strips[kit].mute && strips[nested].bypass && !strips[chorus]?.bypass && !strips[drive]?.bypass, "Comparison changed the wrong strip");
    check(await button("Stop preview", dock).count() && previewWrites.length === 3, "A mix control interrupted the sample");
    await bypass(strip).click(); await button("Solo", strip).click();
    await page.screenshot({ path: "screenshots/perform-mix-sample-comparison.png" });
    await page.getByRole("separator").press("End");
    await essential(strip,false); await essential(master,true);
    await button("Expand", dock).click();
    await essential(compare(kit),false); await essential(compare("$master"),true);
    await button("Mute",compare("$master")).click(); await button("Mute",compare("$master")).click();
    // Compact selection and scrolling the dock do not change sample ownership.
    await dock.locator(".ws-dock-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await essential(compare(kit),false);
    await button("Back to overview", dock).click();
    await button("Instrument controls", page.locator(".ws-mix-tools")).click();
    await compact("routed").click({ modifiers: ["Shift"] });
    await bypass(card(drive)).click();
    check((await state())[drive].bypass && !((await state())[nested]?.bypass), "Card bypass hit a sibling");
    check(await compact(kit).getAttribute("aria-pressed") === "true" && await compact("routed").getAttribute("aria-pressed") === "true", "Card bypass changed multi-selection");
    await compact(kit).click(); await picker(strip).selectOption(drive);
    check(await bypass(strip).getAttribute("aria-pressed") === "true", "Strip did not reflect card bypass");
    await bank.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await compare(kit).waitFor();
    await bypass(compare(kit)).click();
    const offset = await bank.evaluate(el => el.scrollLeft);
    check(offset > 100 && await bypass(card(drive)).getAttribute("aria-pressed") === "false", "Offscreen owner lost comparison");
    await button("Live").click(); await button("Mix").click();
    check(Math.abs(await bank.evaluate(el => el.scrollLeft) - offset) < 2, "Bank offset was lost");
    const keyboard = button("Keyboard");
    if (await keyboard.getAttribute("aria-pressed") !== "true") await keyboard.click();
    for (const [width,height] of [[1280,720],[736,720],[390,844],[640,360]]) {
      await page.setViewportSize({width,height});
      await compare(kit).waitFor();
      await essential(compare(kit),false);
      const channels = dock.getByRole("combobox", {name:"Mixer channel"});
      if (await channels.isVisible()) await channels.selectOption("$master");
      await essential(compare("$master"),true);
      if (await channels.isVisible()) await channels.selectOption(kit);
      await reachable(dock.locator(".ws-output"));
      check(await bounded() && await dock.locator(".ws-dock-scroll").evaluate(el=>el.clientHeight > 15), "Detail clipped at " + width + "×" + height);
    }
    await page.screenshot({ path: "screenshots/perform-mix-short-comparison.png" });
    await page.setViewportSize({width:1440,height:900});
    if (await keyboard.getAttribute("aria-pressed")==="true") await keyboard.click();
    await button("Stop Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
    await page.evaluate(({nested,kit}) => {
      const s = window.__workspaceTest.store.getState(), samplePatch = s.sequencerInstruments.find(b => b.id === kit).patchId;
      window.__workspaceTest.store.setState({ sequencerInstruments: s.sequencerInstruments.map(b => b.id === nested ? {...b,patchId:samplePatch} : b) });
    }, { nested,kit });
    await picker(compare(kit)).selectOption(nested);
    check(await bypass(compare(kit)).isDisabled() && await bypass(card(nested)).isDisabled(), "Ineligible insert enabled");
    await page.setViewportSize({width:640,height:360});
    if (await keyboard.getAttribute("aria-pressed") !== "true") await keyboard.click();
    await button("Back to overview", dock).click();
    await bank.evaluate((el, kit) => {
      const target = el.querySelector('[data-mixer-strip="' + kit + '"]');
      el.scrollLeft += target.getBoundingClientRect().left - el.getBoundingClientRect().left;
    }, kit);
    for (const error of [null, "Audio connection interrupted. ".repeat(20)]) {
      await page.evaluate(error => window.__workspaceTest.store.setState({error}), error);
      await essential(strip, false); await essential(master, true);
      await reachable(page.locator(".ws-console .ws-output"));
      check(await bounded(), "Mixer overview overflowed in landscape");
    }
    const compactScroll = await strip.evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
    check(compactScroll > 0, "Compact channel settings did not scroll");
    await button("Live").click(); await button("Mix").click();
    check(Math.abs(await strip.evaluate(el => el.scrollTop) - compactScroll) < 2, "Compact channel lost its settings position");
    return { nestedAndMaster: true, sampleGesture: previewWrites, levels, multiSelection: true, bankOffset: offset };
  } finally {
    page.off("request", sampleRequest);
    if (await button("Stop Instruments").isVisible()) await button("Stop Instruments").click();
    await page.evaluate(() => window.endCompareProbe?.());
    await page.evaluate(() => window.__workspaceTest.store.setState({error:null}));
    await page.setViewportSize({width:1440,height:900});
  }
}
