// Run in the isolated English workspace with an empty arrangement. Use a fresh page at each size.
async (page, { keyboardOpen = page.viewportSize().height <= 460, screenshots = false } = {}) => {
  const button = (name, area = page) => area.getByRole("button", { name, exact: true });
  const dock = page.locator(".ws-dock:visible");
  const surface = dock.locator(".ws-pattern-surface");
  const devices = {};
  const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  async function point(target, offset) {
    await target.waitFor({ state: "attached" });
    await settle();
    return target.evaluate((el, offset) => {
      const r = el.getBoundingClientRect();
      const x = r.left + (offset?.x ?? r.width / 2), y = r.top + (offset?.y ?? r.height / 2);
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit) || el.closest(".ws-pattern-surface").scrollTop !== 0)
        throw Error(`Unreachable ${el.tagName} at ${x}, ${y} in ${innerWidth} × ${innerHeight}`);
      return { x, y };
    }, offset);
  }
  async function edit(kind) {
    if (kind === "sequencer") {
      const note = surface.locator('select').first();
      await point(note);
      const next = (await note.inputValue()) === "0" ? "2" : "0";
      await note.selectOption(next);
      if (await note.inputValue() !== next) throw Error("First note did not change");
    } else if (kind === "drummer") {
      const hit = surface.getByRole("button", { name: /^Step 1, drum key/ }).first();
      const { x, y } = await point(hit);
      const before = await hit.getAttribute("aria-pressed");
      await page.mouse.click(x, y);
      if (await hit.getAttribute("aria-pressed") === before) throw Error("First drum hit did not change");
    } else if (kind === "score") {
      const canvas = surface.getByRole("application");
      const { x, y } = await point(canvas, { x: 75, y: 42 });
      await page.mouse.click(x, y);
      await canvas.locator("g[data-note]").first().waitFor();
    } else if (kind === "arpeggiator") {
      const step = surface.getByRole("button", { name: /^Step 1:/ });
      const label = await step.getAttribute("aria-label");
      const { x, y } = await point(step, { x: 10, y: 10 });
      await page.mouse.dblclick(x, y);
      if (await step.getAttribute("aria-label") === label) throw Error("First arpeggiator step did not change");
    } else {
      const endpoint = surface.locator("svg circle.cursor-ns-resize").first();
      const { x, y } = await point(endpoint);
      const before = await endpoint.getAttribute("cy");
      const rect = await surface.locator("svg").boundingBox();
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x, y + (y < rect.y + rect.height / 2 ? 15 : -15), { steps: 3 });
      await page.mouse.up();
      if (await endpoint.getAttribute("cy") === before) throw Error("First curve endpoint did not change");
      const settings = button("Settings", dock);
      await settings.click(); await button("Step Mode", dock).click(); await settings.click();
      const cell = surface.getByRole("textbox", { name: "Step 1", exact: true });
      await point(cell); await cell.fill("80"); await cell.press("Enter");
      await settings.click(); await button("Curve Mode", dock).click(); await settings.click();
    }
  }
  async function closeEditor() {
    const close = button("Close", dock);
    await (await close.isVisible() ? close : button("Back to overview")).click();
  }
  for (const kind of ["sequencer", "drummer", "score", "controller", "arpeggiator"]) {
    await page.getByRole("combobox", { name: "Add track", exact: true }).selectOption(kind);
    devices[kind] = await page.locator("[data-clip-lane]").last().getAttribute("data-clip-lane");
    await button("Editor").click();
    if (keyboardOpen) await button("Keyboard").click();
    await edit(kind);
    if (keyboardOpen) await button("Keyboard").click();
    if (screenshots && page.viewportSize().width === 1366 && kind === "sequencer")
      await page.screenshot({ path: "screenshots/perform-arrange-pattern-editor.png" });
    await button("Settings", dock).click();
    await dock.getByRole("textbox", { name: "Pattern name" }).waitFor();
    await button("Settings", dock).click();
    await button("Save pattern here", dock).click();
    if (await dock.isVisible()) await closeEditor();
  }
  await button("Live").click();
  for (const [kind, id] of Object.entries(devices)) {
    await page.locator(`[data-live-device="${id}"] [data-pad-editor-toggle]`).click();
    if (keyboardOpen) await button("Keyboard").click();
    await edit(kind);
    if (keyboardOpen) await button("Keyboard").click();
    if (screenshots && page.viewportSize().width === 1366 && kind === "controller")
      await page.screenshot({ path: "screenshots/perform-live-curve-editor.png" });
    await closeEditor();
  }
}
