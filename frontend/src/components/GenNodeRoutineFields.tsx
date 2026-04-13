import type { Dispatch, JSX, SetStateAction } from "react";

import { AssetUploadCard } from "./AssetUploadCard";
import type { GenNodeConfig, GenRoutineEditorKind } from "../lib/genNodeConfig";

export type GenRoutineFieldsCopy = {
  routineParameters: string;
  add: string;
  deleteShort: string;
  keepAtLeastOneEntry: string;
  removeRow: string;
  harmonicAmplitudes: string;
  valueList: string;
  startValue: string;
  segmentsLengthValue: string;
  nh: string;
  lh: string;
  rMultiplier: string;
  gen17Hint: string;
  xyPairs: string;
  windowType: string;
  max: string;
  opt: string;
  gen20NoOpt: string;
  uploadAudioFile: string;
  uploading: string;
  clearAsset: string;
  persistedAsset: string;
  fallbackSamplePath: string;
  skipTime: string;
  format: string;
  channel: string;
  rawArguments: string;
  rawArgsHelpBeforeExpr: string;
  rawArgsHelpExprPrefix: string;
  rawArgsHelpAfterExpr: string;
  customWindowOption: (value: number) => string;
};

type GenNodeRoutineFieldsProps = {
  copy: GenRoutineFieldsCopy;
  routineKind: GenRoutineEditorKind;
  draft: GenNodeConfig;
  setDraft: Dispatch<SetStateAction<GenNodeConfig>>;
  gen20WindowOptions: Array<{ value: number; label: string }>;
  uploading: boolean;
  uploadError: string | null;
  onClearSampleAsset: () => void;
  onUploadSampleFile: (file: File) => Promise<void>;
};

type NumericPairRow = {
  first: number;
  second: number;
};

