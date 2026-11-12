# Stereo Delay — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

The four per-instance settings use stable IDs `sd_tempo`, `sd_beats`,
`sd_feedback` and `sd_stereo`. Native instrument/performance bundles and both
CSD export modes retain the controls and selected instance values.

Each input channel has separate odd- and even-echo streams. A feedback delay at
twice the interval generates the even echoes; a second delay fills the odd
positions. A one-sample seed delay and matching feedback-loop compensation keep
successive echoes on the selected sample interval. The dry path bypasses these
delays and the panning formulas.

The graph uses existing `delay`, `flanger`, `upsamp`, `mix2`, `inleta`, `outleta`
and `perf_controller` nodes. See the [example and validation guide](../../examples/instruments/stereo_delay/README.md)
for reproducible renders and tests. Long intervals with high Feedback need long
render tails; the instrument does not extend the export duration automatically.
