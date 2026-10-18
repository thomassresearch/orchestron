"""Exact piecewise-quadratic joint tuning and pitch-collection fit."""
import numpy as np

NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
COLLECTIONS = {"major": (0, 2, 4, 5, 7, 9, 11), "natural minor": (0, 2, 3, 5, 7, 8, 10)}


def fit_scales(pitches: list[float]) -> dict:
    values = np.asarray(pitches, dtype=float)
    if not len(values) or not np.all(np.isfinite(values)):
        raise ValueError("Scale fitting requires finite detected note pitches")
    candidates = []
    for tonic in range(12):
        for mode, offsets in COLLECTIONS.items():
            pcs = sorted((tonic+p) % 12 for p in offsets)
            targets = np.array([p for p in range(int(np.floor(values.min()))-14,
                                               int(np.ceil(values.max()))+15) if p % 12 in pcs])
            # Assignments change only when a pitch crosses a midpoint between scale notes.
            midpoints = (targets[:-1]+targets[1:])/2
            switches = (values[:, None]-midpoints).ravel()
            boundaries = np.unique(np.r_[-.5, switches[(switches > -.5) & (switches < .5)], .5])
            fits = []
            for lo, hi in zip(boundaries[:-1], boundaries[1:]):
                indices = np.abs(values[:, None]-(lo+hi)/2-targets).argmin(axis=1)
                chosen = targets[indices]
                tuning = float(np.clip(np.mean(values-chosen), lo, hi))
                error = float(np.sum((values-chosen-tuning)**2))
                fits.append((error, tuning, chosen))
            best = min(f[0] for f in fits)
            seen = set()
            for error, tuning, chosen in fits:
                signature = (round(tuning, 10), tuple(chosen))
                if error > best+1e-10 or signature in seen:
                    continue
                seen.add(signature)
                candidates.append({"name": f"{NAMES[tonic]} {mode}", "tonic": tonic, "mode": mode,
                                   "pitch_classes": pcs, "tuning_cents": tuning*100,
                                   "squared_error_cents": error*10000,
                                   "midi_pitches": chosen.tolist()})
    candidates.sort(key=lambda c: (round(c["squared_error_cents"], 7), abs(c["tuning_cents"]),
                                   c["tonic"], c["mode"]))
    minimum = candidates[0]["squared_error_cents"]
    tied = [c for c in candidates if c["squared_error_cents"] <= minimum+1e-6]
    return {"objective": "Unweighted sum of squared cents errors across robust note medians",
            "tuning_bound_cents": [-50, 50], "tied_candidates": tied,
            "all_candidates": candidates, "selected_for_preview": tied[0],
            "ambiguous_pitch_mapping": len({tuple(c["midi_pitches"]) for c in tied}) > 1,
            "interpretation": "Pitch collections, not evidence of a unique tonal key"}
