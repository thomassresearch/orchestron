# Tools

Documentation tooling and native macOS MIDI diagnostics.

## User manual

`documentation/manual.json` is the only source of inclusion, reading order and parentage.
Its `root` is an ordered tree of `{ "path": "...md", "children": [...] }` entries;
paths are relative to `documentation/`. Titles come from each page's opening H1.
Every Markdown file under that directory must appear exactly once in the tree or in
`excluded` with a nonempty `reason`. Keep developer material in `specifications/`
or other technical references outside the manual.

When adding or reordering a page:

1. Update the manifest, including a reason for any exclusion.
2. Update each affected page's top and bottom `**Navigation:**` line. **Up** points
   to its manifest parent; **Previous** and **Next** follow the complete preorder sequence.
   The bottom navigation must follow all content. `navigation()` in `tools/manual.mjs`
   returns the required line.
3. Update direct child lists between `manual-contents:start` / `manual-contents:end`
   comments in each parent. `contents()` returns the required block.
4. Preserve referenced heading anchors when renaming sections, with standalone
   `<a id="old-anchor"></a>` aliases or coordinated reference updates. Place screenshots
   beside their explanation, without a Screenshot/Screenshots heading. The manual is English-only.
5. Run `make docs-check`, then `git diff --check`.

`make docs-check` uses only Node and Python standard libraries. It validates coverage,
navigation, local links, heading anchors, images and prohibited headings, and runs the
manifest/link tests and save-hook regressions. No backend, audio engine or PDF renderer is needed.
CI runs it for documentation and related tooling changes.

Build with `node tools/build_user_docs_pdf.mjs` (requires `wkhtmltopdf`). Existing
`--output`, `--logo`, `--title` and `--keep-temp` options remain available. `--input`
selects a declared page and its descendants; excluded/unknown inputs fail.
`--check` validates without rendering. Cross-references never change the selected pages.
Links to selected pages retain their heading destinations; other repository files become
repository URLs in the PDF. An HTML architecture guide must be downloaded and opened locally.

The PDF preserves the custom dotted contents and cover/header/footer layout. Heading levels
follow manifest depth. Page-number reconciliation checks the entire rendered heading sequence
against wkhtmltopdf's outline, including nested and repeated headings. After rebuilding,
inspect the complete contents, chapter starts, nested guide entries and changed image layouts.

For an independent PDF audit, build with `--keep-temp` and run
`uv run --with pypdf python tools/check_user_docs_pdf.py --build-dir <printed-directory>`.
It checks the rendered contents numbers, both links on every contents row, all internal
link destinations, and bookmark parentage against the manifest. Visual inspection is still required.

The [retained technical background](../specifications/manual-reference/README.md) contains
material removed from the end-user guide. Current behavior is defined by the linked source
contracts; historical format descriptions there are not a current compatibility matrix.

## Contents

- `midi_pulse.c`: MIDI note pulse sender (CoreMIDI output)
- `midi_stats.c`: MIDI note-on receiver statistics probe (CoreMIDI input)

## Build

From project root:

```bash
make midi-pulse-build
make midi-stats-build
```

Binaries:

- `./tools/midi_pulse`
- `./tools/midi_stats`

## `midi_pulse` (sender)

List destinations:

```bash
./tools/midi_pulse --list
```

Example:

```bash
./tools/midi_pulse --dest 0 --channel 1 --note 60 --interval-ms 5 --gate 0.2 --count 5000 --report-every 250
```

Useful options:

- `--dest <name|index>`
- `--channel <1-16>`
- `--interval-ms <ms>`
- `--gate <0.0-1.0>`
- `--count <N>`
- `--report-every <N>`
- `--verbose`

## `midi_stats` (receiver)

List sources:

```bash
./tools/midi_stats --list
```

Example:

```bash
./tools/midi_stats --dest 0 --channel 1 --report-every 250
```

Useful options:

- `--dest <name|index>`
- `--channel <1-16>`
- `--report-every <N>`
- `--count <N>`

What it reports:

- Event interval statistics: mean/std/min/max (ms)
- Jitter statistics vs first observed interval: ref/mean/abs_mean/std/min/max (ms)
- Timestamp coverage: how many events have non-zero CoreMIDI timestamps (`ts_ratio`)
- `timestamp_only` stats: interval/jitter computed only from event timestamps
- `arrival_vs_timestamp` stats: callback arrival time minus event timestamp

## Typical workflow

Terminal 1 (receiver):

```bash
./tools/midi_stats --dest 0 --channel 1 --report-every 250
```

Terminal 2 (sender):

```bash
./tools/midi_pulse --dest 0 --channel 1 --interval-ms 5 --gate 0.2 --count 5000 --report-every 250
```

Use the same MIDI bus/device and channel on both commands.
