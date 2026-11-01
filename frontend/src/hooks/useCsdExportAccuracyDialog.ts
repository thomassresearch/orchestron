import { useCallback, useEffect, useRef, useState } from "react";

export function useCsdExportAccuracyDialog() {
  const [open, setOpen] = useState(false);
  const resolver = useRef<((value: number | null) => void) | null>(null);
  const request = useCallback(() => {
    if (resolver.current) return Promise.resolve(null);
    return new Promise<number | null>(resolve => {
      resolver.current = resolve;
      setOpen(true);
    });
  }, []);
  const close = useCallback((value: number | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    setOpen(false);
    resolve?.(value);
  }, []);
  useEffect(() => () => {
    resolver.current?.(null);
    resolver.current = null;
  }, []);
  return { open, request, close };
}
