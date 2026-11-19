import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ClipEditingContext } from "../clipArranger/context";
import { usePerformanceEditorState } from "./PerformanceEditorState";
import { MarkovGraph, graphColors } from "./MarkovGraph";
import { useMarkovAudition } from "./useMarkovAudition";
import {
  durationStates,
  durationLabel,
  generateMarkov,
  initialChain,
  learnChain,
  phraseLengths,
  remapChain,
  replaceRow,
  type Chain,
  type NamedChain,
  type MarkovEvent,
  type MarkovRecipe,
  type MarkovError,
} from "../../lib/markov";
import {
  drumHitKey,
  patternVocabulary,
  scalePitches,
  writeMarkovPattern,
  type GeneratedPattern,
} from "../../lib/markovPattern";
import { markovCopy } from "../../lib/markovCopy";
import { midiNoteLabel } from "../../lib/sequencer";
import { localBeatTicks } from "../../lib/clipArranger/model";
import { SCORE_MAX_PAD_NOTES, SCORE_MAX_TOTAL_NOTES } from "../../lib/scoreSequencer";
import { useAppStore } from "../../store/useAppStore";
import { sequencerEditAccess } from "../../store/sequencerEdits";
import type { GuiLanguage, DrummerSequencerRowState, ScorePadState, SequencerTimingConfig } from "../../types";
import "./markov.css";

type Settings = {
  recipe: MarkovRecipe;
  octave: number;
  selected: string[];
  groups: string[][];
  keepPitches?: boolean;
  keepDurations?: boolean;
  keptPitch?: NamedChain & { source: string };
  keptRhythm?: { chain: Chain; source: string };
};
type Take = { events: MarkovEvent[]; pattern: GeneratedPattern; labels: string[]; filters: string; rest: number };
type Props = {
  id: string;
  name: string;
  padIndex: number;
  pattern: GeneratedPattern;
  timing: SequencerTimingConfig;
  language: GuiLanguage;
  rows?: DrummerSequencerRowState[];
  onScoreApply?: (p: ScorePadState) => boolean;
};
const emptyRows: DrummerSequencerRowState[] = [];
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

function applySteps(id: string, padIndex: number, pattern: Exclude<GeneratedPattern, { source: "score" }>) {
  const access = sequencerEditAccess(useAppStore.setState, useAppStore.getState);
  const state = access.get().sequencer;
  if (pattern.source === "sequencer") {
    const tracks = state.tracks.map((t) =>
      t.id !== id
        ? t
        : {
            ...t,
            steps: pattern.payload.steps,
            pads: t.pads.map((p, i) => (i === padIndex ? pattern.payload : p)),
          },
    );
    access.set({ sequencer: { ...state, tracks } });
  } else {
    const drummerTracks = state.drummerTracks.map((t) =>
      t.id !== id ? t : { ...t, pads: t.pads.map((p, i) => (i === padIndex ? pattern.payload : p)) },
    );
    access.set({ sequencer: { ...state, drummerTracks } });
  }
}

export function MarkovGenerator(props: Props) {
  const clip = useContext(ClipEditingContext);
  const key = useAppStore((s) => (clip ? s.clipEditingKey : null));
  const gen = useAppStore((s) => s.performanceWorkspaceGeneration);
  const [open, setOpen] = useState<string | null>(null);
  const identity = JSON.stringify([gen, key, props.id, props.padIndex]);
  const setupKey = JSON.stringify([
    identity,
    props.pattern.payload.lengthBeats,
    props.timing.stepsPerBeat,
    props.rows?.map((r) => r.id),
    props.pattern.source !== "drummer" && props.pattern.payload.scaleRoot,
    props.pattern.source !== "drummer" && props.pattern.payload.mode,
  ]);
  const [saved, save] = usePerformanceEditorState<Settings | null>(
    `device:${props.id}`,
    "markov:" + setupKey,
    null,
  );
  return (
    <>
      <button type="button" className="mk-launch" onClick={() => setOpen(identity)}>
        {markovCopy[props.language].title}
      </button>
      {open === identity && (
        <GeneratorDialog
          key={setupKey}
          {...props}
          clipKey={key}
          saved={saved}
          save={save}
          close={() => setOpen(null)}
        />
      )}
    </>
  );
}

