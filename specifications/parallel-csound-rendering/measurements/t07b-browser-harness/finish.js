async (page) => {
  const evidence=await page.evaluate(async () => {
    const t=window.t07, c=t.connections.at(-1), state=t.store.getState();
    return {specification:t.fixture.specification, initialRing:t.initialRing, warmupDiagnostics:t.warmupDiagnostics, startedStatus:t.startedStatus, elapsedSeconds:(performance.now()-t.startedAt)/1000, diagnostics:t.diagnostics, errors:t.errors,
      ring:[...c.state], peak:c.samples.reduce((m,v)=>Math.max(m,Math.abs(v)),0),
      info:await fetch('/api/sessions/'+state.activeSessionId).then(r=>r.json()),
      startInfo:t.startInfo, isPlaying:state.sequencerRuntime.isPlaying, frontendError:state.error,
      userAgent:navigator.userAgent, crossOriginIsolated, audioSettings:state.browserClockLatencySettings, ringCapacityFrames:c.samples.length/2,
      connections:t.connections.length, startedAtPerformanceMs:t.startedAt, startedAtEpochMs:performance.timeOrigin+t.startedAt, capturedAtEpochMs:performance.timeOrigin+performance.now()};
  });
  await page.getByRole('button',{name:'Stop Instruments',exact:true}).click();
  await page.waitForFunction(() => window.t07.store.getState().activeSessionState!=='running');
  evidence.stopped = true;
  return evidence;
}
