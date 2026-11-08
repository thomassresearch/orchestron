// Silent side branch: the production processor remains connected directly to output.
class QualificationProbe extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.state = new Uint32Array(options.processorOptions.state);
    this.rows = new Float64Array(options.processorOptions.telemetry);
    this.capacity = options.processorOptions.capacity;
    this.recording = false;
    this.count = 0;
    this.overflow = false;
    this.arm = null;
    this.quietFrames = 0;
    this.port.onmessage = ({data}) => {
      if (data.type === 'arm') {
        this.arm = data;
        this.port.postMessage({type:'armed', id:data.id, frame:currentFrame, quietFrames:this.quietFrames});
      } else if (data.type === 'quiet') {
        this.port.postMessage({type:'quiet', id:data.id, frame:currentFrame, quietFrames:this.quietFrames});
      } else if (data.type === 'record') {
        this.count = 0; this.overflow = false; this.recording = true;
        this.port.postMessage({type:'recording', id:data.id, frame:currentFrame});
      } else if (data.type === 'stop_record') {
        this.recording = false;
        this.port.postMessage({type:'recorded', id:data.id, count:this.count, overflow:this.overflow, frame:currentFrame});
      } else if (data.type === 'disarm') this.arm = null;
    };
  }
  process(inputs, outputs) {
    for (const channel of outputs[0] ?? []) channel.fill(0);
    const primary=inputs[0] ?? [];
    for(let i=0;i<(primary[0]?.length ?? 0);i++) {
      this.quietFrames=primary.some(channel=>Math.abs(channel[i])>1e-7)?0:this.quietFrames+1;
    }
    if (this.recording) {
      const base = this.count * 4;
      if (base + 4 <= this.rows.length) {
        this.rows[base] = currentFrame;
        this.rows[base + 1] = Atomics.load(this.state, 0);
        this.rows[base + 2] = Atomics.load(this.state, 1);
        this.rows[base + 3] = Atomics.load(this.state, 2);
        this.count++;
      } else this.overflow = true;
    }
    if (this.arm) {
      const channels = inputs[this.arm.input ?? 0] ?? [];
      const frames = channels[0]?.length ?? 0;
      for (let i=0; i<frames; i++) {
        if (channels.some(channel => Math.abs(channel[i]) > this.arm.threshold)) {
          this.port.postMessage({type:'onset', id:this.arm.id, frame:currentFrame+i,
            value:channels[0][i], sampleRate});
          this.arm = null;
          break;
        }
      }
    }
    return true;
  }
}
registerProcessor('qualification-observer', QualificationProbe);
