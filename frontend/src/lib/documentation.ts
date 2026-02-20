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
    close: "Schliessen",
    openCsoundReference: "Csound-Referenz oeffnen",
    opcodeDocumentation: "Opcode-Dokumentation",
    noOpcodeDocumentation: "Keine Markdown-Dokumentation fuer dieses Opcode verfuegbar."
  },
  french: {
    showDocumentation: "Afficher la documentation",
    help: "Aide",
    close: "Fermer",
    openCsoundReference: "Ouvrir la reference Csound",
    opcodeDocumentation: "Documentation Opcode",
    noOpcodeDocumentation: "Aucune documentation markdown disponible pour cet opcode."
  },
  spanish: {
    showDocumentation: "Mostrar documentacion",
    help: "Ayuda",
    close: "Cerrar",
    openCsoundReference: "Abrir referencia de Csound",
    opcodeDocumentation: "Documentacion de Opcode",
    noOpcodeDocumentation: "No hay documentacion markdown disponible para este opcode."
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

Jeder Instrument-Tab behaelt eine eigene bearbeitbare Graph-Kopie.`
    },
    french: {
      title: "Barre de patch instrument",
      markdown: `## Barre de patch instrument

Cette zone gere les fichiers de patch et les actions principales.

- Renommer le patch courant et modifier sa description.
- Charger un patch existant dans l'onglet courant.
- Creer un nouveau brouillon de patch.
- Enregistrer le patch courant sur le backend.
- Compiler le graphe courant en Csound ORC/CSD.
- Exporter le fichier CSD compile.

Chaque onglet instrument garde son propre etat de graphe editable.`
    },
    spanish: {
      title: "Barra de patch de instrumento",
      markdown: `## Barra de patch de instrumento

Esta zona controla archivos de patch y acciones principales.

- Renombrar el patch actual y editar su descripcion.
- Cargar un patch existente en la pestana actual.
- Crear un nuevo borrador de patch.
- Guardar el patch actual en el backend.
- Compilar el grafo actual a Csound ORC/CSD.
- Exportar el archivo CSD compilado.

Cada pestana de instrumento mantiene su propio estado editable del grafo.`
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

Hier werden Opcodes fuer den Graph Editor gesucht und eingefuegt.

- Suche nach Opcode-Name, Kategorie, Tags oder Beschreibung.
- Klick auf ein Opcode fuegt es in den Graphen ein.
- Drag-and-drop aus dieser Liste in die Graph-Flaeche.

Icon und Kategorie helfen bei der Einordnung der Signalrolle.`
    },
    french: {
      title: "Catalogue Opcode",
      markdown: `## Catalogue Opcode

Parcourez et inserez des opcodes dans l'editeur de graphe.

- Rechercher par nom, categorie, tags ou description.
- Cliquer sur un opcode pour l'ajouter au graphe.
- Glisser-deposer des opcodes vers le canevas du graphe.

L'icone et la categorie aident a identifier le role signal.`
    },
    spanish: {
      title: "Catalogo de Opcode",
      markdown: `## Catalogo de Opcode

Explora e inserta opcodes en el editor de grafos.

- Busca por nombre, categoria, etiquetas o descripcion.
- Haz clic en un opcode para agregarlo al grafo.
- Arrastra y suelta opcodes de esta lista al lienzo.

El icono y la categoria ayudan a identificar el rol de la senal.`
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

Dies ist der visuelle Patch-Bereich fuer Signalrouting.

- Kompatible Ports zwischen Nodes verbinden.
- Parameter direkt auf den Nodes bearbeiten.
- Nodes oder Kabel auswaehlen, pruefen und loeschen.
- Die Node-\`?\`-Taste oeffnet die Opcode-Dokumentation.

Die Kompilierungsreihenfolge folgt den Graph-Abhaengigkeiten.`
    },
    french: {
      title: "Editeur de graphe",
      markdown: `## Editeur de graphe

Zone visuelle de patch pour le routage des signaux.

- Connecter des ports compatibles entre noeuds.
- Modifier les parametres sur chaque noeud.
- Selectionner noeuds ou connexions pour inspection/suppression.
- Le bouton \`?\` d'un noeud ouvre la documentation opcode.

L'ordre de compilation suit les dependances du graphe.`
    },
    spanish: {
      title: "Editor de grafos",
      markdown: `## Editor de grafos

Zona visual de patch para enrutar senales.

- Conectar puertos compatibles entre nodos.
- Editar parametros en cada nodo.
- Seleccionar nodos o conexiones para inspeccionar/eliminar.
- El boton \`?\` del nodo abre la documentacion del opcode.

El orden de compilacion depende de las dependencias del grafo.`
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

Ueberwachen und steuern der laufenden Session.

- Aktiven MIDI-Eingang fuer die Session binden.
- Generierten ORC-Output nach der Kompilierung pruefen.
- Letzte Session-Events aus WebSocket-Updates ansehen.

Dieses Panel waehrend Live-Tests verwenden.`
    },
    french: {
      title: "Panneau Runtime",
      markdown: `## Panneau Runtime

Surveillance et controle de la session runtime.

- Associer l'entree MIDI active a la session courante.
- Inspecter la sortie ORC apres compilation.
- Consulter les evenements recents de session (WebSocket).

Utilisez ce panneau pendant les tests en direct.`
    },
    spanish: {
      title: "Panel Runtime",
      markdown: `## Panel Runtime

Monitorea y controla el comportamiento de la sesion runtime.

- Vincula la entrada MIDI activa para la sesion actual.
- Revisa la salida ORC generada tras compilar.
- Consulta eventos recientes de sesion via WebSocket.

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
- Gespeicherte Patches MIDI-Kanaelen zuweisen.
- Instrument-Engine starten/stoppen.
- Sequencer-Konfiguration als JSON importieren/exportieren.`
    },
    french: {
      title: "Rack instrument",
      markdown: `## Rack instrument

Gestion des affectations d'instruments au niveau performance.

- Definir nom et description de performance.
- Charger et enregistrer des presets de performance.
- Affecter des patches sauvegardes a des canaux MIDI.
- Demarrer/arreter le moteur instrument.
- Import/export JSON de configuration sequencer.`
    },
    spanish: {
      title: "Rack de instrumentos",
      markdown: `## Rack de instrumentos

Gestiona asignaciones de instrumentos a nivel de performance.

- Define nombre y descripcion de performance.
- Carga y guarda presets de performance.
- Asigna patches guardados a canales MIDI.
- Inicia y detiene el motor de instrumentos.
- Importa/exporta JSON de configuracion del secuenciador.`
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

- Sequencer-Spuren hinzufuegen/entfernen.
- Kanal, Skala, Modus und Schrittzahl (16/32) setzen.
- Pattern-Pads (P1..P8) fuer geplante Pattern-Wechsel nutzen.
- Pro Schritt Noten oder Pausen setzen.
- Globales BPM und Laufstatus steuern.`
    },
    french: {
      title: "Pistes sequencer",
      markdown: `## Pistes sequencer

Programme des patterns melodiques ou rythmiques par pas.

- Ajouter/supprimer des pistes sequencer.
- Regler canal, gamme, mode et nombre de pas (16/32).
- Utiliser les pads P1..P8 pour changements de pattern.
- Definir note ou silence par pas.
- Controler BPM global et etat de lecture.`
    },
    spanish: {
      title: "Pistas del secuenciador",
      markdown: `## Pistas del secuenciador

Programa patrones melodicos o ritmicos por pasos.

- Agrega/elimina pistas del secuenciador.
- Ajusta canal, escala, modo y cantidad de pasos (16/32).
- Usa pads P1..P8 para cambios de patron en cola.
- Define nota o silencio por paso.
- Controla BPM global y estado de reproduccion.`
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

- Piano-Roll-Controller hinzufuegen/entfernen.
- MIDI-Kanal, Grundton/Skala und Modus setzen.
- Jede Piano Roll separat starten/stoppen.
- Noten per Pointer auf der Tastatur ausloesen.`
    },
    french: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Jouez des notes manuellement avec surbrillance selon la gamme.

- Ajouter/supprimer des controleurs piano roll.
- Definir canal MIDI, tonique/type de gamme et mode.
- Demarrer/arreter chaque piano roll independamment.
- Declencher des notes par interaction pointeur clavier.`
    },
    spanish: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Toca notas manualmente con resaltado segun la escala.

