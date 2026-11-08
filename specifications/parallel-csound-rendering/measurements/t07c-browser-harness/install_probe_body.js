async (page, source) => {
  return await page.evaluate(async (source) => {
    const t=window.t07;
    if(t.probe) throw new Error('Probe already installed');
    const ctx=t.contexts.at(-1), original=t.audioNodes.at(-1), c=t.connections.at(-1);
    if(original.context!==ctx)throw new Error('Audio observer context mismatch');
    const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const telemetry=new SharedArrayBuffer(4*8*200000);
    const node=new AudioWorkletNode(ctx,'qualification-observer',{numberOfInputs:2,numberOfOutputs:1,
      outputChannelCount:[2],processorOptions:{state:c.state.buffer,telemetry,capacity:c.samples.length/2}});
    const p={node,ctx,rows:new Float64Array(telemetry),events:[],pending:new Map(),telemetry:[],calibration:[]};
    t.probe=p;
    node.port.onmessage=({data})=>{
      const observed=performance.now(), stamp=ctx.getOutputTimestamp();
      const event={...data,observedPerfMs:observed,outputStamp:stamp,
        outputPerfMs:stamp.performanceTime+(data.frame/ctx.sampleRate-stamp.contextTime)*1000};
      p.events.push(event);
      const key=data.type+':'+data.id;
      if(p.pending.has(key)) { const pending=p.pending.get(key);p.pending.delete(key);clearTimeout(pending.timer);pending.resolve(event); }
    };
    p.wait=(type,id,timeout=5000)=>new Promise((resolve,reject)=>{
      const key=type+':'+id;
      const timer=setTimeout(()=>{p.pending.delete(key);reject(new Error('Probe timeout '+key));},timeout);
      p.pending.set(key,{resolve,reject,timer});
    });
    p.command=async (message,reply)=>{const result=p.wait(reply,message.id);node.port.postMessage(message);return await result;};
    original.connect(node,0,0);node.connect(ctx.destination);
    p.snapshot=()=>({atPerfMs:performance.now(),atEpochMs:performance.timeOrigin+performance.now(),
      contextTime:ctx.currentTime,outputStamp:ctx.getOutputTimestamp(),ring:[...c.state],diagnostic:t.diagnostics.at(-1)});
    p.begin=async(id)=>{const started=await p.command({type:'record',id},'recording');p.recordStarted=p.snapshot();return started;};
    p.end=async(id)=>{
      const ended=await p.command({type:'stop_record',id},'recorded');
      if(ended.overflow)throw new Error('Probe telemetry overflow');
      const record={id,started:p.recordStarted,ended:p.snapshot(),count:ended.count,
        columns:['contextFrame','readFrame','writeFrame','underrunCount'],data:Array.from(p.rows.slice(0,ended.count*4))};
      p.telemetry.push(record);return {id,count:ended.count,started:record.started,ended:record.ended};
    };
    p.calibrate=async(count=16)=>{
      for(let i=0;i<count;i++) {
        const id='calibration-'+p.calibration.length;
        await p.command({type:'arm',id,input:1,threshold:1e-7},'armed');
        const expected=Math.ceil(ctx.currentTime*ctx.sampleRate)+4800;
        const data=ctx.createBuffer(1,1,ctx.sampleRate);data.getChannelData(0)[0]=1;
        const source=ctx.createBufferSource();source.buffer=data;source.connect(node,0,1);
        const result=p.wait('onset',id);source.start(expected/ctx.sampleRate);
        const event=await result;source.disconnect();
        p.calibration.push({...event,expectedFrame:expected,frameError:event.frame-expected});
        if(Math.abs(event.frame-expected)>1)throw new Error('Observer calibration exceeded one sample');
      }
      return p.calibration;
    };
    return {sampleRate:ctx.sampleRate,baseLatency:ctx.baseLatency,outputLatency:ctx.outputLatency,
      ringCapacityFrames:c.samples.length/2,settings:t.store.getState().browserClockLatencySettings,
      started:p.snapshot()};
  }, source);
}
