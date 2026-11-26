import { structureSaveButton } from './scope.testHelpers';
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import { migrateClipArrangement } from '../../lib/clipArranger/migration';
import { clipSongPlayback, songDraftPlayback } from '../../lib/clipArranger/songDrafts';
import { runtimeSchedule } from '../../lib/clipArranger/runtime';
import { QUARTER_TICKS as Q } from '../../lib/clipArranger/model';
import { clipHistoryStep, openClipEditor } from '../../store/clipActions';
import { ClipPerformance } from './ClipPerformance';

beforeEach(()=>{
  useAppStore.setState(useAppStore.getInitialState(),true);useStructureDraft.setState({draft:null});
  const sequencer=structuredClone(useAppStore.getState().sequencer),track=sequencer.tracks[0];
  track.padLoopEnabled=true;track.padLoopPattern={groups:[],superGroups:[],rootSequence:[{type:'pad',padIndex:0}]};
  sequencer.clipArrangement=migrateClipArrangement(sequencer).model!;
  const lane=sequencer.clipArrangement.lanes[0],clip=lane.clips[0];lane.cycleTicks=null;clip.mode='once';clip.length=12*Q;clip.children.push({id:'tail',restTicks:8*Q});sequencer.clipArrangement.end=clip.length;
  useAppStore.setState({sequencer});
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const lane=()=>useAppStore.getState().sequencer.clipArrangement!.lanes[0];
const patterns=()=>Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-structure-key]')).filter(b=>b.title.startsWith('pattern:'));
function show(expand=true){render(<ClipPerformance language="english" renderEditor={()=>null}/>);const toggle=screen.queryByRole('button',{expanded:false,name:/▸/});if(expand&&toggle)fireEvent.click(toggle);}
function context(item:HTMLElement){fireEvent.contextMenu(item,{clientX:200,clientY:100});return within(screen.getByRole('menu'));}
async function save(){fireEvent.click(structureSaveButton());await waitFor(()=>expect(useStructureDraft.getState().draft).toBeNull());}

function playback() {
  const { sequencer, clipDrafts } = useAppStore.getState();
  const song = songDraftPlayback(sequencer, clipDrafts, useStructureDraft.getState().draft);
  return runtimeSchedule(song, song.clipArrangement!.lanes[0]);
}

it("deletes the focused occurrence after moving focus away from the selected clip header", async () => {
  const clip = lane().clips[0];
  const original = lane().definitions[0];
  lane().definitions.push({ ...original, id: "other-pattern", name: "Other pattern" });
  clip.children = [clip.children[0], { definitionId: "other-pattern", id: "second" }];
  show();
  fireEvent.click(document.querySelector("[data-clip-header]")!);
  const second = patterns()[1];
  second.focus();
  fireEvent.keyDown(second, { key: "Delete" });
  await save();
  expect(lane().clips).toHaveLength(1);
  expect(lane().clips[0].children.filter(item => "definitionId" in item).map(item => item.definitionId))
    .toEqual([original.id]);
});

it("leaves arrangement history alone while a dialog has keyboard focus", () => {
  show();
  fireEvent.click(context(patterns()[0]).getByRole('menuitem', { name: 'Duplicate' }));
  const undo = within(structureSaveButton().parentElement!).getByRole("button", { name: "Undo" });
  const { container } = render(<dialog open><button>Audition take</button></dialog>);
  fireEvent.keyDown(within(container).getByRole("button"), { key: "z", ctrlKey: true });
  expect(undo.hasAttribute("disabled")).toBe(false);
  container.querySelector("dialog")!.close();
  fireEvent.keyDown(undo, { key: "z", ctrlKey: true });
  expect(undo.hasAttribute("disabled")).toBe(true);
});

it("continues a keyboard clip selection across virtualized gaps", async () => {
  // jsdom lacks CSS.escape. The clip IDs in this fixture are plain identifiers.
  vi.stubGlobal("CSS", { escape: (id: string) => id });
  const model = useAppStore.getState().sequencer.clipArrangement!;
  const target = model.lanes[0], first = target.clips[0];
  for (const [index, start] of [200, 400].entries()) {
    target.clips.push({ ...structuredClone(first), id: "far-" + index, start: start * Q });
  }
  model.end = 420 * Q;
  show(false);
  const header = (id: string) => document.querySelector<HTMLButtonElement>(
    '[data-arranger-clip="' + id + '"] > [data-clip-header]');
  expect(header("far-0")).toBeNull();
  fireEvent.click(header(first.id)!);
  for (const [from, to] of [[first.id, "far-0"], ["far-0", "far-1"]]) {
    fireEvent.keyDown(header(from)!, { key: "ArrowRight", shiftKey: true });
    await waitFor(() => { expect(header(to)).toBeTruthy(); expect(document.activeElement).toBe(header(to)); });
  }
});

it('plays Duplicate and a timed nudge immediately, follows draft undo/redo and restores the saved rest on Discard', () => {
  show();
  const before = useAppStore.getState(), original = playback();
  fireEvent.click(context(patterns()[0]).getByRole('menuitem', { name: 'Duplicate' }));
  const duplicated = playback(), revision = useAppStore.getState().sequencerEditRevision;
  expect(revision).toBeGreaterThan(before.sequencerEditRevision);
  expect(duplicated.clips[0].content.map(c => c.pad)).toEqual([0, 0, null]);
  fireEvent.keyDown(patterns()[1], { key: 'ArrowRight' });
  expect(useAppStore.getState().sequencerEditRevision).toBeGreaterThan(revision);
  const moved = playback();
  expect(moved.clips[0].content.map(c => [c.pad, c.length / Q])).toEqual([[0, 4], [null, .25], [0, 4], [null, 3.75]]);
  const draftControls = within(structureSaveButton().parentElement!);
  fireEvent.click(draftControls.getByRole('button', { name: 'Undo' }));
  expect(playback()).toEqual(duplicated);
  fireEvent.click(draftControls.getByRole('button', { name: 'Redo' }));
  expect(playback()).toEqual(moved);
  const beforeDiscard = useAppStore.getState().sequencerEditRevision;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useAppStore.getState().sequencerEditRevision).toBeGreaterThan(beforeDiscard);
  expect(playback()).toEqual(original);
  expect(useAppStore.getState().sequencer).toBe(before.sequencer);
});

