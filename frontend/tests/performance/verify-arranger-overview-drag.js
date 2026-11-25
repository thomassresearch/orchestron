// Run on clip-arranger.html?workspace=1. jsdom cannot test overlapping pointer targets.
async page => {
  const check = (condition, message) => { if (!condition) throw Error(message); };
  await page.reload();
  await page.locator("[data-arranger-clip]").first().waitFor();
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.evaluate(() => {
    const { store, report } = window.__clipTest;
    const model = structuredClone(report.model);
    const beat = 20160;
    model.end = 256 * beat;
    for (const lane of model.lanes) {
      const pattern = lane.definitions.find(d => d.kind === "pattern");
      const source = lane.clips[0];
      const makeClip = (id, name, start, length) => ({
        ...source, id: lane.id + id, name, start: start * beat, length: length * beat,
        offset: 0, mode: "loop", children: [{ id: lane.id + id + "-phrase", definitionId: pattern.id }]
      });
      lane.clips = [makeClip("intro", "Intro", 0, 32), makeClip("verse", "Verse", 64, 64),
        makeClip("chorus", "Chorus", 144, 64), makeClip("outro", "Outro", 224, 32)];
    }
    const lead = model.lanes[0];
    lead.clips.splice(1, 0, { ...lead.clips[0], id: "fill", name: "Fill", mode: "once",
      start: 40 * beat, length: 4 * beat, children: [{ ...lead.clips[0].children[0], id: "fill-phrase" }] });
    lead.clips.push({ ...lead.clips[1], id: "empty", name: "Break", start: 216 * beat,
      children: [{ id: "rest", restTicks: 4 * beat }] });
    store.setState(s => ({ sequencer: { ...s.sequencer, clipArrangement: model } }));
  });
  const lane = page.locator("[data-clip-lane]").first();
  const clip = lane.locator('[data-arranger-clip="fill"]');
  const empty = lane.locator('[data-arranger-clip="empty"]');
  const zoom = page.getByRole("slider", { name: "Zoom" });
  const start = page.getByRole("spinbutton", { name: "Start · master beats" });
  const length = page.getByRole("spinbutton", { name: "Length · master beats" });
  const controls = '[role="separator"], [data-transpose-target], [data-structure-target], [data-clip-add]';
  const hidden = node => getComputedStyle(node).opacity === "0" && getComputedStyle(node).pointerEvents === "none";

  await zoom.fill("0");
  for (const expanded of [false, true]) {
    if (expanded) await lane.getByRole("button", { expanded: false }).first().click();
    for (const item of [clip, empty]) {
      const interactive = item.locator(controls);
      check(await interactive.count() > 2, "Expected resize handles and inline actions");
      for (const control of await interactive.all()) check(await control.evaluate(hidden), "Crowded control intercepted the clip");
      const cursors = await item.evaluate(el => {
        const r = el.getBoundingClientRect(), results = [];
        for (const x of [1, r.width / 2, r.width - 1])
          for (const y of [4, r.height / 2, r.height - 4])
            results.push(getComputedStyle(document.elementFromPoint(r.x + x, r.y + y)).cursor);
        return results;
      });
      check(cursors.every(cursor => cursor === "grab"), "Expected a grab cursor across the clip: " + cursors);
    }
    const wide = lane.locator("[data-arranger-clip]").first();
    check(!await wide.locator(':scope > [role=separator]').first().evaluate(hidden), "Wide neighbor lost its trim handles");

    const r = await clip.boundingBox(), y = r.y + r.height / 2;
    await page.mouse.move(r.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(r.x + 1 + r.width * 2, y, { steps: 8 });
    await page.mouse.up();
    check(Math.abs(Number(await start.inputValue()) - (expanded ? 56 : 48)) <= 0.5 && await length.inputValue() === "4",
      "Dragging a short clip edge should move the window eight beats and keep its length");
    if (!expanded) await page.getByRole("region", { name: "Multitrack arranger" }).screenshot({
      path: "screenshots/arranger-overview-drag.png"
    });
  }

  // A short clip remains operable from the keyboard even before zooming in.
  await clip.locator("[data-structure-key]").first().focus();
  await page.keyboard.press("Tab");
  check(await clip.locator("[data-transpose-target]").first().evaluate(node =>
    node.matches(":focus-visible") && getComputedStyle(node).opacity === "1"), "Tab did not reveal transpose");
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Transpose in arranger" }).waitFor();
  await page.keyboard.press("Escape");
  const right = clip.locator(':scope > [role=separator]').last();
  await right.focus();
  await page.keyboard.press("ArrowRight");
  check(await length.inputValue() === "4.25", "Keyboard trim was unavailable in the overview");
  await zoom.fill("100");
  // The slider keeps the center beat. Scroll to the moved clip at its new scale.
  await page.locator("[data-arranger-viewport]").evaluate(el => { el.scrollLeft = 54 * 100; });
  await clip.waitFor();
  const transpose = clip.locator("[data-transpose-target]").first();
  const add = clip.locator("[data-structure-target]").first();
  for (const control of [right, transpose, add]) check(!await control.evaluate(hidden), "Control did not return at close zoom");
  await transpose.click();
  await page.getByRole("dialog", { name: "Transpose in arranger" }).getByRole("button", { name: "Close" }).click();
  await add.click();
  await page.getByRole("dialog", { name: "Add content" }).waitFor();
  await page.keyboard.press("Escape");

  // Finish an active trim even when the preview becomes narrower than the controls.
  const edge = await right.boundingBox(), edgeX = edge.x + edge.width / 2, edgeY = edge.y + 6;
  const previousStart = await start.inputValue();
  await page.mouse.move(edgeX, edgeY);
  await page.mouse.down();
  await page.mouse.move(edgeX - 400, edgeY, { steps: 12 });
  await page.mouse.up();
  check(await length.inputValue() === "0.25" && await start.inputValue() === previousStart, "Close-zoom trim lost pointer capture");

  const cancel = page.getByRole("group", { name: "Arrangement changes" }).getByRole("button", { name: "Cancel" });
  await cancel.click();
  await zoom.fill("0");
  await page.evaluate(() => {
    const store = window.__clipTest.store, sequencer = store.getState().sequencer;
    const model = structuredClone(sequencer.clipArrangement), intro = model.lanes[0].clips[0];
    intro.mode = "once";
    intro.children.push({ id: "intro-rest", restTicks: 28 * 20160 });
    store.setState({ sequencer: { ...sequencer, clipArrangement: model } });
  });
  const wide = lane.locator("[data-arranger-clip]").first();
  for (const expanded of [true, false]) {
    if ((await lane.getAttribute("data-expanded") === "true") !== expanded)
      await lane.locator("button[aria-expanded]").first().click();
    const preview = wide.getByRole("img").first();
    const box = await preview.boundingBox(), windowBox = await wide.boundingBox();
    const y = box.y + box.height / 2, destX = windowBox.x + windowBox.width * 0.4;
    await page.mouse.move(box.x + 3, y);
    await page.mouse.down();
    await page.mouse.move(destX, y, { steps: 12 });
    await page.mouse.up();
    check(Math.abs((await preview.boundingBox()).x - destX) < 4, "Narrow pattern did not move into the rest");
    check((await wide.boundingBox()).x === windowBox.x, "Moving a pattern moved its clip");
    await cancel.click();
    check(Math.abs((await preview.boundingBox()).x - box.x) < 1, "Cancel did not restore the pattern");
  }
  await clip.locator("[data-clip-header]").click({ button: "right" });
  await page.getByRole("menuitem", { name: "Duplicate clip" }).waitFor();
  await page.keyboard.press("Escape");
  await clip.getByRole("img").first().dblclick();
  await page.getByRole("region", { name: "Editing", exact: true }).waitFor();
}
