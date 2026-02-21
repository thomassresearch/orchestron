import type { GuiLanguage, HelpDocId, OpcodeSpec, PortSpec, SignalType } from "../types";

import { normalizeGuiLanguage } from "./guiLanguage";

export interface HelpDocument {
  title: string;
  markdown: string;
}

export interface DocumentationUiCopy {
  showDocumentation: string;
  help: string;
  close: string;
  openCsoundReference: string;
  opcodeDocumentation: string;
  noOpcodeDocumentation: string;
}

const DOCUMENTATION_UI_COPY: Record<GuiLanguage, DocumentationUiCopy> = {
  english: {
    showDocumentation: "Show documentation",
    help: "Help",
    close: "Close",
    openCsoundReference: "Open Csound Reference",
    opcodeDocumentation: "Opcode Documentation",
    noOpcodeDocumentation: "No documentation markdown available for this opcode."
  },
  german: {
    showDocumentation: "Dokumentation anzeigen",
    help: "Hilfe",
    close: "Schließen",
    openCsoundReference: "Csound-Referenz öffnen",
    opcodeDocumentation: "Opcode-Dokumentation",
    noOpcodeDocumentation: "Keine Markdown-Dokumentation für dieses Opcode verfügbar."
  },
  french: {
    showDocumentation: "Afficher la documentation",
    help: "Aide",
    close: "Fermer",
    openCsoundReference: "Ouvrir la référence Csound",
    opcodeDocumentation: "Documentation Opcode",
    noOpcodeDocumentation: "Aucune documentation markdown disponible pour cet opcode."
  },
  spanish: {
    showDocumentation: "Mostrar documentación",
    help: "Ayuda",
    close: "Cerrar",
    openCsoundReference: "Abrir referencia de Csound",
    opcodeDocumentation: "Documentación de Opcode",
    noOpcodeDocumentation: "No hay documentación markdown disponible para este opcode."
  }
};

