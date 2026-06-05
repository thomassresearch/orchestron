import { useEffect, useState } from "react";

import { api } from "../api/client";
import { AssetUploadCard } from "./AssetUploadCard";
import { NodeEditorModalFrame } from "./NodeEditorModalFrame";
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
    note: "sfload requires an uploaded SF2 asset. The backend compiler resolves it to contained asset storage.",
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
    note: "sfload erfordert ein hochgeladenes SF2-Asset. Der Backend-Compiler loest es in den geschuetzten Asset-Speicher auf.",
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
    note: "sfload requiert un asset SF2 televerse. Le compilateur backend le resout vers le stockage d'assets protege.",
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
    note: "sfload requiere un asset SF2 subido. El compilador backend lo resuelve al almacenamiento de assets protegido.",
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

  useEffect(() => {
    setDraft(normalizeSfloadNodeConfig(initialConfig));
    setUploadError(null);
  }, [initialConfig]);

  function setSampleAsset(asset: GenAudioAssetRef | null): void {
    setDraft((current) => ({ ...current, sampleAsset: asset }));
  }

  async function handleUploadFile(file: File): Promise<void> {
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
  }

  const footer = (
    <>
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
    </>
  );

  return (
    <NodeEditorModalFrame
      ariaLabel={copy.configureSfloadAria(nodeId)}
      title={copy.title}
      nodeId={nodeId}
      nodeLabel={copy.nodeLabel}
      closeLabel={copy.close}
      onClose={onClose}
      footer={footer}
    >
          <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <div className="rounded-md border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
              {copy.note}
            </div>

            <div className="mt-3">
              <AssetUploadCard
                accept=".sf2"
                asset={draft.sampleAsset}
                uploading={uploading}
                uploadError={uploadError}
                uploadLabel={copy.uploadSf2File}
                uploadingLabel={copy.uploading}
                clearLabel={copy.clearAsset}
                persistedAssetLabel={copy.persistedAsset}
                onClearAsset={() => setSampleAsset(null)}
                onUploadFile={handleUploadFile}
              />
            </div>
          </div>

    </NodeEditorModalFrame>
  );
}
