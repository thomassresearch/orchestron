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
  addNode: ["Add node to case", "Knoten zum Zweig hinzufügen", "Ajouter un nœud au cas", "Añadir nodo al caso"],
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
    "If and Switch choose one synthesis case when each note starts. Patch case audio into Case Result, then connect the block output. Cases can use shared main-graph sources. Move nodes explicitly; dragging never changes case membership. Default/False may be Silence. Effects after a block run per voice; use the performance mixer for whole-instrument effects.",
    "If und Switch wählen beim Start jeder Note einen Synthesezweig. Audio mit dem Zweigergebnis verbinden, dann den Blockausgang anschließen. Zweige können gemeinsame Quellen im Hauptgraphen nutzen. Knoten explizit verschieben; Ziehen ändert keine Zweigzuordnung. Standard/Falsch kann Stille sein. Effekte nach dem Block wirken pro Stimme; gemeinsame Effekte gehören in den Performance-Mixer.",
    "If et Switch choisissent un cas de synthèse au début de chaque note. Reliez l’audio au résultat du cas, puis connectez la sortie du bloc. Les cas peuvent utiliser des sources communes du graphe principal. Déplacez explicitement les nœuds entre cas ; leur position ne change pas leur appartenance. Par défaut/Faux peut être Silence. Les effets après le bloc s’appliquent par voix ; utilisez le mixeur pour les effets communs.",
    "If y Switch eligen un caso de síntesis al inicio de cada nota. Conecta el audio al resultado del caso y después a la salida del bloque. Los casos pueden usar fuentes del grafo principal. Mueve los nodos explícitamente entre casos; su posición no cambia su pertenencia. Por defecto/Falso puede ser Silencio. Los efectos posteriores al bloque se aplican por voz; usa el mezclador para efectos comunes."
  ],
} as const;

export function controlFlowCopy(language: GuiLanguage) {
  const index = ({ english: 0, german: 1, french: 2, spanish: 3 } as const)[language];
  return (key: keyof typeof rows): string => rows[key][index];
}
