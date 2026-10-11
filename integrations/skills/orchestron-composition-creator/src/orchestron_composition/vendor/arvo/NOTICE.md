# arvo compatibility copy

Source: [Georges Dimitrov's arvo](https://github.com/georgesdimitrov/arvo),
PyPI release **0.3.0**, source archive SHA256
`5cd65d4fa1d4e5e189517ad86145ed292d6c762c3d56df2c021da949810037f0`.
The accompanying MIT license applies to these files.

Changes for music21 10.5.0: `.flat` becomes `.flatten()`, scale `.next()` becomes
`.nextPitch()`, scale direction strings become `scale.Direction` members, and
internal arvo imports become relative imports. No global monkey patches or
installed third-party files are modified. Algorithm semantics remain upstream's:
in particular, minimalism operates on notes rather than rest events. The
composition generator applies its output to explicit rhythmic slots to preserve
rests, phrase length and locked material. Tests cover the compatibility surface.
