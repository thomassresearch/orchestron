"""Apply measured C3–B4 envelopes using the existing harmonic orders.

The old C3 branch still supplies interpolation below C3. A strict MIDI mask
leaves those bass notes and C5 upward on their original synthesis paths.
All fitting data are numeric; rebuilding never needs reference recordings.
"""

import numpy as np

KEYS = [48, 51, 54, 57, 60, 63, 66, 69]
VELS = [40, 60, 92, 124]
TIMES = [0, 0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 1.2, 1.5, 2, 3, 4, 6, 13]
ENV_NODES = {"core": "piano_middle_decay", "p2": "piano_spectral_env_0", "p4": "piano_spectral_env_2"}
PORTS = ["ia", "ib", "ic", "id", "ie"]


def amplitude_formula(rows, index, boundary, b):
    # Interpolate in dB over key and velocity, keeping the existing below-40 scaling.
    values = np.array([[r["levels"][index] for r in rows if r["velocity"] == v] for v in VELS])
    values = np.c_[values, boundary]
    values = 20 * np.log10(np.maximum(values, 1e-30))
    splines = [b.interp("note", KEYS + [72], values[j]) for j in range(4)]
    expr = splines[0]
    for j in range(3):
        expr += f" + ({splines[j + 1]} - {splines[j]}) * {b.ramp('velocity * 127', VELS[j], VELS[j + 1])}"
    return "ampdb(" + expr + ")"


def velocity_basis(data, key):
    profiles = [next(q["tracks"] for q in data["profiles"] if q["key"] == key and q["velocity"] == v) for v in VELS]
    numbers = sorted({t["partial"] for profile in profiles for t in profile})
    curves = np.array(
        [
            [next((t["levels"][:13] for t in profile if t["partial"] == n), [0] * 13) for n in numbers]
            for profile in profiles
        ]
    )
    vectors = curves.reshape(4, -1)
    if not data.get("compress_velocity", False):
        return VELS, np.eye(4), [0.0] * 4
    choices = []
    for selected in [[0, 3], [0, 1, 3], [0, 2, 3], [0, 1, 2, 3]]:
        coeff = np.zeros((4, len(selected)))
        errors = []
        for j in range(4):
            if j in selected:
                coeff[j, selected.index(j)] = 1
                errors.append(0.0)
                continue
            weights = np.tile(1 / np.maximum(np.linalg.norm(curves[j], axis=0), 1e-9), len(numbers))
            faces = []
            for mask in range(1, 1 << len(selected)):
                active = [i for i in range(len(selected)) if mask & (1 << i)]
                cols = [selected[i] for i in active]
                fit = np.linalg.lstsq(vectors[cols].T * weights[:, None], vectors[j] * weights, rcond=None)[0]
                if np.any(fit < 0):
                    continue
                c = np.zeros(len(selected))
                c[active] = fit
                faces.append((np.linalg.norm((vectors[selected].T @ c - vectors[j]) * weights), c))
            coeff[j] = min(faces, key=lambda pair: pair[0])[1]
            pred = vectors[selected].T @ coeff[j]
            error = np.average(
                abs(20 * np.log10(np.maximum(pred, 1e-12) / np.maximum(vectors[j], 1e-12))),
                weights=(vectors[j] * weights) ** 2,
            )
            errors.append(float(error))
        if max(errors) <= 0.25:
            choices.append((len(selected), max(errors), selected, coeff, errors))
    _, _, selected, coeff, errors = min(choices, key=lambda c: (c[0], c[1]))
    return [VELS[i] for i in selected], coeff, errors


