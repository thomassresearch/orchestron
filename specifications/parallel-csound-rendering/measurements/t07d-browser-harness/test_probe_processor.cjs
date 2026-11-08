// Deterministic controls for the observation branch; no browser/runtime mutation.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const messages=[];
let Processor;
const sandbox={AudioWorkletProcessor:class {constructor(){this.port={postMessage:m=>messages.push(m)}}},
  registerProcessor:(_name,type)=>{Processor=type},currentFrame:1000,sampleRate:48000,Uint32Array,Float64Array,Atomics};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname+'/probe_processor.js','utf8'),sandbox);
const state=new Uint32Array(new SharedArrayBuffer(32)),rows=new Float64Array(new SharedArrayBuffer(64));
const p=new Processor({processorOptions:{state:state.buffer,telemetry:rows.buffer,capacity:4096}});
const send=data=>p.port.onmessage({data});
const input=[new Float32Array(128),new Float32Array(128)],output=[new Float32Array(128).fill(4)];
send({type:'arm',id:'stereo',input:0,threshold:1e-7});input[1][73]=.5;
p.process([input],[output]);
assert.equal(messages.at(-1).frame,1073);assert.equal(messages.at(-1).id,'stereo');
assert.ok(output[0].every(x=>x===0),'Observer must remain silent');
input[1].fill(0);sandbox.currentFrame+=128;
send({type:'arm',id:'calibration',input:1,threshold:1e-7});
const calibration=[new Float32Array(128)];calibration[0][17]=1;
p.process([input,calibration],[output]);assert.equal(messages.at(-1).frame,1145);
send({type:'record',id:'bounded'});
for(let i=0;i<3;i++){state[0]=128*i;state[1]=state[0]+1024;p.process([input],[output]);sandbox.currentFrame+=128;}
send({type:'stop_record',id:'bounded'});
assert.equal(messages.at(-1).count,2);assert.equal(messages.at(-1).overflow,true);
assert.equal(rows[1],0);assert.equal(rows[5],128);
send({type:'quiet',id:'quiet'});assert.ok(messages.at(-1).quietFrames>=384);
console.log('Observer onset, stereo input, silence, calibration, bounded recording and quiet controls passed.');
