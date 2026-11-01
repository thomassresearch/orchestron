"""Build an editable Minimoog-style instrument using existing Orchestron opcodes.

No library writes: publish the validated graph separately through the patch API.
"""

import json
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL

ROOT = Path(__file__).resolve().parent
NAME = "Minimoog Monophonic"
BUNDLE_ID = str(uuid5(NAMESPACE_URL, "orchestron:instruments:minimoog-monophonic"))
DB_OCTAVE = 6.020599913279624

CONTROLLER_GROUPS = {
    node_id: group
    for group, node_ids in {
        "Tuning & Articulation": ("master_tune", "glide_enabled", "legato_time", "decay_enabled"),
        "Modulation": ("mod_mix", "mod_amount", "osc_mod", "filter_mod"),
        "Oscillator 1": ("osc1_range", "osc1_wave", "osc1_level", "osc1_enabled"),
        "Oscillator 2": ("osc2_range", "osc2_wave", "osc2_tune", "osc2_level", "osc2_enabled"),
        "Oscillator 3": ("osc3_range", "osc3_wave", "osc3_tune", "osc3_level", "osc3_enabled", "osc3_keyboard"),
        "Noise & Mixer": ("noise_level", "noise_enabled", "noise_pink", "mixer_drive"),
        "Filter": ("cutoff", "resonance", "contour", "filter_key1", "filter_key2"),
        "Filter Envelope": ("filter_attack", "filter_decay", "filter_sustain"),
        "Loudness": ("amp_attack", "amp_decay", "amp_sustain"),
        "Output": ("velocity_amount", "output_volume"),
    }.items()
    for node_id in node_ids
}