- Agrega/elimina controladores piano roll.
- Ajusta canal MIDI, raiz/tipo de escala y modo.
- Inicia/detiene cada piano roll de forma independiente.
- Dispara notas con interaccion de puntero en el teclado.`
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

- Bis zu 16 Controller-Spuren hinzufuegen.
- Controller-Nummer (\`0..127\`) festlegen.
- Controller-Wert mit dem Drehregler einstellen.
- Jede Controller-Spur separat starten/stoppen.`
    },
    french: {
      title: "Controleurs MIDI",
      markdown: `## Controleurs MIDI

Envoi de messages MIDI CC depuis la page sequencer.

- Ajouter jusqu'a 16 pistes de controleur.
- Definir le numero de controleur (\`0..127\`).
- Ajuster la valeur avec le potentiometre.
- Demarrer/arreter chaque piste independamment.`
    },
    spanish: {
      title: "Controladores MIDI",
      markdown: `## Controladores MIDI

Envia mensajes MIDI CC desde la pagina del secuenciador.

- Agrega hasta 16 pistas de control.
- Define numero de controlador (\`0..127\`).
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

Konfiguriert Timing und Buffer der Csound-Engine fuer den aktiven Patch.

- \`sr\`: Audio-Sample-Rate.
- Ziel-Control-Rate: daraus wird \`ksmps\` abgeleitet.
- Software-Buffer (\`-b\`) und Hardware-Buffer (\`-B\`).
- Gueltige Werte auf den aktuellen Patch anwenden.

Die GUI-Sprache steuert integrierte Hilfe und Opcode-Dokumentation.`
    },
    french: {
      title: "Configuration du moteur audio",
      markdown: `## Configuration du moteur audio

Configure le timing et les buffers Csound pour le patch actif.

- \`sr\` : frequence d'echantillonnage audio.
- frequence de controle cible : derive \`ksmps\`.
- buffer logiciel (\`-b\`) et buffer materiel (\`-B\`).
- appliquer les valeurs validees au patch courant.

La langue GUI controle l'aide integree et la doc opcode.`
    },
    spanish: {
      title: "Configuracion del motor de audio",
      markdown: `## Configuracion del motor de audio

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

Dieses Panel zeigt die Werte fuer Compile/Start.`
    },
    french: {
      title: "Valeurs moteur du patch courant",
      markdown: `## Valeurs moteur du patch courant

Vue en lecture seule des valeurs moteur normalisees stockees dans le patch :

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Ce panneau confirme les valeurs utilisees en compile/start.`
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

- Die \`?\`-Taste oben rechts oeffnet immer kontextbezogene Hilfe fuer den aktuellen UI-Bereich.
- Aenderungen mit Einfluss auf die Runtime sollten vor Live-Tests gespeichert werden.
- Fuer Opcode-Details die \`?\`-Taste direkt am Opcode-Node im Graph Editor verwenden.

### UI-Konventionen

| Element | Bedeutung |
| --- | --- |
| \`?\`-Symbol | Integrierte Markdown-Dokumentation oeffnen |
| runde Statusanzeige | Aktueller Runtime/Transport-Status |
| roter Aktionsknopf | Entfernen oder destruktive Aktion |
| ORC-/Event-Ansicht | Runtime-Diagnose und Rueckmeldung |`,
  french: `### Notes pratiques

- Le bouton \`?\` en haut a droite ouvre toujours l'aide contextuelle de la zone UI courante.
- Les changements qui impactent la runtime doivent etre sauvegardes avant test live.
- Pour les details opcode, utilisez le bouton \`?\` directement sur un noeud opcode du graphe.

### Conventions UI

| Element | Signification |
| --- | --- |
| icone \`?\` | Ouvrir la documentation markdown integree |
| badge d'etat arrondi | Etat runtime/transport courant |
| bouton rouge | Action de suppression/destructive |
| vue ORC / evenements | Diagnostic runtime et retour systeme |`,
  spanish: `### Notas practicas

- El boton \`?\` arriba a la derecha siempre abre ayuda contextual para el area UI actual.
- Los cambios que afectan runtime deben guardarse antes de probar en vivo.
- Para detalles de opcode, usa el boton \`?\` directamente en el nodo opcode del editor de grafos.

### Convenciones de UI

| Elemento | Significado |
| --- | --- |
| icono \`?\` | Abrir documentacion markdown integrada |
| insignia redondeada de estado | Estado actual de runtime/transporte |
| boton rojo | Accion destructiva o de eliminacion |
| vista ORC / eventos | Diagnostico y feedback de runtime |`
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

1. Den Opcode-Node auswaehlen.
2. Den Eingangs-Connector dieses Eingangs doppelklicken.
3. Der **Input Formula Assistant** wird geoeffnet.
4. Definieren, wie Signale kombiniert werden (z.B. \`in1 + in2\` oder \`in1 * 0.6 + in2 * 0.4\`).
5. Formel speichern.

| Token | Bedeutung |
| --- | --- |
| \`in1\`, \`in2\`, ... | Verbundene Eingangssignale |
| \`+\`, \`-\`, \`*\`, \`/\` | Arithmetische Operatoren |
| \`(\`, \`)\` | Gruppierung / Prioritaet |`,
    french: `### Combiner plusieurs signaux sur la meme entree

Si plusieurs signaux sont connectes a **la meme entree** d'un opcode :

1. Selectionnez le noeud opcode.
2. Double-cliquez le connecteur d'entree cible.
3. L'**Input Formula Assistant** s'ouvre.
4. Definissez la formule de combinaison (ex. \`in1 + in2\` ou \`in1 * 0.6 + in2 * 0.4\`).
5. Enregistrez la formule.

| Token | Signification |
| --- | --- |
| \`in1\`, \`in2\`, ... | Signaux entrants connectes |
| \`+\`, \`-\`, \`*\`, \`/\` | Operateurs arithmetiques |
| \`(\`, \`)\` | Groupement / priorite |`,
    spanish: `### Combinar multiples senales en la misma entrada

Si multiples senales estan conectadas a **la misma entrada** de un opcode:

1. Selecciona el nodo opcode.
2. Haz doble clic en el conector de esa entrada.
3. Se abre el **Input Formula Assistant**.
4. Define la formula de combinacion (por ejemplo \`in1 + in2\` o \`in1 * 0.6 + in2 * 0.4\`).
5. Guarda la formula.

| Token | Significado |
| --- | --- |
| \`in1\`, \`in2\`, ... | Senales entrantes conectadas |
| \`+\`, \`-\`, \`*\`, \`/\` | Operadores aritmeticos |
| \`(\`, \`)\` | Agrupacion / precedencia |`
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
  originalDescriptionNote: string;
  opcodeNameNotice: string;
};

const LOCALIZED_OPCODE_COPY: Record<GuiLanguage, LocalizedOpcodeCopy> = {
  english: {
    description: "Description",
    category: "Category",
    syntax: "VisualCSound syntax",
    tags: "Tags",
    inputs: "Inputs",
    outputs: "Outputs",
    noInputs: "none",
    noOutputs: "none (sink opcode)",
    reference: "Reference",
    optional: "optional",
    defaultValue: "default",
    accepts: "accepts",
    originalDescriptionNote: "",
    opcodeNameNotice: ""
  },
  german: {
    description: "Beschreibung",
    category: "Kategorie",
    syntax: "VisualCSound Syntax",
    tags: "Tags",
    inputs: "Eingaenge",
    outputs: "Ausgaenge",
    noInputs: "keine",
    noOutputs: "keine (Sink-Opcode)",
    reference: "Referenz",
    optional: "optional",
    defaultValue: "default",
    accepts: "akzeptiert",
    originalDescriptionNote: "_Hinweis: Die Original-Beschreibung bleibt auf Englisch._",
    opcodeNameNotice: "_Opcode-Namen werden nicht uebersetzt._"
  },
  french: {
    description: "Description",
    category: "Categorie",
    syntax: "Syntaxe VisualCSound",
    tags: "Tags",
    inputs: "Entrees",
    outputs: "Sorties",
    noInputs: "aucune",
    noOutputs: "aucune (opcode sink)",
    reference: "Reference",
    optional: "optionnel",
    defaultValue: "defaut",
    accepts: "accepte",
    originalDescriptionNote: "_Note : la description originale reste en anglais._",
    opcodeNameNotice: "_Les noms d'opcode ne sont pas traduits._"
  },
  spanish: {
    description: "Descripcion",
    category: "Categoria",
    syntax: "Sintaxis VisualCSound",
    tags: "Etiquetas",
    inputs: "Entradas",
    outputs: "Salidas",
    noInputs: "ninguna",
    noOutputs: "ninguna (opcode sink)",
    reference: "Referencia",
    optional: "opcional",
    defaultValue: "por defecto",
    accepts: "acepta",
    originalDescriptionNote: "_Nota: la descripcion original se mantiene en ingles._",
    opcodeNameNotice: "_Los nombres de opcode no se traducen._"
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
    k: "kontroll-rate",
    i: "init-rate",
    S: "string-rate",
    f: "funktions-tabellen-rate"
  },
  french: {
    a: "taux audio",
    k: "taux controle",
    i: "taux init",
    S: "taux chaine",
    f: "taux table de fonction"
  },
  spanish: {
    a: "tasa de audio",
    k: "tasa de control",
    i: "tasa init",
    S: "tasa de cadena",
    f: "tasa de tabla de funcion"
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

function buildGeneratedOpcodeMarkdown(opcode: OpcodeSpec, language: GuiLanguage): string {
  const copy = LOCALIZED_OPCODE_COPY[language];
  const lines: string[] = [];

  lines.push(`### \`${opcode.name}\``);
  lines.push("");
  lines.push(`**${copy.description}:** ${opcode.description.trim().length > 0 ? opcode.description : "-"}`);
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

  if (copy.originalDescriptionNote.length > 0) {
    lines.push("");
    lines.push(copy.originalDescriptionNote);
  }
  if (copy.opcodeNameNotice.length > 0) {
    lines.push(copy.opcodeNameNotice);
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

  if (normalized === "english" && opcode.documentation_markdown.trim().length > 0) {
    return opcode.documentation_markdown;
  }

  return buildGeneratedOpcodeMarkdown(opcode, normalized);
}
