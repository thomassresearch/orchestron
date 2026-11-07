async (page) => {
  return await page.evaluate(() => {
    const t=window.t07,p=t.probe,c=t.connections.at(-1),worker=t.workers.at(-1);
    if(!p || t.latency?.state==='running')throw new Error('Invalid latency probe state');
    const spec=t.fixture.specification, count=128, warmup=4;
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const base='/api/sessions/'+t.store.getState().activeSessionId;
    const request=async(path,method,body)=>{
      const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      if(!r.ok)throw new Error(await r.text());return await r.json();
    };
    const send=(midi,at)=>worker.postMessage({type:'manual_midi',midi,eventEpochMs:performance.timeOrigin+at});
    const allOff=()=>{for(let channel=1;channel<=spec.sources;channel++)send({type:'all_notes_off',channel},performance.now());};
    const run={state:'running',specification:spec,count,warmup,trials:[],warmupTrials:[],
      method:'Timestamped production Worker manual MIDI; first sample >1e-7 in a silent observer side branch; getOutputTimestamp output-time estimate.',
      backgroundVoices:(spec.sources-1)*spec.voices, foregroundVoices:spec.voices,
      threshold:1e-7,settings:structuredClone(t.store.getState().browserClockLatencySettings),
      start:p.snapshot(),errors:[]};
    t.latency=run;
    t.latencyPromise=(async()=>{
      const original=await request('/mixer','GET');
      run.originalMixer=original;
      try {
        run.stoppedSequencer=await request('/sequencer/stop','POST');
        allOff();
        const strips=structuredClone(original.mixer.strips);
        for(const target of t.fixture.targets) {
          strips[target.identity]={...(strips[target.identity]??{}),mute:target.identity!=='source0' && target.identity!=='delay0'};
        }
        run.probeMixer=await request('/mixer','PUT',{strips});
        const at=performance.now();
        for(let channel=2;channel<=spec.sources;channel++)for(let v=0;v<spec.voices;v++)send({type:'note_on',channel,note:48+v,velocity:100},at);
        await delay(3000);
        run.calibration=await p.calibrate(16);
        for(let index=-warmup;index<count;index++) {
          const id='midi-'+index;
          const quiet=await p.command({type:'quiet',id},'quiet');
          if(quiet.quietFrames<2400)throw new Error('Foreground was not silent for 50 ms before '+id);
          const armed=await p.command({type:'arm',id,input:0,threshold:run.threshold},'armed');
          const onset=p.wait('onset',id);
          const before=p.snapshot(), at=performance.now();
          const notes=Array.from({length:spec.voices},(_,v)=>48+v+(index+warmup)%3);
          for(const note of notes)send({type:'note_on',channel:1,note,velocity:100},at);
          const event=await onset;
          const trial={index,notes,inputPerfMs:at,inputEpochMs:performance.timeOrigin+at,before,armed,onset:event,
            outputLatencyMs:event.outputPerfMs-at,notificationLatencyMs:event.observedPerfMs-at,
            mappingExtrapolationMs:(event.frame/p.ctx.sampleRate-event.outputStamp.contextTime)*1000,
            after:p.snapshot()};
          if(trial.outputLatencyMs<0 || trial.outputLatencyMs>5000)throw new Error('Invalid measured latency');
          (index<0?run.warmupTrials:run.trials).push(trial);
          await delay(120);
          const offAt=performance.now();
          for(const note of notes)send({type:'note_off',channel:1,note,velocity:0},offAt);
          // Frozen deterministic inter-event jitter prevents one refill phase being selected.
          await delay(700+((index+warmup)*73%211));
        }
        run.end=p.snapshot();
        run.state='restoring';
      } catch(error) {
        run.state='failed';run.errors.push(String(error));run.end=p.snapshot();
      } finally {
        allOff();
        await request('/mixer','PUT',{strips:original.mixer.strips,sends:original.mixer.sends});
        // Every modified strip must be restored, including implicit defaults.
        const restored={};for(const target of t.fixture.targets)restored[target.identity]=original.mixer.strips[target.identity]??{gainDb:0,balance:0,mute:false,solo:false,bypass:false};
        await request('/mixer','PUT',{strips:restored});
        run.restoredMixer=await request('/mixer','GET');
        if(run.state==='restoring')run.state='complete';
      }
    })().catch(error=>{run.state='failed';run.errors.push('Cleanup: '+String(error));});
    return {state:run.state,count,warmup,specification:spec};
  });
}
