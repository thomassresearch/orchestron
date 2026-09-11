# Final Audio And Spectrogram Validation

Use this after creating a playable instrument and after its final sound correction. The utility analyzes an existing audio audition; it does not render MIDI, contact the backend, change patches, or assign a sound-quality score.

## Run The Utility

From this skill's directory:

```bash
uv run --extra audio python scripts/render_spectrograms.py audition.wav --out-dir spectrograms
```

From the VisualCSound repository root:

```bash
uv run --project integrations/skills/orchestron-patch-creator --extra audio python \
  integrations/skills/orchestron-patch-creator/scripts/render_spectrograms.py \
  examples/instruments/edm_techno_psy/auditions/psy_rotor_bass.wav \
  --out-dir /tmp/orchestron-spectrograms --n-fft 4096
```

From anywhere, using the installed global skill and an absolute audio path:

```bash
uv run --project "$HOME/.codex/skills/orchestron-patch-creator" --extra audio python \
  "$HOME/.codex/skills/orchestron-patch-creator/scripts/render_spectrograms.py" \
  /absolute/path/to/audition.wav --out-dir /tmp/orchestron-spectrograms
```

If skills are installed under a custom Codex home, substitute that skill directory. The global invocation does not require the VisualCSound checkout. `uv` installs the optional `audio` extra (NumPy, SoundFile, librosa and Matplotlib); normal patch CLI use does not require it. Use `--locked` with `uv run` when reproducing the checked-in dependency versions. No GUI or display server is required.

The script prints absolute paths to `<audio-stem>.mel.png` and `<audio-stem>.stft.png`. Each image has one panel per channel, sharing time, frequency and color limits. The original sample rate and channel signals are preserved; there is no downmix, resampling, trimming or amplitude normalization. WAV, including floating-point WAV, and other formats readable by [SoundFile](https://python-soundfile.readthedocs.io/en/latest/) are accepted. Input audio is never modified. Existing PNGs with the same names in the output directory are replaced; use separate output directories for auditions that share a filename.

## Options And Scales

| Argument | Default | Purpose |
| --- | --- | --- |
| `audio` | Required | Existing rendered audio file. |
| `--out-dir` | `./spectrograms` | Directory for the two PNGs; created when needed. |
| `--n-fft` | `2048` | Periodic Hann window length and FFT size in samples. |
| `--hop-length` | `256` | Frame spacing in samples; must be between 1 and FFT size. |
| `--n-mels` | `128` | Number of Slaney Mel bands. |
| `--fmin` | `20` | Lower displayed/analyzed Mel frequency in Hz; positive. |
| `--fmax` | Native Nyquist | Upper frequency in Hz; above `fmin` and at most half the sample rate. |
| `--vmin` | `-100` | Fixed color scale minimum in dB. |
| `--vmax` | `0` | Fixed color scale maximum in dB; greater than `vmin`. |

Both views use power in decibels, calculated with `10 * log10(power / 1.0)`. STFT power is `abs(STFT / sum(Hann window)) ** 2`. Mel power applies librosa's Slaney area-normalized Mel filter bank to that same STFT power before conversion. See the [STFT](https://librosa.org/doc/main/api/generated/librosa.stft.html) and [Mel spectrogram](https://librosa.org/doc/main/api/generated/librosa.feature.melspectrogram.html) references.

The colorbar reads **Power (dB re 1, window-normalized)**. These are spectral levels, not a calibrated dBFS meter or a loudness measurement. A bin-centered unit-peak sine has a positive-frequency STFT peak near −6.02 dB with this convention. Mel levels differ because of filter weighting. Compare like views using identical settings: halving amplitude reduces either view by approximately 6.02 dB away from silence. The reference and color limits never follow the recording's peak. Zero power uses a finite numerical floor below the displayed range; silence stays dark.

The Mel view uses a Mel frequency scale labelled in Hz. The STFT view uses a logarithmic frequency axis, omits DC, and retains individual FFT bins. This improves harmonic visibility without adding frequency resolution. At 48 kHz, FFT 2048 spans about 42.7 ms with 23.4 Hz bin spacing; 4096 spans 85.3 ms with 11.7 Hz spacing. Use a larger FFT for bass harmonics and a smaller one for short attacks. Reducing the hop adds time samples but does not improve the window's time/frequency resolution. Very short clips and boundaries are zero-padded, so boundary smearing is expected. If librosa warns about empty Mel filters, increase FFT size or reduce Mel bands for that sample rate and frequency range.

## Last Test After Instrument Creation

1. Render representative MIDI notes, velocities, retriggers and chords as appropriate. Include note-off and sufficient time for the full release, delay feedback and reverb tail to finish. Retain the audition and the settings that produced it.
2. Complete numerical checks first: finite samples, clipping/headroom, expected channel output and velocity response. Audition relevant [performance-controller](performance_controllers.md#final-controller-auditions) minimum/default/maximum settings with matching MIDI timings, velocities and total duration. Keep enough tail time for the longest setting. Perform listening checks when available and record whether listening actually occurred.
3. **As the last test, generate and open both PNGs with the available image viewer** (for example `view_image` for local files). Inspect the actual images, not just file existence. Compare harmonic/pitch evolution, brightness and modulation to the intended sound; check both channel panels, note attacks, repeated echoes, gaps and tail decay. Keep sample rate, FFT, hop, Mel bands, frequency limits and color limits identical across comparison renders.
4. Investigate unexpected broadband bursts, persistent tones, missing channels or sudden tail endings against the MIDI timing and numerical checks. Such patterns are clues, not automatic failures: intentional distortion, noise and abrupt percussion can produce similar features. Correct the relevant sound issue within the task's authorized scope, rerender, and repeat the final checks.

Report what was rendered, numerically measured, visually inspected and listened to separately. Generating spectrograms alone is not inspection, and inspecting them does not establish pleasant sound, absence of aliasing, phase compatibility or absence of clipping. Incomplete templates are exempt from a playable audition. If rendering or viewing is unavailable, state the unperformed check instead of claiming a pass.

## Utility Verification

From the skill directory, run its existing CLI tests and synthetic audio regression tests together:

```bash
uv run --extra audio python -m unittest discover -s tests -v
```

The audio tests cover frequency placement, fixed-reference level changes, stereo separation, sweeps, delayed decay, silence, short clips, PNG output and invalid input. Without the optional audio extra those tests are explicitly skipped; run with the extra to validate changes to this utility.
