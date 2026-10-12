# Dependencies and compatibility

The skill is an isolated Python 3.13 project with a committed `uv.lock` and
music21 **10.5.0**. Its local package includes an attributed compatibility copy
of arvo **0.3.0** under `src/orchestron_composition/vendor/arvo/`; read that
directory's `NOTICE.md` and MIT `LICENSE` when updating it.

Stock arvo uses deprecated `.flat` and obsolete `.next()`/string-direction APIs.
The copy uses `.flatten()`, `.nextPitch()` and music21 scale direction enums. Imports are
relative; no global monkey patches or third-party environment files are changed.
Tests exercise all nine exposed operations. Some upstream algorithms return
nested streams and omit rests: flatten their output and apply generated pitches
to explicit score slots. Do not feed a user's full score into a process and
assume its rests, phrase length or locks survive.

Sources: [arvo](https://github.com/georgesdimitrov/arvo),
[music21](https://github.com/cuthbertLab/music21). No bundled example compositions,
music21 corpus scores or third-party SoundFonts are used as musical source material.

The default preview renders the exported MIDI through a small fixed-gain additive
synth included in `preview.py`. It works without an external synthesizer and uses
one neutral timbre; General MIDI programs are recorded in MIDI but ignored by this
fallback synth. FluidSynth with an explicitly supplied SoundFont provides richer
General MIDI timbres. Keep the SoundFont available locally; it is not bundled in
exports. Neither renderer previews the final Orchestron patch timbre. The page
plays WAV through native browser audio controls; MIDI downloads remain available.

Session locking uses POSIX `flock`, as provided on macOS and Linux. The audition
server accepts only loopback host/origin requests, requires a per-server token
for writes, limits review size and checks revisions before saving. It serves only
its own UI and named candidate preview files. Stop it after use.

## Verification

From the repository root (these development tests are excluded from the plugin ZIP):

```bash
uv run --locked --project integrations/skills/orchestron-composition-creator \
  --group dev pytest integrations/skills/orchestron-composition-creator/tests
uv run --locked --project integrations/skills/orchestron-composition-creator \
  --group dev ruff check integrations/skills/orchestron-composition-creator
uv run --locked --extra dev pytest integrations/skills/orchestron-performance-creator/tests
```

The HTTP test needs permission to open a local loopback socket. Cross-skill
integration tests resolve the sibling Performance Creator source; other tests
run with the self-contained skill alone. Tests use versioned fixtures under
`tests/fixtures`, never developer `examples/`. To check the page, generate a
disposable session, start `serve`, save a favourite and lock, reload, switch
language/round, and check solo/mix playback. Screenshots live under the repository's
`screenshots/` directory.
