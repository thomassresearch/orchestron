from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re

from backend.app.models.opcode import OpcodeSpec, PortSpec, SignalType

CSOUND_OVERVIEW_URL = "https://csound.com/docs/manual/PartOpcodesOverview.html"
OPCODE_REFERENCE_URLS: dict[str, str] = {
    "adsr": "https://csound.com/docs/manual/madsr.html",
    "oscili": "https://csound.com/docs/manual/oscili.html",
    "lfo": "https://csound.com/docs/manual/lfo.html",
    "poscil3": "https://csound.com/docs/manual/poscil3.html",
    "vibr": "https://csound.com/docs/manual/vibr.html",
    "vibrato": "https://csound.com/docs/manual/vibrato.html",
    "fmb3": "https://csound.com/docs/manual/fmb3.html",
    "fmbell": "https://csound.com/docs/manual/fmbell.html",
    "fmmetal": "https://csound.com/docs/manual/fmmetal.html",
    "fmpercfl": "https://csound.com/docs/manual/fmpercfl.html",
    "fmrhode": "https://csound.com/docs/manual/fmrhode.html",
    "fmvoice": "https://csound.com/docs/manual/fmvoice.html",
    "fmwurlie": "https://csound.com/docs/manual/fmwurlie.html",
    "madsr": "https://csound.com/docs/manual/madsr.html",
    "mxadsr": "https://csound.com/docs/manual/mxadsr.html",
    "pinker": "https://csound.com/docs/manual/pinker.html",
    "noise": "https://csound.com/docs/manual/noise.html",
    "pluck": "https://csound.com/docs/manual/pluck.html",
    "wgflute": "https://csound.com/docs/manual/wgflute.html",
    "wguide2": "https://csound.com/docs/manual/wguide2.html",
    "pan2": "https://csound.com/docs/manual/pan2.html",
    "vdelay3": "https://csound.com/docs/manual/vdelay3.html",
    "flanger": "https://csound.com/docs/manual/flanger.html",
    "comb": "https://csound.com/docs/manual/comb.html",
    "reverb2": "https://csound.com/docs/manual/reverb2.html",
    "limit": "https://csound.com/docs/manual/limit.html",
    "exciter": "https://csound.com/docs/manual/exciter.html",
    "vco": "https://csound.com/docs/manual/vco.html",
    "ftgen": "https://csound.com/docs/manual/ftgen.html",
    "cpsmidi": "https://csound.com/docs/manual/cpsmidi.html",
    "midictrl": "https://csound.com/docs/manual/midictrl.html",
    "k_to_a": "https://csound.com/docs/manual/interp.html",
    "moogladder": "https://csound.com/docs/manual/moogladder.html",
    "outs": "https://csound.com/docs/manual/outs.html",
    "midi_note": "https://csound.com/docs/manual/cpsmidi.html",
}