it.each(['save', 'discard'])('edits a provisional duplicate through the note editor and resolves both changes on %s', async choice => {
  show();
  const before = useAppStore.getState(), savedLane = structuredClone(lane());
  fireEvent.click(context(patterns()[0]).getByRole('menuitem', { name: 'Duplicate' }));
  fireEvent.doubleClick(patterns()[1]);
  const editor = () => {
    const state = useAppStore.getState();
    return state.clipDrafts[state.clipEditingKey!];
  };
  expect(editor()?.provisionalDuplicate).toBe(true);
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => before.setSequencerTrackStepNote(lane().id, 0, 79));
  act(() => before.setSequencerTrackStepNote(lane().id, 1, 82));
  const structure = useStructureDraft.getState().draft!;
  const state = useAppStore.getState();
  const edited = editor().definition;
  if (edited.kind !== 'pattern' || edited.source !== 'sequencer') throw Error('Expected a melodic duplicate');
  expect(edited.payload.steps.slice(0, 2).map(step => step.note)).toEqual([79, 82]);
  const song = songDraftPlayback(state.sequencer, state.clipDrafts, structure);
  const playedLane = song.clipArrangement!.lanes[0];
  const slots = runtimeSchedule(song, playedLane).clips[0].content.map(leaf => leaf.pad);
  const definitions = playedLane.definitions.filter(def => def.kind === 'pattern');
  expect(slots[0]).not.toBe(slots[1]);
  expect(definitions[slots[0]!]).toEqual(savedLane.definitions[0]);
  expect(definitions[slots[1]!]).toMatchObject({ id: edited.id, payload: edited.payload });
  const audition = clipSongPlayback(state.sequencer, state.clipDrafts, editor(), structure);
  expect(audition.state.clipArrangement!.lanes[0].definitions.filter(d => d.kind === 'pattern')[audition.sequence[0]]).toMatchObject({ payload: edited.payload });
  expect(state.buildSequencerConfigSnapshot().sequencer.clipArrangement!.lanes[0]).toEqual(savedLane);
  const controls = within(structureSaveButton().parentElement!);
  fireEvent.click(controls.getByRole('button', { name: 'Undo' }));
  expect(editor().definition).not.toEqual(edited);
  expect(playback().clips[0].content.map(leaf => leaf.pad)).toEqual(slots);
  fireEvent.click(controls.getByRole('button', { name: 'Redo' }));
  expect(editor().definition).toEqual(edited);

  if (choice === 'save') {
    const restored = useAppStore.getState();
    const expected = songDraftPlayback(restored.sequencer, restored.clipDrafts, useStructureDraft.getState().draft).clipArrangement!.lanes[0];
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(useStructureDraft.getState().draft).toBeNull());
    expect(lane()).toEqual(expected);
    act(() => clipHistoryStep(false));
    expect(lane()).toEqual(savedLane);
    act(() => clipHistoryStep(true));
    expect(lane()).toEqual(expected);
  } else {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(lane()).toEqual(savedLane);
    expect(playback().clips[0].content.map(leaf => leaf.pad)).toEqual([0, null]);
    expect(useAppStore.getState().sequencer.clipHistory).toBe(before.sequencer.clipHistory);
  }
  if (choice === 'discard') expect(useAppStore.getState().clipEditingKey).toBeNull();
});

