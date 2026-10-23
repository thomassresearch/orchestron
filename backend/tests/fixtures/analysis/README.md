# Synthetic adsyn fixture

`decaying-sine.het` contains one 440 Hz partial analyzed from a generated,
mono, 48 kHz, 16-bit WAV. It contains no recorded or third-party material.
Source samples: `round(7000 * exp(-4*n/48000) * sin(2*pi*440*n/48000))`,
for `n=0..47999`. Generated with Csound 6.18:

```sh
csound -U hetro -f440 -h1 -n64 -m0 source.wav decaying-sine.het
```

The file uses Csound’s portable ASCII `HETRO 1` format with integer breakpoint values.
Tests cover pitch/amplitude scaling, faster envelope traversal, branch use,
and managed asset packaging. Tests never read developer examples.
