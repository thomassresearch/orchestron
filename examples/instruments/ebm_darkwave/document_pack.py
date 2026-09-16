#!/usr/bin/env python3
"""Rebuild the pack's user guide from its source specs and measured reports."""

import json
from pathlib import Path

PACK = Path(__file__).resolve().parent
specs = [json.loads(p.read_text()) for p in sorted((PACK / "specs").glob("*.json"))]
lines = [
    "# EBM / Dark Wave instruments",
    "",
    "Thirteen sample-free instruments with classic EBM and dark-wave defaults. Each is MIDI-triggered, velocity-sensitive, and ready for the performance rack.",
    "",
    "## Use the instruments",
    "",
    "The instruments are imported into the local library under **EBM DW —**. To use an export elsewhere, open **Instrument Design → Import** and choose one of the native JSON files below. In **Perform**, assign the instrument and route its **Stereo Output** through the mixer to **Master**.",
    "",
    "Attack and Release appear on every instrument. The other knobs vary by sound. These are per-instance initialization settings: changes affect new notes; held notes retain their settings. Internal LFOs continue moving during held notes. Motion rates are in Hz and echoes use fixed millisecond delays, with no automatic tempo synchronization.",
    "",
    "Sequencer Bass needs notes from the piano roll or arpeggiator. Choir Drone and Noise Metal FX need sustained notes. All voices allow overlapping MIDI notes; bass auditions use monophonic patterns. Spatial processing is built in, while basses stay dry and centered.",
    "",
    "## Instruments and auditions",
    "",
    "| Instrument | Type / suggested MIDI register | Native export | WAV audition |",
    "| --- | --- | --- | --- |",
]
for spec in specs:
    d = spec["design"]
    slug = d["slug"]
    name = spec["name"].replace("EBM DW — ", "")
    lines.append(
        f"| {name} | {d['instrument_type']} · {d['register'][0]}–{d['register'][1]} | [Import](exports/{slug}.orch.instrument.json) | [Listen](auditions/{slug}.wav) |"
    )
lines += [
    "",
    "## Sound and controls",
    "",
    "Times are seconds unless labelled otherwise. Logarithmic controls have finer resolution at the low end. Chorus/Reverb/Echo/Space are bounded effect amounts, not calibrated wet percentages. Space controls the sound’s documented ambience; PWM Lead keeps a light chorus even with Space at zero.",
    "",
]
for spec in specs:
    d = spec["design"]
    slug = d["slug"]
    name = spec["name"].replace("EBM DW — ", "")
    lines += [
        f"### {name}",
        "",
        spec["description"],
        "",
        f"Source specification: [{slug}.json](specs/{slug}.json). The source `envelope` lists attack, decay, sustain and release; `design.controls` defines the rack knobs.",
        "",
        "| Knob | Range | Default | Scale |",
        "| --- | --- | --- | --- |",
    ]
    for key, c in d["controls"].items():
        lines.append(f"| {c['label']} | {c['min']:g}–{c['max']:g} | {c['default']:g} | {c['scale']} |")
    lines += [""]
lines += [
    "## Reproduce the pack",
    "",
    "Run from the repository root with its installed Python dependencies and Csound on PATH. The builder uses the [patch-creator skill](../../../integrations/skills/orchestron-patch-creator/SKILL.md) for its base specs, MIDI/envelope foundation, validation, backend client and compile preflight; it then adds the custom modulation/effect graph nodes. It does not edit SQLite or modify application code.",
    "",
    "```sh",
    "uv run python examples/instruments/ebm_darkwave/build_pack.py build",
    "uv run python examples/instruments/ebm_darkwave/audition_pack.py",
    "uv run python examples/instruments/ebm_darkwave/build_pack.py import",
    "uv run --project integrations/skills/orchestron-patch-creator --extra audio python examples/instruments/ebm_darkwave/spectrogram_pack.py",
    "uv run python examples/instruments/ebm_darkwave/document_pack.py",
    "```",
    "",
    "The importer accepts `--api-url` and records the saved IDs in `library_manifest.json`. Reruns update only those recorded IDs and check the existing name before writing. A different backend requires a separate pack checkout without that backend-specific manifest. Imports are paced to respect session admission limits. After an interrupted batch, use `--only` with the unfinished specification slugs to resume.",
    "",
    "All builders and renderers accept `--only` except this documentation generator. Add `--quick` to the audition command for a preliminary sound check; quick results cannot authorize import. A complete control sweep must pass against the current graph hash first.",
    "",
    "Native exports, default WAVs and MIDI, specifications, scripts, and compact reports are retained in the pack. Generated graphs, CSD/log files, full control-sweep WAVs, spectral images and review sheets are reproducible local intermediates ignored by Git. Full validation can use several gigabytes of disk space.",
    "",
    "## Validation",
    "",
    "See [validation results](validation/README.md). Auditions use real Csound 6.18 at 48 kHz, stereo, 32-bit float. The offline wrapper connects each unchanged Stereo Output to a monitor instrument; it does not add direct outputs to saved patch graphs.",
    "",
    "The checks cover note ranges, velocities 40/80/120, short retriggers, sixteenth-note patterns, chords where appropriate, controller minima/defaults/maxima, overlapping releases, DC, channel output and clipping. Percussive control probes include early note-off so Release is exercised before the envelope reaches zero.",
    "",
    "The final spectral review uses both channels with a fixed reference: Hann FFT 4096, hop 512, 128 Mel bands, 20–24,000 Hz, and −100–0 dB display limits. Spectrograms support inspection of pitch, movement, attacks and tails; they do not establish subjective sound quality. Actual listening is reported separately.",
    "",
]
(PACK / "README.md").write_text("\n".join(lines))
reports = {
    p.stem: json.loads(p.read_text())
    for p in (PACK / "validation").glob("*.json")
    if p.stem in [s["design"]["slug"] for s in specs]
}
rows = [
    "# Validation results",
    "",
    "| Instrument | Default peak (dBFS) | Worst tested peak (dBFS) | Numerical checks | Spectral review |",
    "| --- | ---: | ---: | --- | --- |",
]
for slug, r in sorted(reports.items()):
    rows.append(
        f"| {r['name']} | {r['results']['audition']['peak_dbfs']:.1f} | {max(v['peak_dbfs'] for v in r['results'].values()):.1f} | {'Pass' if r['passed'] else 'Pending'} | {'Inspected' if r.get('spectrograms_inspected') else 'Pending'} |"
    )
rows += [
    "",
    "Each instrument’s JSON report retains measured levels, controller overrides, source-graph hash, and local paths to its MIDI/WAV/CSD recordings and spectrograms.",
    "",
    "Frontend production build: **passed**. Docker `frontend-build` target: **passed**. Shared analog-drumkit build input preserved.",
    "",
    "Listening: **not performed by the agent**. The linked WAV auditions are available for listening and musical evaluation.",
    "",
    "Library import and native round trips are recorded in `../library_manifest.json`. Existing-library preservation is recorded in `library_preservation.json`. No performance or current rack is modified.",
    "",
]
(PACK / "validation" / "README.md").write_text("\n".join(rows))
print("Updated pack guide and validation summary")
