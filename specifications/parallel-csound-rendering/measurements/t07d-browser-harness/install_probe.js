async (page) => { return await (async (page, source) => {
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
)(page, "// Silent side branch: the production processor remains connected directly to output.\nclass QualificationProbe extends AudioWorkletProcessor {\n  constructor(options) {\n    super();\n    this.state = new Uint32Array(options.processorOptions.state);\n    this.rows = new Float64Array(options.processorOptions.telemetry);\n    this.capacity = options.processorOptions.capacity;\n    this.recording = false;\n    this.count = 0;\n    this.overflow = false;\n    this.arm = null;\n    this.quietFrames = 0;\n    this.port.onmessage = ({data}) => {\n      if (data.type === 'arm') {\n        this.arm = data;\n        this.port.postMessage({type:'armed', id:data.id, frame:currentFrame, quietFrames:this.quietFrames});\n      } else if (data.type === 'quiet') {\n        this.port.postMessage({type:'quiet', id:data.id, frame:currentFrame, quietFrames:this.quietFrames});\n      } else if (data.type === 'record') {\n        this.count = 0; this.overflow = false; this.recording = true;\n        this.port.postMessage({type:'recording', id:data.id, frame:currentFrame});\n      } else if (data.type === 'stop_record') {\n        this.recording = false;\n        this.port.postMessage({type:'recorded', id:data.id, count:this.count, overflow:this.overflow, frame:currentFrame});\n      } else if (data.type === 'disarm') this.arm = null;\n    };\n  }\n  process(inputs, outputs) {\n    for (const channel of outputs[0] ?? []) channel.fill(0);\n    const primary=inputs[0] ?? [];\n    for(let i=0;i<(primary[0]?.length ?? 0);i++) {\n      this.quietFrames=primary.some(channel=>Math.abs(channel[i])>1e-7)?0:this.quietFrames+1;\n    }\n    if (this.recording) {\n      const base = this.count * 4;\n      if (base + 4 <= this.rows.length) {\n        this.rows[base] = currentFrame;\n        this.rows[base + 1] = Atomics.load(this.state, 0);\n        this.rows[base + 2] = Atomics.load(this.state, 1);\n        this.rows[base + 3] = Atomics.load(this.state, 2);\n        this.count++;\n      } else this.overflow = true;\n    }\n    if (this.arm) {\n      const channels = inputs[this.arm.input ?? 0] ?? [];\n      const frames = channels[0]?.length ?? 0;\n      for (let i=0; i<frames; i++) {\n        if (channels.some(channel => Math.abs(channel[i]) > this.arm.threshold)) {\n          this.port.postMessage({type:'onset', id:this.arm.id, frame:currentFrame+i,\n            value:channels[0][i], sampleRate});\n          this.arm = null;\n          break;\n        }\n      }\n    }\n    return true;\n  }\n}\nregisterProcessor('qualification-observer', QualificationProbe);\n"); }
