// English preview, UX Baseline Legacy, native Csound and the real browser-clock output.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const strip = id => page.locator('[data-mixer-strip="' + id + '"]');
  const check = (value, message) => { if (!value) throw Error(message); };
  const viewport = page.viewportSize();
  await page.evaluate(async () => {
    const state = window.__workspaceTest.store.getState();
    const patch = state.sequencerInstruments.find(b => b.id === "routed").patchId;
    for (let i = 0; i < 7; i++) state.addSequencerInstrument(patch);
    const { meterSnapshot } = await import("/src/lib/mixerRuntime.ts");
    const connect = AudioNode.prototype.connect;
    let analyser;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (destination === this.context.destination) {
        analyser = this.context.createAnalyser();
        connect.call(this, analyser);
      }
      return connect.call(this, destination, ...args);
    };
    window.readMixSignal = () => {
      const samples = new Float32Array(analyser?.fftSize ?? 0);
      analyser?.getFloatTimeDomainData(samples);
      return { direct: meterSnapshot("direct").peakL, master: meterSnapshot("$master").peakL, output: meterSnapshot("$output").peakL,
        pcm: samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0) };
    };
    window.restoreMixProbe = () => { AudioNode.prototype.connect = connect; delete window.readMixSignal; delete window.restoreMixProbe; };
  });
  const bank = page.locator(".ws-strip-bank");
  const fixed = () => page.evaluate(() => [".ws-master", ".ws-output"].map(s => document.querySelector(s).getBoundingClientRect().toJSON()));
  try {
    await button("Live").click();
    await button("Start Instruments").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState === "running");
    const session = await page.evaluate(() => window.__workspaceTest.store.getState().activeSessionId);
    const manual = page.getByRole("group", { name: "Manual lead", exact: true });
    await button("Pad 1", manual).click();
    await button("Play", manual).click();
    await manual.locator('[data-sounding][aria-label="Pad 1"]').waitFor();
    await button("Pad 2", manual).click();
    await manual.locator('[data-sounding][aria-label="Pad 2"]').waitFor();
    await button("Play", page.getByRole("group", { name: "Routed phrase", exact: true })).click();
    await button("Mix").click();
    const signal = async stage => (await page.waitForFunction(stage => {
      const v = window.readMixSignal();
      const audible = v.output > .001 && v.pcm > .001;
      return ((stage === "routed" && v.master > .001 && audible) ||
        (stage === "unmutedDirect" && v.direct > .001 && audible) ||
        (stage === "direct" && v.master === 0 && audible) ||
        (stage === "silent" && v.master === 0 && v.output === 0 && v.pcm < .000001)) && v;
    }, stage, { timeout: 20000 })).jsonValue();
    // The fixture alternates phrases. Sample each path while both devices run.
    const both = { routed: await signal("routed"), direct: await signal("unmutedDirect") };
    await button("UX Baseline Direct", strip("direct")).click();
    check(!(await page.locator(".ws-dock").count()), "selecting a strip opened a dock");
    await button("Inspector").click();
    await page.locator(".ws-inspector").getByRole("heading", { name: "UX Baseline Direct" }).waitFor();
    await page.screenshot({ path: "screenshots/perform-workspace-mix.png" });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForFunction(() => document.querySelector(".ws-strip-bank").scrollHeight > document.querySelector(".ws-strip-bank").clientHeight);
    const original = await fixed();
    const offset = await bank.evaluate(el => {
      el.scrollTo(el.scrollWidth, el.scrollHeight);
      return { x: el.scrollLeft, y: el.scrollTop };
    });
    check(offset.x > 100 && offset.y > 0, "the fixture did not overflow on both axes");
    await page.locator('[data-meter-id="routed"] [aria-label]').waitFor({ state: "detached" });
    check(JSON.stringify(original) === JSON.stringify(await fixed()), "Master or Audio Output moved with the bank");
    await button("Arrange").click();
    await button("Mix").click();
    await page.waitForFunction(({x,y}) => {
      const bank = document.querySelector(".ws-strip-bank");
      return Math.abs(bank.scrollLeft - x) < 2 && Math.abs(bank.scrollTop - y) < 2;
    }, offset);
    await page.locator(".ws-inspector").getByRole("heading", { name: "UX Baseline Direct" }).waitFor();
    await button("Mute", strip("$master")).click();
    const direct = await signal("direct");
    await button("Mute", strip("direct")).click();
    const silent = await signal("silent");
    // Require a complete phrase of silence, including the next note on both devices.
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(170);
      check((await page.evaluate(() => window.readMixSignal())).pcm < .000001, "audio returned with both paths muted");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector(".ws-inspector"));
    const [master, output] = await fixed();
    check(master.right <= 390 && output.right <= 390 && output.bottom <= 844 && master.height > 0, "pinned signals outside mobile viewport");
    await page.setViewportSize(viewport);
    const nav = page.getByRole("navigation", { name: "Mixer" });
    await button("Routing", nav).click();
    check(await page.getByRole("combobox", { name: "Source", exact: true }).first().isDisabled(), "topology unlocked during playback");
    await page.locator(".ws-routing-body summary").filter({hasText: /matrix/i}).click();
    check(await page.evaluate(id => window.__workspaceTest.store.getState().activeSessionId === id, session), "routing changed engine session");
    await button("Rack", nav).click();
    await button("Stop to edit rack").click();
    await page.waitForFunction(() => window.__workspaceTest.store.getState().activeSessionState !== "running");
    return { both, direct, silent, horizontalScroll: offset };
  } finally {
    if (await button("Stop Instruments").count()) await button("Stop Instruments").click();
    await page.evaluate(() => window.restoreMixProbe());
    await page.setViewportSize(viewport);
  }
}