const HELP_DOCUMENTS: Record<HelpDocId, Record<GuiLanguage, HelpDocument>> = {
  instrument_patch_toolbar: {
    english: {
      title: "Instrument Patch Toolbar",
      markdown: `## Instrument Patch Toolbar

Use this area to organize patch files and main patch actions.

- Rename the current patch and edit its short description.
- Load an existing patch into the current tab.
- Create a new patch draft.
- Save the current patch to the backend.
- Compile the current graph into Csound ORC/CSD.
- Export the compiled CSD file.

Each instrument tab keeps its own editable graph snapshot.`
    },
    german: {
      title: "Instrument Patch Toolbar",
      markdown: `## Instrument Patch Toolbar

Dieser Bereich steuert Patch-Dateien und Hauptaktionen.

- Aktuellen Patch umbenennen und Beschreibung bearbeiten.
- Vorhandenen Patch in den aktuellen Tab laden.
- Neuen Patch-Entwurf erstellen.
- Aktuellen Patch im Backend speichern.
- Aktuellen Graphen in Csound ORC/CSD kompilieren.
- Kompilierte CSD-Datei exportieren.

Jeder Instrument-Tab behält eine eigene bearbeitbare Graph-Kopie.`
    },
    french: {
      title: "Barre de patch instrument",
      markdown: `## Barre de patch instrument

Cette zone gère les fichiers de patch et les actions principales.

- Renommer le patch courant et modifier sa description.
- Charger un patch existant dans l'onglet courant.
- Créer un nouveau brouillon de patch.
- Enregistrer le patch courant sur le backend.
- Compiler le graphe courant en Csound ORC/CSD.
- Exporter le fichier CSD compilé.

Chaque onglet instrument garde son propre état de graphe éditable.`
    },
    spanish: {
      title: "Barra de patch de instrumento",
      markdown: `## Barra de patch de instrumento

Esta zona controla archivos de patch y acciones principales.

- Renombrar el patch actual y editar su descripción.
- Cargar un patch existente en la pestaña actual.
- Crear un nuevo borrador de patch.
- Guardar el patch actual en el backend.
- Compilar el grafo actual a Csound ORC/CSD.
- Exportar el archivo CSD compilado.

Cada pestaña de instrumento mantiene su propio estado editable del grafo.`
    }
  },
  instrument_opcode_catalog: {
    english: {
      title: "Opcode Catalog",
      markdown: `## Opcode Catalog

Browse and insert opcodes into the graph editor.

- Search by opcode name, category, tags, or description.
- Click an opcode to add it to the graph.
- Drag and drop opcodes from this list into the graph canvas.

The icon and category help identify the signal role of each opcode.`
    },
    german: {
      title: "Opcode-Katalog",
      markdown: `## Opcode-Katalog

Hier werden Opcodes für den Graph Editor gesucht und eingefügt.

- Suche nach Opcode-Name, Kategorie, Tags oder Beschreibung.
- Klick auf ein Opcode fügt es in den Graphen ein.
- Drag-and-drop aus dieser Liste in die Graph-Fläche.

Icon und Kategorie helfen bei der Einordnung der Signalrolle.`
    },
    french: {
      title: "Catalogue Opcode",
      markdown: `## Catalogue Opcode

Parcourez et insérez des opcodes dans l'éditeur de graphe.

- Rechercher par nom, catégorie, tags ou description.
- Cliquer sur un opcode pour l'ajouter au graphe.
- Glisser-deposer des opcodes vers le canevas du graphe.

L'icône et la catégorie aident à identifier le rôle du signal.`
    },
    spanish: {
      title: "Catálogo de Opcode",
      markdown: `## Catálogo de Opcode

Explora e inserta opcodes en el editor de grafos.

- Busca por nombre, categoría, etiquetas o descripción.
- Haz clic en un opcode para agregarlo al grafo.
- Arrastra y suelta opcodes de esta lista al lienzo.

El ícono y la categoría ayudan a identificar el rol de la señal.`
    }
  },
  instrument_graph_editor: {
    english: {
      title: "Graph Editor",
      markdown: `## Graph Editor

This is the visual patching area for signal routing.

- Connect compatible ports between nodes.
- Edit node parameters in controls on each node.
- Select nodes or cables to inspect and delete them.
- Use the node-level \`?\` button to open opcode documentation.

Compilation order is derived from graph dependencies.`
    },
    german: {
      title: "Graph Editor",
      markdown: `## Graph Editor

Dies ist der visuelle Patch-Bereich für Signalrouting.

- Kompatible Ports zwischen Nodes verbinden.
- Parameter direkt auf den Nodes bearbeiten.
- Nodes oder Kabel auswählen, prüfen und löschen.
- Die Node-\`?\`-Taste öffnet die Opcode-Dokumentation.

Die Kompilierungsreihenfolge folgt den Graph-Abhängigkeiten.`
    },
    french: {
      title: "Éditeur de graphe",
      markdown: `## Éditeur de graphe

Zone visuelle de patch pour le routage des signaux.

- Connecter des ports compatibles entre nœuds.
- Modifier les paramètres sur chaque nœud.
- Sélectionner nœuds ou connexions pour inspection/suppression.
- Le bouton \`?\` d'un nœud ouvre la documentation opcode.

L'ordre de compilation suit les dépendances du graphe.`
    },
    spanish: {
      title: "Editor de grafos",
      markdown: `## Editor de grafos

Zona visual de patch para enrutar señales.

- Conectar puertos compatibles entre nodos.
- Editar parámetros en cada nodo.
- Seleccionar nodos o conexiones para inspeccionar/eliminar.
- El botón \`?\` del nodo abre la documentación del opcode.

El orden de compilación depende de las dependencias del grafo.`
    }
  },
  instrument_runtime_panel: {
    english: {
      title: "Runtime Panel",
      markdown: `## Runtime Panel

Monitor and control runtime session behavior.

- Bind the active MIDI input for the current session.
- Inspect generated ORC output after compile.
- Review recent session events from WebSocket updates.

Use this panel while testing patches live.`
    },
    german: {
      title: "Runtime-Panel",
      markdown: `## Runtime-Panel

Überwachen und steuern der laufenden Session.

- Aktiven MIDI-Eingang für die Session binden.
- Generierten ORC-Output nach der Kompilierung prüfen.
- Letzte Session-Events aus WebSocket-Updates ansehen.

Dieses Panel während Live-Tests verwenden.`
    },
    french: {
      title: "Panneau Runtime",
      markdown: `## Panneau Runtime

Surveillance et contrôle de la session runtime.

- Associer l'entrée MIDI active à la session courante.
- Inspecter la sortie ORC après compilation.
- Consulter les événements récents de session (WebSocket).

Utilisez ce panneau pendant les tests en direct.`
    },
    spanish: {
      title: "Panel Runtime",
      markdown: `## Panel Runtime

Monitorea y controla el comportamiento de la sesión runtime.

- Vincula la entrada MIDI activa para la sesión actual.
- Revisa la salida ORC generada tras compilar.
- Consulta eventos recientes de sesión via WebSocket.

Usa este panel durante pruebas en vivo.`
    }
  },
  sequencer_instrument_rack: {
    english: {
      title: "Instrument Rack",
      markdown: `## Instrument Rack

Manage performance-level instrument assignments.

- Set performance name and description.
- Load and save performance presets.
- Assign saved patches to MIDI channels.
- Start and stop instrument engine transport.
- Import/export sequencer configuration JSON.`
    },
    german: {
      title: "Instrument Rack",
      markdown: `## Instrument Rack

Verwaltet Instrument-Zuordnungen auf Performance-Ebene.

- Performance-Name und Beschreibung setzen.
- Performance-Presets laden und speichern.
- Gespeicherte Patches MIDI-Kanälen zuweisen.
- Instrument-Engine starten/stoppen.
- Sequencer-Konfiguration als JSON importieren/exportieren.`
    },
    french: {
      title: "Rack instrument",
      markdown: `## Rack instrument

Gestion des affectations d'instruments au niveau performance.

- Définir nom et description de performance.
- Charger et enregistrer des presets de performance.
- Affecter des patches sauvegardés à des canaux MIDI.
- Démarrer/arrêter le moteur instrument.
- Import/export JSON de configuration séquenceur.`
    },
    spanish: {
      title: "Rack de instrumentos",
      markdown: `## Rack de instrumentos

Gestiona asignaciones de instrumentos a nivel de performance.

- Define nombre y descripción de performance.
- Carga y guarda presets de performance.
- Asigna patches guardados a canales MIDI.
- Inicia y detiene el motor de instrumentos.
- Importa/exporta JSON de configuración del secuenciador.`
    }
  },
  sequencer_tracks: {
    english: {
      title: "Sequencer Tracks",
      markdown: `## Sequencer Tracks

Program step-based melodic or rhythmic patterns.

- Add/remove sequencer tracks.
- Set track channel, scale, mode, and step count (16/32).
- Use pattern pads (P1..P8) for queued pattern changes.
- Set per-step notes or rests.
- Control global BPM and running state.`
    },
    german: {
      title: "Sequencer Tracks",
      markdown: `## Sequencer Tracks

Programmiert schrittbasierte melodische oder rhythmische Patterns.

- Sequencer-Spuren hinzufügen/entfernen.
- Kanal, Skala, Modus und Schrittzahl (16/32) setzen.
- Pattern-Pads (P1..P8) für geplante Pattern-Wechsel nutzen.
- Pro Schritt Noten oder Pausen setzen.
- Globales BPM und Laufstatus steuern.`
    },
    french: {
      title: "Pistes séquenceur",
      markdown: `## Pistes séquenceur

Programme des patterns mélodiques ou rythmiques par pas.

- Ajouter/supprimer des pistes séquenceur.
- Régler canal, gamme, mode et nombre de pas (16/32).
- Utiliser les pads P1..P8 pour changements de pattern.
- Définir note ou silence par pas.
- Contrôler BPM global et état de lecture.`
    },
    spanish: {
      title: "Pistas del secuenciador",
      markdown: `## Pistas del secuenciador

Programa patrones melódicos o rítmicos por pasos.

- Agrega/elimina pistas del secuenciador.
- Ajusta canal, escala, modo y cantidad de pasos (16/32).
- Usa pads P1..P8 para cambios de patrón en cola.
- Define nota o silencio por paso.
- Controla BPM global y estado de reproducción.`
    }
  },
  sequencer_piano_rolls: {
    english: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Play notes manually with scale-aware keyboard highlights.

- Add/remove piano roll controllers.
- Set MIDI channel, scale root/type, and mode.
- Start/stop each piano roll independently.
- Trigger notes with pointer interaction on the keyboard.`
    },
    german: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Noten manuell spielen mit skalenbezogener Tastatur-Hervorhebung.

- Piano-Roll-Controller hinzufügen/entfernen.
- MIDI-Kanal, Grundton/Skala und Modus setzen.
- Jede Piano Roll separat starten/stoppen.
- Noten per Pointer auf der Tastatur auslösen.`
    },
    french: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Jouez des notes manuellement avec surbrillance selon la gamme.

- Ajouter/supprimer des contrôleurs piano roll.
- Définir canal MIDI, tonique/type de gamme et mode.
- Démarrer/arrêter chaque piano roll indépendamment.
- Déclencher des notes par interaction pointeur clavier.`
    },
    spanish: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Toca notas manualmente con resaltado según la escala.

- Agrega/elimina controladores piano roll.
- Ajusta canal MIDI, raíz/tipo de escala y modo.
- Inicia/detiene cada piano roll de forma independiente.
- Dispara notas con interacción de puntero en el teclado.`
    }
  },
  sequencer_midi_controllers: {
    english: {
      title: "MIDI Controllers",
      markdown: `## MIDI Controllers

Send MIDI CC messages from the sequencer page.

- Add up to 16 controller lanes.
- Set controller number (\`0..127\`).
- Adjust controller value with the knob.
- Start/stop each controller lane independently.`
    },
    german: {
      title: "MIDI Controller",
      markdown: `## MIDI Controller

Sendet MIDI-CC-Nachrichten von der Sequencer-Seite.

- Bis zu 16 Controller-Spuren hinzufügen.
- Controller-Nummer (\`0..127\`) festlegen.
- Controller-Wert mit dem Drehregler einstellen.
- Jede Controller-Spur separat starten/stoppen.`
    },
    french: {
      title: "Contrôleurs MIDI",
      markdown: `## Contrôleurs MIDI

Envoi de messages MIDI CC depuis la page séquenceur.

- Ajouter jusqu'à 16 pistes de contrôleur.
- Définir le numéro de contrôleur (\`0..127\`).
- Ajuster la valeur avec le potentiomètre.
- Démarrer/arrêter chaque piste indépendamment.`
    },
    spanish: {
      title: "Controladores MIDI",
      markdown: `## Controladores MIDI

Envía mensajes MIDI CC desde la página del secuenciador.

- Agrega hasta 16 pistas de control.
- Define número de controlador (\`0..127\`).
- Ajusta el valor con la perilla.
- Inicia/detiene cada pista de forma independiente.`
    }
  },
  config_audio_engine: {
    english: {
      title: "Audio Engine Configuration",
      markdown: `## Audio Engine Configuration

Configure Csound engine timing and buffers for the active patch.

- \`sr\`: audio sample rate.
- target control rate: used to derive \`ksmps\`.
- software buffer (\`-b\`) and hardware buffer (\`-B\`).
- apply validated values to the current patch.

The GUI language setting controls integrated help and opcode docs language.`
    },
    german: {
      title: "Audio Engine Konfiguration",
      markdown: `## Audio Engine Konfiguration

Konfiguriert Timing und Buffer der Csound-Engine für den aktiven Patch.

- \`sr\`: Audio-Sample-Rate.
- Ziel-Control-Rate: daraus wird \`ksmps\` abgeleitet.
- Software-Buffer (\`-b\`) und Hardware-Buffer (\`-B\`).
- Gültige Werte auf den aktuellen Patch anwenden.

Die GUI-Sprache steuert integrierte Hilfe und Opcode-Dokumentation.`
    },
    french: {
      title: "Configuration du moteur audio",
      markdown: `## Configuration du moteur audio

Configure le timing et les buffers Csound pour le patch actif.

- \`sr\` : fréquence d'échantillonnage audio.
- fréquence de contrôle cible : dérive \`ksmps\`.
- buffer logiciel (\`-b\`) et buffer matériel (\`-B\`).
- appliquer les valeurs validées au patch courant.

La langue GUI contrôle l'aide intégrée et la doc opcode.`
    },
    spanish: {
      title: "Configuración del motor de audio",
      markdown: `## Configuración del motor de audio

Configura tiempos y buffers de Csound para el patch activo.

- \`sr\`: frecuencia de muestreo de audio.
- tasa de control objetivo: deriva \`ksmps\`.
- buffer software (\`-b\`) y hardware (\`-B\`).
- aplicar valores validados al patch actual.

El idioma de GUI controla la ayuda integrada y docs de opcodes.`
    }
  },
  config_engine_values: {
    english: {
      title: "Current Patch Engine Values",
      markdown: `## Current Patch Engine Values

Read-only view of normalized engine values currently stored in the patch:

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Use this panel to verify what will be used during compile/start.`
    },
    german: {
      title: "Aktuelle Patch Engine Werte",
      markdown: `## Aktuelle Patch Engine Werte

Nur-Lese Ansicht der normalisierten Engine-Werte im Patch:

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Dieses Panel zeigt die Werte für Compile/Start.`
    },
    french: {
      title: "Valeurs moteur du patch courant",
      markdown: `## Valeurs moteur du patch courant

Vue en lecture seule des valeurs moteur normalisées stockées dans le patch :

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Ce panneau confirme les valeurs utilisées en compile/start.`
    },
    spanish: {
      title: "Valores del motor en el patch actual",
      markdown: `## Valores del motor en el patch actual

Vista de solo lectura de valores normalizados del motor en el patch:

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Este panel permite verificar valores para compilar/iniciar.`
    }
  }
};

