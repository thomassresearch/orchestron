// Stopped English workspace with an empty arrangement. Exercise real pointer sequences
// from a closed dock, including a compact clip below a different expanded track.
async page => {
  const add = page.getByRole("combobox", { name: "Add track", exact: true });
  await add.selectOption("sequencer");
  await add.selectOption("sequencer");
  const fixture = await page.evaluate(() => {
    const config = window.__workspaceTest.store.getState().buildSequencerConfigSnapshot();
    const model = config.sequencer.clipArrangement, lane = model.lanes[1], clip = lane.clips[0];
    lane.definitions[0].name = "Phrase";
    lane.definitions.push(
      { id: "group", kind: "group", name: "Bars", revision: 0, children: clip.children },
      { id: "super", kind: "supergroup", name: "Verse", revision: 0, children: [{ id: "bars", definitionId: "group" }] }
    );
    clip.children = [{ id: "verse", definitionId: "super" }];
    clip.mode = "loop";
    clip.length = 12 * 20160;
    model.end = Math.max(model.end, clip.length);
    return config;
  });
  const lanes = page.locator("[data-clip-lane]");
  const lower = lanes.nth(1);
  const clip = lower.locator("[data-arranger-clip]");
  const editor = page.getByRole("region", { name: "Editing", exact: true });
  async function fresh(config = fixture) {
    await page.evaluate(snapshot => window.__workspaceTest.store.getState().applySequencerConfigSnapshot(snapshot), config);
    await page.getByRole("slider", { name: "Zoom" }).fill("50");
    if (await editor.count()) throw Error("Expected a closed editor after loading the arrangement");
  }
  async function verify(kind, pass, choose) {
    await editor.waitFor();
    const draft = await page.evaluate(() => {
      const state = window.__workspaceTest.store.getState();
      const { target, definition, editIntent } = state.clipDrafts[state.clipEditingKey];
      return { kind: definition.kind, pass: target.pass, scope: editIntent.scope };
    });
    if (draft.kind !== kind || draft.pass !== pass || draft.scope !== (choose ? null : "all"))
      throw Error("Opened the wrong occurrence or editing scope: " + JSON.stringify(draft));
    if (choose) {
      await editor.getByRole("button", { name: "Create variation here", exact: true }).waitFor();
      await editor.getByRole("button", { name: new RegExp("^Edit linked " + kind) }).click();
    }
    await editor.getByText(kind === "pattern" ? "HOLD" : "Name", { exact: true }).first().waitFor();
  }
  await fresh();
  await lanes.first().getByRole("img").first().dblclick();
  await verify("pattern", 0, false);

  await fresh();
  await lanes.first().locator("button[aria-expanded=false]").first().click();
  await clip.locator("button").first().dblclick({ position: { x: 20, y: 8 } });
  await verify("supergroup", 0, false);

  await fresh();
  const header = clip.locator("button").first();
  const secondPass = await clip.getByRole("img", { name: "Phrase" }).nth(1).boundingBox();
  const windowBox = await header.boundingBox();
  await header.dblclick({ position: { x: secondPass.x - windowBox.x + 20, y: 8 } });
  await verify("supergroup", 1, true);

  for (const pass of [0, 1]) {
    await fresh();
    await clip.getByRole("img", { name: "Phrase" }).nth(pass).dblclick();
    await verify("pattern", pass, pass > 0);
    for (const [kind, name] of [["pattern", "Phrase"], ["group", "Bars"], ["supergroup", "Verse"]]) {
      await fresh();
      await lower.locator("button[aria-expanded=false]").first().click();
      const target = kind === "pattern" ? clip.getByRole("img", { name }) : clip.getByTitle(kind + ": " + name, { exact: true });
      await target.nth(pass).dblclick();
      await verify(kind, pass, pass > 0);
    }
  }
  const cropped = structuredClone(fixture);
  const croppedClip = cropped.sequencer.clipArrangement.lanes[1].clips[0];
  croppedClip.offset = 4 * 20160;
  croppedClip.length = 4 * 20160;
  await fresh(cropped);
  await clip.locator("button").first().dblclick({ position: { x: 20, y: 8 } });
  await verify("supergroup", 1, true);
}
