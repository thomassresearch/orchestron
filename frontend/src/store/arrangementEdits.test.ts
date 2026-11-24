import { beforeEach, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";
import { openClipEditor, updateClipDraft } from "./clipActions";
import { arrangementHistoryStep, arrangementPlayback, cancelArrangementEdits, flushArrangementEditors, saveArrangementEdits, stageArrangement, withTrackSetup } from "./arrangementEdits";
import { useArrangementEdits, workingArrangement } from "../lib/clipArranger/editSession";
import { useStructureDraft } from "../lib/clipArranger/structureStore";
import { arrangementTimings, migrateClipArrangement } from "../lib/clipArranger/migration";
import { definitionAt, deleteClip, duplicateClip, updateClip } from "../lib/clipArranger/operations";
import { QUARTER_TICKS as Q, type Clip, type OccurrenceTarget } from "../lib/clipArranger/model";

const state = useAppStore.getState;
const authored = () => state().sequencer.clipArrangement!;
const working = () => workingArrangement(state().sequencer)!;
const timings = () => arrangementTimings(state().sequencer);
const history = () => state().sequencer.clipHistory;
const preview = () => arrangementPlayback(state().sequencer, state().clipDrafts, null, useStructureDraft.getState().draft).state.clipArrangement!;

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true);
  const seq = structuredClone(state().sequencer), a = seq.tracks[0];
  a.padLoopEnabled = true;
  a.padLoopPattern = {groups:[], superGroups:[], rootSequence:[{type:"pad",padIndex:0}]};
  seq.tracks = [a, {...structuredClone(a), id:"second", name:"Second"}];
  seq.clipArrangement = migrateClipArrangement(seq).model!;
  for (const lane of seq.clipArrangement.lanes) lane.cycleTicks = null;
  const second = seq.clipArrangement.lanes[1];
  second.clips.push({...structuredClone(second.clips[0]), id:"linked", children:second.clips[0].children.map((item,i)=>({...item,id:"linked-"+i})), start:8*Q});
  seq.clipArrangement.end = 24*Q;
  useAppStore.setState({sequencer:seq});
  useArrangementEdits.setState({session:null});
  useStructureDraft.setState({draft:null});
});

function target(laneId:string, clip:Clip):OccurrenceTarget {
  return {laneId, clipId:clip.id, pass:0, path:[clip.children[0].id]};
}
function note(location:OccurrenceTarget, scope:"all"|"local", pitch:number) {
  openClipEditor(location,scope);
  const pattern = state().clipDrafts[state().clipEditingKey!].definition;
  if (pattern.kind!=="pattern" || pattern.source!=="sequencer") throw Error("Expected a melodic pattern");
  updateClipDraft({...pattern,payload:{...pattern.payload,steps:pattern.payload.steps.map((s,i)=>i?s:{...s,note:pitch})}});
}
it("previews one cross-track batch, cancels it, saves it, and replays the exact identities after reload",()=>{
  const before = authored(), originalHistory = history();
  function edit() {
    const [lead,other] = working().lanes;
    const copy = duplicateClip(working(),lead.id,lead.clips[0].id,timings());
    stageArrangement(copy.model);
    note(target(lead.id,copy.clip),"local",89);
    const projected = flushArrangementEditors().model;
    stageArrangement(updateClip(projected,lead.id,copy.clip.id,{start:16*Q},timings()));
    note(target(other.id,other.clips[0]),"all",77);
    stageArrangement(deleteClip(flushArrangementEditors().model,other.id,other.clips[0].id,timings()));
    return copy.clip.id;
  }
  edit();
  expect(authored()).toBe(before);
  expect(state().buildSequencerConfigSnapshot().sequencer.clipArrangement).toEqual(before);
  for(let i=0;i<5;i++) arrangementHistoryStep(false);
  expect(preview()).toEqual(before);
  for(let i=0;i<5;i++) arrangementHistoryStep(true);
  expect(preview().lanes[1].clips).toHaveLength(1);
  cancelArrangementEdits(); expect(history()).toBe(originalHistory); expect(preview()).toBe(before);
  const id=edit(), expected=preview();
  const [lead,other] = expected.lanes;
  expect(lead.clips[1]).toMatchObject({id,start:16*Q});
  expect(definitionAt(lead,target(lead.id,lead.clips[1]))).toMatchObject({payload:{steps:expect.arrayContaining([expect.objectContaining({note:89})])}});
  expect(definitionAt(other,target(other.id,other.clips[0]))).toMatchObject({payload:{steps:expect.arrayContaining([expect.objectContaining({note:77})])}});
  saveArrangementEdits();
  expect(authored()).toEqual(expected);expect(history()?.entries).toHaveLength(1);
  state().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(state().buildSequencerConfigSnapshot())));
  arrangementHistoryStep(false);expect(authored()).toEqual(before);
  arrangementHistoryStep(true);expect(authored()).toEqual(expected);
});

