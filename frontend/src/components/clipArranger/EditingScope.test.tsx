// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAppStore } from '../../store/useAppStore';
import { useStructureDraft } from '../../lib/clipArranger/structureStore';
import { migrateClipArrangement } from '../../lib/clipArranger/migration';
import { QUARTER_TICKS as Q } from '../../lib/clipArranger/model';
import { clipHistoryStep, openClipEditor, saveClipDraftWithIntent, setClipEditIntent } from '../../store/clipActions';
import { ClipPerformance } from './ClipPerformance';

beforeEach(() => {
  useAppStore.setState(useAppStore.getInitialState(), true); useStructureDraft.setState({ draft: null });
  const seq = structuredClone(useAppStore.getState().sequencer), track = seq.tracks[0];
  track.padLoopEnabled = true; track.padLoopPattern = { groups: [], superGroups: [], rootSequence: [{ type: 'pad', padIndex: 0 }] };
  seq.clipArrangement = migrateClipArrangement(seq).model!;
  const l = seq.clipArrangement.lanes[0]; l.cycleTicks = null; l.definitions[0].name = 'Phrase';
  l.clips = [{ ...l.clips[0], id: 'loop', name: 'Verse', mode: 'loop', length: 16 * Q }, { ...structuredClone(l.clips[0]), id: 'other', name: 'Chorus', start: 20 * Q, length: 4 * Q, mode: 'once', children: [{ id: 'other-use', definitionId: l.definitions[0].id }] }];
  seq.clipArrangement.end = 24 * Q; useAppStore.setState({ sequencer: seq });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const model = () => useAppStore.getState().sequencer.clipArrangement!;
const patterns = () => screen.getAllByTitle('pattern: Phrase');
const editor = () => within(screen.getByRole('region', { name: 'Editing' }));
function show() {
  render(<ClipPerformance language="english" renderEditor={(_kind,id) => <button onClick={() => useAppStore.getState().setSequencerTrackStepNote(id, 0, 73)}>Change note</button>} />);
  fireEvent.click(screen.getByRole('button', { expanded: false, name: /▸/ }));
}
it('separates relationship highlighting from selection and shows repetition indicators', () => {
  show(); fireEvent.click(patterns()[1]);
  expect(document.querySelectorAll('[data-linked-highlight=true]')).toHaveLength(4);
  expect(document.querySelectorAll('[data-structure-node][style*="outline: 2px"]')).toHaveLength(1);
  expect(document.querySelectorAll('[data-loop-repetition=true]')).toHaveLength(3);
  expect(screen.getByText(/5 arranged occurrences · 2 clips/)).toBeTruthy();
  fireEvent.click(patterns()[2], { shiftKey: true });
  expect(document.querySelectorAll('[data-linked-highlight=true]')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Create variation here' }).hasAttribute('disabled')).toBe(true);
});
it.each(['doubleClick','keyboard'] as const)('asks before editing shared content through %s', method => {
  show(); const before = model();
  if (method === 'doubleClick') fireEvent.doubleClick(patterns()[1]); else fireEvent.keyDown(patterns()[1], { key: 'Enter' });
  expect(editor().queryByRole('button', { name: 'Change note' })).toBeNull();
  expect(editor().getByText(/isolated into before/)).toBeTruthy();
  fireEvent.click(editor().getByRole('button', { name: 'Create variation here' }));
  expect(editor().getByRole('button', { name: 'Change note' })).toBeTruthy();
  expect(editor().getByRole('button', { name: 'Save variation here' }).hasAttribute('disabled')).toBe(true);
  expect(model()).toBe(before);
});
it.each(['local','all'] as const)('saves the established %s scope without another dialog and undoes atomically', async scope => {
  show(); const before = structuredClone(model()); fireEvent.doubleClick(patterns()[1]);
  fireEvent.click(editor().getByRole('button', { name: scope === 'local' ? 'Create variation here' : 'Edit linked pattern (5)' }));
  fireEvent.click(editor().getByRole('button', { name: 'Change note' }));
  await act(async () => fireEvent.click(editor().getByRole('button', { name: scope === 'local' ? 'Save variation here' : 'Save to linked occurrences (5)' })));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(model().lanes[0].clips).toHaveLength(scope === 'local' ? 4 : 2);
  expect(model().lanes[0].definitions.length).toBe(before.lanes[0].definitions.length + (scope === 'local' ? 1 : 0));
  if (scope === 'local') expect(model().lanes[0].definitions[model().lanes[0].definitions.length-1]?.name).toBe('Phrase variation 1');
  expect(JSON.stringify(useAppStore.getState().buildSequencerConfigSnapshot())).not.toContain('editIntent');
  act(() => clipHistoryStep(false)); expect(model().lanes).toEqual(before.lanes);
});
it('keeps note edits and scope on reopen, and does not apply a variation name to shared content', () => {
  show(); fireEvent.doubleClick(patterns()[1]); fireEvent.click(editor().getByRole('button', { name: 'Create variation here' }));
  fireEvent.change(editor().getByRole('textbox', { name: 'Variation name' }), { target: { value: 'Fill' } });
  fireEvent.click(editor().getByRole('button', { name: 'Change note' }));
  fireEvent.click(editor().getByRole('button', { name: 'Close editor' })); fireEvent.doubleClick(patterns()[1]);
  expect((editor().getByRole('textbox', { name: 'Variation name' }) as HTMLInputElement).value).toBe('Fill');
  fireEvent.click(editor().getByRole('button', { name: 'Change scope' })); fireEvent.click(editor().getByRole('button', { name: 'Edit linked pattern (5)' }));
  act(() => saveClipDraftWithIntent()); expect(model().lanes[0].definitions[0].name).toBe('Phrase');
  const d=model().lanes[0].definitions[0]; expect(d.kind==='pattern'&&d.source==='sequencer'&&d.payload.steps[0].note).toBe(73);
});
it.each(['toolbar','context menu'] as const)('opens a named local variation directly from the %s', async entry => {
  show(); fireEvent.click(patterns()[1]);
  if(entry==='context menu')fireEvent.contextMenu(patterns()[1]);
  fireEvent.click(screen.getByRole(entry==='context menu'?'menuitem':'button',{name:'Create variation here'}));
  expect((editor().getByRole('textbox',{name:'Variation name'}) as HTMLInputElement).value).toBe('Phrase variation 1');
  fireEvent.click(editor().getByRole('button',{name:'Change note'}));
  await act(async()=>fireEvent.click(editor().getByRole('button',{name:'Save variation here'})));
  expect(model().lanes[0].definitions.some(d=>d.name==='Phrase variation 1')).toBe(true);
});
it('updates independent content in place and rejects stale inferred scope', () => {
  const l=model().lanes[0]; l.clips=[{...l.clips[0],mode:'once',length:4*Q}];
  const target={laneId:l.id,clipId:l.clips[0].id,pass:0,path:[l.clips[0].children[0].id]};
  openClipEditor(target);const before=model();saveClipDraftWithIntent();expect(model()).toBe(before);
  useAppStore.getState().setSequencerTrackStepNote(l.id,0,73);
  l.clips.push({...l.clips[0],id:'linked',start:8*Q,children:[{id:'linked-use',definitionId:l.definitions[0].id}]});
  expect(()=>saveClipDraftWithIntent()).toThrow('Choose');
  setClipEditIntent('all');saveClipDraftWithIntent();expect(model().lanes[0].definitions).toHaveLength(l.definitions.length);
});
it('holds the first structural action, cancels without changing selection, and reuses its chosen scope', () => {
  const l=model().lanes[0],p=l.definitions[0]; l.definitions.push({id:'g',name:'Group',kind:'group',revision:0,children:[{id:'child1',definitionId:p.id},{id:'child2',definitionId:p.id}]});
  l.clips.forEach((c,i)=>{c.children=[{id:`group${i}`,definitionId:'g'}];}); show(); fireEvent.click(patterns()[0]);
  const before=model();fireEvent.click(screen.getByRole('button',{name:'Remove selected'}));
  expect(useStructureDraft.getState().draft).toBeNull(); const dialog=screen.getByRole('dialog',{name:'Choose editing scope'});
  fireEvent(dialog,new Event('cancel',{bubbles:true,cancelable:true}));expect(model()).toBe(before);
  expect(document.querySelectorAll('[data-structure-node][style*="outline: 2px"]')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Remove selected'}));fireEvent.click(within(screen.getByRole('dialog',{name:'Choose editing scope'})).getByRole('button',{name:'Only this occurrence'}));
  expect(useStructureDraft.getState().draft?.cursor).toBe(1);expect(useStructureDraft.getState().draft?.editIntent).toMatchObject({scope:'local',explicit:true});
  fireEvent.click(patterns()[0]);fireEvent.click(screen.getByRole('button',{name:'Remove selected'}));
  expect(screen.queryByRole('dialog',{name:'Choose editing scope'})).toBeNull();expect(useStructureDraft.getState().draft?.cursor).toBe(2);
});
it('holds an incompatible later command until the whole draft is explicitly switched to local scope',()=>{
  const l=model().lanes[0],p=l.definitions[0];l.definitions.push({id:'g',name:'Group',kind:'group',revision:0,children:[{id:'child',definitionId:p.id}]});
  l.clips.forEach((c,i)=>{c.children=[{id:`group${i}`,definitionId:'g'}];});show();
  fireEvent.doubleClick(screen.getAllByTitle('group: Group')[0]);
  fireEvent.click(editor().getByRole('button',{name:'Edit linked group (5)'}));
  fireEvent.blur(editor().getByRole('textbox',{name:'Name'}),{target:{value:'Renamed'}});
  fireEvent.click(editor().getByRole('button',{name:'Close editor'}));
  fireEvent.click(screen.getAllByTitle('group: Renamed')[0]);const previous=useStructureDraft.getState().draft;
  fireEvent.click(screen.getByRole('button',{name:'Remove selected'}));
  let dialog=within(screen.getByRole('dialog',{name:'Choose editing scope'}));
  expect(dialog.getByText(/Change the whole draft to local scope/)).toBeTruthy();
  fireEvent.click(dialog.getByRole('button',{name:'Cancel'}));expect(useStructureDraft.getState().draft).toBe(previous);
  fireEvent.click(screen.getByRole('button',{name:'Remove selected'}));dialog=within(screen.getByRole('dialog',{name:'Choose editing scope'}));
  fireEvent.click(dialog.getByRole('button',{name:'Only this occurrence'}));
  expect(useStructureDraft.getState().draft?.cursor).toBe(2);expect(useStructureDraft.getState().draft?.editIntent?.scope).toBe('local');
  fireEvent.click(screen.getAllByRole('button',{name:'Undo'})[1]);
  expect(useStructureDraft.getState().draft?.editIntent?.scope).toBe('local');
});