function parseNumericInput(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseIntegerInput(value: string, fallback: number): number {
  return Math.round(parseNumericInput(value, fallback));
}

function NumberListEditor({
  label,
  values,
  onChange,
  addLabel,
  deleteLabel,
  keepOneTitle,
  removeRowTitle
}: {
  label: string;
  values: number[];
  onChange: (values: number[]) => void;
  addLabel: string;
  deleteLabel: string;
  keepOneTitle: string;
  removeRowTitle: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
        <button
          type="button"
          onClick={() => onChange([...values, 0])}
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
        >
          {addLabel}
        </button>
      </div>
      <div className="space-y-2">
        {values.map((entry, index) => (
          <div key={`${label}-${index}`} className="flex items-center gap-2">
            <div className="w-8 shrink-0 text-right font-mono text-[11px] text-slate-400">{index + 1}</div>
            <input
              type="text"
              value={String(entry)}
              onChange={(event) => {
                const next = [...values];
                next[index] = parseNumericInput(event.target.value, next[index] ?? 0);
                onChange(next);
              }}
              className="w-full rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
            />
            <button
              type="button"
              onClick={() => onChange(values.filter((_, rowIndex) => rowIndex !== index))}
              className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30"
              disabled={values.length <= 1}
              title={values.length <= 1 ? keepOneTitle : removeRowTitle}
            >
              {deleteLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NumericPairListEditor({
  label,
  rows,
  onAddRow,
  onChangeRow,
  onDeleteRow,
  addLabel,
  deleteLabel,
  keepOneTitle,
  removeRowTitle,
  firstPlaceholder,
  secondPlaceholder
}: {
  label: string;
  rows: NumericPairRow[];
  onAddRow: () => void;
  onChangeRow: (index: number, row: NumericPairRow) => void;
  onDeleteRow: (index: number) => void;
  addLabel: string;
  deleteLabel: string;
  keepOneTitle: string;
  removeRowTitle: string;
  firstPlaceholder: string;
  secondPlaceholder: string;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</div>
        <button
          type="button"
          onClick={onAddRow}
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
        >
          {addLabel}
        </button>
      </div>
      {rows.map((row, index) => (
        <div key={`${label}-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input
            type="text"
            value={String(row.first)}
            onChange={(event) =>
              onChangeRow(index, {
                ...row,
                first: parseNumericInput(event.target.value, row.first)
              })
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
            placeholder={firstPlaceholder}
          />
          <input
            type="text"
            value={String(row.second)}
            onChange={(event) =>
              onChangeRow(index, {
                ...row,
                second: parseNumericInput(event.target.value, row.second)
              })
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
            placeholder={secondPlaceholder}
          />
          <button
            type="button"
            disabled={rows.length <= 1}
            onClick={() => onDeleteRow(index)}
            title={rows.length <= 1 ? keepOneTitle : removeRowTitle}
            className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30 disabled:opacity-40"
          >
            {deleteLabel}
          </button>
        </div>
      ))}
    </div>
  );
}

function Gen11RoutineFields({
  copy,
  draft,
  setDraft
}: {
  copy: GenRoutineFieldsCopy;
  draft: GenNodeConfig;
  setDraft: Dispatch<SetStateAction<GenNodeConfig>>;
}): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.nh}</span>
        <input
          type="text"
          value={String(draft.gen11HarmonicCount)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              gen11HarmonicCount: Math.max(1, parseIntegerInput(event.target.value, current.gen11HarmonicCount))
            }))
          }
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.lh}</span>
        <input
          type="text"
          value={String(draft.gen11LowestHarmonic)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              gen11LowestHarmonic: Math.max(1, parseIntegerInput(event.target.value, current.gen11LowestHarmonic))
            }))
          }
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.rMultiplier}</span>
        <input
          type="text"
          value={String(draft.gen11Multiplier)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              gen11Multiplier: parseNumericInput(event.target.value, current.gen11Multiplier)
            }))
          }
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
        />
      </label>
    </div>
  );
}

function Gen7RoutineFields({
  copy,
  draft,
  setDraft
}: {
  copy: GenRoutineFieldsCopy;
  draft: GenNodeConfig;
  setDraft: Dispatch<SetStateAction<GenNodeConfig>>;
}): JSX.Element {
  const rows = draft.segments.map((segment) => ({ first: segment.length, second: segment.value }));

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.startValue}</span>
        <input
          type="text"
          value={String(draft.segmentStartValue)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              segmentStartValue: parseNumericInput(event.target.value, current.segmentStartValue)
            }))
          }
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
        />
      </label>

      <NumericPairListEditor
        label={copy.segmentsLengthValue}
        rows={rows}
        onAddRow={() =>
          setDraft((current) => ({
            ...current,
            segments: [...current.segments, { length: Math.max(1, current.tableSize), value: 0 }]
          }))
        }
        onChangeRow={(index, row) =>
          setDraft((current) => ({
            ...current,
            segments: current.segments.map((segment, rowIndex) =>
              rowIndex === index ? { length: row.first, value: row.second } : segment
            )
          }))
        }
        onDeleteRow={(index) =>
          setDraft((current) => ({
            ...current,
            segments: current.segments.filter((_, rowIndex) => rowIndex !== index)
          }))
        }
        addLabel={copy.add}
        deleteLabel={copy.deleteShort}
        keepOneTitle={copy.keepAtLeastOneEntry}
        removeRowTitle={copy.removeRow}
        firstPlaceholder="Length"
        secondPlaceholder="Value"
      />
    </div>
  );
}

function Gen17RoutineFields({
  copy,
  draft,
  setDraft
}: {
  copy: GenRoutineFieldsCopy;
  draft: GenNodeConfig;
  setDraft: Dispatch<SetStateAction<GenNodeConfig>>;
}): JSX.Element {
  const rows = draft.gen17Pairs.map((pair) => ({ first: pair.x, second: pair.y }));

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">{copy.gen17Hint}</p>
      <NumericPairListEditor
        label={copy.xyPairs}
        rows={rows}
        onAddRow={() =>
          setDraft((current) => ({
            ...current,
            gen17Pairs: [...current.gen17Pairs, { x: current.gen17Pairs.length * 16, y: 0 }]
          }))
        }
        onChangeRow={(index, row) =>
          setDraft((current) => ({
            ...current,
            gen17Pairs: current.gen17Pairs.map((pair, rowIndex) =>
              rowIndex === index ? { x: row.first, y: row.second } : pair
            )
          }))
        }
        onDeleteRow={(index) =>
          setDraft((current) => ({
            ...current,
            gen17Pairs: current.gen17Pairs.filter((_, rowIndex) => rowIndex !== index)
          }))
        }
        addLabel={copy.add}
        deleteLabel={copy.deleteShort}
        keepOneTitle={copy.keepAtLeastOneEntry}
        removeRowTitle={copy.removeRow}
        firstPlaceholder="x"
        secondPlaceholder="y"
      />
    </div>
  );
}

function Gen20RoutineFields({
  copy,
  draft,
  setDraft,
  gen20WindowOptions
}: {
  copy: GenRoutineFieldsCopy;
  draft: GenNodeConfig;
  setDraft: Dispatch<SetStateAction<GenNodeConfig>>;
  gen20WindowOptions: Array<{ value: number; label: string }>;
}): JSX.Element {
  const normalizedWindowType = Math.max(1, Math.round(draft.gen20WindowType));
  const usesOptionalValue = [6, 7, 9].includes(normalizedWindowType);

  return (
    <div className="space-y-3">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.windowType}</span>
        <select
          value={String(draft.gen20WindowType)}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              gen20WindowType: Math.max(1, parseIntegerInput(event.target.value, current.gen20WindowType))
            }))
          }
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
        >
          {gen20WindowOptions.map((option) => (
            <option key={`gen20-window-${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
          {!gen20WindowOptions.some((option) => option.value === draft.gen20WindowType) ? (
            <option value={draft.gen20WindowType}>{copy.customWindowOption(draft.gen20WindowType)}</option>
          ) : null}
        </select>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.max}</span>
          <input
            type="text"
            value={String(draft.gen20Max)}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                gen20Max: parseNumericInput(event.target.value, current.gen20Max)
              }))
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
          />
        </label>

        {usesOptionalValue ? (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.opt}</span>
            <input
              type="text"
              value={String(draft.gen20Opt)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  gen20Opt: parseNumericInput(event.target.value, current.gen20Opt)
                }))
              }
              className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
            />
          </label>
        ) : (
          <div className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-400">
            {copy.gen20NoOpt}
          </div>
        )}
      </div>
    </div>
  );
}

function Gen1RoutineFields({
  copy,
  draft,
  setDraft,
  uploading,
  uploadError,
  onClearSampleAsset,
  onUploadSampleFile
}: {
  copy: GenRoutineFieldsCopy;
  draft: GenNodeConfig;
  setDraft: Dispatch<SetStateAction<GenNodeConfig>>;
  uploading: boolean;
  uploadError: string | null;
  onClearSampleAsset: () => void;
  onUploadSampleFile: (file: File) => Promise<void>;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <AssetUploadCard
        accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg"
        asset={draft.sampleAsset}
        uploading={uploading}
        uploadError={uploadError}
        uploadLabel={copy.uploadAudioFile}
        uploadingLabel={copy.uploading}
        clearLabel={copy.clearAsset}
        persistedAssetLabel={copy.persistedAsset}
        onClearAsset={onClearSampleAsset}
        onUploadFile={onUploadSampleFile}
      />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.fallbackSamplePath}</span>
        <input
          type="text"
          value={draft.samplePath}
          onChange={(event) => setDraft((current) => ({ ...current, samplePath: event.target.value }))}
          placeholder="/absolute/path/file.wav"
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.skipTime}</span>
          <input
            type="text"
            value={String(draft.sampleSkipTime)}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sampleSkipTime: parseNumericInput(event.target.value, current.sampleSkipTime)
              }))
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.format}</span>
          <input
            type="text"
            value={String(draft.sampleFormat)}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sampleFormat: parseIntegerInput(event.target.value, current.sampleFormat)
              }))
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.channel}</span>
          <input
            type="text"
            value={String(draft.sampleChannel)}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                sampleChannel: parseIntegerInput(event.target.value, current.sampleChannel)
              }))
            }
            className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
          />
        </label>
      </div>
    </div>
  );
}

