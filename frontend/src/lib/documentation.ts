import type { GuiLanguage, HelpDocId, OpcodeSpec, PortSpec, SignalType } from "../types";

import { normalizeGuiLanguage } from "./guiLanguage";
import opcodeDocDetails from "./opcodeDocDetails.json";

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
- Synchronize a track to another sequencer with \`Sync To\`.
- Reorder sequencer tracks by dragging the \`::\` handle on each track card.
- Use pattern pads (P1..P8) for queued pattern changes.
- Copy a pattern pad by dragging one pad and dropping it onto another pad (copies notes and pad scale/mode settings).
- Pad edge transpose buttons (\`-\` / \`+\`):
- Short click: transpose the stored notes to the previous/next degree within the current scale (scale root and mode stay the same), and update configured step chords to matching diatonic chord types for the transposed step when available.
- Long press: move the pad tonic to the previous/next degree (key-step transpose), keep the mode, and update the pad scale root.
- Set per-step notes or rests.
- Drag a step \`::\` handle onto another step (including steps in other sequencer tracks) to copy step note/chord/velocity settings.
- Control global BPM and running state.`
    },
    german: {
      title: "Sequencer Tracks",
      markdown: `## Sequencer Tracks

Programmiert schrittbasierte melodische oder rhythmische Patterns.

- Sequencer-Spuren hinzufügen/entfernen.
- Kanal, Skala, Modus und Schrittzahl (16/32) setzen.
- Eine Spur über \`Sync zu\` mit einer anderen Sequencer-Spur synchronisieren.
- Reihenfolge der Sequencer-Spuren per Drag-and-drop am \`::\`-Handle jeder Spurkarte ändern.
- Pattern-Pads (P1..P8) für geplante Pattern-Wechsel nutzen.
- Ein Pattern-Pad per Drag-and-drop auf ein anderes Pad ziehen, um es zu kopieren (kopiert Noten sowie Pad-Skala/Modus-Einstellungen).
- Transpositions-Tasten am Pad-Rand (\`-\` / \`+\`):
- Kurzer Klick: gespeicherte Noten zur vorherigen/nächsten Stufe innerhalb der aktuellen Skala verschieben (Grundton und Modus bleiben gleich) und konfigurierte Step-Akkorde auf passende diatonische Akkordtypen für den transponierten Schritt aktualisieren (falls verfügbar).
- Langer Klick: Tonika zur vorherigen/nächsten Stufe verschieben (Key-Step-Transpose), Modus beibehalten und Pad-Grundton der Skala aktualisieren.
- Pro Schritt Noten oder Pausen setzen.
- Einen Schritt am \`::\`-Handle auf einen anderen Schritt ziehen (auch in anderen Sequencer-Spuren), um Noten-/Akkord-/Velocity-Einstellungen zu kopieren.
- Globales BPM und Laufstatus steuern.`
    },
    french: {
      title: "Pistes séquenceur",
      markdown: `## Pistes séquenceur

Programme des patterns mélodiques ou rythmiques par pas.

- Ajouter/supprimer des pistes séquenceur.
- Régler canal, gamme, mode et nombre de pas (16/32).
- Synchroniser une piste à une autre piste séquenceur via \`Sync vers\`.
- Réordonner les pistes séquenceur par glisser-déposer avec la poignée \`::\` de chaque carte de piste.
- Utiliser les pads P1..P8 pour changements de pattern.
- Copier un pad de pattern en le glissant-deposant sur un autre pad (copie les notes et les réglages de gamme/mode du pad).
- Boutons de transposition sur le bord du pad (\`-\` / \`+\`) :
- Clic court : transpose les notes stockées vers le degré précédent/suivant dans la gamme actuelle (tonique et mode inchangés) et met à jour les accords de pas configurés vers des types d'accords diatoniques correspondants pour le pas transposé quand c'est possible.
- Appui long : déplace la tonique du pad vers le degré précédent/suivant (transposition par degré), conserve le mode et met à jour la tonique de la gamme du pad.
- Définir note ou silence par pas.
- Glisser la poignée \`::\` d'un pas sur un autre pas (y compris dans une autre piste séquenceur) pour copier les réglages note/accord/vélocité du pas.
- Contrôler BPM global et état de lecture.`
    },
    spanish: {
      title: "Pistas del secuenciador",
      markdown: `## Pistas del secuenciador

Programa patrones melódicos o rítmicos por pasos.

- Agrega/elimina pistas del secuenciador.
- Ajusta canal, escala, modo y cantidad de pasos (16/32).
- Sincroniza una pista con otro secuenciador usando \`Sync con\`.
- Reordena las pistas del secuenciador arrastrando el asa \`::\` en cada tarjeta de pista.
- Usa pads P1..P8 para cambios de patrón en cola.
- Copia un pad de patrón arrastrándolo y soltándolo sobre otro pad (copia notas y ajustes de escala/modo del pad).
- Botones de transposición en el borde del pad (\`-\` / \`+\`):
- Clic corto: transpone las notas guardadas al grado anterior/siguiente dentro de la escala actual (la raíz y el modo no cambian) y actualiza los acordes configurados del paso a tipos de acorde diatónicos correspondientes para el paso transpuesto cuando sea posible.
- Pulsación larga: mueve la tónica del pad al grado anterior/siguiente (transposición por grado), mantiene el modo y actualiza la raíz de la escala del pad.
- Define nota o silencio por paso.
- Arrastra el asa \`::\` de un paso sobre otro paso (incluyendo pasos de otras pistas del secuenciador) para copiar ajustes de nota/acorde/velocidad.
- Controla BPM global y estado de reproducción.`
    }
  },
  sequencer_track_editor: {
    english: {
      title: "Sequencer Track",
      markdown: `## Sequencer Track

This help applies to one sequencer track card.

- Start/stop the track independently (instrument transport must be running to start).
- Set MIDI channel, \`Sync To\` target, scale root/type, and mode for note generation.
- Switch step count between 16 and 32.
- Drag the track \`::\` handle in the header to reorder sequencers in the panel.
- Clear all steps for the current track.
- Use pattern pads (P1..P8) to queue or switch patterns.
- Use pad transpose buttons for short-click degree transpose (also remaps configured step chords to matching diatonic chord types when available) and long-press tonic/key-step transpose.
- Edit each step note, hold state, and velocity.
- Drag a step \`::\` handle onto another step (same track or another sequencer track) to copy step note/chord/velocity settings.`
    },
    german: {
      title: "Sequencer-Spur",
      markdown: `## Sequencer-Spur

Diese Hilfe gilt für eine einzelne Sequencer-Spurkarte.

- Spur separat starten/stoppen (zum Starten muss der Instrument-Transport laufen).
- MIDI-Kanal, \`Sync zu\`-Ziel, Skalen-Grundton/-Typ und Modus für die Notenerzeugung setzen.
- Schrittzahl zwischen 16 und 32 umschalten.
- Das \`::\`-Handle in der Kopfzeile ziehen, um Sequencer-Spuren im Panel umzusortieren.
- Alle Schritte dieser Spur löschen.
- Pattern-Pads (P1..P8) verwenden, um Patterns zu wechseln oder vorzumerken.
- Pad-Transpositionsknöpfe für kurzen Klick (Stufentransposition; aktualisiert konfigurierte Step-Akkorde wenn möglich auf passende diatonische Akkordtypen) und langen Druck (Tonika/Key-Step-Transpose) nutzen.
- Pro Schritt Note, Hold-Zustand und Velocity bearbeiten.
- Einen Schritt am \`::\`-Handle auf einen anderen Schritt ziehen (gleiche oder andere Sequencer-Spur), um Noten-/Akkord-/Velocity-Einstellungen zu kopieren.`
    },
    french: {
      title: "Piste séquenceur",
      markdown: `## Piste séquenceur

Cette aide s'applique à une carte de piste séquenceur individuelle.

- Démarrer/arrêter la piste indépendamment (le transport instrument doit être actif pour démarrer).
- Régler canal MIDI, cible \`Sync vers\`, tonique/type de gamme et mode pour la génération de notes.
- Basculer le nombre de pas entre 16 et 32.
- Glisser la poignée \`::\` de l'en-tête pour réordonner les séquenceurs dans le panneau.
- Effacer tous les pas de cette piste.
- Utiliser les pads de pattern (P1..P8) pour changer ou mettre en file d'attente des patterns.
- Utiliser les boutons de transposition de pad pour clic court (transposition par degré; met aussi à jour les accords de pas configurés vers des types diatoniques correspondants quand c'est possible) et appui long (tonique / transposition par degré de tonalité).
- Modifier note, état hold et vélocité pour chaque pas.
- Glisser la poignée \`::\` d'un pas sur un autre pas (même piste ou autre piste séquenceur) pour copier les réglages note/accord/vélocité du pas.`
    },
    spanish: {
      title: "Pista del secuenciador",
      markdown: `## Pista del secuenciador

Esta ayuda se aplica a una tarjeta individual de pista del secuenciador.

- Inicia/detiene la pista de forma independiente (el transporte de instrumentos debe estar activo para iniciar).
- Ajusta canal MIDI, destino \`Sync con\`, raíz/tipo de escala y modo para la generación de notas.
- Cambia la cantidad de pasos entre 16 y 32.
- Arrastra el asa \`::\` del encabezado para reordenar los secuenciadores en el panel.
- Borra todos los pasos de esta pista.
- Usa pads de patrón (P1..P8) para cambiar o poner en cola patrones.
- Usa los botones de transposición del pad para clic corto (transposición por grado; también actualiza los acordes configurados del paso a tipos diatónicos correspondientes cuando sea posible) y pulsación larga (tónica / transposición por grado tonal).
- Edita nota, estado hold y velocidad de cada paso.
- Arrastra el asa \`::\` de un paso sobre otro paso (misma pista u otra pista del secuenciador) para copiar ajustes de nota/acorde/velocidad.`
    }
  },
  sequencer_drummer_sequencer: {
    english: {
      title: "Drummer Sequencer",
      markdown: `## Drummer Sequencer

Drum-machine style step sequencer for fixed MIDI drum keys.

- Add/remove drum rows (keys) and set each row key in the 0..127 MIDI range.
- Program steps by toggling row LEDs on/off for each step.
- Set per-cell velocity (0..127) for active hits.
- Active hits show red LEDs; during playback the current-step active LEDs flash green.
- Choose 4, 8, 16, or 32 steps.
- Use pattern pads (P1..P8) for pattern switching/queueing and pad-loop sequences.
- No chord editing or transposition controls are used in this sequencer type.`
    },
    german: {
      title: "Drummer-Sequencer",
      markdown: `## Drummer-Sequencer

Drum-Machine-Step-Sequencer fuer feste MIDI-Drum-Keys.

- Drum-Reihen (Keys) hinzufuegen/entfernen und MIDI-Key 0..127 setzen.
- Steps programmieren durch Ein/Aus der LED pro Reihe und Schritt.
- Velocity pro Zelle (0..127) fuer aktive Hits setzen.
- Aktive Hits sind rot; beim Abspielen blinken aktive LEDs im aktuellen Schritt gruen.
- 4, 8, 16 oder 32 Schritte waehlen.
- Pattern-Pads (P1..P8) fuer Pattern-Wechsel/Warteschlange und Pad-Loop-Sequenzen nutzen.
- Keine Akkord- oder Transpositionsfunktionen in diesem Sequencer-Typ.`
    },
    french: {
      title: "Séquenceur batterie",
      markdown: `## Séquenceur batterie

Séquenceur pas à pas type boîte à rythmes pour des touches MIDI fixes.

- Ajouter/supprimer des lignes de batterie et régler la touche MIDI (0..127).
- Programmer les pas en activant/désactivant les LED par ligne et par pas.
- Régler la vélocité par cellule (0..127) pour les frappes actives.
- Les frappes actives sont rouges ; en lecture, les LED actives du pas courant clignotent en vert.
- Choisir 4, 8, 16 ou 32 pas.
- Utiliser les pads de pattern (P1..P8) pour changements/queue et séquences de boucle de pads.
- Pas d'édition d'accords ni de transposition pour ce type de séquenceur.`
    },
    spanish: {
      title: "Secuenciador de batería",
      markdown: `## Secuenciador de batería

Secuenciador por pasos estilo caja de ritmos para teclas MIDI fijas.

- Agrega/elimina filas de batería y ajusta la tecla MIDI (0..127).
- Programa pasos activando/desactivando LEDs por fila y paso.
- Ajusta velocidad por celda (0..127) para golpes activos.
- Los golpes activos se muestran en rojo; durante reproducción, los LEDs activos del paso actual parpadean en verde.
- Elige 4, 8, 16 o 32 pasos.
- Usa pads de patrón (P1..P8) para cambios/cola y secuencias de bucle de pads.
- Sin edición de acordes ni controles de transposición en este tipo de secuenciador.`
    }
  },
  sequencer_controller_sequencer: {
    english: {
      title: "Controller Sequencer",
      markdown: `## Controller Sequencer

Automate a MIDI CC value over time with a curve.

- Start/stop this controller sequencer independently (instrument transport must be running to start).
- Set the MIDI controller number (\`0..127\`).
- Choose the curve rate/length (step count) for the repeating cycle.
- Use the curve editor to add, move, and shape key points.
- The curve loops continuously while the lane is running.
- The displayed \`CC n\` badge shows the target controller currently sent.`
    },
    german: {
      title: "Controller-Sequencer",
      markdown: `## Controller-Sequencer

Automatisiert einen MIDI-CC-Wert über die Zeit mit einer Kurve.

- Diesen Controller-Sequencer separat starten/stoppen (zum Starten muss der Instrument-Transport laufen).
- MIDI-Controller-Nummer (\`0..127\`) festlegen.
- Kurvenrate/-länge (Schrittzahl) für den wiederholten Zyklus wählen.
- Im Kurveneditor Keypoints hinzufügen, verschieben und formen.
- Die Kurve läuft in einer Schleife, solange die Spur aktiv ist.
- Das angezeigte \`CC n\`-Badge zeigt den aktuell gesendeten Ziel-Controller.`
    },
    french: {
      title: "Séquenceur contrôleur",
      markdown: `## Séquenceur contrôleur

Automatise une valeur MIDI CC dans le temps avec une courbe.

- Démarrer/arrêter ce séquenceur contrôleur indépendamment (le transport instrument doit être actif pour démarrer).
- Définir le numéro de contrôleur MIDI (\`0..127\`).
- Choisir la cadence/longueur de courbe (nombre de pas) pour le cycle répétitif.
- Utiliser l'éditeur de courbe pour ajouter, déplacer et façonner des points-clés.
- La courbe boucle en continu pendant l'exécution de la piste.
- Le badge \`CC n\` affiché indique le contrôleur cible envoyé.`
    },
    spanish: {
      title: "Secuenciador controlador",
      markdown: `## Secuenciador controlador

Automatiza un valor MIDI CC en el tiempo mediante una curva.

- Inicia/detiene este secuenciador controlador de forma independiente (el transporte de instrumentos debe estar activo para iniciar).
- Define el número de controlador MIDI (\`0..127\`).
- Elige la tasa/longitud de la curva (cantidad de pasos) para el ciclo repetitivo.
- Usa el editor de curva para agregar, mover y dar forma a puntos clave.
- La curva se repite en bucle mientras la pista esté activa.
- La insignia \`CC n\` muestra el controlador destino que se está enviando.`
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

- Add up to 6 controller lanes.
- Set controller number (\`0..127\`).
- Adjust controller value with the knob.
- Start/stop each controller lane independently.`
    },
    german: {
      title: "MIDI Controller",
      markdown: `## MIDI Controller

Sendet MIDI-CC-Nachrichten von der Sequencer-Seite.

- Bis zu 6 Controller-Spuren hinzufügen.
- Controller-Nummer (\`0..127\`) festlegen.
- Controller-Wert mit dem Drehregler einstellen.
- Jede Controller-Spur separat starten/stoppen.`
    },
    french: {
      title: "Contrôleurs MIDI",
      markdown: `## Contrôleurs MIDI

Envoi de messages MIDI CC depuis la page séquenceur.

- Ajouter jusqu'à 6 pistes de contrôleur.
- Définir le numéro de contrôleur (\`0..127\`).
- Ajuster la valeur avec le potentiomètre.
- Démarrer/arrêter chaque piste indépendamment.`
    },
    spanish: {
      title: "Controladores MIDI",
      markdown: `## Controladores MIDI

Envía mensajes MIDI CC desde la página del secuenciador.

- Agrega hasta 6 pistas de control.
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
| \`(\`, \`)\` | Grouping / precedence |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Unary functions |`,
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
| \`(\`, \`)\` | Gruppierung / Priorität |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Unäre Funktionen |`,
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
| \`(\`, \`)\` | Groupement / priorité |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Fonctions unaires |`,
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
| \`(\`, \`)\` | Agrupación / precedencia |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Funciones unarias |`
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

type LocalizedOpcodeDocText = Record<GuiLanguage, string>;

type LocalizedOpcodeDocDetails = {
  description: LocalizedOpcodeDocText;
  inputs: Record<string, LocalizedOpcodeDocText>;
  outputs: Record<string, LocalizedOpcodeDocText>;
};

const OPCODE_DOC_DETAILS: Record<string, LocalizedOpcodeDocDetails> = opcodeDocDetails;

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

function localizedPortDescription(opcode: OpcodeSpec, port: PortSpec, language: GuiLanguage, isOutput: boolean): string {
  const details = OPCODE_DOC_DETAILS[opcode.name];
  const localized = (isOutput ? details?.outputs?.[port.id] : details?.inputs?.[port.id])?.[language];
  if (localized && localized.trim().length > 0) {
    return localized;
  }
  if (port.description.trim().length > 0) {
    return port.description.trim();
  }
  return port.name;
}

function formatPortLine(opcode: OpcodeSpec, port: PortSpec, language: GuiLanguage, isOutput: boolean): string {
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

  const detail = localizedPortDescription(opcode, port, language, isOutput);
  return `- \`${port.id}\` (${qualifiers.join("; ")}): ${detail}`;
}

function localizedOpcodeDescription(opcode: OpcodeSpec, language: GuiLanguage): string {
  const localized = OPCODE_DOC_DETAILS[opcode.name]?.description?.[language];
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
      lines.push(formatPortLine(opcode, input, language, false));
    }
  }

  lines.push("");
  lines.push(`**${copy.outputs}**`);
  if (opcode.outputs.length === 0) {
    lines.push(`- ${copy.noOutputs}`);
  } else {
    for (const output of opcode.outputs) {
      lines.push(formatPortLine(opcode, output, language, true));
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