function GeneratorDialog({
  id,
  name,
  padIndex,
  pattern,
  rows = emptyRows,
  timing,
  language,
  clipKey,
  saved,
  save,
  close,
  onScoreApply,
}: Props & { clipKey: string | null; saved: Settings | null; save: (s: Settings) => void; close: () => void }) {
  const c = markovCopy[language],
    drum = pattern.source === "drummer",
    steps = pattern.payload.lengthBeats * timing.stepsPerBeat;
  const defaultDurations = useMemo(() => durationStates(timing.stepsPerBeat, steps), [timing.stepsPerBeat, steps]);
  const lengths = useMemo(() => phraseLengths(steps), [steps]);
  const [base] = useState(pattern);
  const [settings, setSettings] = useState<Settings>(
    () =>
      saved ?? {
        recipe: {
          pitch: initialChain(drum ? rows.length + 1 : 9, drum ? "hits" : "pitch"),
          rhythm: initialChain(defaultDurations.length, "rhythm"),
          pitchLength: steps,
          rhythmLength: steps,
          seed: seed(),
        },
        octave: 4,
        selected: rows.map((r) => r.id),
        groups: [],
      },
  );
  const { recipe: original, selected, groups, octave } = settings;
  const [combination, setCombination] = useState<string[]>([]);
  const source = useMemo(
    () => patternVocabulary(base, timing),
    [base, timing.meterDenominator, timing.stepsPerBeat],
  );
  const nonempty = source.durations.length > 0;
  const keepPitches = nonempty && !!settings.keepPitches;
  const keepDurations = nonempty && !!settings.keepDurations;
  const material = useMemo(
    () => (drum && selected.length !== rows.length ? patternVocabulary(base, timing, selected) : source),
    [base, source, drum, selected, rows.length],
  );
  const scale = useMemo(
    () => (base.source === "drummer" ? [] : scalePitches(base.payload, octave)),
    [base, octave],
  );
  const pitches = keepPitches ? material.pitches : scale;
  const allHits = useMemo(() => [...selected.map((row) => [row]), ...groups], [selected, groups]);
  const hits = useMemo(() => {
    if (!drum || !keepPitches) return allHits;
    const known = new Map<string, string[]>();
    for (const group of [...allHits, ...material.combinations]) {
      if (group.every((row) => material.drumRows.has(row))) known.set(drumHitKey(group), group);
    }
    return [...known.values()];
  }, [allHits, drum, keepPitches, material]);
  const durations = keepDurations ? material.durations : defaultDurations;
  const perStep = keepDurations ? material.unitsPerStep : 1;
  // In a groove, a Rest would skip an attack and join two allowed hit spacings.
  const hasRest = !(drum && keepDurations);
  const pitchStates = useMemo(() => [...(drum ? hits.map(drumHitKey) : pitches), "rest"], [drum, hits, pitches]);
  const fullPitchKeys = useMemo(() => pitchStates.map(String), [pitchStates]);
  const pitchKeys = useMemo(
    () => (hasRest ? fullPitchKeys : fullPitchKeys.slice(0, -1)),
    [fullPitchKeys, hasRest],
  );
  const durationKeys = useMemo(() => durations.map((n) => durationLabel(n, perStep)), [durations, perStep]);
  // Reopening an edited pad can give the same labels a different sequence of transitions.
  const pitchSource = useMemo(
    () => (keepPitches ? JSON.stringify(material.pitchEvents) : ""),
    [keepPitches, material],
  );
  const rhythmSource = useMemo(
    () => (keepDurations ? JSON.stringify(material.durationEvents) : ""),
    [keepDurations, material],
  );
  const learnedPitch = useMemo(
    () => (keepPitches ? learnChain(pitchStates, material.pitchEvents) : null),
    [keepPitches, pitchStates, material],
  );
  const fullPitch = useMemo(() => {
    if (!learnedPitch) return original.pitch;
    return settings.keptPitch?.source === pitchSource
      ? remapChain(settings.keptPitch, fullPitchKeys, drum ? "hits" : "pitch", learnedPitch)
      : learnedPitch;
  }, [original.pitch, settings.keptPitch, pitchSource, fullPitchKeys, drum, learnedPitch]);
  const pitch = useMemo(
    () => (hasRest ? fullPitch : remapChain({ keys: fullPitchKeys, chain: fullPitch }, pitchKeys, "hits")),
    [hasRest, fullPitch, fullPitchKeys, pitchKeys],
  );
  const rhythm = useMemo(() => {
    if (!keepDurations) return original.rhythm;
    if (settings.keptRhythm?.source === rhythmSource) return settings.keptRhythm.chain;
    return learnChain(durations, material.durationEvents);
  }, [keepDurations, settings.keptRhythm, rhythmSource, original.rhythm, durations, material]);
  const recipe = useMemo(
    () => ({
      ...original,
      pitch,
      rhythm,
      restState: hasRest ? pitchKeys.length - 1 : -1,
      pitchLength: original.pitchLength * perStep,
      rhythmLength: original.rhythmLength * perStep,
      maxNotes: base.source === "score" ? SCORE_MAX_PAD_NOTES : undefined,
    }),
    [original, pitch, rhythm, hasRest, pitchKeys.length, perStep, base.source],
  );
  const filters = JSON.stringify([keepPitches, keepDurations, drum && (keepPitches || keepDurations) && selected]);
  const rowName = (row: string) => String(rows.find((r) => r.id === row)?.key ?? "–");
  const labels = [
    ...(drum
      ? hits.map((g) => g.map(rowName).join("+"))
      : pitches.map(
          (p) => midiNoteLabel(p, base.source !== "drummer" && base.payload.scaleRoot.includes("b")).split(" ")[0],
        )),
    ...(hasRest ? [c.rest] : []),
  ];
  const [lastTake, setTake] = useState<Take | null>(null);
  const take = lastTake?.filters === filters ? lastTake : null;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(true);
  const audio = useMarkovAudition(id, clipKey, padIndex, setError);
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const queued = useAppStore((s) => s.performanceAuditions[id]?.workspace_queued ?? false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  useEffect(() => {
    save(settings);
  }, [settings, save]);
  const stepTicks = localBeatTicks(timing) / timing.stepsPerBeat;
  const audibleStep = useAppStore((s) => {
    const status = s.performanceAuditions[id];
    if (
      !audio.playing ||
      audio.prepared !== take?.pattern ||
      !status?.workspace_active ||
      status.workspace_queued ||
      status.preview_active ||
      status.workspace_gesture !== audio.gesture
    )
      return -1;
    const rt = s.sequencerRuntime;
    const origin = (drum ? rt.drummerStateById[id] : rt.trackStateById[id])?.runtimePadStartSubunit;
    const local = drum ? rt.drummerTrackLocalStepById[id] : rt.trackLocalStepById[id];
    return origin != null ? ((rt.transportSubunit - origin) / stepTicks) % steps : (local ?? -1);
  });
  const stale =
    base.payload !== pattern.payload && JSON.stringify(base.payload) !== JSON.stringify(pattern.payload);
  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError("");
    function fail(reason: string) {
      if (!cancelled) {
        setBusy(false);
        setError(
          reason === "rhythmPath" && keepDurations ? c.keptRhythmPath : (c[reason as MarkovError] ?? reason),
        );
        if (!take && audioRef.current.playing) void audioRef.current.stop();
      }
    }
    function finish(generated: MarkovEvent[]) {
      if (cancelled) return;
      try {
        const events =
          perStep === 1
            ? generated
            : generated.map((e) => ({ ...e, start: e.start / perStep, length: e.length / perStep }));
        const candidate = writeMarkovPattern(base, timing, events, pitches, hits);
        const state = useAppStore.getState();
        if (candidate.source === "score" && clipKey) {
          const draft = state.clipDrafts[clipKey];
          const total =
            state.sequencer.clipArrangement?.lanes
              .flatMap((l) => l.definitions)
              .reduce(
                (n, d) =>
                  n +
                  (d.kind === "pattern" &&
                  d.source === "score" &&
                  (d.id !== draft?.definition.id || draft.editIntent?.scope === "local")
                    ? d.payload.notes.length
                    : 0),
                0,
              ) ?? 0;
          if (total + candidate.payload.notes.length > SCORE_MAX_TOTAL_NOTES) throw new Error("capacity");
        }
        setTake({ events, pattern: candidate, labels, filters, rest: recipe.restState });
        setBusy(false);
        if (audioRef.current.playing) void audioRef.current.send(candidate);
      } catch (e) {
        fail((e as Error).message);
      }
    }
    if ((keepPitches && !hits.length && drum) || (keepDurations && !durations.length)) {
      fail("emptyRows");
      return;
    }
    if (steps * perStep <= 128) {
      try {
        finish(generateMarkov(steps * perStep, durations, recipe));
      } catch (e) {
        fail((e as Error).message);
      }
      return;
    }
    const worker = new Worker(new URL("../../lib/markov.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      if (e.data.error) fail(e.data.error);
      else finish(e.data.events);
      worker.terminate();
    };
    worker.onerror = (e) => fail(e.message);
    worker.postMessage([steps * perStep, durations, recipe]);
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [
    base,
    stepTicks,
    steps,
    durations,
    recipe,
    pitches,
    hits,
    filters,
    perStep,
    c,
    clipKey,
    timing.meterDenominator,
    timing.stepsPerBeat,
  ]);
  // Candidate IDs, durations and row selection are frozen at generation, including during audition.
  const update = (part: Partial<MarkovRecipe>) => setSettings((s) => ({ ...s, recipe: { ...s.recipe, ...part } }));
  function changeHits(next: string[], nextGroups: string[][]) {
    const keys = (list: string[][]) => [...list.map(drumHitKey), "rest"];
    const chain = remapChain(
      { keys: keys(allHits), chain: original.pitch },
      keys([...next.map((r) => [r]), ...nextGroups]),
      "hits",
    );
    setSettings((s) => ({ ...s, selected: next, groups: nextGroups, recipe: { ...s.recipe, pitch: chain } }));
  }
  function dismiss() {
    void audio.stop();
    close();
  }
  function accept() {
    if (!take || stale || busy || (audio.playing && (audio.prepared !== take.pattern || queued))) return;
    if (take.pattern.source === "score") {
      if (!onScoreApply?.(take.pattern.payload)) {
        setError(c.capacity);
        return;
      }
    } else applySteps(id, padIndex, take.pattern);
    dismiss();
  }
  const phrase = (field: "pitchLength" | "rhythmLength", title: string) => (
    <label>
      {c.phrase}{" "}
      <select
        aria-label={title + " · " + c.phrase}
        value={original[field]}
        onChange={(e) => update({ [field]: +e.target.value })}
      >
        {lengths.map((n) => (
          <option key={n} value={n}>
            {n === steps ? c.full : "1/" + steps / n} · {n} {c.steps}
          </option>
        ))}
      </select>
    </label>
  );
  let lo = 0,
    hi = take?.events.length ?? 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (take!.events[mid].start <= audibleStep) lo = mid + 1;
    else hi = mid;
  }
  const active = lo ? take?.events[lo - 1] : undefined,
    prev = take?.events[lo - 2];
  const pitchTitle = drum ? c.hits : c.pitch,
    durationTitle = drum ? c.spacing : c.rhythm;
  // Bound the SVG by its display resolution and include the entire timeline of long scores.
  const preview = useMemo(() => {
    if (!take) return null;
    let lastColumn = -1;
    return take.events.flatMap((event) => {
      const column = Math.floor((900 * event.start) / steps);
      if (column === lastColumn) return [];
      lastColumn = column;
      const rest = event.state === take.rest;
      const y = rest ? 42 : 34 - (30 * event.state) / Math.max(1, take.labels.length - (take.rest < 0 ? 1 : 2));
      return [
        <rect
          key={event.start}
          x={column}
          width={Math.max(1, (900 * event.length) / steps - 1)}
          rx="2"
          y={y}
          height={rest ? 2 : 7}
          fill={graphColors[event.state % graphColors.length]}
        >
          <title>
            {take.labels[event.state]} · {durationLabel(Math.round(event.length * perStep), perStep)} {c.steps}
          </title>
        </rect>,
      ];
    });
  }, [take, steps, c.steps, perStep]);
  return (
    <dialog
      ref={dialog}
      className="mk-dialog"
      aria-label={c.title}
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
    >
      <header className="mk-heading">
        <div>
          <small>{name}</small>
          <h2>{c.title}</h2>
        </div>
        <button aria-label={c.close} onClick={dismiss}>
          ×
        </button>
      </header>
      <p className="mk-hint">{c.hint}</p>
      {nonempty && (
        <div className="mk-filters">
          <label>
            <input
              type="checkbox"
              checked={keepPitches}
              onChange={(e) => setSettings({ ...settings, keepPitches: e.target.checked, keptPitch: undefined })}
            />{" "}
            {c.keepPitches}
          </label>
          <label>
            <input
              type="checkbox"
              checked={keepDurations}
              onChange={(e) =>
                setSettings({ ...settings, keepDurations: e.target.checked, keptRhythm: undefined })
              }
            />{" "}
            {c.keepDurations}
          </label>
        </div>
      )}
      {drum ? (
        <details className="mk-options">
          <summary>
            {c.rows} · {selected.length}
          </summary>
          <div>
            {rows.map((row) => (
              <label key={row.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(row.id)}
                  disabled={selected.length === 1 && selected[0] === row.id}
                  onChange={(e) => {
                    const next = rows
                      .filter((r) => (r.id === row.id ? e.target.checked : selected.includes(r.id)))
                      .map((r) => r.id);
                    changeHits(
                      next,
                      groups.filter((g) => g.every((r) => next.includes(r))),
                    );
                    setCombination([]);
                  }}
                />{" "}
                {row.key}
              </label>
            ))}
          </div>
          <div>
            {selected.map((row) => (
              <button
                key={row}
                aria-pressed={combination.includes(row)}
                onClick={() => setCombination((g) => (g.includes(row) ? g.filter((r) => r !== row) : [...g, row]))}
              >
                {rowName(row)}
              </button>
            ))}
            <button
              disabled={
                combination.length < 2 ||
                groups.some((g) => g.length === combination.length && g.every((r) => combination.includes(r)))
              }
              onClick={() => {
                changeHits(selected, [...groups, selected.filter((r) => combination.includes(r))]);
                setCombination([]);
              }}
            >
              {c.combo}
            </button>
          </div>
        </details>
      ) : (
        <label className="mk-register">
          {c.octave}{" "}
          <select
            disabled={keepPitches}
            value={octave}
            onChange={(e) => setSettings((s) => ({ ...s, octave: +e.target.value }))}
          >
            {[-1, 0, 1, 2, 3, 4, 5, 6, 7, 8]
              .filter((n) => base.source !== "drummer" && scalePitches(base.payload, n).every((p) => p <= 127))
              .map((n) => (
                <option key={n}>{n}</option>
              ))}
          </select>
        </label>
      )}
      <div className="mk-graphs">
        <MarkovGraph
          key={JSON.stringify([keepPitches, pitchKeys])}
          title={pitchTitle}
          copy={c}
          labels={labels}
          chain={recipe.pitch}
          playing={active?.state}
          previous={prev?.state ?? labels.length}
          onChange={(from, values) => {
            const chain = replaceRow(fullPitch, from, values, !hasRest);
            if (keepPitches)
              setSettings((s) => ({ ...s, keptPitch: { source: pitchSource, keys: fullPitchKeys, chain } }));
            else update({ pitch: chain });
          }}
        >
          {phrase("pitchLength", pitchTitle)}
        </MarkovGraph>
        <MarkovGraph
          key={"rhythm" + JSON.stringify([keepDurations, durationKeys])}
          title={durationTitle}
          copy={c}
          labels={durationKeys}
          chain={recipe.rhythm}
          playing={active?.durationState}
          previous={prev?.durationState ?? durations.length}
          onChange={(from, values) => {
            const chain = replaceRow(rhythm, from, values);
            if (keepDurations) setSettings((s) => ({ ...s, keptRhythm: { source: rhythmSource, chain } }));
            else update({ rhythm: chain });
          }}
        >
          {phrase("rhythmLength", durationTitle)}
        </MarkovGraph>
      </div>
      <section className="mk-take">
        <h3>
          {c.take}{" "}
          <small>
            {steps} {c.steps}
          </small>
        </h3>
        <svg viewBox="0 0 900 48" preserveAspectRatio="none" role="img" aria-label={c.take}>
          {preview}
          {audibleStep >= 0 && (
            <line
              x1={(900 * audibleStep) / steps}
              x2={(900 * audibleStep) / steps}
              y1="0"
              y2="48"
              stroke="white"
              strokeWidth="2"
            />
          )}
        </svg>
      </section>
      {(error || stale || busy) && (
        <p role="status" className="mk-status">
          {stale ? c.stale : busy ? c.working : error}
        </p>
      )}
      <footer>
        <button
          disabled={!audio.playing && (!take || !audio.available || stale || busy)}
          aria-pressed={audio.playing}
          onClick={() => {
            if (audio.playing) void audio.stop();
            else if (take) void audio.send(take.pattern);
          }}
        >
          {audio.playing ? "■ " + c.stop : "▶ " + c.play}
        </button>
        <button disabled={stale} onClick={() => update({ seed: seed() })}>
          {c.generate}
        </button>
        <button
          className="mk-use"
          disabled={!take || busy || stale || (audio.playing && (audio.prepared !== take.pattern || queued))}
          onClick={accept}
        >
          {c.use}
        </button>
      </footer>
    </dialog>
  );
}
