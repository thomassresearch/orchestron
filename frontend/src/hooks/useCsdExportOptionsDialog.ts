import { useCallback, useEffect, useRef, useState } from "react";

import type { PerformanceCsdExportRequestPayload } from "../lib/bundleImportExport";

export type CsdExportOptions = Pick<PerformanceCsdExportRequestPayload, "controllerCurveTolerance" | "samplesInSubfolder">;
export type CsdExportControls = { showCurveAccuracy: boolean; showCompanionLocation: boolean };

export function useCsdExportOptionsDialog() {
  const [controls, setControls] = useState<CsdExportControls | null>(null);
  const resolver = useRef<((value: CsdExportOptions | null) => void) | null>(null);
  const request = useCallback((nextControls: CsdExportControls) => {
    if (resolver.current) return Promise.resolve(null);
    return new Promise<CsdExportOptions | null>(resolve => {
      resolver.current = resolve;
      setControls(nextControls);
    });
  }, []);
  const close = useCallback((value: CsdExportOptions | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setControls(null);
    resolve?.(value);
  }, []);
  useEffect(() => () => {
    resolver.current?.(null);
    resolver.current = null;
  }, []);
  return { controls, request, close };
}
