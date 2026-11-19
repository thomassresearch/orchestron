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
      let queued = false, queuedInLive = false, sounded = false;
      while (!sounded && Date.now() - start < 4700) {
        const engine = await (await page.request.get(status)).json();
        const track = engine.tracks.find(track => track.track_id === "manual");
        queued ||= track.active_pad === 0 && track.queued_pad === 1;
        queuedInLive ||= await row.locator('[data-queued][aria-label="Pad 2"]').isVisible();
        sounded = track.active_pad === 1 && await sounding(2).isVisible();
        if (!sounded) await page.waitForTimeout(95);
      }
      const selected = await button("Pad 2", row).getAttribute("aria-pressed") === "true";
      let secondClickSounded = null;
      if (!sounded) {
        await button("Pad 2", row).click();
        secondClickSounded = await sounding(2).waitFor({ timeout: 7000 }).then(() => true, () => false);
      }
      return { pass: selected && queued && queuedInLive && sounded, selected, queued, queuedInLive, sounded, secondClickSounded };
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
    const message = "Temporary storage unavailable for this performance. ".repeat(60) + "End of storage report.";
    await page.route(path, route => route.request().method() === "PUT" ? route.fulfill({
      status: 503, json: { detail: message }
    }) : route.continue());
    try {
      await button("Save Performance").click();
      await page.locator(".ws-status [role=alert]").filter({ hasText: "Temporary storage unavailable" }).waitFor();
      await settle();
      const after = await bounds();
      const summary = page.locator(".ws-error summary");
      await summary.press("Enter");
      const details = page.getByRole("region", { name: "Error details", exact: true });
      await details.focus();
      while (await details.evaluate(el => el.scrollTop + el.clientHeight < el.scrollHeight - 1)) {
        const next = await details.evaluate(el => Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + el.clientHeight / 2));
        await details.press("PageDown");
        await page.waitForFunction(next => document.activeElement.scrollTop >= next - 1, next);
      }
      const fullError = await details.evaluate(el => el.scrollTop > 0) && (await details.innerText()).includes(message);
      const expanded = await bounds();
      await page.keyboard.press("Escape");
      const focusRestored = await summary.evaluate(el => el === document.activeElement);
      const dock = page.locator(".ws-dock");
      if (format === "Clip") await button("Create variation here", dock).click();
      const hold = button("HOLD", dock).nth(2);
      const initial = await hold.getAttribute("aria-pressed");
      await hold.click();
      const edited = await hold.getAttribute("aria-pressed") === (initial === "true" ? "false" : "true");
      const localScroll = await dock.locator(".ws-dock-scroll").evaluate(el => el.scrollTop);
      await hold.press("Enter");
      const restored = await hold.getAttribute("aria-pressed") === initial;
      const hit = el => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      };
      const controlsReachable = await hold.evaluate(hit) && await button("Back to overview").evaluate(hit)
        && await button("Play", page.getByRole("group", { name: "Song transport" })).evaluate(hit)
        && await page.locator(".ws-keyboard [aria-label='C1']").first().evaluate(hit);
      const bounded = [before, after, expanded, await bounds()].every(r =>
        r.offset.every(v => v === 0) && r.document.every((v, i) => Math.abs(v - r.viewport[i]) <= 1));
      return { format, bounded, fullError, focusRestored, edited, restored, controlsReachable, localScroll,
        pass: bounded && fullError && focusRestored && edited && restored && controlsReachable && localScroll > 0 &&
          after.work >= 44 && after.editorBody >= 44 && after.editorBody >= before.editorBody - 1 && expanded.editorBody === after.editorBody,
        before, after, expanded };
    } finally {
      await page.unroute(path);
    }
  }

  const launch = await coldLaunch();
  const editors = [await smallEditor("Clip"), await smallEditor("Legacy")];
  return { pass: launch.pass && editors.every(e => e.pass), launch, editors };
}
