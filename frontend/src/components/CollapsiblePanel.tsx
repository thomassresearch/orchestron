import { useId, type ReactNode } from "react";

export type PerformPanelId = "rack" | "melodic" | "drummer" | "controller" | "arpeggiators" | "piano" | "midi" | "arranger";
export type PanelId = "patchControls" | PerformPanelId;
export type PanelCollapseState = Record<PanelId, boolean>;

export const INITIAL_PANEL_COLLAPSE_STATE: PanelCollapseState = {
  patchControls: false,
  rack: false,
  melodic: false,
  drummer: false,
  controller: false,
  arpeggiators: false,
  piano: false,
  midi: false,
  arranger: false
};

interface CollapsiblePanelProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  className?: string;
  titleClassName?: string;
  actions?: ReactNode;
  help?: ReactNode;
  collapsedSummary?: ReactNode;
  unmountOnCollapse?: boolean;
  children: ReactNode;
}

export function CollapsiblePanel({
  title, collapsed, onCollapsedChange, className = "", titleClassName = "",
  actions, help, collapsedSummary, children, unmountOnCollapse = false
}: CollapsiblePanelProps) {
  const bodyId = useId();
  return (
    <section className={`relative min-w-0 ${className}`}>
      <div className={`flex flex-wrap items-center gap-2 ${help ? "pr-8" : ""}`}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => onCollapsedChange(!collapsed)}
          className={`flex min-w-0 items-center gap-2 rounded text-left text-[11px] font-semibold uppercase tracking-[0.18em] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${titleClassName}`}
        >
          <span aria-hidden="true" className="shrink-0 text-xs">{collapsed ? "▸" : "▾"}</span>
          {title}
        </button>
        {actions}
      </div>
      {help}
      {collapsed && collapsedSummary ? <div className="mt-2 min-w-0">{collapsedSummary}</div> : null}
      <div id={bodyId} hidden={collapsed} className="mt-3 min-w-0">
        {unmountOnCollapse && collapsed ? null : children}
      </div>
    </section>
  );
}
