// Playwright CLI run-code. Start at the local production app with both UX Baseline
// songs imported into a disposable library, English selected, and Instruments stopped.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const api = path => new URL("/api/" + path, page.url()).href;
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

  async function load(format) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.reload();
    await button("Perform").click();
    const project = page.locator(".ws-project");
    await project.locator("summary").click();
    const name = "UX Baseline " + format;
    await project.getByRole("combobox", { name: "Load Performance" }).selectOption({ label: name });
    await page.waitForFunction(name => document.querySelector(".ws-title")?.textContent === name, name);
    if (await project.evaluate(el => el.open)) await project.locator("summary").click();
    await button("Arrange").click();
    await settle();
  }

  async function coldLaunch() {
    await load("Legacy");
    await button("Live").click();
    const row = page.getByRole("group", { name: "Manual lead", exact: true });
    const mode = row.getByRole("combobox", { name: "Pad mode" });
    const sounding = n => row.locator(`[data-sounding][aria-label="Pad ${n}"]`);
    await mode.selectOption("preview");
    await button("Audition Manual lead · Pad 3", row).focus();
    await page.keyboard.down("Space");
    try {
      await button("Stop Instruments").waitFor();
      const sessions = await (await page.request.get(api("sessions"))).json();
      const id = sessions.find(session => session.state === "running").session_id;
      const status = api("sessions/" + id + "/sequencer/status");
      await page.waitForFunction(async url => (await (await fetch(url)).json()).auditions?.manual?.preview_active, status);
      await page.keyboard.press("Escape");
      await page.keyboard.up("Space");
      await page.waitForFunction(async url => !(await (await fetch(url)).json()).auditions?.manual?.preview_gesture, status);
      await mode.selectOption("launch");
      await button("Pad 1", row).click();
      await button("Play", row).click();
      await sounding(1).waitFor();
      await button("Pad 2", row).click();

      // At the fixture's 120 BPM, this covers two complete four-beat cycles.
      const start = Date.now();
      let queued = false, sounded = false;
      while (!sounded && Date.now() - start < 4700) {
        const engine = await (await page.request.get(status)).json();
        const track = engine.tracks.find(track => track.track_id === "manual");
        queued ||= track.queued_pad === 1;
        sounded = track.active_pad === 1 && await sounding(2).isVisible();
        if (!sounded) await page.waitForTimeout(95);
      }
      const selected = await button("Pad 2", row).getAttribute("aria-pressed") === "true";
      let secondClickSounded = null;
      if (!sounded) {
        await button("Pad 2", row).click();
        secondClickSounded = await sounding(2).waitFor({ timeout: 7000 }).then(() => true, () => false);
      }
      return { pass: sounded, selected, queued, sounded, secondClickSounded };
    } finally {
      await page.keyboard.up("Space");
      if (await button("Stop Instruments").isVisible()) await button("Stop Instruments").click();
    }
  }

  async function smallEditor(format) {
    await load(format);
    if (format === "Clip") {
      await page.locator('[data-arranger-clip="phrase-1"] button').first().dblclick();
    } else {
      await page.locator('[data-arrangement-lane="phrase"] [data-arrangement-occurrence]').first().dblclick({ position: { x: 5, y: 7 } });
    }
    const keys = button("Keyboard");
    if (await keys.getAttribute("aria-pressed") !== "true") await keys.click();
    await page.setViewportSize({ width: 640, height: 360 });
    const bounds = () => page.evaluate(() => {
      const body = document.querySelector(".ws-dock-scroll") ?? document.querySelector(".ws-clip-editor-host");
      return { viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        offset: [scrollX, scrollY], work: document.querySelector(".ws-panes").getBoundingClientRect().height, editorBody: body.getBoundingClientRect().height };
    });
    await settle();
    const before = await bounds();
    const path = "**/api/performances/*";
    await page.route(path, route => route.request().method() === "PUT" ? route.fulfill({
      status: 503, json: { detail: "Temporary storage unavailable for this performance. ".repeat(10) }
    }) : route.continue());
    try {
      await button("Save Performance").click();
      await page.locator(".ws-status [role=alert]").filter({ hasText: "Temporary storage unavailable" }).waitFor();
      await settle();
      const after = await bounds();
      const bounded = [before, after].every(r => r.offset.every(v => v === 0) && r.document.every((v, i) => Math.abs(v - r.viewport[i]) <= 1));
      return { format, bounded, pass: bounded && after.work >= 44, before, after };
    } finally {
      await page.unroute(path);
    }
  }

  const launch = await coldLaunch();
  const editors = [await smallEditor("Clip"), await smallEditor("Legacy")];
  return { pass: launch.pass && editors.every(e => e.pass), launch, editors };
}