const HELP_DOC_COMMON_APPENDIX: Record<GuiLanguage, string> = {
  english: `### Practical Notes

- The top-right \`?\` button always opens context-specific help for the current UI area.
- Changes that affect runtime behavior should be saved before live testing.
- For opcode-level details, use the \`?\` button directly on an opcode node in the graph editor.

### UI Conventions

| Element | Meaning |
| --- | --- |
| \`?\` icon | Open integrated markdown documentation |
| rounded status badge | Current runtime/transport state |
| red action button | Remove or destructive action |
| ORC / events view | Runtime diagnostics and feedback |`,
  german: `### Praktische Hinweise

- Die \`?\`-Taste oben rechts öffnet immer kontextbezogene Hilfe für den aktuellen UI-Bereich.
- Änderungen mit Einfluss auf die Runtime sollten vor Live-Tests gespeichert werden.
- Für Opcode-Details die \`?\`-Taste direkt am Opcode-Node im Graph Editor verwenden.

### UI-Konventionen

| Element | Bedeutung |
| --- | --- |
| \`?\`-Symbol | Integrierte Markdown-Dokumentation öffnen |
| runde Statusanzeige | Aktueller Runtime/Transport-Status |
| roter Aktionsknopf | Entfernen oder destruktive Aktion |
| ORC-/Event-Ansicht | Runtime-Diagnose und Rückmeldung |`,
  french: `### Notes pratiques

- Le bouton \`?\` en haut à droite ouvre toujours l'aide contextuelle de la zone UI courante.
- Les changements qui impactent la runtime doivent être sauvegardés avant test live.
- Pour les détails opcode, utilisez le bouton \`?\` directement sur un nœud opcode du graphe.

### Conventions UI

| Element | Signification |
| --- | --- |
| icône \`?\` | Ouvrir la documentation markdown intégrée |
| badge d'état arrondi | État runtime/transport courant |
| bouton rouge | Action de suppression/destructive |
| vue ORC / événements | Diagnostic runtime et retour système |`,
  spanish: `### Notas prácticas

- El botón \`?\` arriba a la derecha siempre abre ayuda contextual para el área UI actual.
- Los cambios que afectan runtime deben guardarse antes de probar en vivo.
- Para detalles de opcode, usa el botón \`?\` directamente en el nodo opcode del editor de grafos.

### Convenciones de UI

| Elemento | Significado |
| --- | --- |
| ícono \`?\` | Abrir documentación markdown integrada |
| insignia redondeada de estado | Estado actual de runtime/transporte |
| botón rojo | Acción destructiva o de eliminación |
| vista ORC / eventos | Diagnóstico y feedback de runtime |`
};

