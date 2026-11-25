// Start with UX Baseline Clip, English, 1440 × 900.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const sizes = [{ width: 390, height: 844 }, { width: 640, height: 360 }];
  const languages = ["german", "french", "spanish", "english"];
  const hits = [];
  await page.locator("[data-keyboard-toggle]").click();
  for (const size of sizes) {
    await page.setViewportSize(size);
    for (const language of languages) {
      const picker = page.locator(".app-language-select");
      if (await picker.isVisible()) await picker.selectOption(language);
      else await button({ german: "DE", french: "FR", spanish: "ES", english: "EN" }[language]).click();
      await page.waitForFunction(language => window.__workspaceTest.store.getState().guiLanguage === language, language);
      const views = page.locator("[data-perform-view]");
      for (const index of [1, 2, 0]) {
        const view = views.nth(index);
        await view.press("Enter");
        if (await view.getAttribute("aria-pressed") !== "true") throw Error("Keyboard navigation failed");
        const pages = page.locator("[data-mix-page]");
        if (await pages.count() !== (index === 2 ? 3 : 0)) throw Error("Wrong navigation for the selected view");
        if (index === 2) {
          const adjacent = await view.evaluate(button => {
            const primary = button.closest("nav"), secondary = primary.nextElementSibling;
            const band = primary.previousElementSibling;
            return band.contains(document.querySelector(".ws-project")) && band.contains(document.querySelector(".ws-transport")) &&
              secondary.contains(document.querySelector("[data-mix-page]")) &&
              Math.abs(primary.getBoundingClientRect().bottom - secondary.getBoundingClientRect().top) <= 1;
          });
          if (!adjacent) throw Error("Perform navigation rows are separated");
          for (const destination of ["rack", "routing", "mixer"]) {
            const tab = page.locator(`[data-mix-page="${destination}"]`);
            await tab.press("Enter");
            if (await tab.getAttribute("aria-pressed") !== "true") throw Error("Mix page navigation failed");
          }
        }
        const hidden = await page.locator(".ws-commandbar button:visible, .ws-project-controls > button, .ws-project summary, [data-perform-view], [data-mix-page], .ws-status input, [data-app-pages] button, .ws-transport button").evaluateAll(nodes => nodes.filter(el => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !el.contains(hit) || r.x < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1;
        }).map(e => e.textContent || e.title));
        if (hidden.length) throw Error(language + " " + size.width + ": " + hidden.join(", "));
        if (!await page.evaluate(() => document.documentElement.scrollHeight === innerHeight && document.documentElement.scrollWidth === innerWidth)) throw Error("Page overflow");
        hits.push([size.width, language, await view.innerText()]);
      }
    }
  }
  await page.locator("[data-keyboard-toggle]").click();
  await page.setViewportSize(sizes[0]);
  await page.locator('[data-arranger-clip="phrase-1"]').getByTitle(/Chorus · Drag/).click();
  await page.locator(".ws-project summary").focus();
  const inspector = button("Inspector");
  for (let i = 0; i < 20 && !await inspector.evaluate(el => el === document.activeElement); i++) await page.keyboard.press("Tab");
  if (!await inspector.evaluate(el => el.matches(":focus-visible"))) throw Error("Inspector missing from visible keyboard focus order");
  await page.keyboard.press("Enter");
  await page.locator(".ws-inspector[data-drawer]").waitFor();
  await page.screenshot({ path: "screenshots/perform-workspace-shell-drawer.png" });
  await page.keyboard.press("Escape");
  const project = page.locator(".ws-project");
  await project.locator("summary").click();
  await button("New", project).click();
  await button("Start Instruments").click();
  const alert = page.locator(".ws-status [role=alert]");
  await alert.waitFor();
  const error = await alert.innerText();
  await button("Mix").click();
  if (!error || !(await alert.innerText()).includes(error)) throw Error("Engine failure missing from the status bar");
  return { hits, engineError: error };
}