function RawArgumentsRoutineFields({
  copy,
  draft,
  setDraft
}: {
  copy: GenRoutineFieldsCopy;
  draft: GenNodeConfig;
  setDraft: Dispatch<SetStateAction<GenNodeConfig>>;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.rawArguments}</span>
        <textarea
          value={draft.rawArgsText}
          onChange={(event) => setDraft((current) => ({ ...current, rawArgsText: event.target.value }))}
          placeholder={'Example: 1, 0.5, expr:1024*2, "file.wav"'}
          className="min-h-[120px] rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
        />
      </label>
      <p className="text-xs text-slate-400">
        {copy.rawArgsHelpBeforeExpr}{" "}
        <span className="font-mono text-slate-300">{copy.rawArgsHelpExprPrefix}</span>{" "}
        {copy.rawArgsHelpAfterExpr}
      </p>
    </div>
  );
}

export function GenNodeRoutineFields({
  copy,
  routineKind,
  draft,
  setDraft,
  gen20WindowOptions,
  uploading,
  uploadError,
  onClearSampleAsset,
  onUploadSampleFile
}: GenNodeRoutineFieldsProps): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
      <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {copy.routineParameters}
      </div>

      {routineKind === "gen10" ? (
        <NumberListEditor
          label={copy.harmonicAmplitudes}
          values={draft.harmonicAmplitudes}
          onChange={(values) => setDraft((current) => ({ ...current, harmonicAmplitudes: values }))}
          addLabel={copy.add}
          deleteLabel={copy.deleteShort}
          keepOneTitle={copy.keepAtLeastOneEntry}
          removeRowTitle={copy.removeRow}
        />
      ) : null}

      {routineKind === "gen11" ? <Gen11RoutineFields copy={copy} draft={draft} setDraft={setDraft} /> : null}

      {routineKind === "gen2" ? (
        <NumberListEditor
          label={copy.valueList}
          values={draft.valueList}
          onChange={(values) => setDraft((current) => ({ ...current, valueList: values }))}
          addLabel={copy.add}
          deleteLabel={copy.deleteShort}
          keepOneTitle={copy.keepAtLeastOneEntry}
          removeRowTitle={copy.removeRow}
        />
      ) : null}

      {routineKind === "gen7" ? <Gen7RoutineFields copy={copy} draft={draft} setDraft={setDraft} /> : null}

      {routineKind === "gen17" ? <Gen17RoutineFields copy={copy} draft={draft} setDraft={setDraft} /> : null}

      {routineKind === "gen20" ? (
        <Gen20RoutineFields
          copy={copy}
          draft={draft}
          setDraft={setDraft}
          gen20WindowOptions={gen20WindowOptions}
        />
      ) : null}

      {routineKind === "gen1" ? (
        <Gen1RoutineFields
          copy={copy}
          draft={draft}
          setDraft={setDraft}
          uploading={uploading}
          uploadError={uploadError}
          onClearSampleAsset={onClearSampleAsset}
          onUploadSampleFile={onUploadSampleFile}
        />
      ) : null}

      {routineKind === "raw" ? <RawArgumentsRoutineFields copy={copy} draft={draft} setDraft={setDraft} /> : null}
    </div>
  );
}
