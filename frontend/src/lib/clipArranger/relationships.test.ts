import { expect, it } from 'vitest';
import { defaultSequencerPads } from '../../store/appStoreModel';
import { QUARTER_TICKS as Q, type ClipLane, type Definition } from './model';
import { affectedClipIds, definitionRelationships, effectiveScope, initialEditIntent, localLoopWindows, uniqueVariationName } from './relationships';

const pattern = (id: string): Definition => ({ id, name: 'Same name', revision: 0, kind: 'pattern', source: 'sequencer', payload: defaultSequencerPads()[0] });
function lane(): ClipLane {
  return { id: 'lane', source: 'sequencer', cycleTicks: null, definitions: [pattern('a'), pattern('b')], clips: [{ id: 'clip', name: 'Clip', start: 0, length: 4 * Q, offset: 0, mode: 'once', children: [{ id: 'use', definitionId: 'a' }] }] };
}
it('counts nested, cropped repetitions and offscreen clips by identity', () => {
  const l = lane(); l.definitions.push({ id: 'g', name: 'Group', kind: 'group', revision: 0, children: [{ id: 'p1', definitionId: 'a' }, { id: 'p2', definitionId: 'a' }] });
  Object.assign(l.clips[0], { mode: 'loop', offset: 2 * Q, length: 15 * Q, children: [{ id: 'group', definitionId: 'g' }] });
  l.clips.push({ ...l.clips[0], id: 'offscreen', mode: 'once', start: 100 * Q, offset: 0, length: 4 * Q, children: [{ id: 'copy', definitionId: 'a' }] });
  const relationships = definitionRelationships(l);
  expect(relationships.get('a')).toMatchObject({ occurrences: 6, clipIds: ['clip', 'offscreen'], shared: true });
  expect(relationships.get('g')).toMatchObject({ occurrences: 3, shared: true });
  expect(relationships.get('b')).toMatchObject({ occurrences: 0, shared: false });
  expect(affectedClipIds(relationships,[{id:'g'},{id:'a'}])).toEqual(['clip','offscreen']);
  expect(localLoopWindows(l,'clip',1)).toEqual([[0,6*Q],[6*Q,14*Q],[14*Q,15*Q]]);
});
it('propagates sharing from reused and unused ancestors without counting unused content as arranged', () => {
  const l = lane(); l.definitions.push({ id: 'unused', name: 'Saved group', kind: 'group', revision: 0, children: [{ id: 'child', definitionId: 'a' }] });
  expect(definitionRelationships(l).get('a')).toMatchObject({ occurrences: 1, references: 2, retained: true, shared: true });
  l.clips[0].children = [{ id: 'g1', definitionId: 'unused' }];
  l.clips.push({ ...l.clips[0], id: 'second', start: 4 * Q, children: [{ id: 'g2', definitionId: 'unused' }] });
  expect(definitionRelationships(l).get('a')).toMatchObject({ occurrences: 2, references: 1, retained: false, shared: true });
});
it('aggregates large loops and does not multiply counts by lane or song playback cycles', () => {
  const l = lane(); l.clips[0].mode = 'loop'; l.clips[0].length = 1000000 * Q; l.cycleTicks = l.clips[0].length;
  expect(definitionRelationships(l).get('a')?.occurrences).toBe(250000);
});
it('does not infer ownership from the first visible pass', () => {
  const l = lane(); Object.assign(l.clips[0], { mode: 'loop', offset: 8 * Q, length: 6 * Q });
  expect(definitionRelationships(l).get('a')).toMatchObject({ occurrences: 2, shared: true });
});
it('does not mark a sole visible consumer shared just because its base pass was trimmed away',()=>{
  const l=lane();Object.assign(l.clips[0],{mode:'loop',offset:4*Q,length:8*Q,children:[{id:'a-use',definitionId:'a'},{id:'b-use',definitionId:'b'}]});
  expect(definitionRelationships(l).get('a')).toMatchObject({occurrences:1,shared:false});
  expect(definitionRelationships(l).get('b')).toMatchObject({occurrences:1,shared:false});
});
it('invalidates inferred scope when sharing changes and keeps explicit intent', () => {
  const l = lane(), independent = definitionRelationships(l).get('a');
  const intent = initialEditIntent(independent); expect(effectiveScope(intent, independent)).toBe('all');
  l.clips[0].mode = 'loop'; l.clips[0].length = 8 * Q;
  const shared = definitionRelationships(l).get('a');
  expect(effectiveScope(intent, shared)).toBeNull();
  expect(initialEditIntent(shared).scope).toBeNull();
  expect(effectiveScope({ scope: 'local', explicit: true }, shared)).toBe('local');
});
it('suggests distinct bounded variation names without changing definitions', () => {
  const l = lane(); l.definitions[1].name = 'Same name variation 1';
  expect(uniqueVariationName(l, 'Same name', 'variation')).toBe('Same name variation 2');
  expect(uniqueVariationName(l, 'x'.repeat(128), 'Variante').length).toBe(128);
});
