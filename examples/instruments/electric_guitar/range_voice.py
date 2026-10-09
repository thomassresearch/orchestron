"""Picked guitar with measured register profiles and MIDI-independent decay."""

import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "integrations/skills/orchestron-patch-creator/src"))
from orchestron_patch.cli.orchestron_patch_cli import (  # noqa: E402
    build_patch_payload,
    require_const_i_connection,
    validate_stereo_output,
)
from backend.app.models.patch import PatchCreateRequest  # noqa: E402

CONTROLS = [
    ("eg_pickup", "Pickup colour", 0.08, 0.42, 0.28, "linear"),
    ("eg_tone", "Tone (Hz)", 700, 5000, 4200, "logarithmic"),
    ("eg_drive", "Amp drive (dB)", 0, 18, 0, "linear"),
    ("eg_decay", "String decay", 1, 12, 9, "logarithmic"),
    ("eg_mute", "Palm mute", 0, 1, 0, "linear"),
    ("eg_width", "Stereo width", 0, 0.6, 0.36, "linear"),
    ("eg_release", "Tail length", 0.04, 0.8, 0.16, "logarithmic"),
    ("eg_level", "Output (dB)", -18, 0, -6, "linear"),
    ("eg_pick", "Pick strength", 0, 2, 1, "linear"),
    ("eg_pitch_decay", "Decay at B4 (factor)", 0.25, 1, 0.5, "linear"),
]


def clamp01(expression):
    """Formula-compatible clamp: abs is supported, conditional/min/max are not."""
    return f"((abs({expression})-abs(({expression})-1)+1)*.5)"


def interpolate(profiles, values):
    """Bounded, continuous interpolation between measured equal-tempered keys."""
    terms = [f"{values[0]:.12f}"]
    for left, right, a, b in zip(profiles, profiles[1:], values, values[1:]):
        if abs(b - a) < 1e-8:
            continue
        low = 440 * 2 ** ((left["midi"] - 69) / 12)
        high = 440 * 2 ** ((right["midi"] - 69) / 12)
        terms.append(f"({b - a:.12f})*{clamp01(f'(hz-{low:.9f})/{high - low:.9f}')}")
    return "(" + " + ".join(terms) + ")"


def pitch_decay_factor(note, reference_factor=0.5):
    """Full duration at/below E2, reference factor at B4 (B string, fret 12)."""
    return reference_factor ** (max(0, note - 40) / 31)


def lifetime(note, settings=None):
    """Conservative time to exact silence, shared with authoring validation."""
    settings = settings or {}
    profiles = json.loads((HERE / "range_tuning.json").read_text())["profiles"]
    frequency = 440 * 2 ** ((note - 69) / 12)
    values = [(440 * 2 ** ((p["midi"] - 69) / 12), p["early_seconds"], max(p["tail_t60"])) for p in profiles]
    a, b = values[0], values[-1]
    for left, right in zip(values, values[1:]):
        if left[0] <= frequency <= right[0]:
            a, b = left, right
            break
    blend = max(0, min(1, (frequency - a[0]) / (b[0] - a[0])))
    early = a[1] + blend * (b[1] - a[1])
    tail = a[2] + blend * (b[2] - a[2])
    return (early + 2 * tail * (0.75 + 1.5625 * settings.get("eg_release", 0.16))) * pitch_decay_factor(
        note, settings.get("eg_pitch_decay", 0.5)
    ) * settings.get("eg_decay", 9) / 9 / (1 + 12 * settings.get("eg_mute", 0)) + 0.10


