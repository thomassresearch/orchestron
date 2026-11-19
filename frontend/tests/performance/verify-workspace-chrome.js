// Start with UX Baseline Clip on the disposable workspace page.
async page => {
  const pages = page.locator("[data-app-pages]");
  const choose = name => pages.getByRole("button", { name, exact: true }).click();
  const geometry = () => page.evaluate(() => {
    const box = el => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return [x, y, width, height];
    };
    const header = document.querySelector(".app-header");
    const language = [...header.querySelectorAll(".app-languages, .app-language-select")].find(el => el.clientWidth);
    return [header, language, ...header.querySelectorAll("[data-app-pages] button")].map(box);
  });
  await page.evaluate(async () => {
    const s = window.__workspaceTest.store.getState();
    const { api } = await import("/src/api/client.ts");
    const { audioTemplate } = await import("/src/lib/audioTemplates.ts");
    const { graph, instrument_type, schema_version } = audioTemplate("instrument");
    const name = "First Sound";
    const starter = s.patches.find(p => p.name === name) ?? await api.createPatch({
      name, description: "A stereo instrument played from the keyboard.", graph, instrument_type, schema_version, always_on: false
    });
    await s.loadPatch(starter.id);
  });
  const observations = [];
  for (const [width, height] of [[1440, 900], [1920, 1080], [390, 844], [640, 360]]) {
    await page.setViewportSize({ width, height });
    await choose("Perform");
    await page.locator("[data-workspace-arranger]").waitFor();
    const reference = await geometry();
    const style = el => {
      const css = getComputedStyle(el);
      return [css.fontFamily, css.fontSize, css.borderTopWidth];
    };
    const referenceStyle = await page.locator("[data-workspace-arranger]").evaluate(style);
    for (const [name, selector] of [["Instrument Design", ".studio-panel"], ["Config", ".studio-panel"], ["Perform", "[data-workspace-arranger]"]]) {
      await choose(name);
      const panel = page.locator(selector).first();
      await panel.waitFor();
      if (JSON.stringify(await panel.evaluate(style)) !== JSON.stringify(referenceStyle)) throw Error("Panel typography or border differs on " + name);
      if (width === 1440 && name === "Instrument Design") {
        await page.getByTestId("node").first().waitFor();
        await page.getByRole("button", { name: "Fit full graph in view" }).click();
        await page.waitForFunction(() => [...document.querySelectorAll(".studio-panel img")].every(img => img.complete && img.naturalWidth));
        await page.screenshot({ path: "screenshots/instrument_toolbar_current.jpg", quality: 92 });
      }
      if (width === 1440 && name === "Config") await page.screenshot({ path: "screenshots/config.png" });
      if (name !== "Perform") await page.locator(".app-page-scroll").evaluate(el => { el.scrollTop = el.scrollHeight; });
      const actual = await geometry();
      if (JSON.stringify(actual) !== JSON.stringify(reference)) throw Error(`Header moved on ${name} at ${width} × ${height}: ${JSON.stringify(actual)}`);
    }
    observations.push({ width, height, header: reference[0] });
  }
  return observations;
}
