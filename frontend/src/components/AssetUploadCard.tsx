import { useRef, type ChangeEvent, type JSX } from "react";

import type { GenAudioAssetRef } from "../lib/genNodeConfig";

type AssetUploadCardProps = {
  accept: string;
  asset: GenAudioAssetRef | null;
  uploading: boolean;
  uploadError: string | null;
  uploadLabel: string;
  uploadingLabel: string;
  clearLabel: string;
  persistedAssetLabel: string;
  onClearAsset: () => void;
  onUploadFile: (file: File) => void | Promise<void>;
};

export function AssetUploadCard({
  accept,
  asset,
  uploading,
  uploadError,
  uploadLabel,
  uploadingLabel,
  clearLabel,
  persistedAssetLabel,
  onClearAsset,
  onUploadFile
}: AssetUploadCardProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    void onUploadFile(file);
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-cyan-500/60 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-cyan-200 transition hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {uploading ? uploadingLabel : uploadLabel}
        </button>
        {asset ? (
          <button
            type="button"
            onClick={onClearAsset}
            className="rounded-md border border-rose-500/50 bg-rose-950/30 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-rose-200 transition hover:bg-rose-900/30"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>

      <input ref={fileInputRef} type="file" accept={accept} className="hidden" onChange={handleFileChange} />

      {asset ? (
        <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-950/20 px-2 py-2 text-xs text-emerald-100">
          <div className="font-semibold">
            {persistedAssetLabel}: {asset.original_name}
          </div>
          <div className="mt-1 font-mono text-[11px] text-emerald-200/90">{asset.stored_name}</div>
        </div>
      ) : null}

      {uploadError ? (
        <div className="mt-2 rounded-md border border-rose-500/50 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200">
          {uploadError}
        </div>
      ) : null}
    </div>
  );
}