def build(tuning=None):
    tuning = tuning or json.loads((HERE / "range_tuning.json").read_text())
    profiles = tuning["profiles"]
    pick_tuning = json.loads((HERE / "pick_tuning.json").read_text())
    pick_profiles = pick_tuning["profiles"]
    payload = build_patch_payload(
        dict(
            name="E-Guitar — Warm Electric",
            description=(
                "Entirely synthesized picked electric guitar fitted across E2–B5. "
                "Register-dependent partials, attacks and exponential decays. "
                "Each note rings to silence independently of MIDI note duration; note-off does not mute it. "
                "Palm mute and Tail length control damping at the next pick. "
                "Decay at B4 progressively shortens higher notes: full time at E2, half time at B4 by default. "
                "Pick strength controls the brief contact sound; sharper high-register attacks follow the recording. "
                "Held notes develop gentle vibrato after 0.5 seconds, rising in depth and rate then fading by 2.5 seconds. "
                "Key release fades the vibrato without muting the natural string decay. "
                "No samples. All sources, envelopes and formulas are editable. Route Stereo Output to Master."
            ),
            family="simple_osc",
            envelope=dict(attack=0.0005, decay=0.01, sustain=1, release=0.16),
            layers=[dict(id="seed", opcode="oscili", gain=0.2, table=-1)],
            output=dict(pan=0.5),
        )
    )
    payload["instrument_type"] = "melody"
    graph = payload["graph"]
    graph["engine_config"].update(sr=48000, ksmps=16, control_rate=3000)
    # The user's one-shot requirement supersedes the helper's MIDI ADSR default.
    remove = {n["id"] for n in graph["nodes"] if n["id"].startswith(("seed_", "env_")) or n["id"] == "amp_madsr"}
    nodes = graph["nodes"] = [n for n in graph["nodes"] if n["id"] not in remove]
    edges = graph["connections"] = [
        e for e in graph["connections"] if e["from_node_id"] not in remove and e["to_node_id"] not in remove
    ]
    formulas = graph["ui_layout"].setdefault("input_formulas", {})

    def node(identity, opcode, x, y, **params):
        nodes.append(dict(id=identity, opcode=opcode, params=params, position=dict(x=x, y=y)))

    def formula(target, expression, **sources):
        identity, port = target.split(".")
        edges[:] = [e for e in edges if (e["to_node_id"], e["to_port_id"]) != (identity, port)]
        bindings = []
        for token, source in sources.items():
            src, out = source.split(".")
            edges.append(dict(from_node_id=src, from_port_id=out, to_node_id=identity, to_port_id=port))
            bindings.append(dict(token=token, from_node_id=src, from_port_id=out))
        formulas[identity + "::" + port] = dict(expression=expression, inputs=bindings)
        next(n for n in nodes if n["id"] == identity)["params"].pop(port, None)

    def curve(key, harmonic=None, fallback=0):
        values = []
        for p in profiles:
            value = p[key]
            values.append(value if harmonic is None else (value[harmonic] if harmonic < len(value) else fallback))
        return interpolate(profiles, values)

    pitch = "pitch_cpsmidi.kfreq"
    # Only oscillator pitch is modulated. The fitted string profiles and natural
    # amplitude decay continue to use the original played pitch.
    node("eg_vibrato_depth", "linseg", -1100, 1700, ia=0, idur1=0.5, ib=0, idur2=0.8, ic=20, idur3=1.2, id=0)
    node("eg_vibrato_rate", "linseg", -1100, 2200, ia=4, idur1=0.5, ib=4, idur2=0.8, ic=6, idur3=1.2, id=6)
    node("eg_vibrato_release", "release", -1100, 2700)
    node("eg_vibrato_lfo", "lfo", -600, 1700, itype=0)
    formula(
        "eg_vibrato_lfo.kamp", "depth*(1-released)", depth="eg_vibrato_depth.kenv", released="eg_vibrato_release.krel"
    )
    formula("eg_vibrato_lfo.kcps", "rate", rate="eg_vibrato_rate.kenv")
    # Smooth the gated pitch offset, not the key gate: a note released before
    # 0.5 s then has exactly zero modulation for its entire ringing tail.
    node("eg_vibrato_smooth", "portk", -100, 1700, khtim=0.004, isig=0)
    formula("eg_vibrato_smooth.ksig", "cents", cents="eg_vibrato_lfo.kout")
    node("eg_decay_note", "notnum", 0, 1100)
    # ampdb/dbamp implement a power law using existing formula functions.
    # B3 is the open B string (MIDI 59); its 12th fret is B4 (MIDI 71).
    pitch_decay = "ampdb(dbamp(factor)*(abs(note-40)+note-40)/62)"
    decay_sources = dict(note="eg_decay_note.inote", factor="eg_pitch_decay.iout")
    controls = dict(hz=pitch, scale="eg_decay.iout", mute="eg_mute.iout", tail="eg_release.iout", **decay_sources)
    for i, (identity, label, low, high, default, scale) in enumerate(CONTROLS):
        node(
            identity,
            "perf_controller",
            -1500 + (i % 2) * 450,
            -800 + (i // 2) * 450,
            label=label,
            min=low,
            max=high,
            default=default,
            scale=scale,
        )
    early = curve("early_seconds")
    # Full correction at B4, blended only across A#4–B4; lower keys retain
    # their existing default attack. Interpolate inside the high register.
    transition_hz = 440 * 2 ** ((pick_tuning["transition_from_note"] - 69) / 12)
    first_hz = 440 * 2 ** ((pick_tuning["first_full_strength_note"] - 69) / 12)
    high_register = clamp01(f"(hz-{transition_hz:.9f})/{first_hz - transition_hz:.9f}")

    def pick_curve(key, harmonic):
        return interpolate(pick_profiles, [p[key][harmonic] for p in pick_profiles])

    node(
        "eg_contact_decay",
        "expsega",
        900,
        5900,
        ia=1,
        idur1=pick_tuning["transient_tau_seconds"] * math.log(1000),
        ib=0.001,
        idur2=0.1,
        ic=1e-12,
    )
    tail_max = interpolate(profiles, [max(p["tail_t60"]) for p in profiles])
    ttl = f"({early}+2*{tail_max}*(.75+1.5625*tail))*{pitch_decay}*scale/9/(1+12*mute)+.08"
    node("eg_note_lifetime", "xtratim", 0, 650)
    formula("eg_note_lifetime.iextradur", ttl + "+.04", **controls)
    node("eg_silence_gate", "linseg", 400, 650, ia=1, ib=1, idur2=0.02, ic=0)
    formula("eg_silence_gate.idur1", ttl, **controls)
    formula("amp_velocity_envelope.a", "vel*(.45+.55*vel)", vel="velocity_ampmidi.iamp")
    formula("amp_velocity_envelope.b", "gate", gate="eg_silence_gate.kenv")
    sums = {}
    for i in range(tuning["partials"]):
        harmonic = i + 1
        prefix = f"eg_partial_{harmonic:02}"
        x, y = 1400 + (i % 4) * 1700, -700 + (i // 4) * 1050
        rise = curve("rise_seconds", i, 0.002)
        decay = curve("early_t60", i, 1)
        tail_decay = curve("tail_t60", i, 1)
        level = curve("weights_db", i, -100)
        ratio = curve("ratios", i, harmonic)
        node(prefix + "_rise", "expsega", x, y, ia=1, ib=0.0001, idur2=1, ic=1e-12)
        delay = pick_curve("delay_seconds", i)
        fast_rise = pick_curve("rise_seconds", i)
        formula(prefix + "_rise.idur1", f"(1-{high_register})*9.210340372*{rise}+{high_register}*{delay}", hz=pitch)
        formula(prefix + "_rise.ib", f"ampdb(-80*(1-{high_register}))", hz=pitch)
        formula(prefix + "_rise.idur2", f"(1-{high_register})+{high_register}*27.631021116*{fast_rise}", hz=pitch)
        node(prefix + "_decay", "expsega", x, y + 430, ia=1, ic=1e-6)
        formula(
            prefix + "_decay.idur1",
            f"{early}*{pitch_decay}*scale/9/(1+12*mute)",
            hz=pitch,
            scale="eg_decay.iout",
            mute="eg_mute.iout",
            **decay_sources,
        )
        formula(prefix + "_decay.ib", f"ampdb(-60*{early}/{decay})", hz=pitch)
        formula(
            prefix + "_decay.idur2",
            f"{tail_decay}*(2-{early}/{decay})*{pitch_decay}*scale/9*(.75+1.5625*tail)/(1+12*mute)",
            **controls,
        )
        node(prefix + "_osc", "oscil3", x + 560, y, ifn=-1, iphs=(i * 0.137) % 1)
        compensation = curve("cabinet_compensation_db", i, 0)
        nyquist = clamp01(f"(sr*.46-hz*{ratio})/(sr*.04)")
        excitation = "(1-rise)*(1-rise)"
        contact_sources = {}
        if any(p["excess"][i] > 0.0001 for p in pick_profiles):
            node(
                prefix + "_contact", "expsega", x + 1050, y + 430, ia=1, ib=1, idur2=0.00035 * math.log(1e12), ic=1e-12
            )
            formula(prefix + "_contact.idur1", delay, hz=pitch)
            excitation += f"+strength*{high_register}*{pick_curve('excess', i)}*(1-contact)*(1-contact)*transient"
            contact_sources = dict(
                strength="eg_pick.iout", contact=prefix + "_contact.aenv", transient="eg_contact_decay.aenv"
            )
        if any(p["precursor"][i] > 0.0001 for p in pick_profiles):
            excitation += f"+strength*{high_register}*{pick_curve('precursor', i)}*(1-pickrise)*(1-pickrise)*pickdecay"
            contact_sources.update(
                strength="eg_pick.iout", pickrise="eg_pick_rise.aenv", pickdecay="eg_pick_decay.aenv"
            )
        formula(
            prefix + "_osc.amp",
            f"{tuning.get('source_gain', 0.3)}*ampdb({level}+{compensation}+{12 + 6 * math.log2(harmonic):.8g}*(.28-colour))*velocity*({excitation})*decay*{nyquist}",
            hz=pitch,
            colour="eg_pickup.iout",
            velocity="amp_velocity_envelope.kout",
            rise=prefix + "_rise.aenv",
            decay=prefix + "_decay.aenv",
            **contact_sources,
        )
        formula(
            prefix + "_osc.freq", f"hz*{ratio}*ampdb(cents*0.0050171665944)", hz=pitch, cents="eg_vibrato_smooth.kout"
        )
        sums[f"h{harmonic}"] = prefix + "_osc.asig"
    node("eg_string_sum", "a_mul", 8750, -500, b=1)
    formula("eg_string_sum.a", " + ".join(sums), **sums)
    node("eg_pick_rise", "expsega", 1400, 5900, ia=1, idur1=0.0018 * 9.21034, ib=0.0001, idur2=1, ic=1e-12)
    node("eg_pick_decay", "expsega", 1400, 6330, ia=1, idur1=0.007 * 6.907755, ib=0.001, idur2=0.1, ic=1e-12)
    formula("eg_pick_rise.idur1", f"(.0018-.0014*{high_register})*9.21034", hz=pitch)
    formula("eg_pick_decay.idur1", f"(.007-.003*{high_register})*6.907755", hz=pitch)
    node("eg_pick_noise", "noise", 2050, 5900, beta=0)
    formula(
        "eg_pick_noise.amp",
        f"{curve('pick_gain')}*(1+.5*{high_register})*strength*velocity*(1-rise)*(1-rise)*decay",
        hz=pitch,
        strength="eg_pick.iout",
        velocity="amp_velocity_envelope.kout",
        rise="eg_pick_rise.aenv",
        decay="eg_pick_decay.aenv",
    )
    node("eg_pick_hp", "butterhp", 2550, 5900, xfreq=1500)
    formula("eg_pick_hp.asig", "noise", noise="eg_pick_noise.aout")
    node("eg_pick_lp", "butterlp", 3000, 5900, xfreq=5000)
    formula("eg_pick_lp.asig", "noise", noise="eg_pick_hp.aout")
    node("eg_amp", "tanh", 9250, -500)
    formula(
        "eg_amp.xin",
        "(string+pick)*ampdb(drive)",
        string="eg_string_sum.aout",
        pick="eg_pick_lp.aout",
        drive="eg_drive.iout",
    )
    node("eg_cabinet", "butterlp", 9700, -500)
    formula("eg_cabinet.asig", "signal", signal="eg_amp.aout")
    formula("eg_cabinet.xfreq", "tone*1.4/(1+2*mute)", tone="eg_tone.iout", mute="eg_mute.iout")
    node("eg_dc", "butterhp", 10150, -500, xfreq=30)
    formula("eg_dc.asig", "signal", signal="eg_cabinet.aout")
    node("eg_gain", "upsamp", 9700, 0)
    formula(
        "eg_gain.ksig",
        f"{tuning.get('output_gain', 0.4)}*ampdb(level-drive*.65)",
        level="eg_level.iout",
        drive="eg_drive.iout",
    )
    formula("output_pan2.asig", "signal*gain", signal="eg_dc.aout", gain="eg_gain.aout")
    formula("output_pan2.xp", ".5-.28*width", width="eg_width.iout")
    node("eg_width_right", "vdelay3", 11050, 0, imd=1)
    formula("eg_width_right.asig", "signal", signal="output_pan2.aright")
    formula("eg_width_right.adel", ".55*width", width="eg_width.iout")
    formula("output_right.asignal", "signal", signal="eg_width_right.aout")
    layout = {
        "pitch_cpsmidi": (0, -750),
        "velocity_scale_const": (-400, -250),
        "velocity_ampmidi": (0, -250),
        "amp_velocity_envelope": (450, -250),
        "output_pan2": (10600, -500),
        "output_left": (11500, -500),
        "output_right": (11500, 0),
    }
    for n in nodes:
        if n["id"] in layout:
            n["position"] = dict(zip(("x", "y"), layout[n["id"]]))
    used = {e["from_node_id"] for e in edges} | {e["to_node_id"] for e in edges}
    graph["nodes"] = [
        n for n in nodes if (n["id"] in used or n["opcode"] == "xtratim") and n["opcode"] != "outleta"
    ] + [n for n in nodes if n["opcode"] == "outleta"]
    validate_stereo_output(graph)
    require_const_i_connection(
        graph["nodes"],
        edges,
        target_node_id="velocity_ampmidi",
        target_port_id="iscal",
        expected_value=1.0,
        label="ampmidi Scale",
    )
    PatchCreateRequest.model_validate(payload)
    return payload
