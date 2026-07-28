# Standard Always-On Effect Patching

Every Orchestron performance should include these always-on patches:

- `reverb effect`
- `compressor effect`
- `speaker output`

Use `orchestron_cli edit add-standard-effects` after adding playable instruments. The command is an idempotent convenience preset built on the same generic route operations documented in `effect_routing.md`. It adds the three effect patches and creates this matrix:

1. Instrument effect-send outlets, normally `sendl` and `sendr`, route to the `reverb effect` inputs.
2. Instrument dry outlets, normally `dryl` and `dryr`, plus reverb outputs route to the `compressor effect` inputs.
3. Compressor outputs route to the `speaker output` inputs.

Route entries use the actual `outleta` labels from each source patch. Labels may differ by patch; the compiler maps exact matches first, then stereo-style names such as `dryl`/`dryr`, `sendl`/`sendr`, `left`/`right`, or `l`/`r` onto the target `inleta` labels.

If a playable instrument still outputs directly through `outs`, duplicate the patch with suffix `_new` and replace each `outs` node with four `outleta` nodes:

- Former `outs.left` source -> `dryl`
- Former `outs.left` source -> `sendl` with input formula `0.1 * in1`
- Former `outs.right` source -> `dryr`
- Former `outs.right` source -> `sendr` with input formula `0.1 * in1`

The CLI performs this conversion automatically when building the standard effect matrix, updates the instrument assignment to the `_new` patch, and embeds all selected patch definitions when the performance is committed.

By default, rerunning the command rebuilds incoming routes on the three standard targets while preserving unrelated effect assignments. Pass `--merge` to preserve additional custom routes already attached to those standard targets. Inspect the result with:

```bash
orchestron_cli --json edit instruments list
orchestron_cli --json edit routes list
orchestron_cli --json edit validate
```
