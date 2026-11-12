# Trance Gate — Technical Background

Technical material retained during the manual reorganization. Historical version numbers describe the source snapshot, not the current support matrix. Consult [AGENTS.md](../../AGENTS.md) and its linked source contracts when changing behavior.

For pan position `p` and Stereo `s`, left gain is `1 − s × p` and right gain is `1 − s × (1 − p)`, applied after the shared gate envelope. This adds no gain or crossfeed. The stable performance-controller ID is `tg_stereo`; its **Live** setting takes effect during realtime playback. Random choices belong to each instance and are not saved automation, so separate renders can choose different manual positions.

Two `ctrl7` readers feed the direct gain and the Orchestron **swept_gate** node. This application-defined Csound UDO keeps its state per instance and computes triangle phase and frequency travel with local `ksmps=1`. The command reader retains the host's control-block timing. Its binary audio-rate output combines with the direct gain before the existing `follow2` envelope and separate stereo multipliers. The Pan output controls the two final balance multipliers; a local `rand` noise stream and `samphold` choose each manual opening’s position.

Rebuild the authoring payloads and native export with `.venv/bin/python tools/trance_gate/build.py`. The builder compiles before writing files and does not write the library. Automated audio tests use independent versioned original and extended fixtures, checking sweep timing against an analytic phase integral and verifying sample-identical CC24-only playback. See [Csound local control periods](https://csound.com/docs/manual/setksmps.html) and [follow2](https://csound.com/docs/manual/follow2.html).
