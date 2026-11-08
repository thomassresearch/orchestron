async (page) => {
  await page.getByRole('button',{name:'Start Instruments',exact:true}).click();
  await page.waitForFunction(() => window.t07.store.getState().activeSessionState === 'running');
  await page.evaluate(async () => {
    const t=window.t07, id=t.store.getState().activeSessionId;
    const response=await fetch('/api/sessions/'+id+'/sequencer/start', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({config:t.fixture.sequencer,position_step:0,arranger_active:false})});
    if(!response.ok) throw new Error(await response.text());
    t.startedStatus=await response.json();
  });
  await page.waitForFunction(() => {
    const c=window.t07.connections.at(-1);
    return c && c.state[4]===1 && c.samples.some(v=>Math.abs(v)>.00001);
  }, null, {timeout:60000});
  await page.waitForTimeout(10000);
  return await page.evaluate(async () => {
    const t=window.t07;
    t.startedAt=performance.now(); t.warmupDiagnostics=t.diagnostics; t.diagnostics=[];
    t.startInfo=await fetch('/api/sessions/'+t.store.getState().activeSessionId).then(r=>r.json());
    t.initialRing=[...t.connections.at(-1).state];
    return {session:t.startInfo.session_id, renderer:t.startInfo.renderer, specification:t.fixture.specification,
      tracks:t.startedStatus.tracks.length, latest:t.warmupDiagnostics.at(-1),ring:t.initialRing};
  });
}