it('keeps notes on the appended copy of a loop after closing its editor and moving it', async () => {
  const clip = lane().clips[0];
  clip.children.pop();
  clip.mode = 'loop';
  clip.length = 8 * Q;
  show();
  fireEvent.click(context(patterns()[1]).getByRole('menuitem', { name: 'Duplicate' }));
  fireEvent.doubleClick(patterns()[2]);
  act(() => useAppStore.getState().setSequencerTrackStepNote(lane().id, 0, 83));
  fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
  expect(useAppStore.getState().clipEditingKey).toBeNull();
  fireEvent.keyDown(patterns()[2], { key: 'ArrowRight' });
  const events = playback().clips[0].content;
  expect(events.map(e => e.pad)).toEqual([0, 0, null, lane().definitions.filter(d => d.kind === 'pattern').length]);
  expect(events[2].length).toBe(Q / 4);
  fireEvent.doubleClick(patterns()[2]);
  const state = useAppStore.getState(), editor = state.clipDrafts[state.clipEditingKey!];
  if (editor.definition.kind !== 'pattern' || editor.definition.source !== 'sequencer') throw Error('Expected melodic copy');
  expect(editor.definition.payload.steps[0].note).toBe(83);
  await save();
  expect(playback().clips[0].content).toEqual(events);
  act(() => clipHistoryStep(false));
  expect(lane().clips[0]).toEqual(clip);
});

it('hides Ungroup for a pattern and duplicates a linked occurrence through save/reload and undo',async()=>{
  show();const original=structuredClone(lane());
  const menu=context(patterns()[0]);expect(menu.queryByRole('menuitem',{name:'Ungroup'})).toBeNull();expect(screen.queryByRole('button',{name:'Ungroup'})).toBeNull();
  fireEvent.click(menu.getByRole('menuitem',{name:'Duplicate'}));expect(lane()).toEqual(original);
  expect(patterns()).toHaveLength(2);await save();
  const saved=structuredClone(lane());expect(saved.definitions).toEqual(original.definitions);expect(saved.clips[0].length).toBe(12*Q);
  act(()=>useAppStore.getState().applySequencerConfigSnapshot(JSON.parse(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot()))));expect(lane()).toEqual(saved);
  act(()=>clipHistoryStep(false));expect(lane()).toEqual(original);act(()=>clipHistoryStep(true));expect(lane()).toEqual(saved);
});

