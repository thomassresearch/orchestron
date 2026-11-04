import { resolveContent, type Clip, type ClipArrangement, type ClipLane, type ContentItem } from './model';
import { addOffsets, offsetAt, TRANSPOSE_LIMITS as L, validateOffsetPlan, type OffsetPlan } from './transposition';

/** Return all three scopes at every level; use full occurrence paths, never definition IDs alone. */
export function transposePlans(lane: ClipLane, clip: Clip, path: string[]): OffsetPlan[] {
  return transposeContributions(lane, clip, path).map(c => c.repeatIndex === undefined ? c.plan : {base:offsetAt(c.plan,c.repeatIndex),repetitions:[]});
}

export function transposeContributions(lane: ClipLane, clip: Clip, path: string[]) {
  const plans: { owner: string; scope: 'shared' | 'parent' | 'placement'; plan: OffsetPlan; repeatIndex?: number }[] = [];
  let items = clip.children;
  let repeatIndex: number | undefined;
  path.forEach((id, index) => {
    const item = items.find(i => i.id === id);
    if (!item || !('definitionId' in item)) throw Error('Invalid transposition placement path.');
    repeatIndex = item.repeatIndex ?? repeatIndex;
    const definition = lane.definitions.find(d => d.id === item.definitionId);
    if (!definition) throw Error('Missing transposition definition.');
    if (definition.transposeProfileId) {
      const profile = lane.transposeProfiles?.find(p => p.id === definition.transposeProfileId);
      if (!profile) throw Error('Missing transposition profile.');
      plans.push({owner: definition.name, scope:'shared', plan:profile.plan, repeatIndex});
    }
    if (item.transpose) plans.push({owner:definition.name,scope:'parent',plan:item.transpose, repeatIndex});
    const placement = clip.transposePlacements?.find(p => p.path.length === index+1 && p.path.every((v,i) => v === path[i]));
    if (placement) plans.push({owner:definition.name,scope:'placement',plan:placement.plan, repeatIndex});
    items = definition.kind === 'pattern' ? [] : definition.children;
  });
  return plans;
}

/** Logical index for an occurrence, independent of its new position after grouping. */
export function logicalRepeatIndex(lane: ClipLane, clip: Clip, path: string[], pass: number): number {
  let index = (clip.repeatIndexBase ?? 0) + pass, items = clip.children;
  for (const id of path) {
    const item = items.find(item => item.id === id);
    if (!item || !('definitionId' in item)) throw Error('Invalid occurrence path.');
    index = item.repeatIndex ?? index;
    const definition = lane.definitions.find(d => d.id === item.definitionId)!;
    items = definition.kind === 'pattern' ? [] : definition.children;
  }
  return index;
}