class OpcodeService:
    def __init__(self, icon_prefix: str) -> None:
        self._icon_prefix = icon_prefix.rstrip("/")
        self._documentation = self._load_opcode_documentation()
        self._opcodes = {opcode.name: opcode for opcode in self._load_builtin_opcodes()}

    def list_opcodes(self, category: str | None = None) -> list[OpcodeSpec]:
        opcodes = list(self._opcodes.values())
        if category:
            opcodes = [opcode for opcode in opcodes if opcode.category == category]
        return sorted(opcodes, key=lambda item: (item.category, item.name))

    def get_opcode(self, name: str) -> OpcodeSpec | None:
        return self._opcodes.get(name)

    def categories(self) -> dict[str, int]:
        counters: dict[str, int] = defaultdict(int)
        for opcode in self._opcodes.values():
            counters[opcode.category] += 1
        return dict(sorted(counters.items(), key=lambda kv: kv[0]))

    def _icon(self, filename: str) -> str:
        return f"{self._icon_prefix}/{filename}"

    def _spec(self, **kwargs: object) -> OpcodeSpec:
        name = str(kwargs["name"])
        description = str(kwargs.get("description", "")).strip()
        fallback_reference = self._reference_url(name)
        documentation_markdown = self._documentation.get(name)
        if not documentation_markdown:
            documentation_markdown = (
                f"### `{name}`\n\n{description}\n\n"
                f"**Reference**\n- [Csound opcode overview]({fallback_reference})"
            )

        return OpcodeSpec(
            documentation_markdown=documentation_markdown,
            documentation_url=fallback_reference,
            **kwargs,
        )

    def _reference_url(self, opcode_name: str) -> str:
        return OPCODE_REFERENCE_URLS.get(opcode_name, CSOUND_OVERVIEW_URL)

    @staticmethod
    def _load_opcode_documentation() -> dict[str, str]:
        docs_path = Path(__file__).resolve().parents[3] / "ADD_OPCODES.md"
        if not docs_path.exists():
            return {}

        text = docs_path.read_text(encoding="utf-8")
        matches = list(re.finditer(r"^### `([^`]+)`.*$", text, flags=re.MULTILINE))
        if not matches:
            return {}

        docs: dict[str, str] = {}
        for index, match in enumerate(matches):
            opcode_name = match.group(1).strip()
            start = match.start()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            section = text[start:end].strip()
            docs[opcode_name] = section
        return docs

    def _load_builtin_opcodes(self) -> list[OpcodeSpec]:
        return [
            self._spec(
                name="midi_note",
                category="midi",
                description="Extract MIDI note frequency and velocity amplitude.",
                icon=self._icon("midi_note.svg"),
                inputs=[
                    PortSpec(id="gain", name="Gain", signal_type=SignalType.INIT, required=False, default=1),
                ],
                outputs=[
                    PortSpec(id="kfreq", name="kFreq", signal_type=SignalType.CONTROL),
                    PortSpec(id="kamp", name="kAmp", signal_type=SignalType.CONTROL),
                ],
                template="{kfreq} cpsmidi\n{kamp} ampmidi {gain}",
                tags=["performance", "source"],
            ),
            self._spec(
                name="adsr",
                category="envelope",
                description="Control-rate ADSR envelope.",
                icon=self._icon("adsr.svg"),
                inputs=[
                    PortSpec(id="iatt", name="Attack", signal_type=SignalType.INIT, default=0.01),
                    PortSpec(id="idec", name="Decay", signal_type=SignalType.INIT, default=0.15),
                    PortSpec(id="islev", name="Sustain", signal_type=SignalType.INIT, default=0.7),
                    PortSpec(id="irel", name="Release", signal_type=SignalType.INIT, default=0.2),
                ],
                outputs=[PortSpec(id="kenv", name="kEnv", signal_type=SignalType.CONTROL)],
                template="{kenv} madsr {iatt}, {idec}, {islev}, {irel}",
                tags=["control", "modulation"],
            ),
            self._spec(
                name="madsr",
                category="envelope",
                description="MIDI release-sensitive ADSR envelope.",
                icon=self._icon("adsr.svg"),
                inputs=[
                    PortSpec(id="iatt", name="Attack", signal_type=SignalType.INIT, default=0.01),
                    PortSpec(id="idec", name="Decay", signal_type=SignalType.INIT, default=0.15),
                    PortSpec(id="islev", name="Sustain", signal_type=SignalType.INIT, default=0.7),
                    PortSpec(id="irel", name="Release", signal_type=SignalType.INIT, default=0.2),
                    PortSpec(id="idel", name="Delay", signal_type=SignalType.INIT, required=False, default=0),
                ],
                outputs=[PortSpec(id="kenv", name="kEnv", signal_type=SignalType.CONTROL)],
                template="{kenv} madsr {iatt}, {idec}, {islev}, {irel}, {idel}",
                tags=["control", "modulation"],
            ),
            self._spec(
                name="mxadsr",
                category="envelope",
                description="Extended MIDI release-sensitive ADSR envelope.",
                icon=self._icon("adsr.svg"),
                inputs=[
                    PortSpec(id="iatt", name="Attack", signal_type=SignalType.INIT, default=0.01),
                    PortSpec(id="idec", name="Decay", signal_type=SignalType.INIT, default=0.15),
                    PortSpec(id="islev", name="Sustain", signal_type=SignalType.INIT, default=0.7),
                    PortSpec(id="irel", name="Release", signal_type=SignalType.INIT, default=0.2),
                    PortSpec(id="idel", name="Delay", signal_type=SignalType.INIT, required=False, default=0),
                    PortSpec(id="iatss", name="AttackScale", signal_type=SignalType.INIT, required=False, default=0),
                    PortSpec(id="idrss", name="ReleaseScale", signal_type=SignalType.INIT, required=False, default=0),
                ],
                outputs=[PortSpec(id="kenv", name="kEnv", signal_type=SignalType.CONTROL)],
                template="{kenv} mxadsr {iatt}, {idec}, {islev}, {irel}, {idel}, {iatss}, {idrss}",
                tags=["control", "modulation"],
            ),
            self._spec(
                name="oscili",
                category="oscillator",
                description="Classic interpolating oscillator.",
                icon=self._icon("oscili.svg"),
                inputs=[
                    PortSpec(id="amp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="freq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="ifn", name="FunctionTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} oscili {amp}, {freq}, {ifn}",
                tags=["sound", "source"],
            ),
            self._spec(
                name="poscil3",
                category="oscillator",
                description="High-precision cubic interpolating oscillator.",
                icon=self._icon("oscili.svg"),
                inputs=[
                    PortSpec(
                        id="amp",
                        name="Amplitude",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=0.4,
                    ),
                    PortSpec(
                        id="freq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="ifn", name="FunctionTable", signal_type=SignalType.INIT, required=False, default=1),
                    PortSpec(id="iphs", name="Phase", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} poscil3 {amp}, {freq}, {ifn}, {iphs}",
                tags=["sound", "source"],
            ),
            self._spec(
                name="lfo",
                category="modulation",
                description="Low-frequency oscillator for control-rate modulation.",
                icon=self._icon("oscili.svg"),
                inputs=[
                    PortSpec(
                        id="kamp",
                        name="Amplitude",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=0.5,
                    ),
                    PortSpec(
                        id="kcps",
                        name="Rate",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=5,
                    ),
                    PortSpec(id="itype", name="Waveform", signal_type=SignalType.INIT, required=False, default=0),
                ],
                outputs=[PortSpec(id="kout", name="kOut", signal_type=SignalType.CONTROL)],
                template="{kout} lfo {kamp}, {kcps}, {itype}",
                tags=["control", "modulation", "lfo"],
            ),
            self._spec(
                name="vibr",
                category="modulation",
                description="Simple vibrato control oscillator with table lookup.",
                icon=self._icon("oscili.svg"),
                inputs=[
                    PortSpec(
                        id="amp",
                        name="Amplitude",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=0.01,
                    ),
                    PortSpec(
                        id="cps",
                        name="Rate",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=6,
                    ),
                    PortSpec(id="ifn", name="FunctionTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="iphs", name="Phase", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="kout", name="kOut", signal_type=SignalType.CONTROL)],
                template="{kout} vibr {amp}, {cps}, {ifn}, {iphs}",
                tags=["control", "modulation", "vibrato"],
            ),
            self._spec(
                name="vibrato",
                category="modulation",
                description="Randomized vibrato generator.",
                icon=self._icon("oscili.svg"),
                inputs=[
                    PortSpec(id="kavgamp", name="AverageAmp", signal_type=SignalType.CONTROL, default=0.01),
                    PortSpec(id="kavgfreq", name="AverageFreq", signal_type=SignalType.CONTROL, default=6),
                    PortSpec(id="krandamp", name="RandAmp", signal_type=SignalType.CONTROL, default=0.05),
                    PortSpec(id="krandfreq", name="RandFreq", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="kampminrate", name="AmpMinRate", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kampmaxrate", name="AmpMaxRate", signal_type=SignalType.CONTROL, default=7),
                    PortSpec(id="kcpsminrate", name="FreqMinRate", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kcpsmaxrate", name="FreqMaxRate", signal_type=SignalType.CONTROL, default=7),
                    PortSpec(id="ifn", name="FunctionTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="kout", name="kOut", signal_type=SignalType.CONTROL)],
                template=(
                    "{kout} vibrato {kavgamp}, {kavgfreq}, {krandamp}, {krandfreq}, {kampminrate}, "
                    "{kampmaxrate}, {kcpsminrate}, {kcpsmaxrate}, {ifn}"
                ),
                tags=["control", "modulation", "vibrato"],
            ),
            self._spec(
                name="fmb3",
                category="fm",
                description="B3 organ FM model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kindex", name="ModIndex", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="kcrossfreq", name="CrossFreq", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="ifn1", name="CarrierTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ifn2", name="ModTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ivfn", name="VibratoTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} fmb3 {kamp}, {kfreq}, {kindex}, {kcrossfreq}, {ifn1}, {ifn2}, {ivfn}",
                tags=["sound", "fm", "source"],
            ),
            self._spec(
                name="fmbell",
                category="fm",
                description="Bell FM model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kc1", name="CarrierRatio1", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="kc2", name="CarrierRatio2", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kvdepth", name="VibratoDepth", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="ifn1", name="CarrierTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ifn2", name="ModTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ivfn", name="VibratoTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} fmbell {kamp}, {kfreq}, {kc1}, {kc2}, {kvdepth}, {ifn1}, {ifn2}, {ivfn}",
                tags=["sound", "fm", "source"],
            ),
            self._spec(
                name="fmmetal",
                category="fm",
                description="Metallic FM model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kc1", name="CarrierRatio1", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="kc2", name="CarrierRatio2", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kvdepth", name="VibratoDepth", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="ifn1", name="CarrierTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ifn2", name="ModTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ivfn", name="VibratoTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} fmmetal {kamp}, {kfreq}, {kc1}, {kc2}, {kvdepth}, {ifn1}, {ifn2}, {ivfn}",
                tags=["sound", "fm", "source"],
            ),
            self._spec(
                name="fmpercfl",
                category="fm",
                description="Percussive flute FM model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kc1", name="CarrierRatio1", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="kc2", name="CarrierRatio2", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kvdepth", name="VibratoDepth", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="ifn1", name="CarrierTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ifn2", name="ModTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ivfn", name="VibratoTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} fmpercfl {kamp}, {kfreq}, {kc1}, {kc2}, {kvdepth}, {ifn1}, {ifn2}, {ivfn}",
                tags=["sound", "fm", "source"],
            ),
            self._spec(
                name="fmrhode",
                category="fm",
                description="Rhodes electric piano FM model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kc1", name="CarrierRatio1", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="kc2", name="CarrierRatio2", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kvdepth", name="VibratoDepth", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="ifn1", name="CarrierTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ifn2", name="ModTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ivfn", name="VibratoTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} fmrhode {kamp}, {kfreq}, {kc1}, {kc2}, {kvdepth}, {ifn1}, {ifn2}, {ivfn}",
                tags=["sound", "fm", "source"],
            ),
            self._spec(
                name="fmvoice",
                category="fm",
                description="Voice-like FM model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kc1", name="CarrierRatio1", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="kc2", name="CarrierRatio2", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kvdepth", name="VibratoDepth", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="ifn1", name="CarrierTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ifn2", name="ModTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ivfn", name="VibratoTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} fmvoice {kamp}, {kfreq}, {kc1}, {kc2}, {kvdepth}, {ifn1}, {ifn2}, {ivfn}",
                tags=["sound", "fm", "source"],
            ),
            self._spec(
                name="fmwurlie",
                category="fm",
                description="Wurlitzer electric piano FM model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kc1", name="CarrierRatio1", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="kc2", name="CarrierRatio2", signal_type=SignalType.CONTROL, default=3),
                    PortSpec(id="kvdepth", name="VibratoDepth", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="ifn1", name="CarrierTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ifn2", name="ModTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="ivfn", name="VibratoTable", signal_type=SignalType.INIT, default=1),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} fmwurlie {kamp}, {kfreq}, {kc1}, {kc2}, {kvdepth}, {ifn1}, {ifn2}, {ivfn}",
                tags=["sound", "fm", "source"],
            ),
            self._spec(
                name="vco",
                category="oscillator",
                description="Band-limited voltage-controlled oscillator.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="amp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.4),
                    PortSpec(
                        id="freq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(
                        id="iwave",
                        name="Waveform",
                        signal_type=SignalType.INIT,
                        required=False,
                        default=1,
                    ),
                    PortSpec(
                        id="kpw",
                        name="PulseWidth",
                        signal_type=SignalType.CONTROL,
                        required=False,
                        default=0.5,
                    ),
                    PortSpec(
                        id="ifn",
                        name="FunctionTable",
                        signal_type=SignalType.INIT,
                        required=False,
                    ),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} vco {amp}, {freq}, {iwave}, {kpw}, {ifn}",
                tags=["sound", "source"],
            ),
            self._spec(
                name="ftgen",
                category="tables",
                description="Create a function table at init time using a GEN routine.",
                icon=self._icon("ftgen.svg"),
                inputs=[
                    PortSpec(id="ifn", name="TableNumber", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="itime", name="StartTime", signal_type=SignalType.INIT, default=0),
                    PortSpec(id="isize", name="TableSize", signal_type=SignalType.INIT, default=16384),
                    PortSpec(id="igen", name="GenRoutine", signal_type=SignalType.INIT, default=10),
                    PortSpec(id="iarg1", name="Arg1", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="iarg2", name="Arg2", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iarg3", name="Arg3", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iarg4", name="Arg4", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iarg5", name="Arg5", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iarg6", name="Arg6", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iarg7", name="Arg7", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iarg8", name="Arg8", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="ift", name="iFn", signal_type=SignalType.INIT)],
                template=(
                    "{ift} ftgen {ifn}, {itime}, {isize}, {igen}, {iarg1}, "
                    "{iarg2}, {iarg3}, {iarg4}, {iarg5}, {iarg6}, {iarg7}, {iarg8}"
                ),
                tags=["source", "tables", "gen"],
            ),
            self._spec(
                name="cpsmidi",
                category="midi",
                description="Read active MIDI note pitch as cycles-per-second.",
                icon=self._icon("cpsmidi.svg"),
                inputs=[],
                outputs=[PortSpec(id="kfreq", name="iFreq", signal_type=SignalType.INIT)],
                template="{kfreq} cpsmidi",
                tags=["performance", "source"],
            ),
            self._spec(
                name="midictrl",
                category="midi",
                description="Read a MIDI controller value with optional scaling.",
                icon=self._icon("midictrl.svg"),
                inputs=[
                    PortSpec(id="inum", name="Controller", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="imin", name="Min", signal_type=SignalType.INIT, required=False, default=0),
                    PortSpec(id="imax", name="Max", signal_type=SignalType.INIT, required=False, default=127),
                ],
                outputs=[PortSpec(id="kval", name="kVal", signal_type=SignalType.CONTROL)],
                template="{kval} midictrl {inum}, {imin}, {imax}",
                tags=["performance", "modulation"],
            ),
            self._spec(
                name="k_mul",
                category="math",
                description="Multiply two control signals.",
                icon=self._icon("k_mul.svg"),
                inputs=[
                    PortSpec(id="a", name="A", signal_type=SignalType.CONTROL),
                    PortSpec(id="b", name="B", signal_type=SignalType.CONTROL),
                ],
                outputs=[PortSpec(id="kout", name="kOut", signal_type=SignalType.CONTROL)],
                template="{kout} = ({a}) * ({b})",
                tags=["utility"],
            ),
            self._spec(
                name="a_mul",
                category="math",
                description="Multiply two audio signals.",
                icon=self._icon("a_mul.svg"),
                inputs=[
                    PortSpec(id="a", name="A", signal_type=SignalType.AUDIO),
                    PortSpec(id="b", name="B", signal_type=SignalType.AUDIO),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} = ({a}) * ({b})",
                tags=["utility"],
            ),
            self._spec(
                name="k_to_a",
                category="utility",
                description="Interpolate control signal to audio-rate.",
                icon=self._icon("k_to_a.svg"),
                inputs=[PortSpec(id="kin", name="kIn", signal_type=SignalType.CONTROL)],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} interp {kin}",
                tags=["conversion"],
            ),
            self._spec(
                name="moogladder",
                category="filter",
                description="Moog ladder low-pass filter.",
                icon=self._icon("moogladder.svg"),
                inputs=[
                    PortSpec(id="ain", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(id="kcf", name="Cutoff", signal_type=SignalType.CONTROL, default=2000),
                    PortSpec(id="kres", name="Resonance", signal_type=SignalType.CONTROL, default=0.2),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} moogladder {ain}, {kcf}, {kres}",
                tags=["tone"],
            ),
            self._spec(
                name="pinker",
                category="noise",
                description="Pink noise generator.",
                icon=self._icon("oscili.svg"),
                inputs=[],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} pinker",
                tags=["noise", "source"],
            ),
            self._spec(
                name="noise",
                category="noise",
                description="Variable-color random audio noise.",
                icon=self._icon("oscili.svg"),
                inputs=[
                    PortSpec(
                        id="amp",
                        name="Amplitude",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=0.25,
                    ),
                    PortSpec(
                        id="beta",
                        name="Color",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.CONTROL, SignalType.INIT],
                        default=0,
                    ),
                    PortSpec(id="iseed", name="Seed", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iskip", name="SkipInit", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} noise {amp}, {beta}, {iseed}, {iskip}",
                tags=["noise", "source"],
            ),
            self._spec(
                name="pluck",
                category="physical_modeling",
                description="Karplus-Strong plucked-string model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.3),
                    PortSpec(
                        id="kcps",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=220,
                    ),
                    PortSpec(id="icps", name="InitFrequency", signal_type=SignalType.INIT, default=220),
                    PortSpec(id="ifn", name="FunctionTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="imeth", name="Method", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="iparm1", name="MethodParam", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template="{asig} pluck {kamp}, {kcps}, {icps}, {ifn}, {imeth}, {iparm1}",
                tags=["sound", "physical-modeling", "source"],
            ),
            self._spec(
                name="wgflute",
                category="physical_modeling",
                description="Waveguide flute model.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="kamp", name="Amplitude", signal_type=SignalType.CONTROL, default=0.3),
                    PortSpec(
                        id="kfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=440,
                    ),
                    PortSpec(id="kjet", name="Jet", signal_type=SignalType.CONTROL, default=0.2),
                    PortSpec(id="iatt", name="Attack", signal_type=SignalType.INIT, default=0.03),
                    PortSpec(id="idetk", name="Detune", signal_type=SignalType.INIT, default=0.1),
                    PortSpec(id="kngain", name="NoiseGain", signal_type=SignalType.CONTROL, default=0.1),
                    PortSpec(id="kvibf", name="VibratoRate", signal_type=SignalType.CONTROL, default=5),
                    PortSpec(id="kvamp", name="VibratoDepth", signal_type=SignalType.CONTROL, default=0.02),
                    PortSpec(id="ifn", name="FunctionTable", signal_type=SignalType.INIT, default=1),
                    PortSpec(id="iminfreq", name="MinFreq", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="asig", name="aSig", signal_type=SignalType.AUDIO)],
                template=(
                    "{asig} wgflute {kamp}, {kfreq}, {kjet}, {iatt}, {idetk}, {kngain}, "
                    "{kvibf}, {kvamp}, {ifn}, {iminfreq}"
                ),
                tags=["sound", "physical-modeling", "source"],
            ),
            self._spec(
                name="wguide2",
                category="physical_modeling",
                description="Two-point waveguide resonator.",
                icon=self._icon("vco.svg"),
                inputs=[
                    PortSpec(id="asig", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(
                        id="xfreq",
                        name="Frequency",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=220,
                    ),
                    PortSpec(
                        id="xcutoff",
                        name="Cutoff",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=4000,
                    ),
                    PortSpec(id="kfeedback", name="Feedback", signal_type=SignalType.CONTROL, default=0.5),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} wguide2 {asig}, {xfreq}, {xcutoff}, {kfeedback}",
                tags=["physical-modeling", "resonator"],
            ),
            self._spec(
                name="vdelay3",
                category="delay",
                description="Variable delay line with cubic interpolation.",
                icon=self._icon("moogladder.svg"),
                inputs=[
                    PortSpec(id="asig", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(
                        id="adel",
                        name="DelayTime",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=20,
                    ),
                    PortSpec(id="imd", name="MaxDelay", signal_type=SignalType.INIT, default=100),
                    PortSpec(id="iws", name="WindowSize", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} vdelay3 {asig}, {adel}, {imd}, {iws}",
                tags=["delay", "effect"],
            ),
            self._spec(
                name="flanger",
                category="delay",
                description="Flanger effect with delay modulation and feedback.",
                icon=self._icon("moogladder.svg"),
                inputs=[
                    PortSpec(id="asig", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(
                        id="adel",
                        name="DelayTime",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=3,
                    ),
                    PortSpec(id="kfeedback", name="Feedback", signal_type=SignalType.CONTROL, default=0.3),
                    PortSpec(id="imaxd", name="MaxDelay", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} flanger {asig}, {adel}, {kfeedback}, {imaxd}",
                tags=["delay", "effect"],
            ),
            self._spec(
                name="comb",
                category="delay",
                description="Comb filter / feedback delay.",
                icon=self._icon("moogladder.svg"),
                inputs=[
                    PortSpec(id="asig", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(id="krvt", name="ReverbTime", signal_type=SignalType.CONTROL, default=2),
                    PortSpec(id="ilpt", name="LoopTime", signal_type=SignalType.INIT, default=0.05),
                    PortSpec(id="iskip", name="SkipInit", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} comb {asig}, {krvt}, {ilpt}, {iskip}",
                tags=["delay", "effect"],
            ),
            self._spec(
                name="reverb2",
                category="reverb",
                description="Schroeder reverb processor.",
                icon=self._icon("moogladder.svg"),
                inputs=[
                    PortSpec(id="asig", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(id="krvt", name="ReverbTime", signal_type=SignalType.CONTROL, default=1.5),
                    PortSpec(id="khf", name="HighFreqDamp", signal_type=SignalType.CONTROL, default=0.5),
                    PortSpec(id="israte", name="SampleRateScale", signal_type=SignalType.INIT, required=False),
                    PortSpec(id="iskip", name="SkipInit", signal_type=SignalType.INIT, required=False),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} reverb2 {asig}, {krvt}, {khf}, {israte}, {iskip}",
                tags=["reverb", "effect"],
            ),
            self._spec(
                name="limit",
                category="dynamics",
                description="Hard clamp limiter.",
                icon=self._icon("moogladder.svg"),
                inputs=[
                    PortSpec(
                        id="xin",
                        name="Input",
                        signal_type=SignalType.AUDIO,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                    ),
                    PortSpec(
                        id="xmin",
                        name="Min",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.CONTROL, SignalType.INIT],
                        default=-0.8,
                    ),
                    PortSpec(
                        id="xmax",
                        name="Max",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.CONTROL, SignalType.INIT],
                        default=0.8,
                    ),
                ],
                outputs=[PortSpec(id="xout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{xout} limit {xin}, {xmin}, {xmax}",
                tags=["dynamics", "utility"],
            ),
            self._spec(
                name="exciter",
                category="filter",
                description="Harmonic exciter that adds controlled upper partials.",
                icon=self._icon("moogladder.svg"),
                inputs=[
                    PortSpec(id="asig", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(
                        id="kfreq",
                        name="Freq",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=2500,
                    ),
                    PortSpec(
                        id="kceil",
                        name="Ceiling",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=12000,
                    ),
                    PortSpec(
                        id="kharmonics",
                        name="Harmonics",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.CONTROL, SignalType.INIT],
                        default=1,
                    ),
                    PortSpec(
                        id="kblend",
                        name="Blend",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.CONTROL, SignalType.INIT],
                        default=0.5,
                    ),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} exciter {asig}, {kfreq}, {kceil}, {kharmonics}, {kblend}",
                tags=["effect", "harmonic", "enhancer"],
            ),
            self._spec(
                name="pan2",
                category="mixer",
                description="Stereo panner.",
                icon=self._icon("mix2.svg"),
                inputs=[
                    PortSpec(id="asig", name="aIn", signal_type=SignalType.AUDIO),
                    PortSpec(
                        id="xp",
                        name="Pan",
                        signal_type=SignalType.CONTROL,
                        accepted_signal_types=[SignalType.AUDIO, SignalType.CONTROL, SignalType.INIT],
                        default=0.5,
                    ),
                    PortSpec(id="imode", name="Mode", signal_type=SignalType.INIT, required=False, default=0),
                ],
                outputs=[
                    PortSpec(id="aleft", name="aLeft", signal_type=SignalType.AUDIO),
                    PortSpec(id="aright", name="aRight", signal_type=SignalType.AUDIO),
                ],
                template="{aleft}, {aright} pan2 {asig}, {xp}, {imode}",
                tags=["mix", "stereo", "utility"],
            ),
            self._spec(
                name="mix2",
                category="mixer",
                description="Mix two audio signals.",
                icon=self._icon("mix2.svg"),
                inputs=[
                    PortSpec(id="a", name="Left", signal_type=SignalType.AUDIO),
                    PortSpec(id="b", name="Right", signal_type=SignalType.AUDIO),
                ],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} = ({a}) + ({b})",
                tags=["mix"],
            ),
            self._spec(
                name="outs",
                category="output",
                description="Stereo output sink.",
                icon=self._icon("outs.svg"),
                inputs=[
                    PortSpec(id="left", name="Left", signal_type=SignalType.AUDIO),
                    PortSpec(id="right", name="Right", signal_type=SignalType.AUDIO),
                ],
                outputs=[],
                template="outs {left}, {right}",
                tags=["sink"],
            ),
            self._spec(
                name="const_k",
                category="constants",
                description="Control-rate constant value.",
                icon=self._icon("const_k.svg"),
                inputs=[],
                outputs=[PortSpec(id="kout", name="kOut", signal_type=SignalType.CONTROL)],
                template="{kout} = {value}",
                tags=["source"],
            ),
            self._spec(
                name="const_i",
                category="constants",
                description="Init-rate constant value.",
                icon=self._icon("const_i.svg"),
                inputs=[],
                outputs=[PortSpec(id="iout", name="iOut", signal_type=SignalType.INIT)],
                template="{iout} = {value}",
                tags=["source"],
            ),
            self._spec(
                name="const_a",
                category="constants",
                description="Audio-rate constant value.",
                icon=self._icon("const_a.svg"),
                inputs=[],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} = {value}",
                tags=["source"],
            ),
        ]
