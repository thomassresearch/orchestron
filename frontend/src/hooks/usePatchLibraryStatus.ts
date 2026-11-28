import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { patchSignature } from "../lib/patchSignature";
import { normalizePatch } from "../store/appStoreModel";
import type { EditablePatch } from "../store/appStoreTypes";

// Restored tabs may already contain edits. Compare authored content with the library revision.
export function usePatchLibraryStatus(patch: EditablePatch, revision: string | undefined, visible: boolean) {
  const id = patch.id;
  const [baseline, setBaseline] = useState<{ id: string; revision?: string; content: string | null }>();
  useEffect(() => {
    if (!id || !visible) return;
    let current = true;
    void api.getPatch(id).then(saved => {
      if (current) setBaseline({ id, revision, content: patchSignature(normalizePatch(saved)) });
    }).catch(() => { if (current) setBaseline({ id, revision, content: null }); });
    return () => { current = false; };
  }, [id, revision, visible]);
  return useMemo(() => {
    if (!id) return "unsaved";
    if (!baseline || baseline.id !== id || baseline.revision !== revision) return "checking";
    if (baseline.content === null) return "unknown";
    return baseline.content === patchSignature(patch) ? "saved" : "changed";
  }, [id, baseline, revision, patch]);
}
