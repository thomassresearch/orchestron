# Enough and Logan

Dry, editable ports from [altamax by joel / ebmtranceboy](https://ide.csound.com/editor/pXPRc5Y1vALtxqgszdhI).

- Import [Enough](../Enough.orch.instrument.json) or [Logan](../Logan.orch.instrument.json).
- Read the [instrument guide](../../../documentation/instrument_design/enough_and_logan.md)
  for controls, routing, source attribution and the accepted Enough approximation.
- Rebuild both graphs from the repository root with `.venv/bin/python tools/altamax/build.py`.
- Render dry previews and source comparisons with `.venv/bin/python tools/altamax/audition.py`.
  WAVs and numerical measurements are written to `output/altamax/`.

The raw `.patch.json` files here are reproducible authoring outputs. Tests use
independent versioned fixtures under `backend/tests/fixtures/`, not these files.
The builder does not write to the running library. Library installation uses the
patch-creator API client with compile preflight and native export.
Run `.venv/bin/python tools/altamax/install.py` after deploying the new catalog;
existing names are reused only when the authored graph matches.

Validation covers live block sizes 32/64 and MIDI/SCORE export block size 1,
including velocity, register, retriggers, chords, release tails and control
extremes. Run `.venv/bin/python -m pytest backend/tests/test_altamax.py -q`.
Logan's phase shaping matches the independent source after MIDI attack/gain
compensation; Enough's late pitch and spectral decay are checked without claiming
waveform identity. The delivered WAVs were measured, and both Mel and log-STFT
plots were visually inspected; no listening assessment is claimed.