const HELP_DOC_SPECIFIC_APPENDIX: Partial<Record<HelpDocId, Record<GuiLanguage, string>>> = {
  instrument_graph_editor: {
    english: `### Combining Multiple Signals On One Input

If multiple signals are connected to the **same input** of an opcode:

1. Select the opcode node.
2. Double-click the input connector of that target input.
3. The **Input Formula Assistant** opens.
4. Define how the signals are combined (for example \`in1 + in2\`, or \`in1 * 0.6 + in2 * 0.4\`).
5. Save the formula.

| Token | Meaning |
| --- | --- |
| \`in1\`, \`in2\`, ... | Connected incoming signals |
| \`+\`, \`-\`, \`*\`, \`/\` | Arithmetic operators |
| \`(\`, \`)\` | Grouping / precedence |`,
    german: `### Mehrere Signale auf demselben Eingang kombinieren

Wenn mehrere Signale mit **demselben Eingang** eines Opcodes verbunden sind:

1. Den Opcode-Node auswählen.
2. Den Eingangs-Connector dieses Eingangs doppelklicken.
3. Der **Input Formula Assistant** wird geöffnet.
4. Definieren, wie Signale kombiniert werden (z.B. \`in1 + in2\` oder \`in1 * 0.6 + in2 * 0.4\`).
5. Formel speichern.

| Token | Bedeutung |
| --- | --- |
| \`in1\`, \`in2\`, ... | Verbundene Eingangssignale |
| \`+\`, \`-\`, \`*\`, \`/\` | Arithmetische Operatoren |
| \`(\`, \`)\` | Gruppierung / Priorität |`,
    french: `### Combiner plusieurs signaux sur la même entrée

Si plusieurs signaux sont connectés à **la même entrée** d'un opcode :

1. Sélectionnez le nœud opcode.
2. Double-cliquez le connecteur d'entrée cible.
3. L'**Input Formula Assistant** s'ouvre.
4. Définissez la formule de combinaison (ex. \`in1 + in2\` ou \`in1 * 0.6 + in2 * 0.4\`).
5. Enregistrez la formule.

| Token | Signification |
| --- | --- |
| \`in1\`, \`in2\`, ... | Signaux entrants connectés |
| \`+\`, \`-\`, \`*\`, \`/\` | Opérateurs arithmétiques |
| \`(\`, \`)\` | Groupement / priorité |`,
    spanish: `### Combinar múltiples señales en la misma entrada

Si múltiples señales están conectadas a **la misma entrada** de un opcode:

1. Selecciona el nodo opcode.
2. Haz doble clic en el conector de esa entrada.
3. Se abre el **Input Formula Assistant**.
4. Define la fórmula de combinación (por ejemplo \`in1 + in2\` o \`in1 * 0.6 + in2 * 0.4\`).
5. Guarda la fórmula.

| Token | Significado |
| --- | --- |
| \`in1\`, \`in2\`, ... | Señales entrantes conectadas |
| \`+\`, \`-\`, \`*\`, \`/\` | Operadores aritméticos |
| \`(\`, \`)\` | Agrupación / precedencia |`
  }
};

