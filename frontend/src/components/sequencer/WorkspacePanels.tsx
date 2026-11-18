import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { OccurrenceTarget, SourceKind } from "../../lib/clipArranger/model";

export const shellCopy = {
  english: { project: "Project", inspector: "Inspector", editor: "Editor", keyboard: "Keyboard", transport: "Song transport", divider: "Resize editor", expand: "Expand", restore: "Restore split", back: "Back to overview", close: "Close", fit: "Fit tracks", diagnostics: "Diagnostics", config: "Audio configuration", help: "Help", status: "Session status", overview: "Overview", channel: "MIDI channel", select: "Select an item to inspect." },
  german: { project: "Projekt", inspector: "Inspektor", editor: "Editor", keyboard: "Klaviatur", transport: "Songtransport", divider: "Editorgröße ändern", expand: "Vergrößern", restore: "Teilung wiederherstellen", back: "Zur Übersicht", close: "Schließen", fit: "Spurhöhe anpassen", diagnostics: "Diagnose", config: "Audiokonfiguration", help: "Hilfe", status: "Sitzungsstatus", overview: "Übersicht", channel: "MIDI-Kanal", select: "Element auswählen, um Eigenschaften zu sehen." },
  french: { project: "Projet", inspector: "Inspecteur", editor: "Éditeur", keyboard: "Clavier", transport: "Transport du morceau", divider: "Redimensionner l’éditeur", expand: "Agrandir", restore: "Rétablir le partage", back: "Revenir à la vue d’ensemble", close: "Fermer", fit: "Ajuster les pistes", diagnostics: "Diagnostic", config: "Configuration audio", help: "Aide", status: "État de la session", overview: "Vue d’ensemble", channel: "Canal MIDI", select: "Sélectionnez un élément pour voir ses propriétés." },
  spanish: { project: "Proyecto", inspector: "Inspector", editor: "Editor", keyboard: "Teclado", transport: "Transporte de la canción", divider: "Ajustar tamaño del editor", expand: "Ampliar", restore: "Restaurar división", back: "Volver a la vista general", close: "Cerrar", fit: "Ajustar pistas", diagnostics: "Diagnóstico", config: "Configuración de audio", help: "Ayuda", status: "Estado de la sesión", overview: "Vista general", channel: "Canal MIDI", select: "Selecciona un elemento para ver sus propiedades." }
};

type Panel = "editor" | "inspector" | "editorCommand" | "dialogs" | "launcher";
export const WorkspacePanels = createContext<null | {
  slots: Record<Panel, HTMLElement | null>;
  trackRouting: (id: string, kind: SourceKind) => ReactNode;
  getRememberedTarget: () => OccurrenceTarget | undefined;
  closeDock: () => void;
}>(null);

/** Keep controls in their original coordinator while rendering them in a bounded pane. */
export function WorkspacePanel({ name, children }: { name: Panel; children: ReactNode }) {
  const shell = useContext(WorkspacePanels);
  if (!shell) return name === "editorCommand" ? null : <>{children}</>;
  const target = shell.slots[name];
  return target ? createPortal(children, target) : null;
}
