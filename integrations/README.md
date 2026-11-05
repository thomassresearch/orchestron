# Integrations

This directory is the source root of the Orchestron plugin. Its four skills support instrument design, interactive composition, sung-melody transcription, and performance creation. Continue developing them in `skills/`; the ZIP is generated from these sources.

The [Sung Melody Transcription skill](skills/sung-melody-transcription/SKILL.md)
is included in the plugin alongside the three creator skills. It converts
singing/humming with optional claps to MIDI, note JSON and a FluidSynth piano
preview, with retained pitch evidence and an editorial log. It uses no Orchestron
API or native bundle format. See its [setup and commands](skills/sung-melody-transcription/references/workflow.md).
Its previews use FluidSynth directly, without creating an Orchestron performance.
Keep its model, SoundFont and transcription outputs outside the installed plugin.

## Build the plugin ZIP

From this directory, run:

```bash
make
```

Or run `make -C integrations` from the repository root. The build requires Make
and Python 3.9 or newer, uses only the Python standard library, and needs no
network or installed skill dependencies. Set `PYTHON=/path/to/python3` if needed.

The output is `plugin-dist/orchestron-0.1.5.zip`; the filename comes from the
name and version in [`plugin.json`](plugin.json). Each build reports its path
and compressed size. The archive contains one `orchestron/` directory with:

- The portable plugin manifest, the repository license, and plugin branding in `assets/`.
  The bundled Orchestron icon is copied from `frontend/src/assets/orchestron-icon.png`
  and used for both the plugin logo and composer icon.
- All four skills' `SKILL.md`, available agent metadata, Python sources,
  CLI scripts, references, and assets, including the composition audition UI.
- Each skill's `pyproject.toml` and committed `uv.lock`, plus the vendored arvo and RVC RMVPE
  licenses and attribution.

The builder includes those files explicitly and excludes tests, examples,
development notes, environments, caches, bytecode, and generated distributions.
It rejects symlinks within included content. Archive entries are sorted and
their timestamps and permissions normalized; repeated builds with the same
source and Python/zlib toolchain produce identical ZIPs. Each build replaces
the current version's ZIP, so deleted sources cannot remain in an old archive.

Use `make test` for the packaging tests and `make clean` to remove `plugin-dist/`.
Keep generated archives as local build outputs for now. Before distributing an
update, change the plugin version in `plugin.json` and run `make` again. Skill
project versions and dependency lockfiles remain independently maintained.

## Use the packaged skills