type LocalizedOpcodeCopy = {
  description: string;
  category: string;
  syntax: string;
  tags: string;
  inputs: string;
  outputs: string;
  noInputs: string;
  noOutputs: string;
  reference: string;
  optional: string;
  defaultValue: string;
  accepts: string;
};

const LOCALIZED_OPCODE_COPY: Record<GuiLanguage, LocalizedOpcodeCopy> = {
  english: {
    description: "Description",
    category: "Category",
    syntax: "Syntax",
    tags: "Tags",
    inputs: "Inputs",
    outputs: "Outputs",
    noInputs: "none",
    noOutputs: "none (sink opcode)",
    reference: "Reference",
    optional: "optional",
    defaultValue: "default",
    accepts: "accepts"
  },
  german: {
    description: "Beschreibung",
    category: "Kategorie",
    syntax: "Syntax",
    tags: "Tags",
    inputs: "Eingänge",
    outputs: "Ausgänge",
    noInputs: "keine",
    noOutputs: "keine (Sink-Opcode)",
    reference: "Referenz",
    optional: "optional",
    defaultValue: "default",
    accepts: "akzeptiert"
  },
  french: {
    description: "Description",
    category: "Catégorie",
    syntax: "Syntax",
    tags: "Tags",
    inputs: "Entrées",
    outputs: "Sorties",
    noInputs: "aucune",
    noOutputs: "aucune (opcode sink)",
    reference: "Référence",
    optional: "optionnel",
    defaultValue: "défaut",
    accepts: "accepte"
  },
  spanish: {
    description: "Descripción",
    category: "Categoría",
    syntax: "Syntax",
    tags: "Etiquetas",
    inputs: "Entradas",
    outputs: "Salidas",
    noInputs: "ninguna",
    noOutputs: "ninguna (opcode sink)",
    reference: "Referencia",
    optional: "opcional",
    defaultValue: "por defecto",
    accepts: "acepta"
  }
};

