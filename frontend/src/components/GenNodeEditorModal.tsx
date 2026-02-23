import { useEffect, useMemo, useRef, useState } from "react";

import { api } from "../api/client";
import {
  GEN_ROUTINE_OPTIONS,
  buildGenNodePreview,
  genRoutineKindForNumber,
  normalizeGenNodeConfig,
  type GenAudioAssetRef,
  type GenNodeConfig
} from "../lib/genNodeConfig";

interface GenNodeEditorModalProps {
  nodeId: string;
  initialConfig: GenNodeConfig;
  onClose: () => void;
  onSave: (config: GenNodeConfig) => void;
}

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
  onChange
}: {
  label: string;
  values: number[];
  onChange: (values: number[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
        <button
          type="button"
          onClick={() => onChange([...values, 0])}
          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
        >
          Add
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
              title={values.length <= 1 ? "Keep at least one entry" : "Remove row"}
            >
              Del
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenNodeEditorModal({ nodeId, initialConfig, onClose, onSave }: GenNodeEditorModalProps) {
  const [draft, setDraft] = useState<GenNodeConfig>(() => normalizeGenNodeConfig(initialConfig));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(normalizeGenNodeConfig(initialConfig));
    setUploadError(null);
  }, [initialConfig]);

  const routineKind = useMemo(() => genRoutineKindForNumber(draft.routineNumber), [draft.routineNumber]);
  const selectedRoutine = useMemo(
    () => GEN_ROUTINE_OPTIONS.find((option) => option.value === Math.abs(Math.round(draft.routineNumber))),
    [draft.routineNumber]
  );
  const preview = useMemo(() => buildGenNodePreview(draft), [draft]);

  const setSampleAsset = (asset: GenAudioAssetRef | null) => {
    setDraft((current) => ({ ...current, sampleAsset: asset }));
  };

  const handleUploadFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await api.uploadGenAudioAsset(file);
      setDraft((current) => ({
        ...current,
        sampleAsset: uploaded,
        samplePath: ""
      }));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload audio file.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1260] flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={onClose}>
      <section
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`GEN editor for ${nodeId}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">GEN Editor</h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Node {nodeId}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
          >
            Close
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Table Generation Mode
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Opcode</span>
                  <select
                    value={draft.mode}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        mode: event.target.value === "ftgenonce" ? "ftgenonce" : "ftgen"
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  >
                    <option value="ftgen">ftgen</option>
                    <option value="ftgenonce">ftgenonce</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">GEN Routine</span>
                  <select
                    value={String(Math.abs(Math.round(draft.routineNumber)))}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        routineNumber: Math.max(1, parseIntegerInput(event.target.value, current.routineNumber))
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  >
                    {GEN_ROUTINE_OPTIONS.map((option) => (
                      <option key={`gen-routine-${option.value}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    {!selectedRoutine ? (
                      <option value={Math.abs(Math.round(draft.routineNumber))}>
                        Custom GEN{Math.abs(Math.round(draft.routineNumber))}
                      </option>
                    ) : null}
                  </select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Routine Number</span>
                  <input
                    type="text"
                    value={String(Math.abs(Math.round(draft.routineNumber)))}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        routineNumber: Math.max(1, parseIntegerInput(event.target.value, current.routineNumber))
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Table Number</span>
                  <input
                    type="text"
                    value={String(draft.tableNumber)}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, tableNumber: parseIntegerInput(event.target.value, current.tableNumber) }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Table Size</span>
                  <input
                    type="text"
                    value={String(draft.tableSize)}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        tableSize: Math.max(1, parseIntegerInput(event.target.value, current.tableSize))
                      }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Start Time</span>
                  <input
                    type="text"
                    value={String(draft.startTime)}
                    disabled={draft.mode === "ftgenonce"}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, startTime: parseNumericInput(event.target.value, current.startTime) }))
                    }
                    className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-md border border-slate-700 bg-slate-900 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={draft.normalize}
                    onChange={(event) => setDraft((current) => ({ ...current, normalize: event.target.checked }))}
                    className="h-4 w-4 accent-cyan-400"
                  />
                  <span className="text-xs text-slate-200">Normalize table (use positive GEN number)</span>
                </label>
              </div>

              {selectedRoutine && (
                <p className="mt-3 text-xs text-slate-300">
                  <span className="font-semibold text-slate-200">{selectedRoutine.label}</span>: {selectedRoutine.description}
                </p>
              )}
              {!selectedRoutine && (
                <p className="mt-3 text-xs text-slate-400">
                  Custom GEN routine. Use the raw arguments editor below. For string literals, wrap values in quotes. Use
                  <span className="mx-1 rounded bg-slate-800 px-1 py-0.5 font-mono text-[11px]">expr:</span>
                  to force an unquoted expression.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                Routine Parameters
              </div>

              {routineKind === "gen10" && (
                <NumberListEditor
                  label="Harmonic Amplitudes"
                  values={draft.harmonicAmplitudes}
                  onChange={(values) => setDraft((current) => ({ ...current, harmonicAmplitudes: values }))}
                />
              )}

              {routineKind === "gen2" && (
                <NumberListEditor
                  label="Value List"
                  values={draft.valueList}
                  onChange={(values) => setDraft((current) => ({ ...current, valueList: values }))}
                />
              )}

              {routineKind === "gen7" && (
                <div className="space-y-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Start Value</span>
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

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                        Segments (length, value)
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            segments: [...current.segments, { length: Math.max(1, current.tableSize), value: 0 }]
                          }))
                        }
                        className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-400/70 hover:text-cyan-200"
                      >
                        Add
                      </button>
                    </div>
                    {draft.segments.map((segment, index) => (
                      <div key={`segment-${index}`} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <input
                          type="text"
                          value={String(segment.length)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              segments: current.segments.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      length: Math.max(1, parseNumericInput(event.target.value, row.length))
                                    }
                                  : row
                              )
                            }))
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                          placeholder="Length"
                        />
                        <input
                          type="text"
                          value={String(segment.value)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              segments: current.segments.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      value: parseNumericInput(event.target.value, row.value)
                                    }
                                  : row
                              )
                            }))
                          }
                          className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                          placeholder="Value"
                        />
                        <button
                          type="button"
                          disabled={draft.segments.length <= 1}
                          onClick={() =>
                            setDraft((current) => ({
                              ...current,
                              segments: current.segments.filter((_, rowIndex) => rowIndex !== index)
                            }))
                          }
                          className="rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30 disabled:opacity-40"
                        >
                          Del
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {routineKind === "gen1" && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
                      >
                        {uploading ? "Uploading..." : "Upload Audio File"}
                      </button>
                      {draft.sampleAsset ? (
                        <button
                          type="button"
                          onClick={() => setSampleAsset(null)}
                          className="rounded-md border border-rose-500/50 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30"
                        >
                          Clear Asset
                        </button>
                      ) : null}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*,.wav,.aif,.aiff,.flac,.mp3,.ogg"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) {
                          void handleUploadFile(file);
                        }
                      }}
                    />

                    {draft.sampleAsset ? (
                      <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-950/20 px-2 py-2 text-xs text-emerald-100">
                        <div className="font-semibold">Persisted asset: {draft.sampleAsset.original_name}</div>
                        <div className="mt-1 font-mono text-[11px] text-emerald-200/90">
                          {draft.sampleAsset.stored_name}
                        </div>
                      </div>
                    ) : null}

                    {uploadError ? (
                      <div className="mt-2 rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200">
                        {uploadError}
                      </div>
                    ) : null}
                  </div>

                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                      Fallback Sample Path (optional)
                    </span>
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
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Skip Time</span>
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
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Format</span>
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
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Channel</span>
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
              )}

              {routineKind === "raw" && (
                <div className="space-y-2">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">Raw Arguments</span>
                    <textarea
                      value={draft.rawArgsText}
                      onChange={(event) => setDraft((current) => ({ ...current, rawArgsText: event.target.value }))}
                      placeholder={'Example: 1, 0.5, expr:1024*2, "file.wav"'}
                      className="min-h-[120px] rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
                    />
                  </label>
                  <p className="text-xs text-slate-400">
                    Use commas or new lines. Strings should be quoted. Prefix with{" "}
                    <span className="font-mono text-slate-300">expr:</span> to emit an unquoted expression.
                  </p>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Preview</div>
              <div className="space-y-2 text-xs text-slate-300">
                <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Effective GEN</div>
                  <div className="mt-1 font-mono text-slate-100">{preview.igen}</div>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Flattened Args</div>
                  <div className="mt-1 break-words font-mono text-[11px] text-slate-100">
                    {preview.args.length > 0 ? preview.args.join(", ") : "(none)"}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-900 px-2 py-2">
                  <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Rendered Line</div>
                  <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-cyan-100">
                    {preview.line}
                  </pre>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-xs text-slate-400">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Notes</div>
              <div>GEN01 uses the uploaded asset if present. The backend compiler resolves it to the stored file path.</div>
              <div className="mt-2">
                `ftgenonce` ignores Start Time and uses the same table parameter as the `ftgenonce` first argument.
              </div>
            </div>
          </aside>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-200 transition hover:border-slate-400"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(normalizeGenNodeConfig(draft))}
            className="rounded-md border border-cyan-500/70 bg-cyan-500/15 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-cyan-200 transition hover:bg-cyan-500/25"
          >
            Save GEN
          </button>
        </footer>
      </section>
    </div>
  );
}
