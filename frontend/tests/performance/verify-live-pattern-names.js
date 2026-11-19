// English workspace with UX Baseline Clip or Legacy loaded and transport stopped.
async page => {
  const button = (name, area = page) => area.getByRole("button", { name, exact: true });
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const long = "Final chorus with the counter-melody returning after the extended instrumental break";
  const isClip = await page.evaluate(long => {
    const s = window.__workspaceTest.store.getState(), config = s.buildSequencerConfigSnapshot();
    const lane = config.sequencer.clipArrangement?.lanes.find(l => l.id === "phrase");
    if (!lane) return false;
    const names = ["Introduction 1", "Verse 1", "Pre-chorus", long, "Chorus reprise", "Bridge", "Outro"];
    names.forEach((name, i) => { lane.definitions[i].name = name; });
    lane.clips[1].children[0].definitionId = lane.definitions[7].id;
    lane.clips[1].name = "Coda";
    // Array order is the runtime order. It is independent of physical pad identity.
    lane.definitions.reverse();
    lane.definitions.unshift({ ...lane.definitions[0], id: "standalone", name: "Verse 2 variation" });
    s.applySequencerConfigSnapshot(config);
    return true;
  }, long);
  await button("Live").click();
  const row = page.locator('[data-live-device="phrase"]:visible');
  const bank = row.locator(".ws-live-pads");
  const mode = row.getByRole("combobox", { name: "Pad mode" });
  const header = row.locator(".ws-live-device");
  const expectRoute = async (header, midi, instrument) => {
    await header.getByText(midi, { exact: true }).waitFor();
    await header.getByText(instrument, { exact: true }).waitFor();
  };
  await expectRoute(header, "MIDI 1", "UX Baseline Routed");
  const routePhrase = channel => page.evaluate(ch => window.__workspaceTest.store.getState().setSequencerTrackMidiChannel("phrase", ch), channel);
  await routePhrase(2);
  await expectRoute(header, "MIDI 2", "UX Baseline Direct");
  await routePhrase(15);
  await expectRoute(header, "MIDI 15", "No rack instrument");
  await routePhrase(1);
  if (!isClip) {
    await button("Pad 1", bank).click();
    check(await bank.locator(".ws-pad-name").count() === 0, "Unnamed legacy pads acquired names");
    check(await bank.evaluate(el => el.scrollWidth === el.clientWidth), "The legacy bank no longer fits");
    const { arpId, ccId, input } = await page.evaluate(() => {
      const store = window.__workspaceTest.store, state = store.getState();
      state.addArpeggiator();
      const arp = store.getState().sequencer.arpeggiators.at(-1);
      state.updateArpeggiator(arp.id, { targetChannel: 2 });
      state.addControllerSequencer();
      const cc = store.getState().sequencer.controllerSequencers.at(-1);
      state.setControllerSequencerTargetChannels(cc.id, [1, 2]);
      return { arpId: arp.id, ccId: cc.id, input: arp.inputChannel };
    });
    const deviceHeader = id => page.locator(`[data-live-device="${id}"]:visible .ws-live-device`);
    await expectRoute(deviceHeader(ccId), "MIDI 1, 2", "UX Baseline Routed, UX Baseline Direct");
    await expectRoute(deviceHeader(arpId), `MIDI ${input} → 2`, "UX Baseline Direct");
    await routePhrase(input);
    await expectRoute(header, `MIDI ${input}`, "UX Baseline Direct");
    return "Eight compact numbered pads, multi-channel controller and arpeggiated instrument destinations";
  }
  await button("Pad 1 · Introduction 1", bank).waitFor();
  const extra = row.getByRole("list", { name: "Arrangement patterns" });
  check((await extra.innerText()).includes("Verse 2 variation") && !(await bank.innerText()).includes("Verse 2 variation"),
    "A standalone definition was assigned to a physical slot");
  await page.setViewportSize({ width: 1000, height: 650 });
  await button("Pad 2 · Verse 1", bank).click();
  // Use the voice's musical name in the manual and check a library rename updates the header.
  await page.evaluate(() => window.__workspaceTest.store.setState(s => ({
    patches: s.patches.map(p => p.name === "UX Baseline Routed" ? { ...p, name: "Tenor Saxophone" } : p)
  })));
  await expectRoute(header, "MIDI 1", "Tenor Saxophone");
  await row.screenshot({ path: "screenshots/perform-live-pattern-names.png" });
  const earlier = button("Show earlier pads", row), later = button("Show later pads", row);
  check(await earlier.isDisabled(), "Earlier pads should be disabled at the start");
  await later.click();
  await earlier.click();
  check(await button("Pad 2 · Verse 1", bank).getAttribute("aria-pressed") === "true", "The scroll arrows selected another pad");
  await mode.selectOption("preview");
  await bank.getByRole("button", { name: /Routed phrase · Pad 2 · Verse 1$/ }).waitFor();
  const wrapped = bank.locator(".ws-pad-name", { hasText: long });
  check(await wrapped.evaluate(el => {
    const label = el.getBoundingClientRect(), button = el.closest("button").getBoundingClientRect();
    return label.height > parseFloat(getComputedStyle(el).lineHeight) &&
      label.top >= button.top && label.bottom <= button.bottom;
  }), "The full long label should wrap inside its preview button");
  await mode.selectOption("actions");
  await button("Pad actions · Pad 8 · Coda", bank).click();
  const copies = row.getByRole("combobox", { name: "Copy pad to…" });
  check((await copies.locator('option[value="3"]').textContent()).includes(long), "Copy destination lost its full name");
  await mode.selectOption("launch");
  const last = button("Pad 8 · Coda", bank);
  await last.focus();
  await page.waitForFunction(() => document.querySelector('.ws-launcher [data-live-device="phrase"] .ws-live-pads').scrollLeft > 0);
  const left = () => bank.evaluate(el => el.scrollLeft);
  const before = await left();
  await button("Mix").click();
  await button("Live").click();
  check(Math.abs(await left() - before) <= 1, "Returning to Live lost the bank's horizontal position");
  await button("Edit", row).click();
  await page.getByRole("heading", { name: "Routed phrase / Pad 2 · Verse 1" }).waitFor();
  const cdp = await page.context().newCDPSession(page);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await button("Keyboard").click();
    await page.locator(".ws-compact-launch .ws-live-pads:visible").waitFor();
    const picker = page.getByRole("combobox", { name: "Device", exact: true });
    check(await picker.getByRole("option", { name: "MIDI 1 · Routed phrase" }).count() === 1 &&
      await picker.getByRole("option", { name: "MIDI 2 · Manual lead" }).count() === 1, "Compact device choices lost their channels");
    await picker.selectOption("manual");
    await page.locator(".ws-compact-launch .ws-live-device").getByText("UX Baseline Direct", { exact: true }).waitFor();
    await picker.selectOption("phrase");
    await header.getByText("Tenor Saxophone", { exact: true }).waitFor();
    const headerLeft = (await header.boundingBox()).x;
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await bank.evaluate(el => { el.scrollLeft = 0; });
    const box = await bank.boundingBox(), x = box.x + box.width * .75, y = box.y + box.height / 2;
    const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{ x, y }]
    });
    await touch("touchStart", x);
    for (let i = 1; i <= 6; i++) await touch("touchMove", x - i * box.width / 12);
    await touch("touchEnd");
    check(await left() > 0, "Swiping did not scroll the compact bank");
    check(Math.abs((await header.boundingBox()).x - headerLeft) <= 1, "The device header scrolled away with the pads");
    await last.focus();
    check(await button("Pad 2 · Verse 1", bank).getAttribute("aria-pressed") === "true",
      "Scrolling or focusing selected a different pad");
    await last.press("Enter");
    check(await last.getAttribute("aria-pressed") === "true", "The last pad is unreachable");
    for (const [width, height] of [[390, 844], [640, 360]]) {
      await page.setViewportSize({ width, height });
      check(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth &&
        document.documentElement.scrollHeight === innerHeight && !scrollX && !scrollY), "Live overflows the viewport");
    }
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  }
  return "Named launch, preview, actions and editor; clip title, independent definitions, retained scroll and touch";
}