const LOCALIZED_OPCODE_DESCRIPTIONS: Record<GuiLanguage, Record<string, string>> = {
  english: {},
  german: {
    midi_note: "Extrahiert MIDI-Notenfrequenz und Velocity-Amplitude.",
    adsr: "ADSR-Hüllkurve mit Kontrollrate.",
    madsr: "MIDI-release-sensitive ADSR-Hüllkurve.",
    mxadsr: "Erweiterte MIDI-release-sensitive ADSR-Hüllkurve.",
    oscili: "Klassischer interpolierender Oszillator.",
    poscil3: "Hochpräziser kubisch interpolierender Oszillator.",
    lfo: "Niederfrequenzoszillator für Modulation mit Kontrollrate.",
    vibr: "Einfacher Vibrato-Kontrolloszillator mit Tabellen-Lookup.",
    vibrato: "Zufallsbasierter Vibrato-Generator.",
    fmb3: "B3-Orgel-FM-Modell.",
    fmbell: "Glocken-FM-Modell.",
    fmmetal: "Metallisches FM-Modell.",
    fmpercfl: "Perkussives Flöten-FM-Modell.",
    fmrhode: "Rhodes-E-Piano-FM-Modell.",
    fmvoice: "Stimmenähnliches FM-Modell.",
    fmwurlie: "Wurlitzer-E-Piano-FM-Modell.",
    vco: "Bandbegrenzter spannungsgesteuerter Oszillator.",
    vco2: "Verbesserter aliasingarmer analoger Oszillator.",
    foscili: "FM-Oszillator mit Audiotrate und harmonischen Verhältnissen.",
    ftgen: "Erzeugt zur Init-Zeit eine Funktionstabelle mit einer GEN-Routine.",
    ftgenonce: "Erzeugt eine Funktionstabelle einmalig und nutzt sie instanzübergreifend wieder.",
    cpsmidi: "Liest die aktive MIDI-Notenhöhe in Zyklen pro Sekunde.",
    midictrl: "Liest einen MIDI-Controllerwert mit optionaler Skalierung.",
    k_mul: "Multipliziert zwei Kontrollsignale.",
    a_mul: "Multipliziert zwei Audiosignale.",
    k_to_a: "Interpoliert ein Kontrollsignal auf Audiotrate.",
    moogladder: "Moog-Ladder-Tiefpassfilter.",
    moogladder2: "Nichtlinearer Moog-Ladder-Filter mit Unterstützung für Audioratenmodulation.",
    diode_ladder: "Dioden-Ladder-Tiefpassfiltermodell.",
    rezzy: "Resonanter Tiefpass- oder Hochpassfilter.",
    vclpf: "Virtuell-analoger Tiefpassfilter.",
    pinker: "Pink-Noise-Generator.",
    noise: "Zufälliges Audiorauschen mit variabler Farbe.",
    pluck: "Karplus-Strong-Modell für gezupfte Saiten.",
    marimba: "Physikalisches Modell eines Marimbabalkens und Resonators.",
    dripwater: "Stochastische physikalische Quelle für tropfendes Wasser.",
    wgflute: "Waveguide-Flötenmodell.",
    wguide2: "Zweipunkt-Waveguide-Resonator.",
    delay: "Einfache nicht interpolierende Audio-Delay-Linie.",
    delayk: "Delay-Linie mit Kontrollrate.",
    delayr: "Liest einen Tap aus einem klassischen Delay-Linienspeicher.",
    delayw: "Schreibt in den Delay-Linienspeicher.",
    deltap: "Liest einen Delay-Tap mit linearer Interpolation.",
    deltap3: "Liest einen Delay-Tap mit kubischer Interpolation.",
    vdelayxs: "Variables Delay mit hochwertiger Sinc-Interpolation.",
    vdelay3: "Variable Delay-Linie mit kubischer Interpolation.",
    flanger: "Flanger-Effekt mit Delay-Modulation und Feedback.",
    comb: "Kammfilter-/Feedback-Delay.",
    reverb2: "Schroeder-Hallprozessor.",
    limit: "Harter Clamp-Limiter.",
    dam: "Dynamischer Amplitudenprozessor (Downward-Compressor/Rauschunterdrückung).",
    exciter: "Harmonischer Exciter, der kontrollierte obere Teiltöne hinzufügt.",
    distort1: "Waveshaping-Verzerrung mit konfigurierbarer Kennlinie.",
    pan2: "Stereo-Panner.",
    mix2: "Mischt zwei Audiosignale.",
    outs: "Stereo-Ausgangssenke.",
    const_k: "Konstanter Wert mit Kontrollrate.",
    const_i: "Konstanter Wert mit Init-Rate.",
    const_a: "Konstanter Wert mit Audiotrate."
  },
  french: {
    midi_note: "Extrait la fréquence de note MIDI et l'amplitude de vélocité.",
    adsr: "Enveloppe ADSR au taux de contrôle.",
    madsr: "Enveloppe ADSR sensible au relâchement MIDI.",
    mxadsr: "Enveloppe ADSR étendue sensible au relâchement MIDI.",
    oscili: "Oscillateur interpolé classique.",
    poscil3: "Oscillateur interpolé cubique haute précision.",
    lfo: "Oscillateur basse fréquence pour modulation au taux de contrôle.",
    vibr: "Oscillateur de vibrato simple avec lecture de table.",
    vibrato: "Générateur de vibrato aléatoire.",
    fmb3: "Modèle FM d'orgue B3.",
    fmbell: "Modèle FM de cloche.",
    fmmetal: "Modèle FM métallique.",
    fmpercfl: "Modèle FM de flûte percussive.",
    fmrhode: "Modèle FM de piano électrique Rhodes.",
    fmvoice: "Modèle FM à caractère vocal.",
    fmwurlie: "Modèle FM de piano électrique Wurlitzer.",
    vco: "Oscillateur commandé en tension à bande limitée.",
    vco2: "Oscillateur analogique amélioré avec peu d'aliasing.",
    foscili: "Oscillateur FM au taux audio avec rapports harmoniques.",
    ftgen: "Crée une table de fonction à l'initialisation via une routine GEN.",
    ftgenonce: "Génère une table de fonction une seule fois et la réutilise entre instances.",
    cpsmidi: "Lit la hauteur de note MIDI active en cycles par seconde.",
    midictrl: "Lit une valeur de contrôleur MIDI avec mise à l'échelle optionnelle.",
    k_mul: "Multiplie deux signaux de contrôle.",
    a_mul: "Multiplie deux signaux audio.",
    k_to_a: "Interpole un signal de contrôle vers le taux audio.",
    moogladder: "Filtre passe-bas en échelle de Moog.",
    moogladder2: "Filtre en échelle de Moog non linéaire avec modulation au taux audio.",
    diode_ladder: "Modèle de filtre passe-bas en échelle à diodes.",
    rezzy: "Filtre résonant passe-bas ou passe-haut.",
    vclpf: "Filtre passe-bas virtuel-analogique.",
    pinker: "Générateur de bruit rose.",
    noise: "Bruit audio aléatoire à couleur variable.",
    pluck: "Modèle de corde pincée Karplus-Strong.",
    marimba: "Modèle physique d'une lame de marimba et de son résonateur.",
    dripwater: "Source physique stochastique de gouttes d'eau.",
    wgflute: "Modèle de flûte waveguide.",
    wguide2: "Résonateur waveguide à deux points.",
    delay: "Ligne de délai audio simple sans interpolation.",
    delayk: "Ligne de délai au taux de contrôle.",
    delayr: "Lit un point de lecture d'un tampon de délai classique.",
    delayw: "Écrit dans le tampon de ligne de délai.",
    deltap: "Lit un point de délai avec interpolation linéaire.",
    deltap3: "Lit un point de délai avec interpolation cubique.",
    vdelayxs: "Délai variable avec interpolation sinc de haute qualité.",
    vdelay3: "Ligne de délai variable avec interpolation cubique.",
    flanger: "Effet flanger avec modulation du délai et feedback.",
    comb: "Filtre en peigne / délai avec feedback.",
    reverb2: "Processeur de réverbération Schroeder.",
    limit: "Limiteur à écrêtage dur.",
    dam: "Processeur d'amplitude dynamique (compresseur descendant/réduction de bruit).",
    exciter: "Exciter harmonique ajoutant des partiels supérieurs contrôlés.",
    distort1: "Distorsion waveshaping avec courbe de transfert configurable.",
    pan2: "Panoramique stéréo.",
    mix2: "Mixe deux signaux audio.",
    outs: "Sortie stéréo (sink).",
    const_k: "Valeur constante au taux de contrôle.",
    const_i: "Valeur constante au taux d'initialisation.",
    const_a: "Valeur constante au taux audio."
  },
  spanish: {
    midi_note: "Extrae la frecuencia de nota MIDI y la amplitud de velocidad.",
    adsr: "Envolvente ADSR de tasa de control.",
    madsr: "Envolvente ADSR sensible al release MIDI.",
    mxadsr: "Envolvente ADSR extendida sensible al release MIDI.",
    oscili: "Oscilador interpolado clásico.",
    poscil3: "Oscilador interpolado cúbico de alta precisión.",
    lfo: "Oscilador de baja frecuencia para modulación de tasa de control.",
    vibr: "Oscilador de vibrato simple con búsqueda en tabla.",
    vibrato: "Generador de vibrato aleatorizado.",
    fmb3: "Modelo FM de órgano B3.",
    fmbell: "Modelo FM de campana.",
    fmmetal: "Modelo FM metálico.",
    fmpercfl: "Modelo FM de flauta percusiva.",
    fmrhode: "Modelo FM de piano eléctrico Rhodes.",
    fmvoice: "Modelo FM con carácter vocal.",
    fmwurlie: "Modelo FM de piano eléctrico Wurlitzer.",
    vco: "Oscilador controlado por voltaje de banda limitada.",
    vco2: "Oscilador analógico mejorado con bajo aliasing.",
    foscili: "Oscilador FM a tasa de audio con relaciones armónicas.",
    ftgen: "Crea una tabla de función en init usando una rutina GEN.",
    ftgenonce: "Genera una tabla de función una sola vez y la reutiliza entre instancias.",
    cpsmidi: "Lee el tono de la nota MIDI activa como ciclos por segundo.",
    midictrl: "Lee un valor de controlador MIDI con escalado opcional.",
    k_mul: "Multiplica dos señales de control.",
    a_mul: "Multiplica dos señales de audio.",
    k_to_a: "Interpola una señal de control a tasa de audio.",
    moogladder: "Filtro pasa-bajos tipo escalera Moog.",
    moogladder2: "Filtro de escalera Moog no lineal con soporte de modulación a tasa de audio.",
    diode_ladder: "Modelo de filtro pasa-bajos de escalera de diodos.",
    rezzy: "Filtro resonante pasa-bajos o pasa-altos.",
    vclpf: "Filtro pasa-bajos virtual-analógico.",
    pinker: "Generador de ruido rosa.",
    noise: "Ruido de audio aleatorio de color variable.",
    pluck: "Modelo de cuerda pulsada Karplus-Strong.",
    marimba: "Modelo físico de una barra de marimba y su resonador.",
    dripwater: "Fuente física estocástica de goteo de agua.",
    wgflute: "Modelo de flauta por guía de ondas.",
    wguide2: "Resonador de guía de ondas de dos puntos.",
    delay: "Línea de retardo de audio simple sin interpolación.",
    delayk: "Línea de retardo a tasa de control.",
    delayr: "Lee un tap de un búfer de retardo clásico.",
    delayw: "Escribe en el búfer de la línea de retardo.",
    deltap: "Lee un tap de retardo usando interpolación lineal.",
    deltap3: "Lee un tap de retardo usando interpolación cúbica.",
    vdelayxs: "Retardo variable con interpolación sinc de alta calidad.",
    vdelay3: "Línea de retardo variable con interpolación cúbica.",
    flanger: "Efecto flanger con modulación de retardo y realimentación.",
    comb: "Filtro comb / retardo con realimentación.",
    reverb2: "Procesador de reverberación Schroeder.",
    limit: "Limitador de recorte duro.",
    dam: "Procesador dinámico de amplitud (compresor descendente/supresión de ruido).",
    exciter: "Excitador armónico que añade parciales superiores controlados.",
    distort1: "Distorsión por waveshaping con curva de transferencia configurable.",
    pan2: "Paneador estéreo.",
    mix2: "Mezcla dos señales de audio.",
    outs: "Salida estéreo (sink).",
    const_k: "Valor constante a tasa de control.",
    const_i: "Valor constante a tasa de inicialización.",
    const_a: "Valor constante a tasa de audio."
  }
};

