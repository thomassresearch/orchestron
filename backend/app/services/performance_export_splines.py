"""Export authored Catmull–Rom patterns with their sampled playback clock.

The capture runtime supplies occurrences, so this does not implement a second
arranger. A destination is used only after its reconstructed event stream agrees
with capture, including rounding, rests, partial exports and final held values.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import math
import re

from backend.app.models.controller_curve import normalize_controller_keypoints
from backend.app.models.sequencer_constants import CONTROLLER_AUTOMATION_SUBUNIT_QUANTUM as QUANTUM
from backend.app.services.performance_export_curves import curve_controller_indices

SPLINE_INSTRUMENT = 8983


@dataclass
class CurveOccurrence:
    start: float
    end: float
    origin: float
    duration: int
    points: tuple[tuple[float, int], ...]
    events: tuple
    first_offset: int


class SplineCapture:
    def __init__(self, request, default_channels, sample_rate):
        self.sample_rate = sample_rate
        self.eligible = curve_controller_indices(request.sequencer_config.controller_tracks, default_channels)
        self.tracks = {track.track_id: track for track in request.sequencer_config.controller_tracks
                       if any((ch - 1) * 128 + track.controller_number in self.eligible
                              for ch in track.target_channels or default_channels)}
        self.points = {(track.track_id, pad.pad_index): normalize_controller_keypoints(pad.keypoints)
                       for track in self.tracks.values() for pad in track.pads}
        self.spans = defaultdict(list)
        self.states = {}
        self.open = {}
        self.quantum_samples = 0.0

    def observe(self, runtime, config, subunit, seconds):
        sample = float(f"{seconds:.10f}") * self.sample_rate
        per_subunit = config.timing.transport_subunit_duration_seconds * self.sample_rate
        self.quantum_samples = per_subunit * QUANTUM
        for identity in self.tracks:
            track = config.controller_tracks[identity]
            active = track.enabled and not runtime._controller_pause_token_active(track)
            state = (track.active_pad, track.phase_offset_subunit, active)
            if self.states.get(identity) == state:
                continue
            self.states[identity] = state
            if identity in self.open:
                self.open.pop(identity).end = sample
            if not active:
                continue
            pad = runtime._active_pad_runtime(track)
            if pad is None:
                continue
            offset = runtime._local_transport_offset_for(track, subunit)
            occurrence = CurveOccurrence(sample, sample, seconds * self.sample_rate - offset * per_subunit,
                pad.transport_subunit_count, self.points[(identity, track.active_pad)], pad.events, offset)
            self.open[identity] = occurrence
            for channel in track.target_channels:
                index = (channel - 1) * 128 + track.controller_number
                if index in self.eligible:
                    self.spans[index].append(occurrence)

    def finish(self, sample):
        for span in self.open.values():
            span.end = sample
        self.open.clear()

    def validated(self, events):
        actual = defaultdict(dict)
        for event in events:
            status, cc, value = event.message
            if status & 0xF0 == 0xB0:
                actual[(status & 15) * 128 + cc][round(float(f"{event.time_seconds:.6f}") * self.sample_rate)] = value
        result = {}
        for index, spans in self.spans.items():
            predicted = {}
            for span in spans:
                if span.end <= span.start:
                    continue
                before = [e for e in span.events if e.offset_subunit <= span.first_offset]
                if before:
                    predicted[round(float(f"{span.start / self.sample_rate:.6f}") * self.sample_rate)] = before[-1].value
                for event in span.events:
                    if event.offset_subunit <= span.first_offset:
                        continue
                    due = span.origin + event.offset_subunit / QUANTUM * self.quantum_samples
                    sample = round(float(f"{due / self.sample_rate:.6f}") * self.sample_rate)
                    if sample >= round(span.end):
                        break
                    # The helper's inverse clock must agree at both sides of the
                    # rounded boundary. Ambiguous half-sample timing falls back.
                    q = event.offset_subunit // QUANTUM
                    def grid_at(at):
                        candidate = math.floor((at - span.origin + .499999) / self.quantum_samples)
                        def due_at(n):
                            seconds = (span.origin + n * self.quantum_samples) / self.sample_rate
                            return math.floor(.5 + math.floor(.5 + seconds * 1e6) / 1e6 * self.sample_rate)
                        return candidate + 1 if due_at(candidate + 1) <= at else candidate - 1 if due_at(candidate) > at else candidate
                    if grid_at(sample) != q or grid_at(sample - 1) >= q:
                        predicted = {}
                        break
                    predicted[sample] = event.value
                if not predicted:
                    break
            if not predicted:
                continue
            # Before the first occurrence the stored manual/default state stays
            # authoritative. All later changes must be explained by the curve.
            first = min(predicted)
            expected = {t: v for t, v in actual[index].items() if t >= first}
            def changes(stream):
                previous = None
                result = []
                for t, value in sorted(stream.items()):
                    if value != previous:
                        result.append((t, value))
                        previous = value
                return result
            if changes(predicted) == changes(expected):
                result[index] = [span for span in spans if span.end > span.start]
        return result


def _lookup_opcode(rate):
    """Same math for note initialization and the shared continuous CC writer."""
    v = rate
    lines = [f"opcode VcsSpline{rate.upper()}, {rate}, i{rate}", f" iroute, {v}sample xin",
        " ibegin = gi_vcs_spline_routes[iroute * 2]", " icount = gi_vcs_spline_routes[iroute * 2 + 1]"]
    if rate == "k":
        lines += [" kcachedrow init -1", " kcachedq init -1", " kvalue init -1"]
    lines += [f" {v}lo = 0", f" {v}hi = icount",
        f" while {v}lo < {v}hi do", f"  {v}mid = int(({v}lo + {v}hi) / 2)",
        (f"  if floor(.5 + floor(.5 + gi_vcs_spline_spans[(ibegin + {v}mid) * 4] / sr * 1e6) / 1e6 * sr) <= {v}sample then"
         if rate == "k" else f"  if gi_vcs_spline_spans[(ibegin + {v}mid) * 4] <= {v}sample then"),
        f"   {v}lo = {v}mid + 1", "  else", f"   {v}hi = {v}mid", "  endif", " od",
        f" {v}row = {v}lo - 1", f" if {v}row < 0 then", f"  {v}value = -1", " else",
        f"  {v}base = (ibegin + {v}row) * 4", f"  {v}at = min({v}sample, round(gi_vcs_spline_spans[{v}base + 1]) - 1)",
        f"  {v}pad = gi_vcs_spline_spans[{v}base + 3] * 3",
        f"  {v}duration = gi_vcs_spline_pads[{v}pad + 2]",
        f"  {v}q = floor(({v}at - gi_vcs_spline_spans[{v}base + 2] + {'.499999' if rate == 'k' else '0'}) / gi_vcs_spline_quantum)"]
    if rate == "i":
        # SCORE setters use ten decimals, notes six. At a shared sample their
        # textual p2 order still decides which value note initialization sees.
        # Csound 6 x86 floor conversion overflows signed 32 bits at 0.215s
        # when scaling by 1e10. Split the decimal rounding into small operands.
        for name, offset in (("inext", "iq + 1"), ("iprev", "iq")):
            lines += [f"  {name} = (gi_vcs_spline_spans[ibase + 2] + ({offset}) * gi_vcs_spline_quantum) / sr * 1e4",
                      f"  {name}whole = floor({name})",
                      f"  {name} = ({name}whole / 1e4 + floor(.5 + ({name} - {name}whole) * 1e6) / 1e10) * sr"]
        lines += ["  iq = (inext <= iat ? iq + 1 : (iprev > iat ? iq - 1 : iq))"]
    else:
        # Ordinary CC score timestamps have six decimals before Csound rounds
        # them to samples. Near a half sample this differs from rounding the
        # unformatted capture time directly, even at integer global tempi.
        lines += ["  knext = floor(.5 + floor(.5 + (gi_vcs_spline_spans[kbase + 2] + (kq + 1) * gi_vcs_spline_quantum) / sr * 1e6) / 1e6 * sr)",
                  "  kprev = floor(.5 + floor(.5 + (gi_vcs_spline_spans[kbase + 2] + kq * gi_vcs_spline_quantum) / sr * 1e6) / 1e6 * sr)",
                  "  kq = (knext <= kat ? kq + 1 : (kprev > kat ? kq - 1 : kq))"]
    lines += [f"  {v}q = limit({v}q, 0, ceil({v}duration) - 1)"]
    if rate == "k":
        lines += ["  if krow != kcachedrow || kq != kcachedq then", "   kcachedrow = krow", "   kcachedq = kq"]
    lines += [f"  {v}t = {v}q / {v}duration", f"  {v}first = gi_vcs_spline_pads[{v}pad]",
        f"  {v}last = {v}first + gi_vcs_spline_pads[{v}pad + 1] - 1", f"  {v}seg = {v}first",
        f"  while {v}seg < {v}last - 1 && {v}t > gi_vcs_spline_points[({v}seg + 1) * 2] do",
        f"   {v}seg += 1", "  od",
        f"  {v}t = limit(({v}t - gi_vcs_spline_points[{v}seg * 2]) / max(.000001, gi_vcs_spline_points[({v}seg + 1) * 2] - gi_vcs_spline_points[{v}seg * 2]), 0, 1)",
        f"  {v}p0 = gi_vcs_spline_points[max({v}first, {v}seg - 1) * 2 + 1]",
        f"  {v}p1 = gi_vcs_spline_points[{v}seg * 2 + 1]",
        f"  {v}p2 = gi_vcs_spline_points[({v}seg + 1) * 2 + 1]",
        f"  {v}p3 = gi_vcs_spline_points[min({v}last, {v}seg + 2) * 2 + 1]",
        f"  {v}t2 = {v}t * {v}t", f"  {v}t3 = {v}t2 * {v}t",
        f"  {v}c0 = 2 * {v}p1", f"  {v}c1 = -{v}p0 + {v}p2",
        f"  {v}c2 = 2 * {v}p0 - 5 * {v}p1 + 4 * {v}p2 - {v}p3",
        f"  {v}c3 = -{v}p0 + 3 * {v}p1 - 3 * {v}p2 + {v}p3",
        f"  {v}raw = .5 * ({v}c0 + {v}c1 * {v}t + {v}c2 * {v}t2 + {v}c3 * {v}t3)",
        f"  {v}value = floor({v}raw)", f"  {v}fraction = {v}raw - {v}value",
        f"  if {v}fraction > .5 || ({v}fraction == .5 && {v}value % 2 != 0) then",
        f"   {v}value += 1", "  endif", f"  {v}value = limit({v}value, 0, 127)"]
    if rate == "k":
        lines += ["  endif"]
    return [*lines, " endif", f" xout {v}value", "endop"]


class SplineExport:
    def __init__(self, capture, events, used_indices, mapped_indices):
        validated = capture.validated(events)
        self.spans = {index: spans for index, spans in sorted(validated.items())
                      if (used_indices is None or index in used_indices) or index in mapped_indices}
        self.routes = {index: route for route, index in enumerate(self.spans)}
        self.raw_indices = set(self.routes) if used_indices is None else set(self.routes) & used_indices
        self.quantum_samples = capture.quantum_samples
        self.mapped_indices = mapped_indices
        self.mapped_slots = set()

    def rewrite(self, orchestra, targets, manifest):
        if not self.routes:
            return orchestra
        bindings = manifest.get("performanceControllers", {})
        slot = 0
        mapped = {}
        for identity, controllers in bindings.items():
            target = next((t for n, t in enumerate(targets, 1) if (t.assignment_id or f"instrument-{n}") == identity), None)
            for node, binding in controllers.items():
                cc = target.performance_controller_midi_ccs.get(node) if target else None
                index = (target.midi_channel - 1) * 128 + cc if cc is not None else -1
                if (index in self.routes and index in self.mapped_indices and not target.always_on
                    and identity not in manifest.get("legatoInstanceIds", [])):
                    mapped[binding["channel"]] = (self.routes[index], binding)
                    self.mapped_slots.add(slot)
                slot += 1
        def replace(match):
            variable, channel = match.group(1), match.group(2)
            if channel not in mapped:
                return match[0]
            route, b = mapped[channel]
            lo, hi = format(b["min"], ".17g"), format(b["max"], ".17g")
            # Preserve the Python mapping's arithmetic order and endpoints.
            value = (f"exp((1 - i_vcs_cc / 127) * log({lo}) + (i_vcs_cc / 127) * log({hi}))"
                     if b["scale"] == "logarithmic" else f"(1 - i_vcs_cc / 127) * ({lo}) + (i_vcs_cc / 127) * ({hi})")
            if b["controller_type"] == "bool":
                value = "(i_vcs_cc >= 64 ? 1 : 0)"
            lines = [match[0], f" i_vcs_cc VcsSplineI {route}, p2 * sr",
                     " if i_vcs_cc >= 0 then", f"  {variable} = {value}"]
            if b["controller_type"] == "integer":
                lines.append(f"  {variable} = floor({variable} + .5)")
            lines += [f"  {variable} = (i_vcs_cc <= 0 ? {lo} : (i_vcs_cc >= 127 ? {hi} : limit({variable}, {lo}, {hi})))", " endif"]
            return "\n".join(lines)
        orchestra = re.sub(r'\b(i\w+) chnget "(__vcs_perf_[a-f0-9]+)"', replace, orchestra)
        points, pads, spans, routes = [], [], [], []
        point_ids, pad_ids = {}, {}
        for occurrences in self.spans.values():
            routes.extend([len(spans) // 4, len(occurrences)])
            for span in occurrences:
                if span.points not in point_ids:
                    point_ids[span.points] = len(points) // 2
                    points.extend(value for point in span.points for value in point)
                key = (span.points, span.duration)
                if key not in pad_ids:
                    pad_ids[key] = len(pads) // 3
                    pads.extend([point_ids[span.points], len(span.points), span.duration / QUANTUM])
                spans.extend([span.start, span.end, span.origin, pad_ids[key]])
        prefix = ["; Original Catmull-Rom controller patterns; sampled and rounded like sequencer playback.",
                  f"gi_vcs_spline_quantum = {self.quantum_samples:.17g}"]
        for name, values in (("points", points), ("pads", pads), ("spans", spans), ("routes", routes)):
            # Keep both source lines and opcode argument counts bounded.
            prefix.append(f"gi_vcs_spline_{name}[] init {len(values)}")
            for offset in range(0, len(values), 512):
                part = values[offset:offset + 512]
                chunks = [", ".join(format(v, ".17g") for v in part[i:i + 32]) for i in range(0, len(part), 32)]
                prefix.append("gi_vcs_spline_chunk[] fillarray " + (", " + chr(92) + "\n ").join(chunks))
                prefix += ["gi_vcs_spline_copy = 0", f"while gi_vcs_spline_copy < {len(part)} do",
                           f" gi_vcs_spline_{name}[{offset} + gi_vcs_spline_copy] = gi_vcs_spline_chunk[gi_vcs_spline_copy]",
                           " gi_vcs_spline_copy += 1", "od"]
        prefix += _lookup_opcode("i") + _lookup_opcode("k")
        first = re.search(r"^instr\b", orchestra, re.MULTILINE)
        orchestra = orchestra[:first.start()] + "\n".join(prefix) + "\n" + orchestra[first.start():]
        if self.raw_indices:
            lines = [f"instr {SPLINE_INSTRUMENT}", " ktime timek", " ksample = (ktime - 1) * ksmps"]
            for index in sorted(self.raw_indices):
                route = self.routes[index]
                lines += [f" kcc{route} VcsSplineK {route}, ksample", f" if kcc{route} >= 0 then",
                          f"  gk_vcs_score_cc[{index}] = kcc{route}", " endif"]
            orchestra += "\n" + "\n".join([*lines, "endin"])
        return orchestra
