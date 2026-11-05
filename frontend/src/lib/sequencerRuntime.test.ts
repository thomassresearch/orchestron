import { expect, it } from 'vitest';
import { drummerRowRuntimeTrackId, parseDrummerRowRuntimeTrackId } from './sequencerRuntime';

it.each(['drum-row-1', 'rhythm:key35:76e7f7bc9652f8a2'])(
  'round-trips drummer row identity %s without interpreting row delimiters', rowId => {
    expect(parseDrummerRowRuntimeTrackId(drummerRowRuntimeTrackId('rhythm', rowId)))
      .toEqual({ drummerTrackId: 'rhythm', rowId });
  }
);

it.each(['lead', 'drumrow:kit', 'drumrow::kick', 'drumrow:kit:', 'drumrow: :kick', 'drumrow:kit: '])(
  'rejects incomplete drummer identity %s', id => expect(parseDrummerRowRuntimeTrackId(id)).toBeNull()
);