def build():
    nodes, connections, formulas = [], [], {}

    def node(identity, opcode, x, y, **params):
        nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))

    def wire(source, target):
        src, port = source.split(".")
        dst, inlet = target.split(".")
        connections.append(dict(from_node_id=src, from_port_id=port, to_node_id=dst, to_port_id=inlet))

    def formula(target, expression, **sources):
        inputs = []
        for token, source in sources.items():
            wire(source, target)
            src, port = source.split(".")
            inputs.append(dict(token=token, from_node_id=src, from_port_id=port))
        formulas[target.replace(".", "::")] = dict(expression=expression, inputs=inputs)

    def control(identity, label, low, high, default, group, row, kind="float", scale="linear"):
        node(identity, "perf_controller", group * 360, -2100 + row * 310,
             label=label, min=low, max=high, default=default, scale=scale, controller_type=kind,
             controller_group=CONTROLLER_GROUPS[identity])

    def toggle(identity, label, default, group, row):
        control(identity, label, 0, 1, default, group, row, "bool")

    def select(value, token="wave"):
        return f"(1 - ceil(abs({token} - {value}) / 6))"

    def clamp(expression, low, high):
        lower = f"(({expression} + {low} + abs({expression} - {low})) / 2)"
        return f"({lower} + {high} - abs({lower} - {high})) / 2"

    # Node order is also the order of controls in the performance rack.
    control("master_tune", "Master tune (cents)", -100, 100, 0, 0, 0)
    toggle("glide_enabled", "Glide", 1, 0, 1)
    control("legato_time", "Legato half-time (s)", 0.001, 2, 0.065, 0, 2, scale="logarithmic")
    toggle("decay_enabled", "Decay after release", 1, 0, 3)
    control("mod_mix", "Mod mix: Osc 3 to noise", 0, 1, 0, 0, 4)
    control("mod_amount", "Modulation amount", 0, 1, 0, 0, 5)
    toggle("osc_mod", "Oscillator modulation", 0, 0, 6)
    toggle("filter_mod", "Filter modulation", 0, 0, 7)
    for number in (1, 2, 3):
        prefix = f"osc{number}"
        control(f"{prefix}_range", f"Osc {number} range (0=Lo, 1=32, 2=16, 3=8, 4=4, 5=2 ft)",
                0, 5, 3, number, 0, "integer")
        control(f"{prefix}_wave", f"Osc {number} waveform (1-6; see guide)",
                1, 6, 3 if number != 3 else 1, number, 1, "integer")
        if number > 1:
            control(f"{prefix}_tune", f"Osc {number} tune (semitones)", -7, 7,
                    0.07 if number == 2 else -0.05, number, 2)
        control(f"{prefix}_level", f"Osc {number} level", 0, 1,
                {1: 0.8, 2: 0.6, 3: 0.35}[number], number, 3)
        toggle(f"{prefix}_enabled", f"Osc {number} mixer", 1, number, 4)
    toggle("osc3_keyboard", "Osc 3 keyboard control", 1, 3, 5)
    control("noise_level", "Noise level", 0, 1, 0.15, 4, 0)
    toggle("noise_enabled", "Noise mixer", 0, 4, 1)
    toggle("noise_pink", "Pink noise (off = white)", 0, 4, 2)
    control("mixer_drive", "Mixer drive", 1, 5, 1.35, 4, 3)
    control("cutoff", "Filter cutoff (Hz)", 20, 20000, 900, 5, 0, scale="logarithmic")
    control("resonance", "Filter emphasis", 0, 1, 0.25, 5, 1)
    control("contour", "Filter contour (octaves)", 0, 8, 3, 5, 2)
    toggle("filter_key1", "Filter keyboard 1 (1/3)", 1, 5, 3)
    toggle("filter_key2", "Filter keyboard 2 (2/3)", 0, 5, 4)
    for group, prefix, label, defaults in (
        (6, "filter", "Filter", (0.008, 0.28, 0.2)),
        (7, "amp", "Loudness", (0.005, 0.3, 0.8)),
    ):
        control(f"{prefix}_attack", f"{label} attack (s)", 0.001, 10, defaults[0], group, 0, scale="logarithmic")
        control(f"{prefix}_decay", f"{label} decay (s)", 0.005, 10, defaults[1], group, 1, scale="logarithmic")
        control(f"{prefix}_sustain", f"{label} sustain", 0, 1, defaults[2], group, 2)
    control("velocity_amount", "Velocity sensitivity", 0, 1, 0.35, 7, 3)
    control("output_volume", "Output volume", 0, 1, 0.7, 7, 4)

    node("pitch_initial", "cpsmidi", 0, 750)
    node("velocity_scale", "const_i", 0, 1000, value=1)
    node("velocity_initial", "ampmidi", 340, 1000)
    wire("velocity_scale.iout", "velocity_initial.iscal")
    node("legato", "midi_legato", 0, 1300)
    node("glide_pitch", "portk", 700, 800)
    # Smooth log-frequency, so ascending and descending intervals glide equally.
    # Offset keeps portk's initial state positive (negative means retain state).
    formula("glide_pitch.ksig", f"dbamp(freq / 440) / {DB_OCTAVE} + 8.75", freq="legato.kfreq")
    formula("glide_pitch.isig", f"dbamp(freq / 440) / {DB_OCTAVE} + 8.75", freq="pitch_initial.kfreq")
    formula("glide_pitch.khtim", "time * enabled", time="legato_time.iout", enabled="glide_enabled.iout")
    node("played_frequency", "k_mul", 1100, 800, b=1)
    formula("played_frequency.a", f"440 * ampdb({DB_OCTAVE} * (octave - 8.75 + tune / 1200))",
            octave="glide_pitch.kout", tune="master_tune.iout")

    for prefix, x in (("amp", 1100), ("filter", 1500)):
        node(f"{prefix}_envelope", "madsr", x, 1250)
        for suffix, port in (("attack", "iatt"), ("decay", "idec"), ("sustain", "islev")):
            wire(f"{prefix}_{suffix}.iout", f"{prefix}_envelope.{port}")
        formula(f"{prefix}_envelope.irel", "decay * enabled + 0.005 * (1 - enabled)",
                decay=f"{prefix}_decay.iout", enabled="decay_enabled.iout")

    node("white_noise", "noise", 0, 1800, amp=1, beta=0)
    node("pink_noise", "pinkish", 360, 1800)
    wire("white_noise.aout", "pink_noise.xin")
    node("noise_pink_audio", "upsamp", 360, 2120)
    wire("noise_pink.iout", "noise_pink_audio.ksig")
    node("noise_colour", "a_mul", 740, 1800, b=1)
    formula("noise_colour.a", "white * (1 - pink) + coloured * pink * 2",
            white="white_noise.aout", coloured="pink_noise.aout", pink="noise_pink_audio.aout")
    node("noise_modulation", "downsamp", 1100, 1800)
    wire("noise_colour.aout", "noise_modulation.asig")

    # Oscillator 3 is generated independently of its mixer switch and the VCA,
    # preserving the original modulation-source behavior even when inaudible.
    for number in (3, 1, 2):
        p = f"osc{number}"
        y = 2400 + (number - 1) * 750
        node(f"{p}_frequency", "k_mul", 1500, y, b=1)
        octave = f"(range - 3 - 3 * {select(0, 'range')})"
        base = "pitch" if number != 3 else "(pitch * keyboard + 261.6255653005986 * (1 - keyboard))"
        sources = dict(pitch="played_frequency.kout", range=f"{p}_range.iout")
        if number == 3:
            sources.update(keyboard="osc3_keyboard.iout", tune="osc3_tune.iout")
        elif number == 2:
            sources["tune"] = "osc2_tune.iout"
        tuning = " + tune / 12" if number > 1 else ""
        modulation = ""
        if number != 3:
            sources.update(mod="modulation.kout", enabled="osc_mod.iout")
            modulation = " + mod * enabled * 0.5"
        frequency = f"{base} * ampdb({DB_OCTAVE} * ({octave}{tuning}{modulation}))"
        formula(f"{p}_frequency.a", clamp(frequency, 0.05, 18000), **sources)
        node(f"{p}_oscillator", "vco2", 1950, y, kphs={1: 0, 2: 0.19, 3: 0.37}[number], inyx=0.49)
        wire(f"{p}_frequency.kout", f"{p}_oscillator.kcps")
        formula(f"{p}_oscillator.imode", f"12 * {select(1)} + 2 * ({select(4)} + {select(5)} + {select(6)})",
                wave=f"{p}_wave.iout")
        formula(f"{p}_oscillator.kpw", f"0.5 - 0.25 * {select(5)} - 0.375 * {select(6)}", wave=f"{p}_wave.iout")
        if number == 3:
            formula(f"{p}_oscillator.kamp", f"1 - 2 * {select(2)}", wave=f"{p}_wave.iout")
            node("osc3_modulation", "downsamp", 2350, y)
            wire("osc3_oscillator.asig", "osc3_modulation.asig")
        else:
            formula(f"{p}_oscillator.kamp", f"1 - 0.5 * {select(2)}", wave=f"{p}_wave.iout")
            node(f"{p}_shark_triangle", "vco2", 1950, y + 320, imode=12, kphs=0 if number == 1 else 0.19, inyx=0.49)
            wire(f"{p}_frequency.kout", f"{p}_shark_triangle.kcps")
            formula(f"{p}_shark_triangle.kamp", f"0.5 * {select(2)}", wave=f"{p}_wave.iout")

    node("modulation", "k_mul", 2700, 1800, b=1)
    formula("modulation.a", "amount * (osc * (1 - mix) + noise * mix)",
            amount="mod_amount.iout", mix="mod_mix.iout", osc="osc3_modulation.kout", noise="noise_modulation.kout")
    node("mixer", "a_mul", 2750, 2600, b=1)
    sources = {}
    terms = []
    for number in (1, 2, 3):
        node(f"osc{number}_gain", "upsamp", 2350, {1: 2700, 2: 3450, 3: 4250}[number])
        formula(f"osc{number}_gain.ksig", "level * enabled",
                level=f"osc{number}_level.iout", enabled=f"osc{number}_enabled.iout")
        sources.update({f"osc{number}": f"osc{number}_oscillator.asig",
                        f"level{number}": f"osc{number}_gain.aout"})
        signal = f"osc{number}"
        if number != 3:
            sources[f"tri{number}"] = f"osc{number}_shark_triangle.asig"
            signal = f"(osc{number} + tri{number})"
        terms.append(f"{signal} * level{number}")
    node("noise_gain", "upsamp", 2350, 4700)
    formula("noise_gain.ksig", "level * enabled", level="noise_level.iout", enabled="noise_enabled.iout")
    sources.update(noise="noise_colour.aout", noiselevel="noise_gain.aout")
    terms.append("noise * noiselevel")
    formula("mixer.a", "0.22 * (" + " + ".join(terms) + ")", **sources)
    node("mixer_saturation", "tanh", 3100, 2600)
    formula("mixer_saturation.xin", "signal * drive", signal="mixer.aout", drive="mixer_drive.iout")

    node("filter_frequency", "k_mul", 2700, 3300, b=1)
    filter_octaves = (f"(dbamp(pitch / 130.8127826502993) / {DB_OCTAVE}) * (key1 / 3 + key2 * 2 / 3)"
                      " + envelope * contour + modulation * enabled * 3")
    formula("filter_frequency.a", clamp(f"cutoff * ampdb({DB_OCTAVE} * ({filter_octaves}))", 20, 20000),
            pitch="played_frequency.kout", key1="filter_key1.iout", key2="filter_key2.iout",
            envelope="filter_envelope.kenv", contour="contour.iout", modulation="modulation.kout",
            enabled="filter_mod.iout", cutoff="cutoff.iout")
    node("ladder", "moogladder", 3500, 2600)
    wire("mixer_saturation.aout", "ladder.ain")
    wire("filter_frequency.kout", "ladder.kcf")
    wire("resonance.iout", "ladder.kres")
    node("dc_filter", "butterhp", 3900, 2600, xfreq=12)
    wire("ladder.aout", "dc_filter.asig")
    # The loudness VCA follows the ladder, independently of the filter contour.
    # This also gates resonance and guarantees that release tails end silently.
    node("vca", "a_mul", 4300, 2600)
    wire("dc_filter.aout", "vca.a")
    node("vca_gain", "k_to_a", 3900, 3100)
    formula("vca_gain.kin", "envelope * (1 - sensitivity + sensitivity * velocity) * volume * 1.5",
            envelope="amp_envelope.kenv", sensitivity="velocity_amount.iout",
            velocity="legato.kvelocity", volume="output_volume.iout")
    wire("vca_gain.aout", "vca.b")
    node("output_saturation", "tanh", 4650, 2600)
    wire("vca.aout", "output_saturation.xin")
    node("output_pan", "pan2", 5000, 2600, xp=0.5, imode=0)
    wire("output_saturation.aout", "output_pan.asig")
    for side, port, y in (("left", "aleft", 2600), ("right", "aright", 2920)):
        node(f"output_{side}", "outleta", 5400, y, sname=side)
        wire(f"output_pan.{port}", f"output_{side}.asignal")

    description = (
        "Minimoog-style monophonic three-oscillator synthesizer with 24 dB ladder filter, white/pink noise, "
        "separate filter/loudness ADS contours, decay-after-release switch, oscillator-3/noise modulation, "
        "keyboard tracking, mixer saturation and optional velocity response. "
        "Last-note priority; touching/overlapping notes share one voice and both envelopes. "
        "Glide uses Legato half-time (default 0.065 s); larger values slide more slowly. "
        "A gap restarts envelopes and pitch directly. Rack values refresh at phrase start. "
        "Range 0=Lo, 1=32ft, 2=16ft, 3=8ft, 4=4ft, 5=2ft. "
        "Wave 1=triangle, 2=triangle/saw blend (reverse saw on Osc 3), 3=saw, 4=square, "
        "5=25% pulse, 6=12.5% pulse. Osc 3 keyboard off uses C4 as reference; Lo gives about 4.1 Hz. "
        "For vibrato: Osc 3 range 0, keyboard off, mixer off; oscillator modulation on and increase modulation amount. "
        "Suggested MIDI range 36-84. Route Stereo Output to Master. "
        "Inspired by the original architecture, not a circuit-exact emulation; no external audio input or hardware CV."
    )
    return dict(name=NAME, description=description, is_template=False, always_on=False,
                instrument_type="melody", schema_version=1,
                graph=dict(nodes=nodes, connections=connections,
                           engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                                              software_buffer=128, hardware_buffer=512, zero_dbfs=1),
                           ui_layout=dict(input_formulas=formulas, audio_blocks={"main-output": True}),
                           audio_interface=dict(role="instrument", guided=True, mainInput=None,
                                                mainOutput="main-output", groups=[
                                                    dict(id="main-output", name="Stereo Output", direction="output",
                                                         layout="stereo", ports=["left", "right"], purpose="main")]),
                           control_flow={}))


if __name__ == "__main__":
    payload = build()
    (ROOT / "minimoog_monophonic.patch.json").write_text(json.dumps(payload, indent=2) + "\n")
    native = dict(sourcePatchId=BUNDLE_ID, name=payload["name"], description=payload["description"],
                  isTemplate=False, alwaysOn=False, instrumentType="melody", schema_version=1, graph=payload["graph"])
    (ROOT.parent / "Minimoog_Monophonic.orch.instrument.json").write_text(json.dumps(native, indent=2) + "\n")
    print(f"Built {len(payload['graph']['nodes'])} nodes, "
          f"{sum(n['opcode'] == 'perf_controller' for n in payload['graph']['nodes'])} performance controls.")
