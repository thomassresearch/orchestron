from __future__ import annotations

from collections import defaultdict

from backend.app.models.opcode import OpcodeSpec, PortSpec, SignalType


class OpcodeService:
    def __init__(self, icon_prefix: str) -> None:
        self._icon_prefix = icon_prefix.rstrip("/")
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

    def _load_builtin_opcodes(self) -> list[OpcodeSpec]:
        return [
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
                name="cpsmidi",
                category="midi",
                description="Read active MIDI note pitch as cycles-per-second.",
                icon=self._icon("cpsmidi.svg"),
                inputs=[],
                outputs=[PortSpec(id="kfreq", name="iFreq", signal_type=SignalType.INIT)],
                template="{kfreq} cpsmidi",
                tags=["performance", "source"],
            ),
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
                name="k_to_a",
                category="utility",
                description="Interpolate control signal to audio-rate.",
                icon=self._icon("k_to_a.svg"),
                inputs=[PortSpec(id="kin", name="kIn", signal_type=SignalType.CONTROL)],
                outputs=[PortSpec(id="aout", name="aOut", signal_type=SignalType.AUDIO)],
                template="{aout} interp {kin}",
                tags=["conversion"],
            ),
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
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
            OpcodeSpec(
                name="const_k",
                category="constants",
                description="Control-rate constant value.",
                icon=self._icon("const_k.svg"),
                inputs=[],
                outputs=[PortSpec(id="kout", name="kOut", signal_type=SignalType.CONTROL)],
                template="{kout} = {value}",
                tags=["source"],
            ),
            OpcodeSpec(
                name="const_i",
                category="constants",
                description="Init-rate constant value.",
                icon=self._icon("const_i.svg"),
                inputs=[],
                outputs=[PortSpec(id="iout", name="iOut", signal_type=SignalType.INIT)],
                template="{iout} = {value}",
                tags=["source"],
            ),
            OpcodeSpec(
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
