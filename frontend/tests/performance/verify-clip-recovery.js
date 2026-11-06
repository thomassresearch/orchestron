async page => {
  // Run against the fixture server with the default clip arranger enabled.
  await page.reload();
  await page.waitForFunction(()=>window.__clipTest);
  await page.evaluate(()=>{const app=window.__clipTest.store,s=structuredClone(app.getState().sequencer);delete s.clipArrangement;delete s.clipHistory;app.setState({sequencer:s});window.__recoveryOriginal=app.getState().buildSequencerConfigSnapshot();});
  const pending=page.waitForEvent('download');
  await page.getByRole('button',{name:'Convert to clip arranger',exact:true}).click();
  const download=await pending;await download.saveAs('/tmp/arranger-original-recovery.json');
  const migrated=await page.evaluate(()=>window.__clipTest.store.getState().sequencer.clipArrangement.version);
  await page.evaluate(()=>{const i=document.createElement('input');i.type='file';i.id='recovery-fixture';document.body.append(i);});
  await page.locator('#recovery-fixture').setInputFiles('/tmp/arranger-original-recovery.json');
  return await page.evaluate(async migrated=>{
    const original=JSON.parse(await document.querySelector('#recovery-fixture').files[0].text());
    if(JSON.stringify(original)!==JSON.stringify(window.__recoveryOriginal))throw Error('Backup differs from original');
    const app=window.__clipTest.store;app.getState().applySequencerConfigSnapshot(original);
    const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
    if(JSON.stringify(stable(original))!==JSON.stringify(stable(app.getState().buildSequencerConfigSnapshot())))throw Error('Recovery differs');
    document.querySelector('#recovery-fixture').remove();delete window.__recoveryOriginal;
    return {migratedVersion:migrated,recovered:true,clipModel:app.getState().sequencer.clipArrangement??null};
  },migrated);
}
