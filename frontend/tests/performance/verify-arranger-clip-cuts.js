async page => {
  const check = (ok, message) => { if (!ok) throw Error(message); };
  await page.setViewportSize({ width: 1450, height: 850 });
  await page.reload();
  await page.waitForFunction(() => window.__clipTest);
  // Use real nested patterns and a cropped loop from the production arranger fixture.
  await page.evaluate(() => {
    const app = window.__clipTest.store;
    const seq = structuredClone(app.getState().sequencer);
    const lane = seq.clipArrangement.lanes[0], q = 20160;
    lane.cycleTicks = null;
    seq.clipArrangement.end = 16 * q;
    for (const peer of seq.clipArrangement.lanes.slice(1)) {
      peer.cycleTicks = null;
      peer.clips.forEach(c => { c.length = Math.min(c.length, seq.clipArrangement.end - c.start); });
    }
    const original = lane.clips[0];
    lane.clips = ["Verse", "Bridge", "Chorus"].map((name, i) => ({
      ...original, id: "window-" + i, name, nameIsExplicit: true, start: [0, 5, 10][i] * q,
      length: [4, 3, 4][i] * q, offset: i === 1 ? q : 0, mode: i === 1 ? "loop" : "once",
      children: [{id: "placement-" + i, definitionId: lane.definitions.filter(d => d.kind === "pattern")[i % 2].id}]
    }));
    app.setState({sequencer: seq});
  });
  const lane = page.locator('[data-clip-lane]').first();
  const clips = lane.locator('[data-arranger-clip]');
  const headers = clips.locator(':scope > [data-clip-header]');
  const menu = name => page.getByRole('menuitem', {name, exact: true});
  const button = name => page.getByRole('button', {name, exact: true});
  await headers.first().click();
  await headers.nth(2).click({modifiers:['Shift']});
  await headers.nth(1).click({button:'right'});
  await menu('Merge clips').waitFor();
  check(await lane.locator('[data-selected-window=true]').count() === 3, 'Range lost on context click');
  await page.locator('.ws-shell').screenshot({path:'screenshots/arranger-merge-clips.png'});
  await menu('Merge clips').click();
  check(await clips.count() === 1, 'Compound merge did not produce a single visible clip');
  await headers.first().click({button:'right',position:{x:65,y:8}});
  await menu('Split clip…').click();
  const marker = page.getByRole('slider', {name:'Cut position'});
  await marker.waitFor();
  await marker.press('ArrowRight');
  await page.locator('.ws-shell').screenshot({path:'screenshots/arranger-split-clip.png'});
  await marker.press('Escape');
  check(await clips.count() === 1 && !await marker.count(), 'Cancel altered the merged window');
  await headers.first().press('Shift+F10');
  await menu('Split clip…').click();
  await marker.press('Home');
  await marker.press('ArrowRight');
  const grip = await marker.boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 25, grip.y + grip.height / 2, {steps:4});
  await page.mouse.up();
  check(Number(await marker.getAttribute('aria-valuenow')) > .5, 'Dragging the scissors did not move the cut');
  await button('Cut').click();
  check(await clips.count() === 2, 'Cut did not create two windows');
  await button('Undo').click();
  check(await clips.count() === 1, 'Draft Undo did not restore the merge');
  await button('Redo').click();
  await button('Save').click();
  check(await clips.count() === 2, 'Save lost the cut');
  await button('Undo').click();
  check(await clips.count() === 3, 'Committed Undo did not restore all original clips');
  await button('Redo').click();
  check(await clips.count() === 2, 'Committed Redo lost the cut');
  await button('Reload saved performance').click();
  await page.waitForFunction(() => window.__clipTest);
  await clips.nth(1).waitFor();
  check(await clips.count() === 2, 'Reload lost the joined window or split');
  await button('Undo').click();
  check(await clips.count() === 3, 'Reload lost committed merge/split history');
  return { range: true, merge: true, cancel: true, cut: true, draftAndSavedHistory: true };
}