export function validateTranspositions(model: ClipArrangement, identity: (id: string) => void): void {
  let entries = 0, placements = 0;
  for (const lane of model.lanes) {
    const supported = ['sequencer', 'score', 'arpeggiator'].includes(lane.source);
    const feature = () => { if (model.version < 3 || !supported) throw Error('Transposition requires clip v3 and a melodic, score or arpeggiator lane.'); };
    const plan = (value: unknown) => { feature(); validateOffsetPlan(value); entries += value.repetitions.length; if (entries > L.totalEntries) throw Error('Performance transposition entry limit exceeded.'); };
    if (lane.transposeProfiles !== undefined) {
      feature();
      if (!Array.isArray(lane.transposeProfiles) || lane.transposeProfiles.length > L.profiles) throw Error('Transposition profile limit exceeded.');
      for (const p of lane.transposeProfiles) {
        if (!p || Object.keys(p).sort().join() !== 'id,plan,revision' || !Number.isSafeInteger(p.revision) || p.revision < 0 || p.revision > 20160000000) throw Error('Invalid transposition profile.');
        identity(p.id); plan(p.plan);
      }
    }
    const children = (items: ContentItem[]) => { for (const item of items) { if ('repeatIndex' in item && ('restTicks' in item || model.version < 4 || !Number.isSafeInteger(item.repeatIndex) || item.repeatIndex! < 0 || item.repeatIndex! > L.index)) throw Error('Invalid content repetition index.'); if ('transpose' in item) { if ('restTicks' in item) throw Error('Rests cannot be transposed.'); plan(item.transpose); } } };
    for (const def of lane.definitions) {
      if (def.transposeProfileId !== undefined) { feature(); if (!lane.transposeProfiles?.some(p => p.id === def.transposeProfileId)) throw Error('Missing transposition profile.'); }
      if (def.kind !== 'pattern') children(def.children);
    }
    for (const clip of lane.clips) {
      children(clip.children);
      if (clip.repeatIndexBase !== undefined && (model.version < 3 || !Number.isSafeInteger(clip.repeatIndexBase) || clip.repeatIndexBase < 0 || clip.repeatIndexBase > L.index)) throw Error('Invalid repetition base.');
      if (clip.transposePlacements !== undefined) {
        feature();
        if (!Array.isArray(clip.transposePlacements) || clip.transposePlacements.length > L.placements) throw Error('Clip transposition placement limit exceeded.');
        placements += clip.transposePlacements.length;
        if (placements > L.totalPlacements) throw Error('Performance transposition placement limit exceeded.');
        const seen = new Set<string>();
        for (const p of clip.transposePlacements) {
          if (!p || Object.keys(p).sort().join() !== 'path,plan' || !Array.isArray(p.path) || !p.path.length || p.path.length > 3 || p.path.some(id => typeof id !== 'string') || seen.has(JSON.stringify(p.path))) throw Error('Invalid or duplicate transpose placement.');
          seen.add(JSON.stringify(p.path)); plan(p.plan); transposePlans(lane, clip, p.path);
        }
      }
    }
  }
  validateDerivedTranspositions(model);
}

function validateDerivedTranspositions(model: ClipArrangement) {
  let totalVariants=0,totalRecords=0;
  for(const lane of model.lanes) {
    if(!['sequencer','score','arpeggiator'].includes(lane.source))continue;
    const effective=new Map<string,Set<string>>(),variants=new Set<string>();
    let entryCount=0;
    const planIds=new Map<OffsetPlan,number>();
    for(const clip of lane.clips)for(const leaf of resolveContent(lane,clip.children)) {
      if(!leaf.definition)continue;
      const contributions=transposeContributions(lane,clip,leaf.path);
      const key=contributions.map(c=>{if(!planIds.has(c.plan))planIds.set(c.plan,planIds.size);return `${planIds.get(c.plan)}:${c.repeatIndex??'dynamic'}`;}).join('|');
      let pairs=effective.get(key);
      if(!pairs) {
        const plans=contributions.map(c=>c.repeatIndex===undefined?c.plan:{base:offsetAt(c.plan,c.repeatIndex),repetitions:[]});
        const base=addOffsets(plans.map(p=>p.base)),changes=new Map<number,typeof base>();
        for(const p of plans)for(const entry of p.repetitions) {
          const value=changes.get(entry.index)??{...base};
          value.diatonicSteps+=entry.offset.diatonicSteps-p.base.diatonicSteps;
          value.chromaticSemitones+=entry.offset.chromaticSemitones-p.base.chromaticSemitones;
          changes.set(entry.index,value);if(changes.size>L.totalEntries)throw Error('Effective transposition entry limit exceeded.');
        }
        entryCount += [...changes.values()].filter(p=>p.diatonicSteps!==base.diatonicSteps||p.chromaticSemitones!==base.chromaticSemitones).length;
        if(entryCount>L.totalEntries)throw Error('Effective transposition entry limit exceeded.');
        pairs=new Set([base,...changes.values()].map(p=>`${p.diatonicSteps},${p.chromaticSemitones}`));pairs.delete('0,0');effective.set(key,pairs);
      }
      for(const pair of pairs) {
        const variant=JSON.stringify([leaf.definition.id,pair]);if(variants.has(variant))continue;
        variants.add(variant);totalVariants++;
        if(leaf.definition.source==='score')totalRecords+=leaf.definition.payload.notes.length;
        if(variants.size>L.variants||totalVariants>L.totalVariants||totalRecords>L.scoreNotes)throw Error('Transposition variant/score-record limit exceeded.');
      }
    }
  }
}
