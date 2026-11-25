import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ArrangerMenuTarget = { x: number; y: number; anchor: HTMLElement | SVGElement; align?: "end" };

export function ArrangerContextMenu({ target, title, dialog = false, dismissOnFocusLeave = false, onClose, children }: {
  target: ArrangerMenuTarget; title: string; dialog?: boolean; dismissOnFocusLeave?: boolean;
  onClose: (outsidePointer?: EventTarget | null) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: target.x, y: target.y });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const bounds = node.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(target.align === "end" ? target.x - bounds.width : target.x, window.innerWidth - bounds.width - 8)), y: Math.max(8, Math.min(target.y, window.innerHeight - bounds.height - 8)) });
    (node.querySelector<HTMLElement>("button:not(:disabled), select, input") ?? node).focus({ preventScroll: true });
  }, [target, dialog, title]);
  useEffect(() => {
    const node = ref.current!;
    let restoreFocus = true;
    let active = true;
    const dismiss = (restore: boolean, outsidePointer?: EventTarget | null) => {
      if (!active) return;
      active = false;
      restoreFocus = restore;
      close.current(outsidePointer);
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node && node.contains(event.target))) dismiss(!dismissOnFocusLeave, event.target);
    };
    const blur = () => dismiss(!dismissOnFocusLeave);
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node) {
        if (!node.contains(event.relatedTarget)) dismiss(false);
      } else {
        // A submenu can replace the focused button and focus its next control in the same render.
        queueMicrotask(() => { if (!node.contains(document.activeElement)) dismiss(false); });
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss(true);
    };
    if (dismissOnFocusLeave) {
      node.addEventListener("focusout", focusOut);
      window.addEventListener("keydown", escape, true);
    }
    window.addEventListener("pointerdown", outside, dismissOnFocusLeave);
    window.addEventListener("blur", blur);
    window.addEventListener("resize", blur);
    return () => {
      active = false;
      node.removeEventListener("focusout", focusOut);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("pointerdown", outside, dismissOnFocusLeave);
      window.removeEventListener("blur", blur);
      window.removeEventListener("resize", blur);
      if (restoreFocus && target.anchor.isConnected) target.anchor.focus({ preventScroll: true });
    };
  }, [target, dismissOnFocusLeave]);
  return createPortal(<div ref={ref} role={dialog ? "dialog" : "menu"} aria-label={title} tabIndex={-1}
    className="fixed z-[100] max-h-[calc(100vh-16px)] w-72 max-w-[calc(100vw-16px)] overflow-auto rounded border border-slate-500 bg-slate-900 p-2 text-xs text-slate-100 shadow-xl"
    style={{ left: position.x, top: position.y }} onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End", "Tab"].includes(event.key) || dialog && event.key !== "Tab") return;
      const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), select, input")];
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement as HTMLElement);
      if (dismissOnFocusLeave && event.key === "Tab") {
        // Continue in the trigger's tab order when leaving a menu portaled to the end of the page.
        if (current === (event.shiftKey ? 0 : buttons.length - 1)) target.anchor.focus({ preventScroll: true });
        return;
      }
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
        (current + (event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }}>{children}</div>, document.body);
}
