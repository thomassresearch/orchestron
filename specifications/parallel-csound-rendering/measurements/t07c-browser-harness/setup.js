async (page) => {
  await page.addInitScript(() => {
    if (window.t07) return;
    window.t07 = { diagnostics: [], errors: [], connections: [], requests: [], workers: [], contexts: [], audioNodes: [] };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); window.t07.contexts.push(this); }
    };
    const NativeNode = window.AudioWorkletNode;
    window.AudioWorkletNode = class extends NativeNode {
      constructor(...args) { super(...args); window.t07.audioNodes.push(this); }
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        window.t07.workers.push(this);
        this.addEventListener('message', ({data}) => {
          if (data.type === 'diagnostics') window.t07.diagnostics.push({at:performance.now(),...data.diagnostics});
          if (data.type === 'error') window.t07.errors.push(data.message);
        });
      }
      postMessage(data, ...args) {
        if (data.type === 'connect') window.t07.connections.push({ session: data.sessionId,
          state: new Uint32Array(data.stateBuffer), samples: new Float32Array(data.sampleBuffer) });
        if (data.type === 'sequencer_request') window.t07.requests.push(data.request);
        return super.postMessage(data, ...args);
      }
    };
  });
  await page.reload();
  await page.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('/assets/useAppStore-')));
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').find(e => e.name.includes('/assets/useAppStore-')).name;
    const module = await import(url);
    const store = Object.values(module).find(value => typeof value === 'function' && value.getState && typeof value.getState().ensureSession === 'function');
    if (!store) throw new Error('Built store export missing');
    window.t07.store = store;
    const fixture = await fetch('/probe/fixture').then(r => r.json());
    window.t07.fixture = fixture;
    const patches = [], instruments = [];
    for (const target of fixture.targets) {
      const response = await fetch('/api/patches', {method:'POST',headers:{'Content-Type':'application/json'}, body:JSON.stringify(target.patch)});
      if (!response.ok) throw new Error(await response.text());
      const patch = await response.json(); patches.push(patch);
      instruments.push({id:target.identity,patchId:patch.id,midiChannel:target.channel,effectSourceIds:[],effectRoutes:[]});
    }
    store.setState({ patches: await fetch('/api/patches').then(r=>r.json()), activePage:'sequencer', performanceName:'T07 isolated playback', error:null });
    store.getState().applySequencerConfigSnapshot({version:22,instruments,audioGraph:fixture.graph,mixer:fixture.mixer,
      sequencer:{bpm:240,tracks:[{id:'lead',name:'T07 lead',midiChannel:1,enabled:true,padLoopEnabled:false,
        lengthBeats:1,pads:[{lengthBeats:1,steps:[{note:0},{note:2},{note:4},{note:7}]}]}],drummerTracks:[]}});
  });
  await page.screenshot({path:'output/playwright/t07c/prepared.png'});
  console.log(await page.evaluate(() => ({tracks:window.t07.store.getState().sequencer.tracks.length, error:window.t07.store.getState().error})));
}
