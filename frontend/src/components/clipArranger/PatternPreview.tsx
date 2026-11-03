import { memo } from "react";
import { buildControllerCurvePath, buildSequencerStepChordMidiNotes } from "../../lib/sequencer";
import type { PatternDefinition } from "../../lib/clipArranger/model";
import type { ControllerSequencerMode, SequencerTimingConfig } from "../../types";

/** Fixed velocity/pitch scales keep neighboring clips comparable. No audio work lives here. */
export const PatternPreview = memo(function PatternPreview({ definition, timing, controllerMode = "curve", height = 24 }: {
  definition: PatternDefinition; timing?: SequencerTimingConfig; controllerMode?: ControllerSequencerMode; height?: number;
}) {
  const pad = definition.payload, width = 320;
  const steps = pad.lengthBeats * (timing?.stepsPerBeat ?? 4);
  const alpha = (velocity: number) => .2 + .8 * velocity / 127;
  const y = (pitch: number) => height - 2 - Math.max(0, Math.min(1, pitch / 127)) * (height - 4);
  if (definition.source === "arpeggiator") {
    const p = definition.payload;
    return <span className="block truncate px-1 font-mono text-[10px] text-cyan-200" title={`${p.pattern} · ${p.octaves} oct · ${p.rate} · gate ${Math.round(p.gateRatio * 100)}% · ${p.steps.length} steps`}>
      {p.pattern.replace(/_/g, " ")} · {p.octaves} oct · {p.rate} · {Math.round(p.gateRatio * 100)}% · {p.steps.length} steps
    </span>;
  }
  return <svg role="img" aria-label={definition.name} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="overflow-hidden">
    <title>{definition.name}{"scaleRoot" in definition.payload ? ` · ${definition.payload.scaleRoot} ${definition.payload.mode} · MIDI 0–127` : ""}</title>
    {definition.source === "controller" ? controllerMode === "curve"
      ? <path d={buildControllerCurvePath(definition.payload.keypoints, width, height - 2)} fill="none" stroke="#5eead4" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      : definition.payload.steps.slice(0, steps).map((value, i) => value === null ? null : <rect key={i} x={i / steps * width} y={height - Math.max(1, value / 127 * height)} width={Math.max(1, width / steps - 1)} height={Math.max(1, value / 127 * height)} fill="#5eead4"><title>{`CC ${value}`}</title></rect>)
      : definition.source === "drummer" ? definition.payload.rows.flatMap((row, rowIndex, rows) => row.steps.slice(0, steps).flatMap((cell, i) => {
        if (!cell.active) return [];
        const ratchets = cell.ratchets ?? 1;
        return Array.from({ length: ratchets }, (_, r) => {
          const velocity = ratchets > 1 ? cell.velocity + ((cell.ratchetEndVelocity ?? cell.velocity) - cell.velocity) * r / (ratchets - 1) : cell.velocity;
          const x = (i + (cell.timingOffsetPercent ?? 0) / 100 + r / ratchets) / steps * width;
          return <circle key={`${rowIndex}:${i}:${r}`} cx={Math.max(1.5, x)} cy={(rowIndex + .5) / rows.length * height} r={Math.min(2.6, height / rows.length / 3)} fill={`hsl(${30 + velocity / 127 * 20} 90% ${25 + velocity / 127 * 50}%)`}><title>{`${row.rowId} · velocity ${Math.round(velocity)} · ${ratchets}×`}</title></circle>;
        });
      }))
      : definition.source === "score" ? definition.payload.notes.filter(n => n.startTicks < pad.lengthBeats * 20160 * 4 / (timing?.meterDenominator ?? 4)).map(note => {
        const duration = pad.lengthBeats * 20160 * 4 / (timing?.meterDenominator ?? 4);
        return <rect key={note.id} x={note.startTicks / duration * width} y={y(note.pitch)} width={Math.max(1.5, note.durationTicks / duration * width)} height="2.5" rx="1" fill="#a5b4fc" opacity={alpha(note.velocity)}><title>{`${note.pitch} · velocity ${note.velocity}`}</title></rect>;
      }) : definition.payload.steps.slice(0, steps).flatMap((step, i, all) => {
        const p = definition.payload;
        if (step.hold) return [];
        const notes = buildSequencerStepChordMidiNotes(step.note, step.chord, p.scaleRoot, p.mode);
        if (step.strumDirection === "down") notes.reverse();
        let duration = 1;
        while (all[i + duration]?.hold) duration++;
        return notes.map((pitch, j) => {
          const stagger = step.strumDirection && step.strumDirection !== "off" && notes.length > 1 ? (step.strumSpreadPercent ?? 0) / 100 * j / (notes.length - 1) : 0;
          const x = (i + (step.timingOffsetPercent ?? 0) / 100 + stagger) / steps * width;
          return <rect key={`${i}:${pitch}`} x={Math.max(0, x)} y={y(pitch)} width={Math.max(1.5, duration / steps * width - 1)} height="2.5" rx="1" fill="#6ee7b7" opacity={alpha(step.velocity)}><title>{`${pitch} · velocity ${step.velocity}`}</title></rect>;
        });
      })}
  </svg>;
});
