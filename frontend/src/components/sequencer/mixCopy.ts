import type { GuiLanguage } from "../../types";

const labels = {
  monitorChannel: ["Mixer channel", "Mischpultkanal", "Tranche du mixeur", "Canal del mezclador"],
  compact: ["Compact rack", "Kompaktes Rack", "Rack compact", "Rack compacto"],
  rack: ["Rack", "Rack", "Rack", "Rack"],
  routing: ["Routing", "Routing", "Routage", "Rutas"],
  manage: ["Manage rack", "Rack verwalten", "Gérer le rack", "Gestionar rack"],
  instrument: ["Instrument controls", "Instrumentregler", "Commandes de l’instrument", "Controles del instrumento"],
  openControls: ["Open instrument and insert controls.", "Instrument- und Insert-Regler öffnen.", "Ouvrir les commandes des instruments et de leurs inserts.", "Abrir los controles de los instrumentos y sus efectos de inserción."],
  controllers: ["Controllers", "Regler", "Contrôleurs", "Controladores"],
  backToEditor: ["Back to editor", "Zurück zum Editor", "Revenir à l’éditeur", "Volver al editor"],
  noDestination: ["No rack instrument is assigned to this lane’s destination.", "Dem Ziel dieser Spur ist kein Rack-Instrument zugewiesen.", "Aucun instrument du rack n’est affecté à la destination de cette piste.", "No hay ningún instrumento del rack asignado al destino de esta pista."],
  multi: ["Shift-select to add or remove instruments.", "Mit Umschalt Instrumente zur Auswahl hinzufügen oder entfernen.", "Maj + sélection pour ajouter ou retirer des instruments.", "Mayús + selección para añadir o quitar instrumentos."],
  samples: ["Samples", "Samples", "Échantillons", "Muestras"],
  noControls: ["This patch has no performance controls.", "Dieser Patch hat keine Performance-Regler.", "Ce patch ne possède aucune commande de performance.", "Este patch no tiene controles de interpretación."],
  stopRack: ["Stop to edit rack", "Zum Bearbeiten des Racks stoppen", "Arrêter pour modifier le rack", "Detener para editar el rack"]
};

export function mixCopy(language: GuiLanguage) {
  const index = { english: 0, german: 1, french: 2, spanish: 3 }[language];
  return (key: keyof typeof labels) => labels[key][index];
}
