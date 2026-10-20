"""Build HSB Mono using existing graph opcodes only.

Run from the repository root with .venv/bin/python.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def build():
    nodes, connections, formulas = [], [], {}

    def node(identity, opcode, x, y, **params):
        nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))

    def wire(source, target):
        src, port = source.split(".")
        dst, inlet = target.split(".")
        connections.append(dict(from_node_id=src, from_port_id=port, to_node_id=dst, to_port_id=inlet))

    def formula(target, expression, **sources):
        bindings = []
        for token, source in sources.items():
            wire(source, target)
            src, port = source.split(".")
            bindings.append(dict(token=token, from_node_id=src, from_port_id=port))
        formulas[target.replace(".", "::")] = dict(expression=expression, inputs=bindings)

    def control(identity, label, low, high, default, x, y, scale="linear"):
        node(identity, "perf_controller", x, y,
             label=label, min=low, max=high, default=default, scale=scale)

    node("pitch_initial", "cpsmidi", 0, 0)
    node("velocity_scale", "const_i", 0, 240, value=1)
    node("velocity_ampmidi", "ampmidi", 260, 240)
    wire("velocity_scale.iout", "velocity_ampmidi.iscal")
    node("legato", "midi_legato", 0, 490)

    # A separate zero-release envelope senses activity. Its persistent follower
    # crosses 0.5 about 20 ms after note-off. A positive, sub-sample attack
    # produces one zero-valued control sample at a new phrase, so its first
    # pitch update sees the retained activity before the follower snaps to 1.
    node("activity", "madsr", 300, 620,
         iatt=0.000001, idec=0, islev=1, irel=0, ireltim=0)
    node("recent_activity", "portk", 600, 620, isig=-1)
    wire("activity.kenv", "recent_activity.ksig")
    formula("recent_activity.khtim", "0.020 * (1 - gate)", gate="activity.kenv")
    node("phrase_onset", "linseg", 900, 620, ia=1, idur1=1 / 48000, ib=0)

    control("hsb_tonality", "Tonality (octave cycle)", 0, 1, 0, 0, 1050)
    control("hsb_brightness", "Brightness (octaves)", -2, 2, 0, 0, 1390)
    control("hsb_legato_rate", "Legato half-time (s)", 0.001, 0.5, 0.060, 0, 1730, "logarithmic")
    control("hsb_cc_channel", "MIDI control channel", 1, 16, 16, 0, 2100)
    for identity, cc, low, high, y in (
        ("tone", 20, 0, 1, 1050),
        ("brightness", 74, -2, 2, 1390),
        ("glide", 5, 0.001, 0.5, 1730),
    ):
        base = {"tone": "hsb_tonality", "brightness": "hsb_brightness", "glide": "hsb_legato_rate"}[identity]
        node(f"{identity}_cc", "ctrl7", 370, y, ictlno=cc, kmin=0, kmax=127)
        formula(f"{identity}_cc.ichan", "floor(channel + 0.5)", channel="hsb_cc_channel.iout")
        node(f"{identity}_value", "portk", 750, y, khtim=0.010)
        # Negative portk initial values mean "retain state", so brightness is
        # smoothed in an unsigned 0..4 domain and shifted back at the oscillator.
        offset = 2 if identity == "brightness" else 0
        formula(f"{identity}_value.isig", f"base + {offset}", base=f"{base}.iout")
        # CC zero recalls the rack value. CC 1..127 covers the full range.
        mapped = (f"{low} * ampdb((cc - 1) / 126 * 53.979400086720375)"
                  if identity == "glide" else f"{low} + (cc - 1) / 126 * {high - low}")
        formula(f"{identity}_value.ksig",
                f"base * (1 - ceil(cc / 127)) + ({mapped}) * ceil(cc / 127) + {offset}",
                base=f"{base}.iout", cc=f"{identity}_cc.kout")

    node("glide_pitch", "portk", 1250, 400, isig=-1)
    wire("legato.kfreq", "glide_pitch.ksig")
    formula("glide_pitch.khtim", "rate * (1 - onset * (1 - floor(memory + 0.5)))",
            rate="glide_value.kout", memory="recent_activity.kout", onset="phrase_onset.kenv")
    node("pitch_octaves", "k_mul", 1560, 400, b=1)
    formula("pitch_octaves.a", "dbamp(pitch / 261.6255653005986) / 6.020599913279624",
            pitch="glide_pitch.kout")

    for identity, value, y in (("attack", 0.006, 0), ("decay", 0.15, 240),
                               ("sustain", 0.8, 480), ("release", 0.080, 720)):
        node(f"amp_{identity}", "const_i", 1250, y + 1100, value=value)
    node("amp_madsr", "madsr", 1560, 1100)
    for source, target in (("attack", "iatt"), ("decay", "idec"), ("sustain", "islev"), ("release", "irel")):
        wire(f"amp_{source}.iout", f"amp_madsr.{target}")

    node("sine_table", "ftgenonce", 1550, -450, ip1=0, ip2dummy=0, isize=16384, igen=10, iarg1=1)
    node("octave_window", "ftgenonce", 1870, -450,
         ip1=0, ip2dummy=0, isize=16384, igen=-19, iarg1=1, iarg2=0.5, iarg3=270, iarg4=0.5)
    node("hsb_oscillator", "hsboscil", 2200, 300, ibasfreq=261.6255653005986, ioctcnt=5, iphs=-1)
    wire("sine_table.ift", "hsb_oscillator.iwfn")
    wire("octave_window.ift", "hsb_oscillator.ioctfn")
    formula("hsb_oscillator.ktone", "octave + tone + 8",
            octave="pitch_octaves.kout", tone="tone_value.kout")
    formula("hsb_oscillator.kbrite", "octave + brightness - 2",
            octave="pitch_octaves.kout", brightness="brightness_value.kout")
    formula("hsb_oscillator.kamp", "0.28 * velocity * envelope",
            velocity="legato.kvelocity", envelope="amp_madsr.kenv")
    node("output_pan", "pan2", 2600, 300, xp=0.5, imode=0)
    wire("hsb_oscillator.ares", "output_pan.asig")
    for side, port, y in (("left", "aleft", 300), ("right", "aright", 600)):
        node(f"output_{side}", "outleta", 2900, y, sname=side)
        wire(f"output_pan.{port}", f"output_{side}.asignal")

    description = (
        "Monophonic hsboscil synth with five sine-wave octaves and independent cyclic tonality/brightness. "
        "Last-note priority; overlapping/touching notes share an envelope. Patch-local portk memory glides "
        "across gaps up to approximately 20 ms; longer gaps start directly at the new pitch. "
        "A positive gap retriggers the amplitude envelope, as in a slide bass; it does not extend the phrase gate. "
        "Legato half-time defaults to 60 ms (higher = slower). Velocity-sensitive, 6 ms attack / 150 ms decay / "
        "0.8 sustain / 80 ms release. Suggested MIDI range 36-84. "
        "Performance controls: Tonality 0-1 octave cycle, Brightness -2 to +2 octaves, Legato half-time 1-500 ms. "
        "MIDI control channel defaults to 16; CC20 Tonality, CC74 Brightness, CC5 Legato half-time. "
        "CC0 recalls the performance setting; CC1 minimum, CC127 maximum, with 10 ms smoothing. "
        "Rack controls are read at phrase start. CCs affect held notes; notes never reset controllers. "
        "Instances sharing a control channel share CC automation, but their voice/glide state remains separate. "
        "Route Stereo Output through the mixer to Master."
    )
    return dict(name="HSB Mono", description=description, is_template=False, always_on=False,
                instrument_type="melody", schema_version=1,
                graph=dict(nodes=nodes, connections=connections,
                           engine_config=dict(sr=48000, control_rate=1500, ksmps=32, nchnls=2,
                                              software_buffer=128, hardware_buffer=512, zero_dbfs=1),
                           ui_layout=dict(input_formulas=formulas, audio_blocks={"main-output": True}),
                           audio_interface=dict(role="instrument", guided=True, mainInput=None,
                                                mainOutput="main-output", groups=[
                                                    dict(id="main-output", name="Stereo Output",
                                                         direction="output", layout="stereo",
                                                         ports=["left", "right"], purpose="main")]),
                           control_flow={}))


if __name__ == "__main__":
    payload = build()
    (ROOT / "hsb_mono.patch.json").write_text(json.dumps(payload, indent=2) + "\n")
    native = dict(sourcePatchId="35a07e2c-4b00-40ec-b71f-d361476ec81e",
                  name=payload["name"], description=payload["description"],
                  isTemplate=False, alwaysOn=False, instrumentType="melody",
                  schema_version=1, graph=payload["graph"])
    (ROOT.parent / "HSB_Mono.orch.instrument.json").write_text(json.dumps(native, indent=2) + "\n")
    print(f"Built {len(payload['graph']['nodes'])} nodes.")