it.each(['group','supergroup'] as const)('offers Ungroup and Duplicate for a %s and hides Ungroup for a mixed selection',kind=>{
  const l=lane(),clip=l.clips[0],pattern=clip.children[0];l.definitions.push({id:'container',name:'Container',kind,revision:0,children:[{...pattern,id:'child'}]});clip.children=[{id:'container-use',definitionId:'container'},pattern,{id:'tail',restTicks:4*Q}];
  show();const container=screen.getByTitle(`${kind}: Container`);expect(context(container).getByRole('menuitem',{name:'Ungroup'})).toBeTruthy();
  fireEvent.click(container);fireEvent.click(patterns()[1],{shiftKey:true});expect(context(container).queryByRole('menuitem',{name:'Ungroup'})).toBeNull();
  expect((screen.getByRole('menuitem',{name:'Duplicate'}) as HTMLButtonElement).disabled).toBe(false);
});

it('disables duplication for rests and cross-repetition selections',()=>{
  const clip=lane().clips[0];clip.mode='loop';clip.length=24*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();const rest=screen.getAllByTitle('Rest')[0];expect((context(rest).getByRole('menuitem',{name:'Duplicate'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(patterns()[0]);fireEvent.click(patterns()[1],{shiftKey:true});const menu=context(patterns()[1]);expect((menu.getByRole('menuitem',{name:'Duplicate'}) as HTMLButtonElement).disabled).toBe(true);expect(menu.queryByRole('menuitem',{name:'Ungroup'})).toBeNull();
});

it('appends once after the final loop repetition and saves as one clip',async()=>{
  const clip=lane().clips[0];clip.children.pop();clip.mode='loop';clip.length=16*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();fireEvent.click(context(patterns()[1]).getByRole('menuitem',{name:'Duplicate'}));expect(patterns()).toHaveLength(5);
  const preview=playback();expect(preview.end).toBe(20*Q);expect(preview.clips[0].content).toHaveLength(5);
  expect(useAppStore.getState().buildSequencerConfigSnapshot().sequencer.clipArrangement!.end).toBe(16*Q);
  await save();expect(playback()).toEqual(preview);
  expect(lane().clips).toHaveLength(1);expect(lane().clips[0]).toMatchObject({mode:'once',length:20*Q});
});

it('duplicates after a musical edit and cancels both gestures together',()=>{
  const l=lane(),clip=l.clips[0];openClipEditor({laneId:l.id,clipId:clip.id,pass:0,path:[clip.children[0].id]},'all');
  const state=useAppStore.getState(),key=state.clipEditingKey!;
  useAppStore.setState({clipDrafts:{...state.clipDrafts,[key]:{...state.clipDrafts[key],definition:{...state.clipDrafts[key].definition,name:'Unsaved'}}}});
  show();fireEvent.click(patterns()[0]);fireEvent.click(context(patterns()[0]).getByRole('menuitem',{name:'Duplicate'}));
  expect(useStructureDraft.getState().draft?.roots.filter(n=>n.definition)).toHaveLength(2);
  expect(lane()).toBe(l);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  expect(useStructureDraft.getState().draft).toBeNull();expect(lane()).toBe(l);
});

it.each([false,true])('opens Add content at the snapped position with expanded=%s',expanded=>{
  show(expanded);
  const timeline=document.querySelector('[data-clip-timeline]')!,row=document.querySelector('[data-clip-lane]')!,body=document.querySelector('[data-clip-content]')!;
  vi.spyOn(timeline,'getBoundingClientRect').mockReturnValue({left:-300} as DOMRect);vi.spyOn(row,'getBoundingClientRect').mockReturnValue({top:20} as DOMRect);
  fireEvent.change(screen.getByRole('slider',{name:'Zoom'}),{target:{value:'60'}});
  const clip = lane().clips[0];
  const pixelsPerBeat = parseFloat((body.parentElement as HTMLElement).style.width) / (clip.length / Q);
  fireEvent.doubleClick(body,{clientX:-300+5.3*pixelsPerBeat,clientY:80});
  const dialog=within(screen.getByRole('dialog',{name:'Add content'}));fireEvent.click(dialog.getByRole('button',{name:'New pattern'}));
  expect(useStructureDraft.getState().draft?.roots.map(n=>n.restTicks??n.definition?.kind)).toEqual(['pattern',1.25*Q,'pattern',2.75*Q]);
});

it('double-clicks an empty clip at an offset and cancellation leaves authored state unchanged',()=>{
  const clip=lane().clips[0];clip.children=[{id:'silence',restTicks:12*Q}];clip.offset=2*Q;clip.length=8*Q;
  show(false);const before=structuredClone(lane()),body=document.querySelector('[data-clip-content]')!;
  fireEvent.doubleClick(body,{clientX:80,clientY:30});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'Cancel'}));
  expect(lane()).toEqual(before);expect(useStructureDraft.getState().draft).toBeNull();
  fireEvent.doubleClick(body,{clientX:80,clientY:30});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));expect(useStructureDraft.getState().draft?.roots[0].restTicks).toBe(4*Q);
});

