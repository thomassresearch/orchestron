import type { GuiLanguage } from "../types";

export const collapsiblePanelHelp: Record<GuiLanguage, { design: string; runtime: string; perform: string; rack: string }> = {
  "english": {
    "design": "Use Patch controls to collapse metadata and load/save/compile/import/export actions. Instrument tabs, including add and close, stay visible. Controls start expanded; your choice survives view switches until browser reload.",
    "runtime": "Runtime starts collapsed. Open it with Show runtime in the graph header and close it with Hide. Your choice survives view switches until browser reload; compilation and playback continue while it is hidden.",
    "perform": "Arrange, Live and Mix remember their selection, scroll position and open panels. Close the editor to give the overview its full height. On a small screen use Back to overview or close the Inspector with Escape.",
    "rack": "Choose an instance in Compact rack to open its instrument controls or samples. Manage rack opens Mix for patch assignments and order. Project contains the performance name, description and file actions."
  },
  "german": {
    "design": "Mit Patch-Steuerung werden Metadaten sowie Laden, Speichern, Kompilieren, Import und Export eingeklappt. Instrument-Tabs mit Hinzufügen und Schließen bleiben sichtbar. Die Steuerung startet ausgeklappt; die Auswahl bleibt beim Ansichtswechsel bis zum Neuladen der Browserseite erhalten.",
    "runtime": "Runtime startet eingeklappt. Show runtime in der Graph-Kopfzeile öffnet das Panel, Hide schließt es. Die Auswahl bleibt beim Ansichtswechsel bis zum Neuladen der Browserseite erhalten; Kompilierung und Wiedergabe laufen auch bei verborgenem Panel weiter.",
    "perform": "Arrangement, Live und Mix behalten jeweils Auswahl, Scrollposition und offene Bereiche. Schließe den Editor, um die gesamte Höhe für die Übersicht zu nutzen. Auf kleinen Bildschirmen führt Zurück zur Übersicht aus dem Editor. Escape schließt den Inspektor.",
    "rack": "Wähle im kompakten Rack eine Instanz für Instrumentenregler oder Samples. Über Rack verwalten gelangst du zu den Zuordnungen und zur Reihenfolge im Mix. Name, Beschreibung und Dateiaktionen findest du unter Projekt."
  },
  "french": {
    "design": "Commandes du patch replie les métadonnées et les actions de chargement, enregistrement, compilation, import et export. Les onglets instrument, avec ajout et fermeture, restent visibles. Les commandes sont dépliées au départ ; votre choix est conservé entre les vues jusqu'au rechargement du navigateur.",
    "runtime": "Runtime est replié au départ. Show runtime dans l'en-tête du graphe ouvre le panneau et Hide le ferme. Votre choix est conservé entre les vues jusqu'au rechargement du navigateur ; la compilation et la lecture continuent quand il est masqué.",
    "perform": "Arrangement, Live et Mixage conservent chacun la sélection, le défilement et les panneaux ouverts. Fermez l’éditeur pour agrandir la vue d’ensemble. Sur petit écran, revenez à la vue d’ensemble avec le bouton de retour. Échap ferme l’inspecteur.",
    "rack": "Sélectionnez une instance dans le rack compact pour ouvrir ses commandes ou ses échantillons. Gérer le rack ouvre les affectations et l’ordre dans Mixage. Projet contient le nom, la description et les commandes de fichiers."
  },
  "spanish": {
    "design": "Controles del patch contrae los metadatos y las acciones de cargar, guardar, compilar, importar y exportar. Las pestañas de instrumentos, con agregar y cerrar, siguen visibles. Los controles empiezan expandidos; tu elección se conserva al cambiar de vista hasta recargar el navegador.",
    "runtime": "Runtime empieza contraído. Show runtime en la cabecera del grafo abre el panel y Hide lo cierra. Tu elección se conserva al cambiar de vista hasta recargar el navegador; la compilación y la reproducción continúan mientras está oculto.",
    "perform": "Arreglo, En vivo y Mezcla recuerdan su selección, desplazamiento y paneles abiertos. Cierra el editor para ampliar la vista general. En una pantalla pequeña, usa el botón de regreso a la vista general. Escape cierra el inspector.",
    "rack": "Selecciona una instancia en el rack compacto para abrir sus controles o muestras. Gestionar rack abre las asignaciones y el orden en Mezcla. Proyecto contiene el nombre, la descripción y las acciones de archivo."
  }
};
