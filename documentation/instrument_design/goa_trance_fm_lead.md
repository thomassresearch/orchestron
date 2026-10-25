# Goa Trance FM Lead: pitch-dependent filter guards

The [native instrument](../../examples/instruments/Goa_Trance_FM_Lead.orch.instrument.json)
keeps its cross-FM oscillator, waveform, envelopes, five performance controllers
and two `statevar` high-pass filters. Each channel independently limits its
effective Q according to its actual cutoff. Settings inside the guarded range
preserve the original sound to floating-point precision. At an unsafe setting,
the resonance stops increasing before the filter becomes unstable.

The saved controller value remains the requested Q; the graph applies the guard
per note. The left cutoff includes its original velocity scaling, while the right
cutoff retains its original pitch tracking. No global filter replacement or mixer
change is required. Resonant gain can still exceed full scale: allow mixer
headroom, particularly for high notes and chords.

## Exact stability boundary

For the [Csound 6.18 statevar implementation](https://github.com/csound/csound/blob/6.18.1/Opcodes/newfils.c#L791-L870),
define `F = 2 sin(pi * cutoff / (N * sr))` and
`D = max(1/Q, (2-F)*0.05/N)`, where `N` is the oversampling count.
The opcode's zero/default setting means `N = 3`.

With no input, one internal iteration advances the band-pass and low-pass states
using the matrix:

```text
    [ 1-D*F   -F ]
A = [             ]
    [   F      1 ]
```

Its trace is `2-D*F` and its determinant is `1-D*F+F*F`. The strict Jury
conditions for both poles to lie inside the unit circle reduce to:

```text
0 < F < 2
F < D < 2/F + F/2
```

Within this instrument's Q range (0.1–5), the native damping floor never applies.
Consequently the exact admissible Q interval is:

```text
2*F / (4+F*F) < Q < 1/F
```

Both boundaries matter. High Q can cause growing oscillation; very low Q can
also destabilize this discrete filter. The guard uses a 2% inset:

```text
Qmin = 2*F / (0.98 * (4+F*F))
Qmax = 0.98 / F
Qeffective = clamp(Qrequested, Qmin, Qmax)
```

For Q=5, N=3 and sr=48000, the unguarded upper cutoff boundary is
`N*sr/pi * asin(1/(2*Q)) = 4591.336 Hz`. With the saved HP multiplier
5.0395263882509385, the fundamental boundary is 911.065 Hz, between A5 and A♯5.
The right-channel effective Q remains 5 at A5 and becomes about 4.78863 at A♯5.

## Portable graph representation

The original cutoff limiter now caps at `min(18000, 0.45*sr)`, preserving its
48 kHz behavior and preventing a cutoff above Nyquist at lower engine rates.
Both filters explicitly retain `iosamps=3`.

Two additional `limit` nodes compute the dimensionless coefficient, separately
for the two channels. The formula editor supports arithmetic and `abs`, so the
graph uses the ninth-order alternating sine polynomial:

```text
x = pi * cutoff / (3*sr)
Fguard = 2*x*(1 - x*x*(1/6 - x*x*(1/120 - x*x*(1/5040 - x*x/362880))))
```

For `0 <= x <= 0.15*pi`, this is a conservative upper bound on `2*sin(x)`:
its excess is below 1.3e-11, negligible compared with the 2% margin. Since the
lower Q bound increases and the upper Q bound decreases over this interval,
using `Fguard` keeps both limits on the safe side. The final Q clamp uses
`min(a,b)=(a+b-abs(a-b))/2` and `max(a,b)=(a+b+abs(a-b))/2`.

Keep `iosamps=3` unless the guard formula is revised with it. These guarantees
cover this patch's constant per-note cutoff and Q; they are not a proof for
arbitrary audio-rate modulation of any state-variable filter.

## Reproduction and validation

Apply the additive graph transformation to an unguarded saved patch document:

```sh
.venv/bin/python tools/goa_lead/guard_patch.py original.patch.json guarded.patch.json
```

The current cross-FM original and guarded graphs have independent fixtures in
`backend/tests/fixtures/patches/`. The older `goa_trance_fm_lead` fixture remains
unchanged for its original compiler regression.

```sh
.venv/bin/python -m pytest backend/tests/test_goa_lead_stability.py
.venv/bin/python -m pytest backend/tests/test_api.py -k 'goa_lead'
```

Tests evaluate the actual saved guard formulas over every MIDI note, controller
corners, velocities and engine-rate limits against independent exact-sine pole
calculations. Native MIDI and SCORE renders cover the original A♯5 failure,
stable-note sound preservation, high notes, retriggers, chords and release.
The API test checks native export/import and saved controller overrides.
