import type { GuiLanguage } from "../types";

export const collapsiblePanelHelp: Record<GuiLanguage, { design: string; runtime: string; perform: string; rack: string }> = {
  "english": {
    "design": "Use Patch controls to collapse metadata and load/save/compile/import/export actions. Instrument tabs, including add and close, stay visible. Controls start expanded; your choice survives view switches until browser reload.",
    "runtime": "Runtime starts collapsed. Open it with Show runtime in the graph header and close it with Hide. Your choice survives view switches until browser reload; compilation and playback continue while it is hidden.",
    "perform": "Arrange, Live and Mix remember their selection, scroll position and editor. Keyboard stays open across all three. Play along with an unsaved clip audition, or hold a chord in Live and adjust an insert in Mix. Closing Keyboard releases its notes. On a small screen use Back to overview. Escape closes the Inspector. Open a status error to read the full message. Escape returns to its summary.",
    "rack": "Choose an instance in Compact rack to open its instrument controls or samples. Manage rack opens Mix for patch assignments and order. Project contains the performance name, description and file actions."
  },
  "german": {
    "design": "Mit Patch-Steuerung werden Metadaten sowie Laden, Speichern, Kompilieren, Import und Export eingeklappt. Instrument-Tabs mit Hinzufügen und Schließen bleiben sichtbar. Die Steuerung startet ausgeklappt; die Auswahl bleibt beim Ansichtswechsel bis zum Neuladen der Browserseite erhalten.",
    "runtime": "Runtime startet eingeklappt. Show runtime in der Graph-Kopfzeile öffnet das Panel, Hide schließt es. Die Auswahl bleibt beim Ansichtswechsel bis zum Neuladen der Browserseite erhalten; Kompilierung und Wiedergabe laufen auch bei verborgenem Panel weiter.",
    "perform": "Arrangement, Live und Mix behalten jeweils Auswahl, Scrollposition und Editor. Die Klaviatur bleibt beim Wechsel geöffnet. Spiele zum ungespeicherten Clip-Entwurf oder halte in Live einen Akkord und stelle in Mix einen Insert-Effekt ein. Beim Schließen der Klaviatur enden ihre gehaltenen Noten. Auf kleinen Bildschirmen führt Zur Übersicht aus dem Editor. Escape schließt den Inspektor. Öffne eine Fehlermeldung in der Statusleiste, um sie vollständig zu lesen. Mit Escape kehrst du zur Kurzansicht zurück.",
    "rack": "Wähle im kompakten Rack eine Instanz für Instrumentenregler oder Samples. Über Rack verwalten gelangst du zu den Zuordnungen und zur Reihenfolge im Mix. Name, Beschreibung und Dateiaktionen findest du unter Projekt."
  },
  "french": {
    "design": "Commandes du patch replie les métadonnées et les actions de chargement, enregistrement, compilation, import et export. Les onglets instrument, avec ajout et fermeture, restent visibles. Les commandes sont dépliées au départ ; votre choix est conservé entre les vues jusqu'au rechargement du navigateur.",
    "runtime": "Runtime est replié au départ. Show runtime dans l'en-tête du graphe ouvre le panneau et Hide le ferme. Votre choix est conservé entre les vues jusqu'au rechargement du navigateur ; la compilation et la lecture continuent quand il est masqué.",
    "perform": "Arrangement, Live et Mixage conservent chacun la sélection, le défilement et l’éditeur. Le clavier reste ouvert dans les trois vues. Jouez avec une variation en cours d’écoute ou tenez un accord dans Live et réglez un effet d’insert dans Mixage. Fermer le clavier relâche ses notes. Sur petit écran, utilisez le bouton de retour à la vue d’ensemble. Échap ferme l’inspecteur. Ouvrez une erreur dans la barre d’état pour lire le message complet. Échap vous ramène au résumé.",
    "rack": "Sélectionnez une instance dans le rack compact pour ouvrir ses commandes ou ses échantillons. Gérer le rack ouvre les affectations et l’ordre dans Mixage. Projet contient le nom, la description et les commandes de fichiers."
  },
  "spanish": {
    "design": "Controles del patch contrae los metadatos y las acciones de cargar, guardar, compilar, importar y exportar. Las pestañas de instrumentos, con agregar y cerrar, siguen visibles. Los controles empiezan expandidos; tu elección se conserva al cambiar de vista hasta recargar el navegador.",
    "runtime": "Runtime empieza contraído. Show runtime en la cabecera del grafo abre el panel y Hide lo cierra. Tu elección se conserva al cambiar de vista hasta recargar el navegador; la compilación y la reproducción continúan mientras está oculto.",
    "perform": "Arreglo, En vivo y Mezcla recuerdan la selección, el desplazamiento y el editor de cada vista. El teclado permanece abierto en las tres. Toca junto a una variación sin guardar o mantén un acorde en En vivo y ajusta un efecto de inserción en Mezcla. Cerrar el teclado suelta sus notas. En una pantalla pequeña, usa el botón de regreso a la vista general. Escape cierra el inspector. Abre un error en la barra de estado para leer el mensaje completo. Escape vuelve al resumen.",
    "rack": "Selecciona una instancia en el rack compacto para abrir sus controles o muestras. Gestionar rack abre las asignaciones y el orden en Mezcla. Proyecto contiene el nombre, la descripción y las acciones de archivo."
  }
};