const SIGNAL_TYPE_LABELS: Record<GuiLanguage, Record<SignalType, string>> = {
  english: {
    a: "audio-rate",
    k: "control-rate",
    i: "init-rate",
    S: "string-rate",
    f: "function-table rate"
  },
  german: {
    a: "audio-rate",
    k: "Kontrollrate",
    i: "init-rate",
    S: "string-rate",
    f: "Funktions-Tabellen-Rate"
  },
  french: {
    a: "taux audio",
    k: "taux contrôle",
    i: "taux init",
    S: "taux chaîne",
    f: "taux table de fonction"
  },
  spanish: {
    a: "tasa de audio",
    k: "tasa de control",
    i: "tasa init",
    S: "tasa de cadena",
    f: "tasa de tabla de función"
  }
};

function formatPortLine(port: PortSpec, language: GuiLanguage): string {
  const copy = LOCALIZED_OPCODE_COPY[language];
  const signalType = port.signal_type;
  const signalLabel = SIGNAL_TYPE_LABELS[language][signalType];

  const qualifiers: string[] = [signalLabel];
  if (!port.required) {
    qualifiers.push(copy.optional);
  }

  if (port.default !== undefined && port.default !== null) {
    qualifiers.push(`${copy.defaultValue} \`${String(port.default)}\``);
  }

  const accepted = Array.isArray(port.accepted_signal_types)
    ? port.accepted_signal_types.filter((entry) => Boolean(entry))
    : [];
  if (accepted.length > 0) {
    qualifiers.push(`${copy.accepts} ${accepted.map((entry) => `\`${entry}\``).join(", ")}`);
  }

  const detail = port.description.trim().length > 0 ? port.description.trim() : port.name;
  return `- \`${port.id}\` (${qualifiers.join("; ")}): ${detail}`;
}

