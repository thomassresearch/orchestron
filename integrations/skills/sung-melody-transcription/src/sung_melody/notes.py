"""Conservative monophonic segmentation and explicit editorial provenance."""
from dataclasses import asdict, dataclass, replace

import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import find_peaks


@dataclass
class Note:
    id: str
    start: float
    end: float
    pitch: float
    confidence: float = 1.0
    attack: bool = False
    unstable: bool = False


def edit(log: list, kind: str, before, after, reason: str) -> None:
    def value(item):
        return asdict(item) if isinstance(item, Note) else item
    log.append({"kind": kind, "before": [value(n) for n in before],
                "after": [value(n) for n in after], "reason": reason})


def acoustic_events(audio: np.ndarray, sr: int, hop: int = 160,
                    detect_claps: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Separate broadband clap evidence from tonal energy attacks before note segmentation."""
    import librosa

    spectrum = np.abs(librosa.stft(audio, n_fft=512, hop_length=hop))
    harmonic, percussive = librosa.decompose.hpss(spectrum, kernel_size=17)
    high = spectrum[librosa.fft_frequencies(sr=sr, n_fft=512) >= 2500].sum(axis=0)
    total = spectrum.sum(axis=0) + 1e-10
    flatness = librosa.feature.spectral_flatness(S=spectrum)[0]
    flux = np.maximum(np.diff(percussive, prepend=percussive[:, :1], axis=1), 0).sum(axis=0)
    mad = np.median(np.abs(flux - np.median(flux)))
    floor = max(np.median(flux) + 6 * mad, np.max(flux) * 0.08, 1e-7)
    peaks, _ = find_peaks(flux, height=floor, distance=max(1, int(.16 * sr / hop)))
    claps = [p for p in peaks if high[p] / total[p] > .18 and flatness[p] > .025
             and percussive[:, p].sum() / total[p] > .5]
    if not detect_claps:
        claps = []
    # Tonal trough + recovery, not broadband flux, supplies repeated-vocal-attack evidence.
    energy = np.sqrt(np.mean(harmonic ** 2, axis=0))
    attacks = []
    for i in range(4, len(energy) - 4):
        before, after = np.median(energy[i-4:i]), np.median(energy[i:i+4])
        if before < after * .55 and after > np.max(energy) * .08:
            if not any(abs(i - c) * hop / sr < .09 for c in claps):
                if not attacks or (i - attacks[-1]) * hop / sr >= .09:
                    attacks.append(i)
    return np.asarray(claps, dtype=float) * hop / sr, np.asarray(attacks, dtype=float) * hop / sr


def segment(f0: np.ndarray, confidence: np.ndarray, claps: np.ndarray,
            attacks: np.ndarray, log: list, threshold: float = .03, dt: float = .01) -> list[Note]:
    pitch = np.full(len(f0), np.nan)
    voiced = (confidence > threshold) & (f0 > 0) & np.isfinite(f0)
    pitch[voiced] = 69 + 12 * np.log2(f0[voiced] / 440)
    notes = []
    edges = np.flatnonzero(np.diff(np.r_[False, voiced, False]))
    for a, b in zip(edges[::2], edges[1::2]):
        # Median filtering within a voiced run never smears pitches through silence.
        smoothed = median_filter(pitch[a:b], size=5, mode="nearest")
        cuts = [0]
        i = 1
        while i < len(smoothed):
            anchor = np.median(smoothed[cuts[-1]:i])
            future = smoothed[i:min(i+5, len(smoothed))]
            changed = (len(future) >= 4 and abs(np.median(future)-anchor) >= .65
                       and np.all(np.abs(future-anchor) >= .5))
            attack = (i - cuts[-1] >= 6 and np.any(np.abs(attacks-(a+i)*dt) < dt/2)
                      and not np.any(np.abs(claps-(a+i)*dt) < .09))
            if changed or attack:
                cuts.append(i)
                i += 4
            else:
                i += 1
        cuts.append(b-a)
        for left, right in zip(cuts[:-1], cuts[1:]):
            values = pitch[a+left:a+right]
            drift = float(np.percentile(values, 90)-np.percentile(values, 10))
            note = Note(f"n{len(notes)+1}", (a+left)*dt, (a+right)*dt,
                        float(np.median(values)), float(np.median(confidence[a+left:a+right])),
                        bool(np.any(np.abs(attacks-(a+left)*dt) < .04)), drift > .35)
            notes.append(note)
    # Only short isolated pitched transients near a clap are removed. A concurrent
    # sustained voice survives; broad suppression would erase genuine vocal notes.
    kept = []
    for i, note in enumerate(notes):
        isolated = ((i == 0 or note.start-notes[i-1].end > .06)
                    and (i+1 == len(notes) or notes[i+1].start-note.end > .06))
        unreliable = note.confidence < max(.15, threshold*3) or note.unstable
        if isolated and unreliable and note.end-note.start < .09 and np.any(np.abs(claps-note.start) < .06):
            edit(log, "clap_transient", [note], [], "Isolated short, unreliable pitch detection at a broadband clap")
        else:
            kept.append(note)
    return kept


def refine(notes: list[Note], log: list) -> list[Note]:
    notes = [replace(n) for n in notes]
    i = 0
    while i < len(notes)-1:
        left, right = notes[i:i+2]
        gap = right.start-left.end
        if gap <= .065 and abs(left.pitch-right.pitch) < .5 and not right.attack:
            # Longer unvoiced gaps are rests/repeated notes, even at identical pitch.
            merged = replace(left, end=right.end,
                             pitch=float(np.median([left.pitch, right.pitch])) if abs(gap) < .001
                             else (left.pitch*(left.end-left.start)+right.pitch*(right.end-right.start))
                             / (left.end-left.start+right.end-right.start),
                             confidence=min(left.confidence, right.confidence))
            edit(log, "merge_false_split", [left, right], [merged],
                 "Same sustained pitch across a short detector gap, without a tonal reattack")
            notes[i:i+2] = [merged]
            continue
        # Require moving pitch and phrase-edge position: stable grace notes and internal
        # ornaments are retained, even when short. A clap cannot manufacture an attack.
        onset = (i == 0 or left.start-notes[i-1].end > .065)
        release = (i+2 == len(notes) or notes[i+2].start-right.end > .065)
        if gap <= .015 and .4 < abs(left.pitch-right.pitch) <= 2.5:
            if onset and left.end-left.start <= .09 and left.unstable and right.end-right.start >= .16:
                merged = replace(right, id=left.id, start=left.start, attack=left.attack)
                edit(log, "remove_onset_scoop", [left, right], [merged],
                     "Brief moving pitch at phrase onset absorbed into the stable note")
                notes[i:i+2] = [merged]
                continue
            if release and right.end-right.start <= .09 and right.unstable and not right.attack:
                merged = replace(left, end=right.end)
                edit(log, "remove_release_dip", [left, right], [merged],
                     "Brief moving pitch at phrase release absorbed into the stable note")
                notes[i:i+2] = [merged]
                continue
        i += 1
    return notes
