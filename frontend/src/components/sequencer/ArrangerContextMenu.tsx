import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ArrangerMenuTarget = { x: number; y: number; anchor: HTMLElement };

export function ArrangerContextMenu({ target, title, dialog = false, onClose, children }: {
  target: ArrangerMenuTarget; title: string; dialog?: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(target.x, window.innerWidth - bounds.width - 8)), y: Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8)) });
    node.querySelector<HTMLElement>("button:not(:disabled), select, input")?.focus();
  }, [target, dialog]);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close.current(); };
    const blur = () => close.current();
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
      if (target.anchor.isConnected) target.anchor.focus();
    };
  }, [target]);
  return createPortal(<div ref={ref} role={dialog ? "dialog" : "menu"} aria-label={title}
    className="fixed z-[100] max-h-[calc(100vh-16px)] w-72 max-w-[calc(100vw-16px)] overflow-auto rounded border border-slate-500 bg-slate-900 p-2 text-xs text-slate-100 shadow-xl"
    style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key) || dialog && event.key !== "Tab") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select, input")];
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
        (current + (event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }}>{children}</div>, document.body);
}
