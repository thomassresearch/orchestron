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
    const phrase = laneHeader("phrase");
    const instrument = "UX Baseline Routed";
    const longName = "Tenor Saxophone with layered harmonics and a long reverb tail";
    const rename = (from, to) => page.evaluate(([from, to]) => window.__workspaceTest.store.setState(s => ({
      patches: s.patches.map(p => p.name === from ? { ...p, name: to } : p)
    })), [from, to]);
    await phrase.getByText(instrument, { exact: true }).waitFor();
    const geometry = () => phrase.evaluate(el => {
      const r = el.getBoundingClientRect(), timeline = el.nextElementSibling.getBoundingClientRect();
      return [r.width, timeline.left, timeline.width];
    });
    for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [640, 360]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const before = await geometry();
      await rename(instrument, longName);
      const name = phrase.getByText(longName, { exact: true });
      await name.waitFor();
      check(await name.evaluate(el => el.scrollWidth > el.clientWidth && getComputedStyle(el).textOverflow === "ellipsis"),
        "Long instrument name was not contained in the header");
      check((await geometry()).join() === before.join(), "The instrument name moved or narrowed the timeline");
      await phrase.getByText(/MIDI 1/).waitFor();
      for (const action of ["Mute", "Solo", "Controllers"]) {
        const control = button(action, phrase);
        await control.scrollIntoViewIfNeeded();
        const r = await control.boundingBox(), h = await phrase.boundingBox();
        check(r.x >= h.x && r.x + r.width <= h.x + h.width + 1 && await control.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }), action + " is obscured at " + width + " × " + height);
      }
      check(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth &&
        document.documentElement.scrollHeight === innerHeight && !scrollX && !scrollY), "Arrange overflows the page");
      if (width === 1440) {
        await phrase.getByRole("button", { name: /^(?:[▾▸] )?Routed phrase$/ }).click();
        await page.locator(".ws-inspector .ws-track-properties > p").filter({ hasText: longName }).waitFor();
      }
      await rename(longName, instrument);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => window.__workspaceTest.store.getState().setSequencerTrackMidiChannel("phrase", 7));
    await laneHeader("phrase").getByText(/MIDI 7/).waitFor();
    await phrase.getByText("No rack instrument", { exact: true }).waitFor();
    const cc = await page.evaluate(async () => {
      const s = window.__workspaceTest.store.getState();
      if (s.sequencer.clipArrangement) {
        const { addClipLane } = await import("/src/store/clipActions.ts");
        addClipLane("controller", s.addControllerSequencer);
      } else s.addControllerSequencer();
      const track = window.__workspaceTest.store.getState().sequencer.controllerSequencers.at(-1);
      s.setControllerSequencerTargetChannels(track.id, [1, 2, 5, 9]);
      return track.id;
    });
    await laneHeader(cc).getByText(/MIDI 1, 2, 5, 9/).waitFor();
    await laneHeader(cc).getByText("UX Baseline Routed, UX Baseline Direct", { exact: true }).waitFor();
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
    await laneHeader(arp.id).getByText(instrument, { exact: true }).waitFor();
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
