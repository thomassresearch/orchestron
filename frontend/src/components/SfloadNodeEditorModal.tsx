import { useEffect, useRef, useState } from "react";

import { api } from "../api/client";
import type { GenAudioAssetRef } from "../lib/genNodeConfig";
import { normalizeSfloadNodeConfig, type SfloadNodeConfig } from "../lib/sfloadNodeConfig";
import type { GuiLanguage } from "../types";

type SfloadEditorCopy = {
  title: string;
  nodeLabel: string;
  uploadSf2File: string;
  uploading: string;
  clearAsset: string;
  persistedAsset: string;
  fallbackSamplePath: string;
  note: string;
  close: string;
  save: string;
  uploadFailed: string;
  configureSfloadAria: (nodeId: string) => string;
};

const SFLOAD_EDITOR_COPY: Record<GuiLanguage, SfloadEditorCopy> = {
  english: {
    title: "sfload File Configuration",
    nodeLabel: "Node",
    uploadSf2File: "Upload SF2 File",
    uploading: "Uploading...",
    clearAsset: "Clear Asset",
    persistedAsset: "Uploaded asset",
    fallbackSamplePath: "Fallback SoundFont Path",
    note: "Uploaded asset takes precedence over fallback path. The backend compiler resolves the stored file path.",
    close: "Close",
    save: "Save",
    uploadFailed: "Failed to upload SF2 file.",
    configureSfloadAria: (nodeId) => `sfload file configuration for ${nodeId}`
  },
  german: {
    title: "sfload-Dateikonfiguration",
    nodeLabel: "Node",
    uploadSf2File: "SF2-Datei hochladen",
    uploading: "Lade hoch...",
    clearAsset: "Asset entfernen",
    persistedAsset: "Hochgeladenes Asset",
    fallbackSamplePath: "Fallback-SoundFont-Pfad",
    note: "Das hochgeladene Asset hat Vorrang vor dem Fallback-Pfad. Der Backend-Compiler loest den gespeicherten Dateipfad auf.",
    close: "Schliessen",
    save: "Speichern",
    uploadFailed: "SF2-Datei konnte nicht hochgeladen werden.",
    configureSfloadAria: (nodeId) => `sfload-Dateikonfiguration fuer ${nodeId}`
  },
  french: {
    title: "Configuration de fichier sfload",
    nodeLabel: "Noeud",
    uploadSf2File: "Televerser un fichier SF2",
    uploading: "Televersement...",
    clearAsset: "Retirer l'asset",
    persistedAsset: "Asset televerse",
    fallbackSamplePath: "Chemin SoundFont de secours",
    note: "L'asset televerse est prioritaire sur le chemin de secours. Le compilateur backend resolve le chemin stocke.",
    close: "Fermer",
    save: "Enregistrer",
    uploadFailed: "Echec du televersement du fichier SF2.",
    configureSfloadAria: (nodeId) => `configuration du fichier sfload pour ${nodeId}`
  },
  spanish: {
    title: "Configuracion de archivo sfload",
    nodeLabel: "Nodo",
    uploadSf2File: "Subir archivo SF2",
    uploading: "Subiendo...",
    clearAsset: "Quitar asset",
    persistedAsset: "Asset subido",
    fallbackSamplePath: "Ruta SoundFont alternativa",
    note: "El asset subido tiene prioridad sobre la ruta alternativa. El compilador backend resuelve la ruta almacenada.",
    close: "Cerrar",
    save: "Guardar",
    uploadFailed: "No se pudo subir el archivo SF2.",
    configureSfloadAria: (nodeId) => `configuracion de archivo sfload para ${nodeId}`
  }
};

interface SfloadNodeEditorModalProps {
  nodeId: string;
  guiLanguage: GuiLanguage;
  initialConfig: SfloadNodeConfig;
  onClose: () => void;
  onSave: (config: SfloadNodeConfig) => void;
}

export function SfloadNodeEditorModal({
  nodeId,
  guiLanguage,
  initialConfig,
  onClose,
  onSave
}: SfloadNodeEditorModalProps) {
  const copy = SFLOAD_EDITOR_COPY[guiLanguage];
  const [draft, setDraft] = useState<SfloadNodeConfig>(() => normalizeSfloadNodeConfig(initialConfig));
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(normalizeSfloadNodeConfig(initialConfig));
    setUploadError(null);
  }, [initialConfig]);

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
      setUploadError(error instanceof Error ? error.message : copy.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1260] flex items-center justify-center bg-slate-950/80 p-4" onMouseDown={onClose}>
      <section
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={copy.configureSfloadAria(nodeId)}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-700 px-4 py-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-100">{copy.title}</h2>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
              {copy.nodeLabel} {nodeId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
          >
            {copy.close}
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto p-4">
          <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <div className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
              {copy.note}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
              >
                {uploading ? copy.uploading : copy.uploadSf2File}
              </button>
              {draft.sampleAsset ? (
                <button
                  type="button"
                  onClick={() => setSampleAsset(null)}
                  className="rounded-md border border-rose-500/50 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30"
                >
                  {copy.clearAsset}
                </button>
              ) : null}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".sf2"
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
              <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-100">
                <div className="font-semibold">
                  {copy.persistedAsset}: {draft.sampleAsset.original_name}
                </div>
                <div className="mt-1 font-mono text-[11px] text-emerald-200/90">{draft.sampleAsset.stored_name}</div>
              </div>
            ) : null}

            {uploadError ? (
              <div className="mt-3 rounded-md border border-rose-500/50 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
                {uploadError}
              </div>
            ) : null}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{copy.fallbackSamplePath}</span>
            <input
              type="text"
              value={draft.samplePath}
              onChange={(event) => setDraft((current) => ({ ...current, samplePath: event.target.value }))}
              placeholder="/absolute/path/file.sf2"
              className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none ring-cyan-400/30 transition focus:ring"
            />
          </label>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-slate-400"
          >
            {copy.close}
          </button>
          <button
            type="button"
            onClick={() => onSave(normalizeSfloadNodeConfig(draft))}
            className="rounded-lg border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20"
          >
            {copy.save}
          </button>
        </footer>
      </section>
    </div>
  );
}
