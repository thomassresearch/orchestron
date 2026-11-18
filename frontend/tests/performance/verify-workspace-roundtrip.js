// Use the disposable baseline library. The import creates a new performance.
async page => {
  const button = (name, root = page) => root.getByRole("button", { name, exact: true });
  const project = page.locator(".ws-project");
  const openProject = async () => { if (!await project.evaluate(el => el.open)) await project.locator("summary").click(); };
  const read = () => page.evaluate(() => window.__workspaceTest.store.getState().buildSequencerConfigSnapshot());
  const expected = await read();
  const kind = expected.sequencer.clipArrangement ? "clip" : "legacy";
  const file = "output/playwright/workspace-release-" + kind;
  for (const [suffix, caption] of [[".orch.json", "Export"], ["-midi.zip", "Export CSD (MIDI)"], ["-score.zip", "Export CSD (SCORE)"]]) {
    await openProject();
    const pending = page.waitForEvent("download", { timeout: 35000 });
    await button(caption, project).click();
    await (await pending).saveAs(file + suffix);
  }
  await openProject();
  await button("New", project).click();
  await page.waitForFunction(() => !window.__workspaceTest.store.getState().currentPerformanceId);
  await openProject();
  const chooser = page.waitForEvent("filechooser");
  await button("Import", project).click();
  await (await chooser).setFiles(file + ".orch.json");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").nth(1).uncheck();
  await button("Import", dialog).click();
  const name = "Release check " + kind + " " + Date.now();
  await dialog.getByRole("checkbox", { name: "overwrite" }).uncheck();
  await dialog.getByRole("textbox").fill(name);
  await button("Import", dialog).click();
  await page.waitForFunction(name => window.__workspaceTest.store.getState().performanceName === name, name);
  // Canonicalize object keys, retaining array order and optional fields as serialized.
  const canonical = value => JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
      : item);
  if (canonical(await read()) !== canonical(expected)) throw Error("Native import changed the authored configuration");
  const id = await page.evaluate(() => window.__workspaceTest.store.getState().currentPerformanceId);
  await openProject();
  await project.getByRole("textbox", { name: "Description" }).fill("Keep this take");
  await project.locator("summary").click();
  const path = "**/api/performances/" + id;
  await page.route(path, route => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { detail: "Storage unavailable" } }) : route.continue());
  await button("Save Performance").click();
  await page.getByRole("alert").filter({ hasText: "Storage unavailable" }).waitFor();
  await openProject();
  if (await project.getByRole("textbox", { name: "Description" }).inputValue() !== "Keep this take") throw Error("Failed save lost the edit");
  await project.locator("summary").click();
  await page.unroute(path);
  const saved = page.waitForResponse(r => r.request().method() === "PUT" && r.url().endsWith("/" + id));
  await button("Save Performance").click();
  if (!(await saved).ok()) throw Error("Save retry failed");
  await openProject();
  await button("New", project).click();
  await openProject();
  await project.getByRole("combobox", { name: "Load Performance" }).selectOption(id);
  await page.waitForFunction(id => window.__workspaceTest.store.getState().currentPerformanceId === id, id);
  if (canonical(await read()) !== canonical(expected)) throw Error("Saved configuration changed on reload");
  if (await page.evaluate(() => window.__workspaceTest.store.getState().performanceDescription) !== "Keep this take") throw Error("Retry did not save the edit");
  return { kind, version: expected.version, nativeRoundTrip: true, saveRetry: true };
}
