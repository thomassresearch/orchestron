import type { GuiLanguage } from "../types";

const rows = {
  title: ["Control flow", "Kontrollfluss", "Contrôle de flux", "Flujo de control"],
  noteStart: ["At note start · i-rate", "Beim Notenstart · i-Rate", "Au début de la note · taux i", "Al inicio de la nota · tasa i"],
  true: ["True", "Wahr", "Vrai", "Verdadero"],
  false: ["False", "Falsch", "Faux", "Falso"],
  default: ["Default", "Standard", "Par défaut", "Por defecto"],
  result: ["Case Result", "Zweigergebnis", "Résultat du cas", "Resultado del caso"],
  silence: ["Silence", "Stille", "Silence", "Silencio"],
  synthesis: ["Synthesis", "Synthese", "Synthèse", "Síntesis"],
  expand: ["Expand cases", "Zweige ausklappen", "Développer les cas", "Expandir casos"],
  collapse: ["Collapse cases", "Zweige einklappen", "Réduire les cas", "Contraer casos"],
  configure: ["Configure branches", "Zweige konfigurieren", "Configurer les branches", "Configurar ramas"],
  addCase: ["Add case", "Zweig hinzufügen", "Ajouter un cas", "Añadir caso"],
  caseName: ["Case name", "Zweigname", "Nom du cas", "Nombre del caso"],
  value: ["Match value", "Vergleichswert", "Valeur correspondante", "Valor coincidente"],
  operator: ["Comparison", "Vergleich", "Comparaison", "Comparación"],
  lhs: ["Left operand", "Linker Operand", "Opérande gauche", "Operando izquierdo"],
  rhs: ["Right operand", "Rechter Operand", "Opérande droit", "Operando derecho"],
  selector: ["Selector", "Auswahlwert", "Sélecteur", "Selector"],
  connected: ["Connected input / formula takes precedence", "Verbindung / Formel hat Vorrang", "La connexion / formule est prioritaire", "La conexión / fórmula tiene prioridad"],
  format: ["Audio result", "Audioergebnis", "Résultat audio", "Resultado de audio"],
  mono: ["Mono", "Mono", "Mono", "Mono"],
  stereo: ["Stereo", "Stereo", "Stéréo", "Estéreo"],
  mainGraph: ["Main graph", "Hauptgraph", "Graphe principal", "Grafo principal"],
  move: ["Move selected nodes", "Ausgewählte Knoten verschieben", "Déplacer les nœuds sélectionnés", "Mover nodos seleccionados"],
  dropInto: ["Drop into", "Ablegen in", "Déposer dans", "Soltar en"],
  dropRejected: ["Drop refused. Move the connected nodes together:", "Ablegen abgelehnt. Verbundene Knoten gemeinsam verschieben:", "Dépôt refusé. Déplacez ensemble les nœuds connectés :", "Se rechazó la operación. Mueve juntos los nodos conectados:"],
  expandToDrop: ["Expand the block and drop into a specific case.", "Block ausklappen und in einem bestimmten Zweig ablegen.", "Développez le bloc puis déposez dans un cas précis.", "Expande el bloque y suelta en un caso concreto."],
  mainOnly: ["This construct must remain in the main graph:", "Dieses Konstrukt muss im Hauptgraphen bleiben:", "Cette construction doit rester dans le graphe principal :", "Esta construcción debe permanecer en el grafo principal:"],
  resizeHelp: ["Drag Case Result to resize this branch. Its contents set the minimum size. Escape cancels.", "Zweigergebnis ziehen, um die Zweiggröße zu ändern. Der Inhalt bestimmt die Mindestgröße. Escape bricht ab.", "Glissez le Résultat du cas pour redimensionner cette branche. Le contenu fixe la taille minimale. Échap annule.", "Arrastra el Resultado del caso para redimensionar esta rama. El contenido determina el tamaño mínimo. Escape cancela."],
  dragHint: ["Drop catalog nodes into cases · Alt/Option-drag to transfer · Drag Case Result to resize", "Katalogknoten in Zweige ziehen · Alt/Option-Ziehen zum Übertragen · Zweigergebnis zum Ändern der Größe ziehen", "Déposez les nœuds dans les cas · Alt/Option-glisser pour transférer · Glissez le résultat pour redimensionner", "Arrastra nodos a los casos · Alt/Opción-arrastrar para transferir · Arrastra el resultado para redimensionar"],
  remove: ["Delete case", "Zweig löschen", "Supprimer le cas", "Eliminar caso"],
  up: ["Move case up", "Zweig nach oben", "Monter le cas", "Subir caso"],
  down: ["Move case down", "Zweig nach unten", "Descendre le cas", "Bajar caso"],
  review: ["Review affected items", "Betroffene Elemente prüfen", "Vérifier les éléments affectés", "Revisar elementos afectados"],
  apply: ["Apply", "Anwenden", "Appliquer", "Aplicar"],
  cancel: ["Cancel", "Abbrechen", "Annuler", "Cancelar"],
  close: ["Close", "Schließen", "Fermer", "Cerrar"],
  invalid: ["This change is invalid. Repair the listed connections or values.", "Diese Änderung ist ungültig. Aufgeführte Verbindungen oder Werte korrigieren.", "Modification invalide. Corrigez les connexions ou valeurs indiquées.", "Cambio no válido. Corrige las conexiones o los valores indicados."],
  expandToEdit: ["Expand cases to edit this input formula.", "Zweige ausklappen, um diese Eingangsformel zu bearbeiten.", "Développez les cas pour modifier cette formule.", "Expande los casos para editar esta fórmula."],
  help: [
    "If and Switch choose one synthesis case at note start. Drop catalog nodes into expanded cases; valid drops turn Silence into Synthesis. Drag main-graph nodes into a case, or hold Alt/Option at drag start to transfer case members. Move selected nodes uses the same rule: connected endpoints and formula bindings must move together or already belong to the destination. Escape cancels. Frames grow automatically and retain their size. Drag Case Result at the bottom-right to resize, limited by the contents; other selected nodes stay still. Sizes are saved. Patch each case into its result, then connect the common output. Shared main-graph inputs may be wired afterwards. Effects after the block run per voice; mixer effects process the sum.",
    "If und Switch wählen beim Notenstart einen Synthesezweig. Katalogknoten in ausgeklappte Zweige ziehen; gültiges Ablegen schaltet Stille auf Synthese. Hauptgraphknoten hineinziehen oder Alt/Option beim Ziehbeginn halten, um Zweigmitglieder zu übertragen. Ausgewählte Knoten verschieben nutzt dieselbe Regel: verbundene Endpunkte und Formelbindungen müssen mitwechseln oder im Ziel liegen. Escape bricht ab. Rahmen wachsen automatisch und behalten ihre Größe. Zum Ändern das Zweigergebnis unten rechts ziehen; der Inhalt begrenzt die Mindestgröße, andere ausgewählte Knoten bleiben stehen. Größen werden gespeichert. Jeden Zweig mit seinem Ergebnis, dann den gemeinsamen Ausgang verbinden. Gemeinsame Hauptgrapheingänge können danach verdrahtet werden. Effekte nach dem Block wirken pro Stimme, Mixer-Effekte auf die Summe.",
    "If et Switch choisissent un cas au début de la note. Déposez les nœuds du catalogue dans les cas développés ; un dépôt valide active Synthèse dans un cas Silence. Glissez les nœuds du graphe principal dans un cas, ou maintenez Alt/Option dès le début pour transférer les membres. Déplacer les nœuds sélectionnés suit la même règle : extrémités connectées et liaisons de formule doivent être déplacées ensemble ou déjà dans la destination. Échap annule. Les cadres grandissent et conservent leur taille. Glissez le résultat en bas à droite pour redimensionner dans les limites du contenu ; les autres nœuds sélectionnés restent immobiles. Les tailles sont enregistrées. Reliez chaque cas à son résultat puis à la sortie commune. Les entrées communes peuvent être câblées ensuite. Les effets après le bloc traitent chaque voix ; le mixeur traite la somme.",
    "If y Switch eligen un caso al inicio de la nota. Suelta nodos del catálogo en casos expandidos; una operación válida activa Síntesis en un caso Silencio. Arrastra nodos del grafo principal a un caso, o mantén Alt/Opción desde el inicio para transferir miembros. Mover nodos seleccionados aplica la misma regla: extremos conectados y vínculos de fórmula deben moverse juntos o pertenecer al destino. Escape cancela. Los marcos crecen y conservan su tamaño. Arrastra el resultado abajo a la derecha para redimensionar dentro de los límites del contenido; los demás nodos seleccionados no se mueven. Los tamaños se guardan. Conecta cada caso a su resultado y luego a la salida común. Las entradas compartidas pueden conectarse después. Los efectos posteriores procesan cada voz; el mezclador procesa la suma."
  ],
} as const;

export function controlFlowCopy(language: GuiLanguage) {
  const index = ({ english: 0, german: 1, french: 2, spanish: 3 } as const)[language];
  return (key: keyof typeof rows): string => rows[key][index];
}