it("preserves committed redo on Cancel, a no-op and invalid edits, and branches after a new commit",()=>{
  const base=authored();
  const resize=(end:number)=>stageArrangement({...working(),revision:working().revision+1,end});
  resize(30*Q); saveArrangementEdits(); arrangementHistoryStep(false);
  const branch=history();
  resize(28*Q); arrangementHistoryStep(false);
  expect(useArrangementEdits.getState().session?.future).toHaveLength(1);
  cancelArrangementEdits(); expect(history()).toBe(branch);
  resize(28*Q);resize(base.end);saveArrangementEdits();expect(history()).toBe(branch);
  resize(25*Q);expect(()=>resize(Q)).toThrow();expect(working().end).toBe(25*Q);expect(history()).toBe(branch);
  saveArrangementEdits();expect(history()?.entries).toHaveLength(1);arrangementHistoryStep(true);expect(authored().end).toBe(25*Q);
});

it("blocks conflicting device removal while permitting an unrelated setup action",()=>{
  const lane=working().lanes[0], result=duplicateClip(working(),lane.id,lane.clips[0].id,timings());
  stageArrangement(result.model);
  expect(()=>withTrackSetup([lane.id],()=>{})).toThrow(/Save or Cancel/);
  expect(withTrackSetup(["unused"],()=>"ok")).toBe("ok");
  expect(working()).toBe(result.model);
});

it("puts a cropped looping copy in the first fitting gap with independent placement offsets",()=>{
  const base=structuredClone(authored()), lane=base.lanes[0], src=lane.clips[0];
  base.version=4; src.offset=Q; src.length=3*Q; src.mode="loop"; src.repeatIndexBase=2;
  src.transposePlacements=[{path:[src.children[0].id],plan:{base:{diatonicSteps:1,chromaticSemitones:2},repetitions:[]}}];
  const window=(id:string,start:number)=>({...src,id,start,children:src.children.map(i=>({...i,id:id+i.id})),transposePlacements:[]});
  lane.clips.push(window("occupied",4*Q),window("later",12*Q));
  const copy=duplicateClip(base,lane.id,src.id,timings());
  expect(copy.clip).toMatchObject({start:7*Q,mode:"loop",offset:Q,length:3*Q,repeatIndexBase:2});
  expect(copy.clip.children[0].id).not.toBe(src.children[0].id);
  expect(copy.clip.transposePlacements).toEqual([{...src.transposePlacements[0],path:[copy.clip.children[0].id]}]);
  expect(copy.model.lanes[0].definitions).toEqual(lane.definitions);
  expect(copy.model.end).toBe(base.end);
});

it("rejects a stale batch without altering the committed undo cursor or losing the draft",()=>{
  const base=authored();stageArrangement({...base,end:26*Q});saveArrangementEdits();arrangementHistoryStep(false);
  const savedHistory=history();
  stageArrangement({...authored(),end:30*Q});
  const pending=useArrangementEdits.getState().session;
  useAppStore.setState({sequencer:{...state().sequencer,clipArrangement:{...authored(),end:28*Q}}});
  expect(()=>saveArrangementEdits()).toThrow(/changed/);
  expect(authored().end).toBe(28*Q);expect(history()).toBe(savedHistory);
  expect(useArrangementEdits.getState().session).toBe(pending);
  cancelArrangementEdits();expect(authored().end).toBe(28*Q);
});
