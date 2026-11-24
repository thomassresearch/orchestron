import { expect, it } from "vitest";
import { timelineGrid } from "./timelineGrid";
import { localBeatTicks, QUARTER_TICKS as Q } from "./model";

it("keeps visible marks anchored while panning and thins long-song labels at each zoom",()=>{
  for(const zoom of [.02,.2,2,12,48,100]){
    const end=2048*Q, start=953*Q+71;
    const full=timelineGrid(Q,4,zoom,0,end), part=timelineGrid(Q,4,zoom,start,end);
    expect(part).toEqual(full.filter(m=>m.tick>=start));
    expect(full.slice(1).every((m,i)=>(m.tick-full[i].tick)*zoom/Q>=12)).toBe(true);
    const labels=part.filter(m=>m.label);
    expect(labels.slice(1).every((m,i)=>(m.tick-labels[i].tick)*zoom/Q>=38)).toBe(true);
  }
  expect(timelineGrid(Q,4,100,0,48*Q).filter(m=>m.level==='phrase').map(m=>m.label)).toEqual(['1.1','5.1','9.1','13.1']);
});

it("aligns a 6/8 measure at three master quarters, and scales rational playback speed in ticks",()=>{
  for(const speed of [1,2,3] as const){
    const beat=localBeatTicks({tempoBPM:120,meterNumerator:6,meterDenominator:8,beatRateNumerator:speed,beatRateDenominator:1,stepsPerBeat:4});
    const local=timelineGrid(beat,6,100,0,12*Q);
    expect(local.find(m=>m.label==='2.1')?.tick).toBe(3*Q/speed);
    expect(local.find(m=>m.tick===12*Q)?.level).toBe('phrase');
  }
});