it('targets nested silence while retaining content-header double-click editing',()=>{
  const l=lane(),clip=l.clips[0];l.definitions.push({id:'g',name:'Group',kind:'group',revision:0,children:clip.children});clip.children=[{id:'group-use',definitionId:'g'}];
  show();fireEvent.doubleClick(document.querySelector('[data-clip-content]')!,{clientX:240,clientY:70});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));
  expect(useStructureDraft.getState().draft?.roots).toHaveLength(1);expect(useStructureDraft.getState().draft?.roots[0].children?.filter(n=>n.definition)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));fireEvent.doubleClick(patterns()[0]);expect(screen.queryByRole('dialog',{name:'Add content'})).toBeNull();expect(useAppStore.getState().clipEditingKey).toBeTruthy();
});

it('adds content in the clicked loop repetition without moving other content',()=>{
  const clip=lane().clips[0];clip.mode='loop';clip.length=24*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();fireEvent.doubleClick(document.querySelector('[data-clip-content]')!,{clientX:18.2*40,clientY:70});
  fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));
  expect(useStructureDraft.getState().draft?.pass).toBe(1);
  expect(useStructureDraft.getState().draft?.roots[1].restTicks).toBe(2.25*Q);
});

it('requires resolving pending structure before appending to a whole loop',()=>{
  const clip=lane().clips[0];clip.mode='loop';clip.length=24*Q;useAppStore.getState().sequencer.clipArrangement!.end=clip.length;
  show();fireEvent.doubleClick(document.querySelector('[data-clip-content]')!,{clientX:240,clientY:70});fireEvent.click(within(screen.getByRole('dialog',{name:'Add content'})).getByRole('button',{name:'New pattern'}));
  fireEvent.click(context(patterns()[0]).getByRole('menuitem',{name:'Duplicate'}));
  expect(useStructureDraft.getState().draft).toBeNull();expect(screen.getByRole('alert').textContent).toContain('Select the range again');
  expect(lane().clips[0]).toBe(clip);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));
  fireEvent.click(patterns()[0]);fireEvent.click(context(patterns()[0]).getByRole('menuitem',{name:'Duplicate'}));expect(useStructureDraft.getState().draft?.expanded).toBeTruthy();
});