The ZIP is the plugin installation artifact. Building it does not install,
upload, or publish the plugin. Use your Codex client's supported ZIP import
flow; for clients using a local marketplace, extract the archive and point the
marketplace entry at the enclosed `orchestron/` directory. See the
[plugin packaging and installation documentation](https://developers.openai.com/plugins/build/plugins).

Running the skills requires `uv` and Python 3.13. On first use, `uv run --locked`
installs the dependencies from the bundled lockfile; Python packages, virtual
environments, and a Python interpreter are not included in the ZIP. The optional
patch audio-analysis utility uses `--extra audio`. The composition preview UI
uses plain browser JavaScript and requires no Node installation at runtime.

Patch and performance library operations need a running Orchestron backend,
normally at `http://localhost:8000/api`; a different server can be selected with
`--api-url`. Composition generation, audition, and score export run locally on
macOS/Linux without a backend. Optional SoundFont rendering requires a locally
installed FluidSynth and a user-supplied SoundFont. Sung-melody transcription
also runs without a backend and requires the external RMVPE checkpoint plus
FluidSynth and a piano SoundFont for its preview.

Have the agent locate each skill using its installed `SKILL.md` path and run
`uv run --locked --project "/absolute/path/to/skill" ...` from a working
directory for your music. Keep scores, audio, composition sessions, and
performance edit sessions outside the installed plugin. Repository examples
below are for development in a checkout.

After installing and verifying the plugin, remove the corresponding standalone
skill installations to avoid activating different copies. Preserve the source
directories here, and rebuild/reinstall the plugin after source updates.

The skills are [Patch Creator](skills/orchestron-patch-creator/SKILL.md),
[Composition Creator](skills/orchestron-composition-creator/SKILL.md),
[Performance Creator](skills/orchestron-performance-creator/SKILL.md), and
[Sung Melody Transcription](skills/sung-melody-transcription/SKILL.md).

## Orchestron Performance Creator Skill

The skill lives in [`skills/orchestron-performance-creator`](skills/orchestron-performance-creator). It exposes `orchestron_cli` with offline staged clip authoring and backend validation, persistence and runtime control. It does not edit SQLite directly.

Run commands from the repository root with the skill project selected:

```bash
uv run --locked --project integrations/skills/orchestron-performance-creator orchestron_cli --json health
```

The backend must be running and reachable at the default API URL, `http://localhost:8000/api`, unless `--api-url` is supplied.

New songs use the clip model explicitly. From an external music directory:

```bash
uv run --locked --project /absolute/path/to/orchestron-performance-creator orchestron_cli --json capabilities
uv run --locked --project /absolute/path/to/orchestron-performance-creator orchestron_cli --json edit begin --new --arranger clips --name "Agent Sketch"
uv run --locked --project /absolute/path/to/orchestron-performance-creator orchestron_cli --json edit apply-song --file /work/song.json
uv run --locked --project /absolute/path/to/orchestron-performance-creator orchestron_cli --json edit inspect
uv run --locked --project /absolute/path/to/orchestron-performance-creator orchestron_cli --json edit validate
uv run --locked --project /absolute/path/to/orchestron-performance-creator orchestron_cli --json edit commit
```

See the [song cookbook](skills/orchestron-performance-creator/references/song_workflow.md),
[schema and exact timing](skills/orchestron-performance-creator/references/song_schema.md),
[scoped editing/history](skills/orchestron-performance-creator/references/song_editing.md)
and [owned automation](skills/orchestron-performance-creator/references/song_automation.md).
The shipped `assets/minimal-song.json` and `assets/complete-song.json` need no personal
patch IDs. Discover and bind instruments separately, preserving requested choices.
Repeats and pitch changes reuse definitions; intentional musical variations fork locally.
Composition Creator v1/v2 handoffs use explicit, retry-safe `edit adapt-score`.

Legacy pad commands and `edit apply-score` remain available for legacy drafts.
Migration is explicit and writes a recoverable original; creating or packaging this
plugin does not change the arranger's preview rollout gate. Musical formats remain
performance v1–26 and clip v1–4, independently of client/project versions.

Plugin **0.1.5** includes Performance Creator **0.3.0**. Run `capabilities` from the
active installed skill and compare `client.version`; backend capability absence is
reported as unknown. A ZIP rebuild does not update an installed cached copy.
For read-only installs put the environment outside the plugin using
`UV_PROJECT_ENVIRONMENT=/absolute/path/to/work/venv`, alongside external session
and output paths. Never keep local song drafts inside packaged skill trees.

### Mixer and Master routing

Every performance has the built-in `$master` endpoint with exact `left/right` inputs; it needs no speaker patch or rack assignment. Use `edit instruments list` to discover instance IDs and routable outputs, including `$direct.left/right` for direct-output patches. Quote dollar-prefixed identifiers in the shell.

From the skill directory, with a staged performance and the required effect patches available:

```bash
uv run --locked orchestron_cli --json edit add-standard-effects --send-gain-db -12
uv run --locked orchestron_cli --json edit routes list
uv run --locked orchestron_cli --json edit mixer list
uv run --locked orchestron_cli --json edit mixer strip set --binding '$master' --gain-db -3
```

This optional preset sends instrument main outputs and a shared reverb return through a compressor into Master. It reuses routable direct outputs without cloning patches. New sends otherwise start silent; `edit mixer send set` accepts repeated `--route` IDs to change a stereo pair atomically. `edit routes add --kind main|send|custom` supports explicit routing, and `edit routes remove --id` removes one exact connection. The obsolete `--speaker-patch` flag reports an error before editing.

See [routing](skills/orchestron-performance-creator/references/effect_routing.md), [mixer controls and TB303 Demo](skills/orchestron-performance-creator/references/mixer.md), and [the optional preset](skills/orchestron-performance-creator/references/standard_effect_patching.md). Existing insert chains are preserved; use the app to create or reorder inserts. Tests use a versioned synthetic mix in the skill's `tests/fixtures/`, independent of developer examples.

## Example: AI Generated Nr1

The first generated example performance is exported as [`examples/AI_generated_Nr1.orch.zip`](examples/AI_generated_Nr1.orch.zip). The prompt transcript is saved as [`examples/AI_generated_Nr1_prompt.txt`](examples/AI_generated_Nr1_prompt.txt).

The session started by checking the configured patches:

```text
/orchestron-performance-creator what instruments (patches) are currently configured?
```

The available patches included:

```text
PAD with VCOs and LFOs
Roland TR808
TB303 using VCO
```

The performance was then generated from this prompt:

```text
Create a new performance, a techno style 4/4 beat (use Roland TR808), with a bassline (use TB303 using VCO) and a synth pad (using PAD with VCOs and LFOs).
The performance should start with an short, drum only intro, then the bassline should evolve, and finally the synth pad harmonies should set in. The performance should end with a part only using the synth pad.
Make sure the harmonies between bassline and synthpad match, make it interesting while still being techno.
Save the performance as "AI generated Nr1".
```

Resulting performance summary:

```text
Name: AI generated Nr1
Tempo: 132 BPM
Form: short drum-only intro, evolving TB303 bassline, matching pad harmonies, pad-only ending
Instruments:
- Channel 10: Roland TR808
- Channel 2: TB303 using VCO
- Channel 3: PAD with VCOs and LFOs
Harmony: C Dorian/minor
```

Use this example as a small reference for agent-driven performance creation: first ask the skill what material is available, then give a concrete musical brief with named patches, arrangement shape, harmonic constraints, and the final performance name.
