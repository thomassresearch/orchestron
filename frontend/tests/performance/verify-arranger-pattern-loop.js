// Run on tests/performance/clip-arranger.html?workspace using the isolated clip fixture.
async page => {
  await page.setViewportSize({ width: 1440, height: 840 });
  await page.reload();
  await page.waitForFunction(() => !!window.__clipTest);
  await page.evaluate(() => {
    const { store } = window.__clipTest;
    const state = store.getState().sequencer;
    const model = structuredClone(state.clipArrangement);
    model.lanes = model.lanes.slice(0, 2);
    const lane = model.lanes[0], clip = lane.clips[0];
    const patterns = lane.definitions.filter(d => d.kind === "pattern").slice(0, 2);
    patterns[0].name = "Verse";
    patterns[1].name = "Answer";
    clip.children = patterns.map((d, i) => ({ id: "phrase-" + i, definitionId: d.id }));
    clip.mode = "loop";
    model.end = clip.length = 16 * 20160;
    model.revision++;
    store.setState({ sequencer: { ...state, clipArrangement: model } });
  });
  const lane = page.locator("[data-clip-lane]").first();
  const transport = page.getByRole("group", { name: "Song transport" });
  const loop = transport.getByRole("button", { name: "Loop", exact: true });
  const range = async (start, end) => {
    await page.waitForFunction(([a,b]) => {
      const loop = window.__clipTest.store.getState().sequencer.arrangerLoopSelection;
      return loop?.startStep === a && loop.endStep === b;
    }, [start,end]);
  };
  // Compact selection, then a reverse Shift selection across the repeat boundary.
  await lane.getByRole("img", { name: "Answer", exact: true }).first().click();
  await loop.click();
  await range(32,64);
  await loop.click();
  await lane.getByRole("button", { expanded: false, name: /Warm Lead/ }).click();
  const verse = lane.getByTitle("pattern: Verse", { exact: true });
  const answer = lane.getByTitle("pattern: Answer", { exact: true });
  await verse.nth(1).click();
  await answer.first().click({ modifiers: ["Shift"] });
  await loop.click();
  await range(32,96);
  const arrange = page.getByRole("region", { name: "Arrange", exact: true });
  await arrange.screenshot({ path: "screenshots/arranger-selected-pattern-loop.png" });

  await loop.click();
  await answer.first().click();
  await answer.first().click({ button: "right" });
  const rename = page.getByRole("menuitem", { name: "Rename pattern", exact: true });
  await rename.waitFor();
  await arrange.screenshot({ path: "screenshots/clip-arranger-duplicate.png" });
  await rename.click();
  const editor = page.getByRole("region", { name: "Editing", exact: true });
  const name = editor.getByRole("textbox", { name: "Pattern name", exact: true });
  await name.waitFor();
  if (!await name.evaluate(el => el === document.activeElement)) throw Error("Rename did not focus the pattern name");
  await name.fill("Refrain");
  await editor.getByRole("button", { name: /Save linked pattern/ }).click();
  await lane.getByTitle("pattern: Refrain", { exact: true }).nth(1).waitFor();
  if (await lane.getByTitle("pattern: Answer", { exact: true }).count()) throw Error("Linked name was not updated");
  await page.getByRole("button", { name: "Reload saved performance" }).click();
  await lane.getByRole("img", { name: "Refrain", exact: true }).nth(1).waitFor();
  const clip = lane.locator("[data-arranger-clip]").first();
  const header = clip.getByTitle(/Drag clip border/);
  const previewBox = await clip.getByRole("img", { name: "Refrain", exact: true }).first().boundingBox();
  const headerBox = await header.boundingBox();
  await header.click({ button: "right", position: { x: previewBox.x - headerBox.x + 12, y: 7 } });
  await rename.click();
  if (await name.inputValue() !== "Refrain") throw Error("Clip header targeted a different pattern");
}
