from __future__ import annotations

from collections import defaultdict
from pathlib import Path
import re

from backend.app.models.opcode import OpcodeSpec, PortSpec, SignalType

CSOUND_OVERVIEW_URL = "https://csound.com/docs/manual/PartOpcodesOverview.html"
OPCODE_REFERENCE_URLS: dict[str, str] = {
    "adsr": "https://csound.com/docs/manual/madsr.html",
    "oscili": "https://csound.com/docs/manual/oscili.html",
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
        docs_path = Path(__file__).resolve().parents[3] / "CSOUND_OPCODES.md"
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
