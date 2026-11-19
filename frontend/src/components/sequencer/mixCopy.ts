import type { GuiLanguage } from "../../types";

const labels = {
  compact: ["Compact rack", "Kompaktes Rack", "Rack compact", "Rack compacto"],
  rack: ["Rack", "Rack", "Rack", "Rack"],
  routing: ["Routing", "Routing", "Routage", "Rutas"],
  manage: ["Manage rack", "Rack verwalten", "Gérer le rack", "Gestionar rack"],
  instrument: ["Instrument controls", "Instrumentregler", "Commandes de l’instrument", "Controles del instrumento"],
  multi: ["Shift-select to add or remove instruments.", "Mit Umschalt Instrumente zur Auswahl hinzufügen oder entfernen.", "Maj + sélection pour ajouter ou retirer des instruments.", "Mayús + selección para añadir o quitar instrumentos."],
  samples: ["Samples", "Samples", "Échantillons", "Muestras"],
  noControls: ["This patch has no performance controls.", "Dieser Patch hat keine Performance-Regler.", "Ce patch ne possède aucune commande de performance.", "Este patch no tiene controles de interpretación."],
  stopRack: ["Stop to edit rack", "Zum Bearbeiten des Racks stoppen", "Arrêter pour modifier le rack", "Detener para editar el rack"]
};

export function mixCopy(language: GuiLanguage) {
  const index = { english: 0, german: 1, french: 2, spanish: 3 }[language];
  return (key: keyof typeof labels) => labels[key][index];
}
