// English workspace, UX Baseline Clip or Legacy. All additions stay in the loaded session.
async page => {
  const button = (name, area = page) => area.getByRole("button", { name, exact: true });
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    const clip = await page.evaluate(() => !!window.__workspaceTest.store.getState().sequencer.clipArrangement);
    const laneHeader = id => clip ? page.locator(`[data-clip-lane="${id}"] > .sticky`) :
      page.locator("section").filter({ has: page.locator(`[data-arrangement-lane="${id}"]`) }).last().locator(".arranger-lane-heading").locator("..");
    check((await laneHeader("phrase").innerText()).includes("MIDI 1"), "Melodic channel missing");
    await page.evaluate(() => window.__workspaceTest.store.getState().setSequencerTrackMidiChannel("phrase", 7));
    await laneHeader("phrase").getByText(/MIDI 7/).waitFor();
    const cc = await page.evaluate(async () => {
      const s = window.__workspaceTest.store.getState();
      if (s.sequencer.clipArrangement) {
        const { addClipLane } = await import("/src/store/clipActions.ts");
        addClipLane("controller", s.addControllerSequencer);
      } else s.addControllerSequencer();
      const track = window.__workspaceTest.store.getState().sequencer.controllerSequencers.at(-1);
      s.setControllerSequencerTargetChannels(track.id, [2, 5, 9]);
      return track.id;
    });
    await laneHeader(cc).getByText(/MIDI 2, 5, 9/).waitFor();
    const arp = await page.evaluate(async () => {
      const store = window.__workspaceTest.store, state = store.getState();
      if (state.sequencer.clipArrangement) {
        const { addClipLane } = await import("/src/store/clipActions.ts");
        addClipLane("arpeggiator", state.addArpeggiator);
      } else state.addArpeggiator();
      const track = store.getState().sequencer.arpeggiators.at(-1);
      state.updateArpeggiator(track.id, { playbackMode: "arranger", targetChannel: 1 });
      return { id: track.id, input: track.inputChannel };
    });
    await laneHeader(arp.id).getByText(new RegExp("MIDI " + arp.input + " → 1")).waitFor();
    await button("Mix").click();
    const tools = page.locator(".ws-mix-tools"), nav = tools.getByRole("navigation");
    await button("Rack", nav).click();
    const add = button("Add Instrument", tools);
    const picker = page.getByRole("dialog", { name: "Add Instrument" });
    const bindings = () => page.evaluate(() => window.__workspaceTest.store.getState().sequencerInstruments);
    const library = await page.evaluate(() => {
      const s = window.__workspaceTest.store.getState();
      return s.patches.filter(p => !p.is_template);
    });
    const lead = library.find(p => p.name === "UX Baseline Routed");
    const original = await bindings();
    const category = { melody: "Melody", bass: "Bass", percussion: "Percussion", effects_noise: "Effects / Noise", continuous: "Continuous (always-on)" }[lead.instrument_type];
    const group = picker.getByRole("button", { name: new RegExp(category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
    for (const [width, height] of [[1440, 900], [900, 650], [390, 844], [640, 360]]) {
      await page.setViewportSize({ width, height });
      await add.click();
      await group.click();
      const choice = button(lead.name, picker);
      await choice.scrollIntoViewIfNeeded();
      check(await choice.evaluate(el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      }), "Patch is clipped at " + width + " × " + height);
      if (width === 900 && clip) await page.locator(".ws-overview").screenshot({ path: "screenshots/perform-rack-add-instrument.png" });
      await picker.press("Escape");
      check(await add.evaluate(el => el === document.activeElement), "Escape lost focus");
      check((await bindings()).length === original.length, "Opening or cancelling created a slot");
      check(await page.evaluate(() => document.documentElement.scrollHeight === innerHeight &&
        document.documentElement.scrollWidth === innerWidth && !scrollX && !scrollY), "Perform scrolls the page");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await add.click();
    await picker.getByRole("searchbox").fill(lead.name);
    await button(lead.name, picker).click();
    const after = await bindings(), added = after.at(-1);
    check(after.length === original.length + 1 && added.patchId === lead.id, "Wrong rack addition");
    await page.locator(`[data-rack-binding-id="${added.id}"][data-selected]`).waitFor();
    check(await page.locator('.ws-shell [data-mix-detail="instrument"]').count() === 0, "Rack offers duplicate instrument controls");
    await button("Routing", nav).click();
    const routes = page.locator(".ws-routing-body");
    const source = routes.getByRole("combobox", { name: "Source", exact: true }).first();
    await source.selectOption(added.id);
    for (const b of after) {
      const label = await source.locator(`option[value="${b.id}"]`).textContent();
      check(b.midiChannel > 0 ? label.includes("MIDI Ch. " + b.midiChannel) : !label.includes("MIDI Ch."), "Wrong source channel: " + label);
    }
    check(!(await source.locator('option[value="$master"]').textContent()).includes("MIDI"), "Master has a channel");
    await button("Instrument controls", tools).waitFor();
    if (clip) {
      await page.setViewportSize({ width: 900, height: 820 });
      await routes.getByRole("combobox", { name: "Destination", exact: true }).selectOption("$master");
      await routes.locator("summary").filter({ hasText: "Destination matrix" }).click();
      await routes.screenshot({ path: "screenshots/perform-routing-midi-channel.png" });
    }
    check(!errors.length, errors.join("\n"));
    return { format: clip ? "clip" : "legacy", newPatch: lead.name, channel: added.midiChannel };
  } finally { page.off("pageerror", onError); }
}
