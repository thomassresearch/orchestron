// Run with UX Baseline Clip loaded in the workspace harness, English, engine stopped.
async page => {
  const button = (name, parent = page) => parent.getByRole("button", { name, exact: true });
  const divider = page.getByRole("separator", { name: "Resize editor" });
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const dock = page.locator(".ws-dock");
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const geometry = async () => {
    await settle();
    return page.evaluate(() => {
      const box = selector => document.querySelector(selector)?.getBoundingClientRect();
      const timeline = box("[data-arranger-viewport]"), header = box("[data-clip-lane] > :first-child");
      const area = box(".ws-panes"), overview = box(".ws-overview"), dock = box(".ws-dock");
      return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight,
        namesX: header?.x, rulerY: timeline?.y, overview: overview.height, area: area.height, dock: dock?.height ?? 0,
        right: box(".ws-inspector")?.right, workRight: box(".ws-work").right };
    });
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await button("Arrange").click();
  if (await dock.count()) await button("Close", dock).click();
  const closed = await geometry();
  check(!await divider.count() && closed.area === closed.overview, "Closed dock reserved space");
  const track = page.locator("[data-clip-lane]").first();
  const normalHeight = (await track.boundingBox()).height;
  await button("Fit tracks").click();
  check((await track.boundingBox()).height > normalHeight, "Fit tracks did not increase row height");
  await button("Fit tracks").click();
  const full = await page.locator(".ws-overview").boundingBox();
  await button("Inspector").click();
  const wider = await page.locator(".ws-overview").boundingBox();
  check(wider.x === full.x && wider.width > full.width, "Closing Inspector failed to release only its column");
  await button("Inspector").click();
  await page.locator('[data-arranger-clip="phrase-1"] button').first().dblclick();
  await divider.waitFor();
  const edit = await geometry();
  check(edit.rulerY === closed.rulerY && edit.namesX === closed.namesX && edit.dock >= 180, "Opening moved the timeline");
  await page.evaluate(() => {
    const s = window.__workspaceTest.store.getState();
    window.__workspaceTest.beforeResize = { node: document.querySelector(".ws-dock-scroll section"), key: s.clipEditingKey, drafts: s.clipDrafts, song: s.sequencer, revision: s.sequencerEditRevision };
  });
  const value = async () => Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus(); await page.keyboard.press("Home"); check(await value() === 180, "Keyboard minimum");
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("Shift+ArrowDown"); check(await value() === 189, "Keyboard increments");
  await page.keyboard.press("End"); check(await value() === Number(await divider.getAttribute("aria-valuemax")), "Keyboard maximum");
  await page.keyboard.press("Home");
  const drag = async () => {
    const b = await divider.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + b.height / 2 - 64, { steps: 4 });
  };
  await drag(); check(await value() === 244, "Pointer outside grip");
  await page.keyboard.press("Escape"); await page.mouse.up(); check(await value() === 180, "Escape lost preference");
  for (const reason of ["blur", "pointercancel", "lostpointercapture"]) {
    await drag();
    if (reason === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else await divider.evaluate((el, type) => {
      // The primary mouse pointer is captured on the real separator.
      const id = 1;
      if (!el.hasPointerCapture(id)) throw Error("Pointer was not captured");
      if (type === "pointercancel") el.dispatchEvent(new PointerEvent(type, { pointerId: id, bubbles: true }));
      else el.releasePointerCapture(id);
    }, reason);
    await page.mouse.move(20, 60); await page.mouse.up();
    check(await value() === 180, reason + " changed the preferred height");
  }
  await drag(); await page.mouse.up(); check(await value() === 244, "Release did not retain height");
  await drag(); await page.setViewportSize({ width: 1320, height: 820 }); await settle(); await page.mouse.up();
  check(await value() === 244, "Resize during gesture changed preference");
  const stable = await page.evaluate(() => {
    const h = window.__workspaceTest, s = h.store.getState(), b = h.beforeResize;
    return b.node === document.querySelector(".ws-dock-scroll section") && b.key === s.clipEditingKey && b.drafts === s.clipDrafts && b.song === s.sequencer && b.revision === s.sequencerEditRevision;
  });
  check(stable, "Resize remounted editor or wrote musical data");
  await button("Expand", dock).click(); check(!await divider.count() && !await page.locator(".ws-overview").isVisible(), "Expanded layout");
  await button("Restore split", dock).click(); check(await value() === 244, "Split did not restore");
  await button("Keyboard").click(); await page.getByRole("region", { name: "Keyboard", exact: true }).waitFor();
  check(await value() === 244, "Keyboard lost preferred split");
  await button("Editor").click(); await divider.waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  const restored = await geometry();
  check(restored.rulerY === closed.rulerY && restored.namesX === closed.namesX && restored.right === restored.workRight, "Pane geometry drifted");
  for (const viewport of [{ width: 1280, height: 720 }, { width: 736, height: 720 }, { width: 390, height: 844 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(viewport); const bounds = await geometry();
    check(bounds.pageHeight === bounds.height && bounds.pageWidth === bounds.width, "Document overflow " + JSON.stringify(bounds));
  }
  check(!await divider.count() && await button("Back to overview").isVisible(), "Single-pane return missing");
  check(!await inspector.count(), "Desktop Inspector leaked into drawer");
  await button("Inspector").click();
  check(await inspector.getAttribute("data-drawer") === "true" && await button("Close · Inspector").evaluate(el => el === document.activeElement), "Drawer focus");
  await page.keyboard.press("Escape");
  check(!await inspector.count() && await button("Inspector").evaluate(el => el === document.activeElement), "Escape did not restore focus");
  await button("Back to overview").click(); await page.setViewportSize({ width: 1440, height: 900 }); await settle();
  check(await inspector.isVisible() && !await dock.count(), "Returning from single pane failed");
  await button("Editor").click(); check(await value() === 244, "Preferred height not restored");
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const box = await divider.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
    check(box.height >= 24, "Touch divider is too small");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - 30 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    check(await value() === 274, "Touch gesture did not resize");
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  }
  await page.evaluate(() => { delete window.__workspaceTest.beforeResize; });
  return { closed, edit, restored };
}