def apply_middle_refinement(patch, data, dest, b):
    """Mutate an authored graph; b supplies the common graph/HETRO helpers."""
    assert data["keys"] == KEYS and data["velocities"] == VELS and data["bank_times"] == TIMES
    g = patch["graph"]
    mask = f"({b.ramp('note', 47, 48)} - {b.ramp('note', 71, 72)})"
    if "second_partial_core_cut_db" in data:
        original = b.SOURCE_FORMULAS["piano_bass_radiation::kv"]["expression"]
        cut = b.interp("note", KEYS + [72], data["second_partial_core_cut_db"] + [0.0])
        b.formula(g, "piano_bass_radiation.kc", f"hz * (1 + {mask})", hz="pitch_cpsmidi.kfreq", note="piano_note.inote")
        b.formula(
            g,
            "piano_bass_radiation.kv",
            f"({original}) * (1 - {mask}) + ampdb({cut}) * {mask}",
            note="piano_note.inote",
        )
        b.formula(g, "piano_bass_radiation.kq", f"3 + 6 * {mask}", note="piano_note.inote")
    remove = set()
    old_blocks = [f"hetro_register_{k}" for k in [57, 60, 63, 66, 69]]
    for block in old_blocks:
        remove.add(block)
        for case in g["control_flow"].pop(block)["cases"]:
            remove.update(case["node_ids"])
        g["ui_layout"]["control_flow_blocks"].pop(block)
    g["nodes"] = [n for n in g["nodes"] if n["id"] not in remove]
    g["connections"] = [
        e for e in g["connections"] if e["from_node_id"] not in remove and e["to_node_id"] not in remove
    ]
    for category in ["input_formulas", "adsyn_nodes"]:
        g["ui_layout"][category] = {k: v for k, v in g["ui_layout"][category].items() if k.split("::")[0] not in remove}
    lhs = g["ui_layout"]["input_formulas"]["hetro_register_48::lhs"]
    b.formula(g, "hetro_register_48.lhs", f"({lhs['expression']}) * (1 - {mask})", note="piano_note.inote")
    for part, ident in ENV_NODES.items():
        for index, port in enumerate(PORTS):
            if part != "core" and port == "ie":
                continue
            original = b.SOURCE_FORMULAS.get(ident + "::" + port)
            old = original["expression"] if original else str(b.SOURCE_NODES[ident]["params"][port])
            boundary = [b.evaluate(ident + "." + port, 72, v) for v in VELS]
            if part == "core":
                boundary = [
                    min(value, b.evaluate("piano_middle_decay_bound.xmax", 72, v)) for value, v in zip(boundary, VELS)
                ]
            expr = f"({old}) * (1 - {mask}) + {amplitude_formula(data['envelopes'][part], index, boundary, b)} * {mask}"
            b.formula(g, ident + "." + port, expr, note="piano_note.inote", velocity="velocity_ampmidi.iamp")
    # Bound a rising final exponential at its largest authored level; allow normal declining curves.
    peak = [dict(r, levels=[max(r["levels"])]) for r in data["envelopes"]["core"]]
    old = b.SOURCE_FORMULAS["piano_middle_decay_bound::xmax"]["expression"]
    b.formula(
        g,
        "piano_middle_decay_bound.xmax",
        f"({old}) * (1 - {mask}) + {amplitude_formula(peak, 0, [b.evaluate('piano_middle_decay_bound.xmax', 72, v) for v in VELS], b)} * {mask}",
        note="piano_note.inote",
        velocity="velocity_ampmidi.iamp",
    )
    banks = {f"r{k}": f"hetro_register_{k}.left" for k in b.KEYS if k not in [57, 60, 63, 66, 69]}
    audit = []
    for ki, key in enumerate(KEYS):
        block = f"hetro_middle_{key}"
        x, y = 100 + (ki % 3) * 1500, 15000 + (ki // 3) * 2000
        w = b.weight("note", KEYS + [72], ki)
        b.node(g, block, "If", dict(rhs=1e-7), x, y)
        b.formula(g, block + ".lhs", w + " * " + mask, note="piano_note.inote")
        ids = []
        outputs = {}
        selected, coeff, errors = velocity_basis(data, key)
        audit.append(dict(key=key, stored_velocities=selected, gain_coefficients=coeff.tolist(), bank_error_db=errors))
        for vi, v in enumerate(selected):
            tracks = next(q["tracks"] for q in data["profiles"] if q["key"] == key and q["velocity"] == v)
            tracks = [t for t in tracks if max(t["levels"]) > 1e-10]
            norm = 30000 / max(max(t["levels"]) for t in tracks)
            lines = [f"HETRO {len(tracks)}"]
            for t in tracks:
                points = b.breakpoints(TIMES, t["levels"], norm)
                frequency = round(250 * t["ratio"])
                assert 0 < frequency <= 32767
                lines.append("-1," + ",".join(f"{ms},{value}" for ms, value in points) + ",32767")
                lines.append(f"-2,0,{frequency},13000,{frequency},32767")
            name = f"piano_middle_k{key}_v{v}.het"
            path = dest / "assets" / name
            path.write_text("\n".join(lines) + "\n", encoding="ascii")
            b.validate_adsyn_analysis(path)
            ident = block + f"_v{v}"
            b.node(g, ident, "adsyn", {}, x + 50 + (vi % 2) * 600, y + 200 + (vi // 2) * 350)
            g["ui_layout"]["adsyn_nodes"][ident] = dict(
                sampleAsset=dict(
                    asset_id=name[:-4],
                    original_name=name,
                    stored_name=name,
                    content_type="application/octet-stream",
                    size_bytes=path.stat().st_size,
                ),
                samplePath="",
            )
            vg = b.interp("velocity * 127", VELS, coeff[:, vi])
            under = "(velocity * 127 + 40 - abs(velocity * 127 - 40)) / 80"
            b.formula(
                g,
                ident + ".kamod",
                f"{65536 / norm:.12f} * {vg} * {w} * ({under}) * ampdb(dbamp(hardness / 3500) * 0.25 + (0.09 - strike) * 6)",
                velocity="velocity_ampmidi.iamp",
                note="piano_note.inote",
                hardness="piano_hardness.iout",
                strike="piano_strike.iout",
            )
            b.formula(g, ident + ".kfmod", "hz / 250", hz="pitch_cpsmidi.kfreq")
            b.formula(
                g,
                ident + ".ksmod",
                "4 / decay * (1 + loss / 0.002 * 0.25) / 1.25",
                decay="piano_decay.iout",
                loss="piano_loss.iout",
            )
            ids.append(ident)
            outputs[f"v{v}"] = ident + ".ares"
        result = block + "_result"
        silent = block + "_silent"
        b.node(g, result, "CaseResult", {}, x + 750, y + 1050)
        b.node(g, silent, "CaseResult", {}, x + 750, y + 1500)
        b.formula(g, result + ".left", " + ".join(outputs), **outputs)
        g["control_flow"][block] = dict(
            kind="if",
            output_format="mono",
            operator=">",
            cases=[
                dict(
                    id=block + "_active",
                    name=f"MIDI {key} refined profile",
                    value=None,
                    node_ids=ids + [result],
                    result_node_id=result,
                    silence=False,
                ),
                dict(
                    id=block + "_off",
                    name="Outside register",
                    value=None,
                    node_ids=[silent],
                    result_node_id=silent,
                    silence=True,
                ),
            ],
        )
        g["ui_layout"]["control_flow_blocks"][block] = True
        banks[f"m{key}"] = block + ".left"
    b.formula(g, "hetro_tone.asig", " + ".join(banks), **banks)
    return audit
