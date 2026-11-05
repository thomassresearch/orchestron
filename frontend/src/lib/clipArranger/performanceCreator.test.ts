import { describe, expect, it } from 'vitest';
import fixture from '../../../../backend/tests/fixtures/performance_creator/all_sources.json';
import { buildPersistedAppStateSnapshot, buildSequencerConfigSnapshot, normalizeSequencerState, parseSequencerConfigSnapshot } from '../../store/appStoreModel';
import { useAppStore } from '../../store/useAppStore';
import { arrangementTimings } from './migration';
import { readClipHistory, replayClipEdit } from './history';
import { validateArrangement } from './model';

describe('Performance Creator shared contract', () => {
  it('loads all five sources and replays CLI history through save and autosave', () => {
    const parsed = parseSequencerConfigSnapshot(fixture.config, [], null).sequencer;
    expect(parsed.clipArrangement).toEqual(fixture.config.sequencer.clipArrangement);
    validateArrangement(parsed.clipArrangement!, arrangementTimings(parsed));
    const saved = buildSequencerConfigSnapshot(parsed, []);
    const autosaved = buildPersistedAppStateSnapshot({ ...useAppStore.getInitialState(), sequencer: parsed });
    for (const restored of [parseSequencerConfigSnapshot(saved, [], null).sequencer, normalizeSequencerState(autosaved.sequencer)]) {
      expect(restored.clipArrangement).toEqual(parsed.clipArrangement);
      const history = readClipHistory(restored.clipHistory, restored.clipArrangement!, arrangementTimings(restored));
      expect(history.cursor).toBe(1);
      const undone = replayClipEdit(history, restored.clipArrangement!, false);
      expect(undone.model).toEqual(fixture.before);
      expect(replayClipEdit(undone.history, undone.model, true).model).toEqual(parsed.clipArrangement);
      expect(parsed.clipArrangement!.lanes.find(l => l.source === 'score')!.definitions).toHaveLength(9);
    }
  });
});