function localizedOpcodeDescription(opcode: OpcodeSpec, language: GuiLanguage): string {
  const localized = LOCALIZED_OPCODE_DESCRIPTIONS[language]?.[opcode.name];
  if (localized && localized.trim().length > 0) {
    return localized;
  }
  return opcode.description.trim().length > 0 ? opcode.description : "-";
}

function buildGeneratedOpcodeMarkdown(opcode: OpcodeSpec, language: GuiLanguage): string {
  const copy = LOCALIZED_OPCODE_COPY[language];
  const lines: string[] = [];

  lines.push(`### \`${opcode.name}\``);
  lines.push("");
  lines.push(`**${copy.description}:** ${localizedOpcodeDescription(opcode, language)}`);
  lines.push(`**${copy.category}:** \`${opcode.category}\``);

  if (opcode.template.trim().length > 0) {
    lines.push("");
    lines.push(`**${copy.syntax}**`);
    lines.push(`- \`${opcode.template}\``);
  }

  if (opcode.tags.length > 0) {
    lines.push("");
    lines.push(`**${copy.tags}:** ${opcode.tags.map((tag) => `\`${tag}\``).join(", ")}`);
  }

  lines.push("");
  lines.push(`**${copy.inputs}**`);
  if (opcode.inputs.length === 0) {
    lines.push(`- ${copy.noInputs}`);
  } else {
    for (const input of opcode.inputs) {
      lines.push(formatPortLine(input, language));
    }
  }

  lines.push("");
  lines.push(`**${copy.outputs}**`);
  if (opcode.outputs.length === 0) {
    lines.push(`- ${copy.noOutputs}`);
  } else {
    for (const output of opcode.outputs) {
      lines.push(formatPortLine(output, language));
    }
  }

  lines.push("");
  lines.push(`**${copy.reference}**`);
  if (opcode.documentation_url.trim().length > 0) {
    lines.push(`- [Csound manual](${opcode.documentation_url})`);
  } else {
    lines.push("- [Csound Part Reference](https://csound.com/docs/manual/PartReference.html)");
  }

  return lines.join("\n");
}

export function documentationUiCopy(language: GuiLanguage): DocumentationUiCopy {
  const normalized = normalizeGuiLanguage(language);
  return DOCUMENTATION_UI_COPY[normalized];
}

export function getHelpDocument(helpDocId: HelpDocId, language: GuiLanguage): HelpDocument {
  const normalized = normalizeGuiLanguage(language);
  const base = HELP_DOCUMENTS[helpDocId][normalized];
  const commonAppendix = HELP_DOC_COMMON_APPENDIX[normalized];
  const specificAppendix = HELP_DOC_SPECIFIC_APPENDIX[helpDocId]?.[normalized] ?? "";

  const markdown = [base.markdown.trim(), commonAppendix.trim(), specificAppendix.trim()]
    .filter((section) => section.length > 0)
    .join("\n\n");

  return {
    title: base.title,
    markdown
  };
}

export function localizedOpcodeMarkdown(opcode: OpcodeSpec, language: GuiLanguage): string {
  const normalized = normalizeGuiLanguage(language);
  return buildGeneratedOpcodeMarkdown(opcode, normalized);
}
