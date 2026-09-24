import { sequencerTimingHelp } from "./helpDocumentationSequencerTiming";
import { patternWorkspaceHelp } from "./helpDocumentationPatternWorkspace";
import { independentPlaybackHelp } from "./helpDocumentationIndependentPlayback";
import { arrangementHelp } from "./arrangementHelp";
import { arpeggiatorHelp } from "./helpDocumentationArpeggiator";
import { collapsiblePanelHelp } from "./helpDocumentationPanels";
import { performanceControllerHelp } from "./helpDocumentationPerformanceControllers";
import { audioRoutingHelp } from "./helpDocumentationAudio";
import type { HelpDocumentAppendixSet, HelpDocumentSet, SequencerHelpDocId } from "./helpDocumentationTypes";

export const sequencerHelpDocuments: HelpDocumentSet<SequencerHelpDocId> = {
  sequencer_instrument_rack: {
    english: {
      title: "Instrument Rack",
      markdown: `## Instrument Rack

Manage performance-level instrument assignments.

- Set performance name and description.
- The description shows three automatically wrapped lines. Scroll vertically for longer text, or hover over the field to see the full description.
- Load and save performance presets.
- Assign saved patches to MIDI channels.
- Open a slot's patch picker to browse collapsed instrument-type groups, or search names and descriptions across all types after at least four characters and a 500 ms typing pause. Templates are excluded.
- Start and stop instrument engine transport.
- Import/export sequencer configuration JSON.`
    },
    german: {
      title: "Instrument Rack",
      markdown: `## Instrument Rack

Verwaltet Instrument-Zuordnungen auf Performance-Ebene.

- Performance-Name und Beschreibung setzen.
- Die Beschreibung zeigt drei Zeilen mit automatischem Zeilenumbruch. Längeren Text vertikal scrollen oder mit der Maus über das Feld fahren, um die vollständige Beschreibung anzuzeigen.
- Performance-Presets laden und speichern.
- Gespeicherte Patches MIDI-Kanälen zuweisen.
- Die Patch-Auswahl eines Rack-Platzes öffnen, um eingeklappte Instrumententyp-Gruppen zu durchsuchen. Ab vier Zeichen und nach 500 ms Tipp-Pause werden Namen und Beschreibungen über alle Typen hinweg durchsucht. Vorlagen sind ausgeschlossen.
- Instrument-Engine starten/stoppen.
- Sequencer-Konfiguration als JSON importieren/exportieren.`
    },
    french: {
      title: "Rack instrument",
      markdown: `## Rack instrument

Gestion des affectations d'instruments au niveau performance.

- Définir nom et description de performance.
- La description affiche trois lignes avec retour automatique à la ligne. Faites défiler verticalement les textes plus longs ou survolez le champ pour voir la description complète.
- Charger et enregistrer des presets de performance.
- Affecter des patches sauvegardés à des canaux MIDI.
- Ouvrir le sélecteur de patch d'un emplacement pour parcourir les groupes repliés par type d'instrument, ou rechercher dans les noms et descriptions de tous les types après au moins quatre caractères et une pause de saisie de 500 ms. Les modèles sont exclus.
- Démarrer/arrêter le moteur instrument.
- Import/export JSON de configuration séquenceur.`
    },
    spanish: {
      title: "Rack de instrumentos",
      markdown: `## Rack de instrumentos

Gestiona asignaciones de instrumentos a nivel de performance.

- Define nombre y descripción de performance.
- La descripción muestra tres líneas con ajuste automático de texto. Desplázate verticalmente para leer textos más largos o pasa el ratón sobre el campo para ver la descripción completa.
- Carga y guarda presets de performance.
- Asigna patches guardados a canales MIDI.
- Abre el selector de patch de una ranura para explorar grupos contraídos por tipo de instrumento, o buscar en nombres y descripciones de todos los tipos tras escribir al menos cuatro caracteres y hacer una pausa de 500 ms. Las plantillas quedan excluidas.
- Inicia y detiene el motor de instrumentos.
- Importa/exporta JSON de configuración del secuenciador.`
    }
  },
  sequencer_tracks: {
    english: {
      title: "Melodic Sequencers",
      markdown: `## Melodic Sequencers

Click the pen beside the device name to rename it. Save/Enter applies; Cancel/Escape discards. Clicking elsewhere does not save. Names must be nonempty, use at most 65 Unicode characters, contain no HTML or angle brackets, and be unique across all six device types in the performance (ignoring case and surrounding whitespace). Names retain their capitalization and survive save/load and JSON/ZIP export/import. Existing imported names remain intact until renamed.

Program step-based melodic or rhythmic patterns.

- Add/remove melodic sequencers.
- Synchronize a melodic sequencer to another melodic sequencer with \`Sync To\`.
- Reorder melodic sequencers by dragging the \`::\` handle on each sequencer card.
- Copy a pattern pad by dragging one pad and dropping it onto another pad (copies notes and pad scale/mode settings).
- Pad edge transpose buttons (\`-\` / \`+\`):
- Short click: transpose the stored notes to the previous/next degree within the current scale (scale root and mode stay the same), and update configured step chords to matching diatonic chord types for the transposed step when available.
- Long press: move the pad tonic to the previous/next degree (key-step transpose), keep the mode, and update the pad scale root.
- Set per-step notes or rests.
- Choose per-step chords, including the standard \`5\` power chord (root + perfect fifth), with diatonic/chromatic status based on the current mode.
- Drag a step \`::\` handle onto another step (including steps in other melodic sequencers) to copy step note/chord/velocity settings.
- Control global BPM and running state.`
    },
    german: {
      title: "Melodische Sequencer",
      markdown: `## Melodische Sequencer

Zum Umbenennen auf den Stift neben dem Gerätenamen klicken. Speichern/Enter übernimmt, Abbrechen/Escape verwirft den Entwurf. Ein Klick außerhalb speichert nicht. Namen dürfen nicht leer sein, höchstens 65 Unicode-Zeichen enthalten und weder HTML noch spitze Klammern verwenden. Sie müssen über alle sechs Gerätetypen der Performance eindeutig sein; Groß-/Kleinschreibung und äußere Leerzeichen werden dabei ignoriert. Die Schreibweise bleibt erhalten, auch beim Speichern/Laden und JSON/ZIP-Export/Import. Vorhandene importierte Namen bleiben bis zum Umbenennen erhalten.

Programmiert schrittbasierte melodische oder rhythmische Patterns.

- Melodische Sequencer hinzufuegen/entfernen.
- Einen melodischen Sequencer ueber \`Sync zu\` mit einem anderen melodischen Sequencer synchronisieren.
- Reihenfolge der melodischen Sequencer per Drag-and-drop am \`::\`-Handle jeder Sequencer-Karte aendern.
- Ein Pattern-Pad per Drag-and-drop auf ein anderes Pad ziehen, um es zu kopieren (kopiert Noten sowie Pad-Skala/Modus-Einstellungen).
- Transpositions-Tasten am Pad-Rand (\`-\` / \`+\`):
- Kurzer Klick: gespeicherte Noten zur vorherigen/nächsten Stufe innerhalb der aktuellen Skala verschieben (Grundton und Modus bleiben gleich) und konfigurierte Step-Akkorde auf passende diatonische Akkordtypen für den transponierten Schritt aktualisieren (falls verfügbar).
- Langer Klick: Tonika zur vorherigen/nächsten Stufe verschieben (Key-Step-Transpose), Modus beibehalten und Pad-Grundton der Skala aktualisieren.
- Pro Schritt Noten oder Pausen setzen.
- Pro Schritt Akkorde waehlen, inklusive des standardmaessigen \`5\`-Powerchords (Grundton + reine Quinte); der diatonisch/chromatisch-Status richtet sich nach dem aktuellen Modus.
- Einen Schritt am \`::\`-Handle auf einen anderen Schritt ziehen (auch in anderen melodischen Sequencern), um Noten-/Akkord-/Velocity-Einstellungen zu kopieren.
- Globales BPM und Laufstatus steuern.`
    },
    french: {
      title: "Sequenceurs melodiques",
      markdown: `## Sequenceurs melodiques

Cliquez sur le stylo à droite du nom pour le modifier. Enregistrer/Entrée applique ; Annuler/Échap abandonne. Cliquer ailleurs ne sauvegarde pas. Le nom doit être non vide, comporter au maximum 65 caractères Unicode, sans HTML ni chevrons, et être unique parmi les six types d’appareils de la performance, sans tenir compte de la casse ni des espaces aux extrémités. La casse est conservée, ainsi que les noms lors de l’enregistrement, du chargement et de l’export/import JSON/ZIP. Les noms importés existants restent intacts jusqu’à leur modification.

Programme des patterns mélodiques ou rythmiques par pas.

- Ajouter/supprimer des sequenceurs melodiques.
- Regler canal MIDI, gamme, mode, mesure/grille et ratio de temps propres a chaque sequenceur melodique.
- Synchroniser un sequenceur melodique a un autre via \`Sync vers\`.
- Reordonner les sequenceurs melodiques par glisser-deposer avec la poignee \`::\` de chaque carte.
- Utiliser les pads #1..#8 pour file d'attente sur les sequenceurs en lecture et changement immediat sur les sequenceurs arretes.
- Copier un pad de pattern en le glissant-deposant sur un autre pad (copie les notes et les réglages de gamme/mode du pad).
- Le ratio de temps change seulement la vitesse de lecture face au transport partage ; la longueur stockee du pad, la mesure et la grille restent identiques.
- Boutons de transposition sur le bord du pad (\`-\` / \`+\`) :
- Clic court : transpose les notes stockées vers le degré précédent/suivant dans la gamme actuelle (tonique et mode inchangés) et met à jour les accords de pas configurés vers des types d'accords diatoniques correspondants pour le pas transposé quand c'est possible.
- Appui long : déplace la tonique du pad vers le degré précédent/suivant (transposition par degré), conserve le mode et met à jour la tonique de la gamme du pad.
- Définir note ou silence par pas.
- Choisir des accords par pas, y compris le power chord standard \`5\` (fondamentale + quinte juste), avec statut diatonique/chromatique selon le mode actuel.
- Glisser la poignee \`::\` d'un pas sur un autre pas (y compris dans un autre sequenceur melodique) pour copier les reglages note/accord/velocite du pas.
- Contrôler BPM global et état de lecture.`
    },
    spanish: {
      title: "Secuenciadores melodicos",
      markdown: `## Secuenciadores melodicos

Haz clic en el lápiz a la derecha del nombre para editarlo. Guardar/Enter aplica; Cancelar/Escape descarta. Hacer clic fuera no guarda. El nombre no puede estar vacío, debe tener como máximo 65 caracteres Unicode, no puede contener HTML ni corchetes angulares y debe ser único entre los seis tipos de dispositivos de la performance, sin distinguir mayúsculas ni espacios en los extremos. Se conservan las mayúsculas y los nombres al guardar, cargar y exportar/importar JSON/ZIP. Los nombres importados existentes se mantienen hasta que se renombren.

Programa patrones melódicos o rítmicos por pasos.

- Agrega/elimina secuenciadores melodicos.
- Ajusta canal MIDI, escala, modo, metrica/cuadricula y relacion de pulso propias de cada secuenciador melodico.
- Sincroniza un secuenciador melodico con otro usando \`Sync con\`.
- Reordena los secuenciadores melodicos arrastrando el asa \`::\` en cada tarjeta.
- Usa pads #1..#8 para cambios en cola en secuenciadores en reproduccion y cambios inmediatos en secuenciadores detenidos.
- Copia un pad de patrón arrastrándolo y soltándolo sobre otro pad (copia notas y ajustes de escala/modo del pad).
- La relacion de pulso solo cambia la velocidad frente al transporte compartido; la longitud guardada del pad, el compas y la cuadricula no cambian.
- Botones de transposición en el borde del pad (\`-\` / \`+\`):
- Clic corto: transpone las notas guardadas al grado anterior/siguiente dentro de la escala actual (la raíz y el modo no cambian) y actualiza los acordes configurados del paso a tipos de acorde diatónicos correspondientes para el paso transpuesto cuando sea posible.
- Pulsación larga: mueve la tónica del pad al grado anterior/siguiente (transposición por grado), mantiene el modo y actualiza la raíz de la escala del pad.
- Define nota o silencio por paso.
- Elige acordes por paso, incluido el power chord estandar \`5\` (raiz + quinta justa), con estado diatonico/cromatico segun el modo actual.
- Arrastra el asa \`::\` de un paso sobre otro paso (incluyendo pasos de otros secuenciadores melodicos) para copiar ajustes de nota/acorde/velocidad.
- Controla BPM global y estado de reproducción.`
    }
  },
  sequencer_track_editor: {
    english: {
      title: "Melodic Sequencer",
      markdown: `## Melodic Sequencer

Click the pen beside the device name to rename it. Save/Enter applies; Cancel/Escape discards. Clicking elsewhere does not save. Names must be nonempty, use at most 65 Unicode characters, contain no HTML or angle brackets, and be unique across all six device types in the performance (ignoring case and surrounding whitespace). Names retain their capitalization and survive save/load and JSON/ZIP export/import. Existing imported names remain intact until renamed.

This help applies to one melodic sequencer card.

- Start/stop the sequencer independently while the arranger is stopped (Play starts the instrument engine when needed).
- Set MIDI channel, \`Sync To\` target, scale root/type, and mode for note generation.
- Drag the sequencer \`::\` handle in the header to reorder melodic sequencers in the panel.
- Clear all steps for the current sequencer.
- Use pad transpose buttons for short-click degree transpose (also remaps configured step chords to matching diatonic chord types when available) and long-press tonic/key-step transpose.
- Edit each step note, hold state, and velocity.
- Set a per-step chord; the \`5\` option emits the root and perfect fifth and is marked diatonic only when both notes fit the current mode.
- Drag a step \`::\` handle onto another step (same sequencer or another melodic sequencer) to copy step note/chord/velocity settings.`
    },
    german: {
      title: "Melodischer Sequencer",
      markdown: `## Melodischer Sequencer

Zum Umbenennen auf den Stift neben dem Gerätenamen klicken. Speichern/Enter übernimmt, Abbrechen/Escape verwirft den Entwurf. Ein Klick außerhalb speichert nicht. Namen dürfen nicht leer sein, höchstens 65 Unicode-Zeichen enthalten und weder HTML noch spitze Klammern verwenden. Sie müssen über alle sechs Gerätetypen der Performance eindeutig sein; Groß-/Kleinschreibung und äußere Leerzeichen werden dabei ignoriert. Die Schreibweise bleibt erhalten, auch beim Speichern/Laden und JSON/ZIP-Export/Import. Vorhandene importierte Namen bleiben bis zum Umbenennen erhalten.

Diese Hilfe gilt fuer eine einzelne Karte eines melodischen Sequencers.

- Sequencer separat starten/stoppen, waehrend der Arranger gestoppt ist (Play startet die Instrument-Engine bei Bedarf).
- MIDI-Kanal, \`Sync zu\`-Ziel, Skalen-Grundton/-Typ und Modus für die Notenerzeugung setzen.
- Das \`::\`-Handle in der Kopfzeile ziehen, um melodische Sequencer im Panel umzusortieren.
- Alle Schritte dieses Sequencers loeschen.
- Pad-Transpositionsknöpfe für kurzen Klick (Stufentransposition; aktualisiert konfigurierte Step-Akkorde wenn möglich auf passende diatonische Akkordtypen) und langen Druck (Tonika/Key-Step-Transpose) nutzen.
- Pro Schritt Note, Hold-Zustand und Velocity bearbeiten.
- Pro Schritt einen Akkord setzen; die Option \`5\` sendet Grundton und reine Quinte und wird nur dann als diatonisch markiert, wenn beide Noten in den aktuellen Modus passen.
- Einen Schritt am \`::\`-Handle auf einen anderen Schritt ziehen (gleicher oder anderer melodischer Sequencer), um Noten-/Akkord-/Velocity-Einstellungen zu kopieren.`
    },
    french: {
      title: "Sequenceur melodique",
      markdown: `## Sequenceur melodique

Cliquez sur le stylo à droite du nom pour le modifier. Enregistrer/Entrée applique ; Annuler/Échap abandonne. Cliquer ailleurs ne sauvegarde pas. Le nom doit être non vide, comporter au maximum 65 caractères Unicode, sans HTML ni chevrons, et être unique parmi les six types d’appareils de la performance, sans tenir compte de la casse ni des espaces aux extrémités. La casse est conservée, ainsi que les noms lors de l’enregistrement, du chargement et de l’export/import JSON/ZIP. Les noms importés existants restent intacts jusqu’à leur modification.

Cette aide s'applique a une carte individuelle de sequenceur melodique.

- Demarrer/arreter le sequenceur independamment pendant que l'arrangeur est arrete (Play démarre le moteur audio si nécessaire).
- Régler canal MIDI, cible \`Sync vers\`, tonique/type de gamme et mode pour la génération de notes.
- Glisser la poignee \`::\` de l'en-tete pour reordonner les sequenceurs melodiques dans le panneau.
- Effacer tous les pas de ce sequenceur.
- Le ratio de temps change seulement la vitesse de lecture face au transport partage ; la longueur stockee du pad, la mesure et la grille restent identiques.
- Utiliser les boutons de transposition de pad pour clic court (transposition par degré; met aussi à jour les accords de pas configurés vers des types diatoniques correspondants quand c'est possible) et appui long (tonique / transposition par degré de tonalité).
- Modifier note, état hold et vélocité pour chaque pas.
- Definir un accord par pas ; l'option \`5\` envoie la fondamentale et la quinte juste, et n'est marquee diatonique que lorsque les deux notes correspondent au mode actuel.
- Glisser la poignee \`::\` d'un pas sur un autre pas (meme sequenceur ou autre sequenceur melodique) pour copier les reglages note/accord/velocite du pas.`
    },
    spanish: {
      title: "Secuenciador melodico",
      markdown: `## Secuenciador melodico

Haz clic en el lápiz a la derecha del nombre para editarlo. Guardar/Enter aplica; Cancelar/Escape descarta. Hacer clic fuera no guarda. El nombre no puede estar vacío, debe tener como máximo 65 caracteres Unicode, no puede contener HTML ni corchetes angulares y debe ser único entre los seis tipos de dispositivos de la performance, sin distinguir mayúsculas ni espacios en los extremos. Se conservan las mayúsculas y los nombres al guardar, cargar y exportar/importar JSON/ZIP. Los nombres importados existentes se mantienen hasta que se renombren.

Esta ayuda se aplica a una tarjeta individual de secuenciador melodico.

- Inicia/detiene el secuenciador de forma independiente mientras el arreglador esta detenido (Play inicia el motor de audio cuando es necesario).
- Ajusta canal MIDI, destino \`Sync con\`, raíz/tipo de escala y modo para la generación de notas.
- Arrastra el asa \`::\` del encabezado para reordenar los secuenciadores melodicos en el panel.
- Borra todos los pasos de este secuenciador.
- La relacion de pulso solo cambia la velocidad frente al transporte compartido; la longitud guardada del pad, el compas y la cuadricula siguen iguales.
- Usa los botones de transposición del pad para clic corto (transposición por grado; también actualiza los acordes configurados del paso a tipos diatónicos correspondientes cuando sea posible) y pulsación larga (tónica / transposición por grado tonal).
- Edita nota, estado hold y velocidad de cada paso.
- Define un acorde por paso; la opcion \`5\` emite raiz y quinta justa, y solo se marca como diatonica cuando ambas notas encajan en el modo actual.
- Arrastra el asa \`::\` de un paso sobre otro paso (mismo secuenciador u otro secuenciador melodico) para copiar ajustes de nota/acorde/velocidad.`
    }
  },
  sequencer_multitrack_arranger: {
    english: { title: "Multitrack Arranger", markdown: arrangementHelp.english },
    german: { title: "Multitrack Arranger", markdown: arrangementHelp.german },
    french: { title: "Arrangeur multipiste", markdown: arrangementHelp.french },
    spanish: { title: "Arreglador multipista", markdown: arrangementHelp.spanish }
  },
  sequencer_drummer_sequencer: {
    english: {
      title: "Drummer Sequencer",
      markdown: `## Drummer Sequencer

Click the pen beside the device name to rename it. Save/Enter applies; Cancel/Escape discards. Clicking elsewhere does not save. Names must be nonempty, use at most 65 Unicode characters, contain no HTML or angle brackets, and be unique across all six device types in the performance (ignoring case and surrounding whitespace). Names retain their capitalization and survive save/load and JSON/ZIP export/import. Existing imported names remain intact until renamed.

Drum-machine style step sequencer for fixed MIDI drum keys.

- Add/remove drum rows (keys) and set each row key in the 0..127 MIDI range.
- Program steps by toggling row LEDs on/off for each step.
- Set per-cell velocity (0..127) for active hits by clicking and dragging up or down.
- Active hits show red LEDs; during playback the current-step active LEDs flash green.
- No chord editing or transposition controls are used in this sequencer type.`
    },
    german: {
      title: "Drummer-Sequencer",
      markdown: `## Drummer-Sequencer

Zum Umbenennen auf den Stift neben dem Gerätenamen klicken. Speichern/Enter übernimmt, Abbrechen/Escape verwirft den Entwurf. Ein Klick außerhalb speichert nicht. Namen dürfen nicht leer sein, höchstens 65 Unicode-Zeichen enthalten und weder HTML noch spitze Klammern verwenden. Sie müssen über alle sechs Gerätetypen der Performance eindeutig sein; Groß-/Kleinschreibung und äußere Leerzeichen werden dabei ignoriert. Die Schreibweise bleibt erhalten, auch beim Speichern/Laden und JSON/ZIP-Export/Import. Vorhandene importierte Namen bleiben bis zum Umbenennen erhalten.

Drum-Machine-Step-Sequencer fuer feste MIDI-Drum-Keys.

- Drum-Reihen (Keys) hinzufuegen/entfernen und MIDI-Key 0..127 setzen.
- Steps programmieren durch Ein/Aus der LED pro Reihe und Schritt.
- Velocity pro Zelle (0..127) fuer aktive Hits durch Klicken und Ziehen nach oben oder unten setzen.
- Aktive Hits sind rot; beim Abspielen blinken aktive LEDs im aktuellen Schritt gruen.
- Keine Akkord- oder Transpositionsfunktionen in diesem Sequencer-Typ.`
    },
    french: {
      title: "Séquenceur batterie",
      markdown: `## Séquenceur batterie

Cliquez sur le stylo à droite du nom pour le modifier. Enregistrer/Entrée applique ; Annuler/Échap abandonne. Cliquer ailleurs ne sauvegarde pas. Le nom doit être non vide, comporter au maximum 65 caractères Unicode, sans HTML ni chevrons, et être unique parmi les six types d’appareils de la performance, sans tenir compte de la casse ni des espaces aux extrémités. La casse est conservée, ainsi que les noms lors de l’enregistrement, du chargement et de l’export/import JSON/ZIP. Les noms importés existants restent intacts jusqu’à leur modification.

Séquenceur pas à pas type boîte à rythmes pour des touches MIDI fixes.

- Ajouter/supprimer des lignes de batterie et régler la touche MIDI (0..127).
- Programmer les pas en activant/désactivant les LED par ligne et par pas.
- Régler la vélocité par cellule (0..127) pour les frappes actives en cliquant et en faisant glisser vers le haut ou vers le bas.
- Les frappes actives sont rouges ; en lecture, les LED actives du pas courant clignotent en vert.
- Le ratio de temps change seulement la vitesse du motif de lignes face au transport partage.
- Pas d'édition d'accords ni de transposition pour ce type de séquenceur.`
    },
    spanish: {
      title: "Secuenciador de batería",
      markdown: `## Secuenciador de batería

Haz clic en el lápiz a la derecha del nombre para editarlo. Guardar/Enter aplica; Cancelar/Escape descarta. Hacer clic fuera no guarda. El nombre no puede estar vacío, debe tener como máximo 65 caracteres Unicode, no puede contener HTML ni corchetes angulares y debe ser único entre los seis tipos de dispositivos de la performance, sin distinguir mayúsculas ni espacios en los extremos. Se conservan las mayúsculas y los nombres al guardar, cargar y exportar/importar JSON/ZIP. Los nombres importados existentes se mantienen hasta que se renombren.

Secuenciador por pasos estilo caja de ritmos para teclas MIDI fijas.

- Agrega/elimina filas de batería y ajusta la tecla MIDI (0..127).
- Programa pasos activando/desactivando LEDs por fila y paso.
- Ajusta velocidad por celda (0..127) para golpes activos haciendo clic y arrastrando hacia arriba o hacia abajo.
- Los golpes activos se muestran en rojo; durante reproducción, los LEDs activos del paso actual parpadean en verde.
- La relacion de pulso solo cambia la velocidad del patron de filas frente al transporte compartido.
- Sin edición de acordes ni controles de transposición en este tipo de secuenciador.`
    }
  },
  sequencer_controller_sequencer: {
    english: {
      title: "Controller Sequencer",
      markdown: `## Controller Sequencer

Click the pen beside the device name to rename it. Save/Enter applies; Cancel/Escape discards. Clicking elsewhere does not save. Names must be nonempty, use at most 65 Unicode characters, contain no HTML or angle brackets, and be unique across all six device types in the performance (ignoring case and surrounding whitespace). Names retain their capitalization and survive save/load and JSON/ZIP export/import. Existing imported names remain intact until renamed.

Automate a MIDI CC value over time with a curve.

- Start/stop this controller sequencer independently while the arranger is stopped (Play starts the instrument engine when needed).
- Set the MIDI controller number (\`0..127\`).
- Use the curve editor to add, move, and shape key points.
- The curve loops continuously while the lane is running.
- The displayed \`CC n\` badge shows the target controller currently sent.`
    },
    german: {
      title: "Controller-Sequencer",
      markdown: `## Controller-Sequencer

Zum Umbenennen auf den Stift neben dem Gerätenamen klicken. Speichern/Enter übernimmt, Abbrechen/Escape verwirft den Entwurf. Ein Klick außerhalb speichert nicht. Namen dürfen nicht leer sein, höchstens 65 Unicode-Zeichen enthalten und weder HTML noch spitze Klammern verwenden. Sie müssen über alle sechs Gerätetypen der Performance eindeutig sein; Groß-/Kleinschreibung und äußere Leerzeichen werden dabei ignoriert. Die Schreibweise bleibt erhalten, auch beim Speichern/Laden und JSON/ZIP-Export/Import. Vorhandene importierte Namen bleiben bis zum Umbenennen erhalten.

Automatisiert einen MIDI-CC-Wert über die Zeit mit einer Kurve.

- Diesen Controller-Sequencer separat starten/stoppen, waehrend der Arranger gestoppt ist (Play startet die Instrument-Engine bei Bedarf).
- MIDI-Controller-Nummer (\`0..127\`) festlegen.
- Im Kurveneditor Keypoints hinzufügen, verschieben und formen.
- Die Kurve läuft in einer Schleife, solange die Spur aktiv ist.
- Das angezeigte \`CC n\`-Badge zeigt den aktuell gesendeten Ziel-Controller.`
    },
    french: {
      title: "Séquenceur contrôleur",
      markdown: `## Séquenceur contrôleur

Cliquez sur le stylo à droite du nom pour le modifier. Enregistrer/Entrée applique ; Annuler/Échap abandonne. Cliquer ailleurs ne sauvegarde pas. Le nom doit être non vide, comporter au maximum 65 caractères Unicode, sans HTML ni chevrons, et être unique parmi les six types d’appareils de la performance, sans tenir compte de la casse ni des espaces aux extrémités. La casse est conservée, ainsi que les noms lors de l’enregistrement, du chargement et de l’export/import JSON/ZIP. Les noms importés existants restent intacts jusqu’à leur modification.

Automatise une valeur MIDI CC dans le temps avec une courbe.

- Démarrer/arrêter ce séquenceur contrôleur indépendamment pendant que l'arrangeur est arrêté (Play démarre le moteur audio si nécessaire).
- Définir le numéro de contrôleur MIDI (\`0..127\`).
- Utiliser l'éditeur de courbe pour ajouter, déplacer et façonner des points-clés.
- Le ratio de temps change seulement la vitesse de lecture de la courbe face au transport partage ; les points-cles stockes restent au meme endroit.
- La courbe boucle en continu pendant l'exécution de la piste.
- Le badge \`CC n\` affiché indique le contrôleur cible envoyé.`
    },
    spanish: {
      title: "Secuenciador controlador",
      markdown: `## Secuenciador controlador

Haz clic en el lápiz a la derecha del nombre para editarlo. Guardar/Enter aplica; Cancelar/Escape descarta. Hacer clic fuera no guarda. El nombre no puede estar vacío, debe tener como máximo 65 caracteres Unicode, no puede contener HTML ni corchetes angulares y debe ser único entre los seis tipos de dispositivos de la performance, sin distinguir mayúsculas ni espacios en los extremos. Se conservan las mayúsculas y los nombres al guardar, cargar y exportar/importar JSON/ZIP. Los nombres importados existentes se mantienen hasta que se renombren.

Automatiza un valor MIDI CC en el tiempo mediante una curva.

- Inicia/detiene este secuenciador controlador de forma independiente mientras el arreglador está detenido (Play inicia el motor de audio cuando es necesario).
- Define el número de controlador MIDI (\`0..127\`).
- Usa el editor de curva para agregar, mover y dar forma a puntos clave.
- La relacion de pulso solo cambia la velocidad de la curva frente al transporte compartido; los puntos guardados no se mueven.
- La curva se repite en bucle mientras la pista esté activa.
- La insignia \`CC n\` muestra el controlador destino que se está enviando.`
    }
  },
  sequencer_arpeggiator: {
    english: { title: "Arpeggiator", markdown: arpeggiatorHelp.english },
    german: { title: "Arpeggiator", markdown: arpeggiatorHelp.german },
    french: { title: "Arpégiateur", markdown: arpeggiatorHelp.french },
    spanish: { title: "Arpegiador", markdown: arpeggiatorHelp.spanish }
  },
  sequencer_piano_rolls: {
    english: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Click the pen beside the device name to rename it. Save/Enter applies; Cancel/Escape discards. Clicking elsewhere does not save. Names must be nonempty, use at most 65 Unicode characters, contain no HTML or angle brackets, and be unique across all six device types in the performance (ignoring case and surrounding whitespace). Names retain their capitalization and survive save/load and JSON/ZIP export/import. Existing imported names remain intact until renamed.

Play notes manually with scale-aware keyboard highlights.

- Add/remove piano roll controllers.
- Set MIDI channel, scale root/type, and mode.
- Start/stop each piano roll independently.
- Starting a piano roll can start the instrument engine, but it does not start the arranger transport.
- Trigger notes with pointer interaction on the keyboard.`
    },
    german: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Zum Umbenennen auf den Stift neben dem Gerätenamen klicken. Speichern/Enter übernimmt, Abbrechen/Escape verwirft den Entwurf. Ein Klick außerhalb speichert nicht. Namen dürfen nicht leer sein, höchstens 65 Unicode-Zeichen enthalten und weder HTML noch spitze Klammern verwenden. Sie müssen über alle sechs Gerätetypen der Performance eindeutig sein; Groß-/Kleinschreibung und äußere Leerzeichen werden dabei ignoriert. Die Schreibweise bleibt erhalten, auch beim Speichern/Laden und JSON/ZIP-Export/Import. Vorhandene importierte Namen bleiben bis zum Umbenennen erhalten.

Noten manuell spielen mit skalenbezogener Tastatur-Hervorhebung.

- Piano-Roll-Controller hinzufügen/entfernen.
- MIDI-Kanal, Grundton/Skala und Modus setzen.
- Jede Piano Roll separat starten/stoppen.
- Das Starten einer Piano Roll kann die Instrument-Engine starten, startet aber nicht den Arranger-Transport.
- Noten per Pointer auf der Tastatur auslösen.`
    },
    french: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Cliquez sur le stylo à droite du nom pour le modifier. Enregistrer/Entrée applique ; Annuler/Échap abandonne. Cliquer ailleurs ne sauvegarde pas. Le nom doit être non vide, comporter au maximum 65 caractères Unicode, sans HTML ni chevrons, et être unique parmi les six types d’appareils de la performance, sans tenir compte de la casse ni des espaces aux extrémités. La casse est conservée, ainsi que les noms lors de l’enregistrement, du chargement et de l’export/import JSON/ZIP. Les noms importés existants restent intacts jusqu’à leur modification.

Jouez des notes manuellement avec surbrillance selon la gamme.

- Ajouter/supprimer des contrôleurs piano roll.
- Définir canal MIDI, tonique/type de gamme et mode.
- Démarrer/arrêter chaque piano roll indépendamment.
- Demarrer un piano roll peut lancer le moteur instrument, mais ne lance pas le transport arrangeur.
- Déclencher des notes par interaction pointeur clavier.`
    },
    spanish: {
      title: "Piano Rolls",
      markdown: `## Piano Rolls

Haz clic en el lápiz a la derecha del nombre para editarlo. Guardar/Enter aplica; Cancelar/Escape descarta. Hacer clic fuera no guarda. El nombre no puede estar vacío, debe tener como máximo 65 caracteres Unicode, no puede contener HTML ni corchetes angulares y debe ser único entre los seis tipos de dispositivos de la performance, sin distinguir mayúsculas ni espacios en los extremos. Se conservan las mayúsculas y los nombres al guardar, cargar y exportar/importar JSON/ZIP. Los nombres importados existentes se mantienen hasta que se renombren.

Toca notas manualmente con resaltado según la escala.

- Agrega/elimina controladores piano roll.
- Ajusta canal MIDI, raíz/tipo de escala y modo.
- Inicia/detiene cada piano roll de forma independiente.
- Iniciar un piano roll puede iniciar el motor de instrumentos, pero no inicia el transporte del arreglador.
- Dispara notas con interacción de puntero en el teclado.`
    }
  },
  sequencer_midi_controllers: {
    english: {
      title: "MIDI Controllers",
      markdown: `## MIDI Controllers

Click the pen beside the device name to rename it. Save/Enter applies; Cancel/Escape discards. Clicking elsewhere does not save. Names must be nonempty, use at most 65 Unicode characters, contain no HTML or angle brackets, and be unique across all six device types in the performance (ignoring case and surrounding whitespace). Names retain their capitalization and survive save/load and JSON/ZIP export/import. Existing imported names remain intact until renamed.

Send MIDI CC messages from the sequencer page.

- Add up to 6 controller lanes.
- Set controller number (\`0..127\`).
- Adjust controller value with the knob.
- Start/stop each controller lane independently.
- Enabled lanes seed both CSD export modes at render start.`
    },
    german: {
      title: "MIDI Controller",
      markdown: `## MIDI Controller

Zum Umbenennen auf den Stift neben dem Gerätenamen klicken. Speichern/Enter übernimmt, Abbrechen/Escape verwirft den Entwurf. Ein Klick außerhalb speichert nicht. Namen dürfen nicht leer sein, höchstens 65 Unicode-Zeichen enthalten und weder HTML noch spitze Klammern verwenden. Sie müssen über alle sechs Gerätetypen der Performance eindeutig sein; Groß-/Kleinschreibung und äußere Leerzeichen werden dabei ignoriert. Die Schreibweise bleibt erhalten, auch beim Speichern/Laden und JSON/ZIP-Export/Import. Vorhandene importierte Namen bleiben bis zum Umbenennen erhalten.

Sendet MIDI-CC-Nachrichten von der Sequencer-Seite.

- Bis zu 6 Controller-Spuren hinzufügen.
- Controller-Nummer (\`0..127\`) festlegen.
- Controller-Wert mit dem Drehregler einstellen.
- Jede Controller-Spur separat starten/stoppen.
- Aktivierte Spuren initialisieren beide CSD-Exportmodi beim Renderstart.`
    },
    french: {
      title: "Contrôleurs MIDI",
      markdown: `## Contrôleurs MIDI

Cliquez sur le stylo à droite du nom pour le modifier. Enregistrer/Entrée applique ; Annuler/Échap abandonne. Cliquer ailleurs ne sauvegarde pas. Le nom doit être non vide, comporter au maximum 65 caractères Unicode, sans HTML ni chevrons, et être unique parmi les six types d’appareils de la performance, sans tenir compte de la casse ni des espaces aux extrémités. La casse est conservée, ainsi que les noms lors de l’enregistrement, du chargement et de l’export/import JSON/ZIP. Les noms importés existants restent intacts jusqu’à leur modification.

Envoi de messages MIDI CC depuis la page séquenceur.

- Ajouter jusqu'à 6 pistes de contrôleur.
- Définir le numéro de contrôleur (\`0..127\`).
- Ajuster la valeur avec le potentiomètre.
- Démarrer/arrêter chaque piste indépendamment.
- Les voies activees initialisent les deux modes d'export CSD au debut du rendu.`
    },
    spanish: {
      title: "Controladores MIDI",
      markdown: `## Controladores MIDI

Haz clic en el lápiz a la derecha del nombre para editarlo. Guardar/Enter aplica; Cancelar/Escape descarta. Hacer clic fuera no guarda. El nombre no puede estar vacío, debe tener como máximo 65 caracteres Unicode, no puede contener HTML ni corchetes angulares y debe ser único entre los seis tipos de dispositivos de la performance, sin distinguir mayúsculas ni espacios en los extremos. Se conservan las mayúsculas y los nombres al guardar, cargar y exportar/importar JSON/ZIP. Los nombres importados existentes se mantienen hasta que se renombren.

Envía mensajes MIDI CC desde la página del secuenciador.

- Agrega hasta 6 pistas de control.
- Define número de controlador (\`0..127\`).
- Ajusta el valor con la perilla.
- Inicia/detiene cada pista de forma independiente.
- Las pistas activadas inicializan ambos modos de export CSD al empezar el render.`
    }
  },
};

export const sequencerHelpAppendices: HelpDocumentAppendixSet<SequencerHelpDocId> = {
  sequencer_instrument_rack: {
    english: `### Rack Behavior

- Saving or loading a performance restores the full Perform-page state: rack assignments, sequencers, controller lanes, piano rolls, and arranger data.
- Patch/channel add/remove controls lock while the engine is running because changing the rack would invalidate the active runtime session.

### Transport And Session State

- Starting instruments builds the current rack into a live backend session.
- The state badge reflects the backend instrument engine, not only the arranger transport.
- Import/export writes the perform configuration as JSON/ZIP so a live setup can be moved to another machine.
- Both CSD modes include instruments assigned to melodic/drummer sequencers, piano-roll keyboards and arpeggiator output channels, even for stopped or empty devices, plus continuous instruments referenced by mixer routing, Master or inserts (including continuous generators with implicit direct output). Unused rack instances and their exclusive assets are omitted. Native Export keeps the complete rack.
- CSD comments contain instrument descriptions and instance references, routing endpoints and ports, Master/insert roles, direct-output bypasses, pre/post-fader taps and initial mixer settings.
- Each CSD starts with a header containing the performance title, description and creation timestamp, followed by an Orchestron attribution, a short feature introduction and the project GitHub link.
- \`Export CSD (MIDI)\` writes a separate offline render ZIP with the compiled performance CSD, arranger MIDI file, bundled assets, and exact Csound render instructions. \`Export CSD (SCORE)\` embeds notes and controller sweeps directly in the Csound score and omits the MIDI file. Both CSD render modes seed enabled manual MIDI Controller lane values at render start and write 32-bit float WAV output to preserve headroom.`,
    german: `### Rack-Verhalten

- Das Speichern oder Laden einer Performance stellt den kompletten Zustand der Perform-Seite wieder her: Rack-Zuordnungen, Sequencer, Controller-Spuren, Piano Rolls und Arranger-Daten.
- Patch-/Kanal-, Add- und Remove-Steuerungen sperren waehrend die Engine laeuft, weil Rack-Aenderungen die aktive Runtime-Session ungueltig machen wuerden.

### Transport und Session-Status

- Das Starten der Instrumente baut das aktuelle Rack als Live-Session im Backend auf.
- Das Status-Badge zeigt den Zustand der Backend-Instrument-Engine, nicht nur den Arranger-Transport.
- Import/Export schreibt die Perform-Konfiguration als JSON/ZIP, damit ein Live-Setup auf einen anderen Rechner uebertragen werden kann.
- Beide CSD-Modi enthalten Instrumente, die Melodie-/Drum-Sequencern, Piano-Roll-Keyboards oder Arpeggiator-Ausgangskanaelen zugeordnet sind, auch bei gestoppten oder leeren Geraeten, sowie kontinuierliche Instrumente im Mixer-Routing, Master oder Inserts (einschliesslich kontinuierlicher Generatoren mit implizitem Direktausgang). Unbenutzte Rack-Instanzen und ihre exklusiven Assets entfallen. Der native Export behaelt das gesamte Rack.
- CSD-Kommentare enthalten Instrumentbeschreibungen und Instanzreferenzen, Routing-Endpunkte und Ports, Master-/Insert-Rollen, Direktausgaenge am Master vorbei, Pre-/Post-Fader-Abgriffe und anfaengliche Mixer-Einstellungen.
- Jede CSD beginnt mit einem Header mit Performance-Titel, Beschreibung und Erstellungszeitpunkt, gefolgt von einem Orchestron-Hinweis, einer kurzen Funktionsbeschreibung und dem GitHub-Link des Projekts.
- \`Export CSD (MIDI)\` schreibt ein separates Offline-Render-ZIP mit der kompilierten Performance-CSD, der Arranger-MIDI-Datei, gebuendelten Assets und dem exakten Csound-Renderkommando. \`Export CSD (SCORE)\` bettet Noten und Controller-Sweeps direkt in die Csound-Score ein und laesst die MIDI-Datei weg. Beide CSD-Render-Modi initialisieren aktivierte manuelle MIDI-Controller-Spuren beim Renderstart und schreiben 32-bit-Float-WAV-Ausgabe, um Headroom zu erhalten.`,
    french: `### Comportement du rack

- Enregistrer ou charger une performance restaure tout l'etat de la page Perform : affectations du rack, sequenceurs, lanes de controle, piano rolls et donnees d'arrangeur.
- Les controles d'ajout/suppression et de patch/canal se verrouillent pendant l'execution, car modifier le rack invaliderait la session runtime active.

### Transport et etat de session

- Le demarrage des instruments construit le rack courant comme session live cote backend.
- Le badge d'etat reflete l'etat reel du moteur instrument backend, pas seulement le transport de l'arrangeur.
- L'import/export ecrit la configuration Perform en JSON/ZIP pour deplacer facilement un setup live vers une autre machine.
- Les deux modes CSD incluent les instruments affectes aux sequenceurs melodiques/de batterie, claviers piano-roll et canaux de sortie des arpegiateurs, meme pour des appareils arretes ou vides, ainsi que les instruments continus references par le routage du mixeur, le Master ou les inserts (y compris les generateurs continus avec sortie directe implicite). Les instances inutilisees et leurs assets exclusifs sont omis. L'export natif conserve tout le rack.
- Les commentaires CSD contiennent les descriptions et references des instruments, les extremites et ports du routage, les roles Master/insert, les sorties contournant le Master, les prises pre/post-fader et les reglages initiaux du mixeur.
- Chaque CSD commence par un en-tete contenant le titre, la description et l'horodatage de la performance, suivis d'une mention d'Orchestron, d'une breve presentation des fonctions et du lien GitHub du projet.
- \`Export CSD (MIDI)\` ecrit un ZIP de rendu hors ligne distinct avec la CSD compilee de la performance, le fichier MIDI de l'arrangeur, les assets inclus et la commande Csound exacte. \`Export CSD (SCORE)\` integre les notes et sweeps de controle directement dans la score Csound et omet le fichier MIDI. Les deux modes CSD initialisent les voies MIDI Controller manuelles activees au debut du rendu et ecrivent une sortie WAV float 32 bits pour conserver le headroom.`,
    spanish: `### Comportamiento del rack

- Guardar o cargar una performance restaura todo el estado de la pagina Perform: asignaciones del rack, secuenciadores, pistas de control, piano rolls y datos del arreglador.
- Los controles de patch/canal y de agregar/eliminar se bloquean mientras el motor esta ejecutandose porque un cambio del rack invalidaria la sesion runtime activa.

### Transporte y estado de sesion

- Iniciar los instrumentos construye el rack actual como una sesion en vivo en el backend.
- La insignia de estado refleja el motor de instrumentos del backend, no solo el transporte del arreglador.
- Importar/exportar escribe la configuracion Perform como JSON/ZIP para mover un setup en vivo a otra maquina.
- Ambos modos CSD incluyen instrumentos asignados a secuenciadores melodicos/de bateria, teclados piano-roll y canales de salida de arpegiadores, incluso con dispositivos detenidos o vacios, ademas de instrumentos continuos referenciados en el ruteo del mezclador, Master o inserts (incluidos generadores continuos con salida directa implicita). Se omiten las instancias sin usar y sus assets exclusivos. El export nativo conserva todo el rack.
- Los comentarios CSD contienen descripciones y referencias de instrumentos, extremos y puertos del ruteo, funciones Master/insert, salidas que evitan el Master, tomas pre/post-fader y ajustes iniciales del mezclador.
- Cada CSD empieza con un encabezado que incluye el titulo, la descripcion y la fecha y hora de la performance, seguido de una mencion de Orchestron, una breve presentacion de funciones y el enlace GitHub del proyecto.
- \`Export CSD (MIDI)\` escribe un ZIP de render offline separado con la CSD compilada de la performance, el archivo MIDI del arreglador, los assets incluidos y el comando exacto de Csound. \`Export CSD (SCORE)\` incrusta notas y barridos de control directamente en la partitura Csound y omite el archivo MIDI. Ambos modos CSD inicializan las pistas manuales MIDI Controller activadas al empezar el render y escriben salida WAV float de 32 bits para conservar headroom.`
  },
  sequencer_tracks: {
    english: `### Timing Model

- Steps are derived as \`beats * grid\`; a \`4\`-beat pad at grid \`4\` yields \`16\` editable steps.
- \`Sync To\` lets one sequencer follow another sequencer's cycle boundary instead of free-running against the shared transport.

### Step Programming Notes

- Pitch class and octave are edited separately to make note entry faster.
- In-scale notes are highlighted with degree labels, but chromatic notes stay available for borrowed tones and passing notes.
- Per-step chords include \`5\` for power chords; it is diatonic only when the root and perfect fifth both fit the current mode.
- \`HOLD\` sustains the previous note instead of sending a fresh note trigger on that step.`,
    german: `### Timing-Modell

- Die Schrittzahl ergibt sich aus \`beats * grid\`; ein \`4\`-Beat-Pad mit Raster \`4\` ergibt \`16\` bearbeitbare Schritte.
- \`Sync zu\` laesst einen Sequencer an der Zyklusgrenze eines anderen Sequencers folgen, statt frei gegen den gemeinsamen Transport zu laufen.

### Hinweise zur Step-Programmierung

- Tonklasse und Oktave werden getrennt bearbeitet, damit die Noteneingabe schneller geht.
- Skaleninterne Noten sind mit Stufen markiert; chromatische Noten bleiben fuer Borrowed Tones und Durchgangsnoten verfuegbar.
- Step-Akkorde enthalten \`5\` fuer Powerchords; dieser Akkord ist nur diatonisch, wenn Grundton und reine Quinte beide in den aktuellen Modus passen.
- \`HOLD\` verlaengert die vorherige Note, statt in diesem Schritt einen neuen Note-Trigger zu senden.`,
    french: `### Modele temporel

- Le nombre de pas vaut \`beats * grid\` ; un pad de \`4\` temps avec une grille \`4\` donne \`16\` pas editables.
- \`Sync vers\` permet a un sequenceur de suivre la frontiere de cycle d'un autre sequenceur au lieu de tourner librement sur le transport partage.

### Notes sur l'edition des pas

- La hauteur (classe) et l'octave se reglent separement, ce qui accelere la saisie des notes.
- Les notes dans la gamme sont surlignees avec leurs degres, mais les notes chromatiques restent disponibles pour les emprunts et notes de passage.
- Les accords par pas incluent \`5\` pour les power chords ; il est diatonique seulement si la fondamentale et la quinte juste correspondent toutes deux au mode actuel.
- \`HOLD\` prolonge la note precedente au lieu d'envoyer un nouveau declenchement sur ce pas.`,
    spanish: `### Modelo temporal

- Los pasos se derivan como \`beats * grid\`; un pad de \`4\` pulsos con cuadricula \`4\` produce \`16\` pasos editables.
- \`Sync con\` permite que un secuenciador siga el limite de ciclo de otro en lugar de correr libremente contra el transporte compartido.

### Notas sobre la programacion por pasos

- La clase de nota y la octava se editan por separado para agilizar la entrada.
- Las notas de la escala se resaltan con grados, pero las cromaticas siguen disponibles para notas prestadas y de paso.
- Los acordes por paso incluyen \`5\` para power chords; es diatonico solo cuando la raiz y la quinta justa encajan ambas en el modo actual.
- \`HOLD\` prolonga la nota anterior en vez de disparar una nota nueva en ese paso.`
  },
  sequencer_track_editor: {
    english: `### Editing One Sequencer Card

- \`Start\` and \`Stop\` control only this sequencer; Play starts the instrument engine when needed.
- \`Clear Steps\` resets the selected editing pad of this sequencer, not every pad in the performance.

### Pads And Copy Behavior

- #1..#8 are alternate pattern memories for the same sequencer.
- Dragging a step \`::\` handle copies note/chord/velocity data to another step, including across melodic sequencers.
- Short pad transpose keeps the current tonic and mode and shifts notes by scale degree; long press moves the pad tonic itself.`,
    german: `### Eine Sequencer-Karte bearbeiten

- \`Start\` und \`Stop\` steuern nur diesen Sequencer; Play startet die Instrument-Engine bei Bedarf.
- \`Clear Steps\` setzt nur das zur Bearbeitung ausgewählte Pattern-Pad dieses Sequencers zurueck, nicht alle Pads der Performance.

### Pad- und Kopierverhalten

- #1..#8 sind alternative Pattern-Speicher fuer denselben Sequencer.
- Das Ziehen eines Schritt-\`::\`-Handles kopiert Noten-/Akkord-/Velocity-Daten auf einen anderen Schritt, auch ueber mehrere melodische Sequencer hinweg.
- Kurze Pad-Transposition behaelt Tonika und Modus bei und verschiebt Noten nach Skalenstufen; langer Druck verschiebt die Tonika des Pads selbst.`,
    french: `### Edition d'une carte de sequenceur

- \`Start\` et \`Stop\` commandent seulement ce séquenceur ; Play démarre le moteur audio si nécessaire.
- \`Clear Steps\` reinitialise uniquement le pad de pattern actif de ce sequenceur, pas tous les pads de la performance.

### Comportement des pads et copies

- #1..#8 sont des memoires de pattern alternatives pour le meme sequenceur.
- Faire glisser la poignee \`::\` d'un pas copie les donnees note/accord/velocite vers un autre pas, y compris entre sequenceurs melodiques.
- Une transposition courte conserve tonique et mode et deplace les notes par degre ; un appui long deplace la tonique du pad elle-meme.`,
    spanish: `### Edicion de una tarjeta de secuenciador

- \`Start\` y \`Stop\` controlan solo este secuenciador; Play inicia el motor de audio cuando es necesario.
- \`Clear Steps\` reinicia solo el pad de patron activo de este secuenciador, no todos los pads de la performance.

### Comportamiento de pads y copias

- #1..#8 son memorias alternativas de patron para el mismo secuenciador.
- Arrastrar el asa \`::\` de un paso copia datos de nota/acorde/velocidad a otro paso, incluso entre secuenciadores melodicos.
- La transposicion corta mantiene tonica y modo y mueve las notas por grado; la pulsacion larga mueve la tonica del propio pad.`
  },
  sequencer_drummer_sequencer: {
    english: `### Row And Hit Model

- Each row is one fixed MIDI note number. Use separate rows for kick, snare, hat, or any drum mapping your target instrument expects.
- Changing a row key while instruments are running sends a short preview note on that drummer sequencer's MIDI channel.
- Velocity is stored per active hit, so two hits in the same column can have different strengths.

### Timing And Pads

- Drummer pads do not use scale, chord, or transpose controls.`,
    german: `### Zeilen- und Hit-Modell

- Jede Zeile ist genau eine feste MIDI-Notennummer. Verwende getrennte Zeilen fuer Kick, Snare, Hi-Hat oder jede andere Drum-Zuordnung des Zielinstruments.
- Das Aendern eines Row-Keys sendet waehrend laufender Instrumente eine kurze Vorschau-Note auf dem MIDI-Kanal dieses Drummer-Sequencers.
- Velocity wird pro aktivem Hit gespeichert, sodass zwei Hits in derselben Spalte unterschiedliche Staerken haben koennen.

### Timing und Pads

- Drummer-Pads verwenden keine Skalen-, Akkord- oder Transpositionssteuerungen.`,
    french: `### Modele des lignes et impacts

- Chaque ligne correspond a un numero de note MIDI fixe. Utilisez des lignes distinctes pour kick, caisse claire, charley ou tout mapping batterie attendu par l'instrument cible.
- Modifier une touche de ligne pendant que les instruments tournent envoie une courte note de preecoute sur le canal MIDI de ce sequenceur batterie.
- La velocite est stockee pour chaque impact actif ; deux impacts dans la meme colonne peuvent donc avoir des intensites differentes.

### Timing et pads

- Les pads batterie n'utilisent ni gamme, ni accords, ni commandes de transposition.`,
    spanish: `### Modelo de filas y golpes

- Cada fila corresponde a un numero de nota MIDI fijo. Usa filas separadas para bombo, caja, hi-hat o cualquier mapeo de bateria que espere el instrumento destino.
- Cambiar la tecla de una fila mientras los instrumentos estan en marcha envia una nota corta de vista previa por el canal MIDI de ese secuenciador de bateria.
- La velocidad se guarda por golpe activo, asi que dos golpes en la misma columna pueden tener intensidades distintas.

### Timing y pads

- Los pads de bateria no usan controles de escala, acorde ni transposicion.`
  },
  sequencer_controller_sequencer: {
    english: `### Curve Playback

- The selected controller number is sent repeatedly from the sampled curve while this lane is running.

### Editing Rules

Edits to the displayed pad are combined after 80 ms and take effect at the next engine block without resetting transport. If preparation fails, the previous configuration keeps playing and your edit remains local; make another edit or restart to retry.

- Click the background to add an interior point, drag points to reshape the curve, and double-click an interior point to remove it.
- The first and last points act as boundary anchors so the loop always has a defined start and end.
- If the same CC is driven from multiple sources, the latest transmitted value wins at the receiver.`,
    german: `### Kurven-Wiedergabe

- Die gewaehlte Controller-Nummer wird waehrend des Laufens dieser Spur fortlaufend aus der gesampelten Kurve gesendet.
- Die Kurvenlaenge aendert die Loop-Dauer, aber Keypoints behalten ihre relative Position ueber die gesamte Laenge.

### Bearbeitungsregeln

Aenderungen am angezeigten Pad werden nach 80 ms zusammengefasst und beim naechsten Engine-Block ohne Transport-Neustart wirksam. Bei einem Fehler spielt die bisherige Konfiguration weiter; die Aenderung bleibt lokal. Erneut bearbeiten oder neu starten, um es nochmals zu versuchen.

- Hintergrund anklicken, um einen inneren Punkt hinzuzufuegen; Punkte ziehen, um die Kurve zu formen; einen inneren Punkt doppelklicken, um ihn zu entfernen.
- Der erste und letzte Punkt sind Randanker, sodass die Schleife immer einen definierten Start und ein definiertes Ende hat.
- Wenn dieselbe CC von mehreren Quellen gesteuert wird, gewinnt am Empfaenger der zuletzt gesendete Wert.`,
    french: `### Lecture de courbe

- Le numero de controleur choisi est emis en continu depuis la courbe echantillonnee tant que cette piste tourne.
- La longueur de courbe change la duree de boucle, mais les points-cles gardent leur position relative sur toute la plage.

### Regles d'edition

Les modifications du pad affiche sont regroupees apres 80 ms et appliquees au prochain bloc audio sans reinitialiser le transport. En cas d'echec, la configuration precedente continue et la modification reste locale ; modifiez a nouveau ou redemarrez pour reessayer.

- Cliquez sur le fond pour ajouter un point interieur, faites glisser les points pour remodeler la courbe et double-cliquez un point interieur pour le supprimer.
- Le premier et le dernier point servent d'ancrages de bord, de sorte que la boucle garde toujours un debut et une fin definis.
- Si le meme CC est pilote par plusieurs sources, c'est la valeur envoyee en dernier qui gagne cote recepteur.`,
    spanish: `### Reproduccion de la curva

- El numero de controlador elegido se envia de forma continua desde la curva muestreada mientras esta pista esta en marcha.
- La longitud de la curva cambia la duracion del bucle, pero los puntos clave mantienen su posicion relativa en todo el tramo.

### Reglas de edicion

Los cambios del pad mostrado se agrupan tras 80 ms y se aplican en el siguiente bloque de audio sin reiniciar el transporte. Si falla la preparacion, sigue sonando la configuracion anterior y el cambio queda local; edita de nuevo o reinicia para reintentar.

- Haz clic en el fondo para agregar un punto interior, arrastra puntos para remodelar la curva y haz doble clic en un punto interior para eliminarlo.
- El primer y el ultimo punto actuan como anclas de borde, de modo que el bucle siempre tiene un inicio y un final definidos.
- Si el mismo CC esta controlado por varias fuentes, en el receptor prevalece el ultimo valor transmitido.`
  },
  sequencer_piano_rolls: {
    english: `### Live Input Behavior

- A piano roll only sends notes when its own lane is enabled and the instrument engine is running; its Start control can bring up the engine without starting the arranger transport.
- Use the MIDI channel to target one rack instrument. Each MIDI-driven rack instrument requires a unique channel.
- The on-screen keyboard spans \`C1..B7\` and uses pointer press/release gestures for note on/off.

### Scale Guidance

- The keyboard highlights notes from the selected scale and mode.
- When running melodic sequencers agree on one theory, the piano roll follows that shared scale/mode for visual guidance.
- When running sequencers disagree, the UI shows a mixed state and highlights only notes common to the active theories.`,
    german: `### Live-Eingabeverhalten

- Eine Piano Roll sendet nur dann Noten, wenn ihre eigene Spur aktiviert ist und die Instrument-Engine laeuft; ihr Start-Button kann die Engine starten, ohne den Arranger-Transport zu starten.
- Ueber den MIDI-Kanal wird ein Rack-Instrument angesteuert. Jedes MIDI-gesteuerte Rack-Instrument braucht einen eigenen Kanal.
- Die Onscreen-Tastatur reicht von \`C1..B7\` und nutzt Pointer-Press/Release fuer Note On/Off.

### Skalenfuehrung

- Die Tastatur markiert Noten der ausgewaehlten Skala und des Modus.
- Wenn laufende melodische Sequencer dieselbe Theorie teilen, folgt die Piano Roll dieser gemeinsamen Skala/diesem Modus als visuelle Orientierung.
- Wenn laufende Sequencer unterschiedliche Theorien haben, zeigt die UI einen Mixed-Zustand und markiert nur die gemeinsamen Noten der aktiven Theorien.`,
    french: `### Comportement en entree live

- Un piano roll n'envoie des notes que si sa propre voie est active et que le moteur instrument tourne ; son bouton Start peut lancer le moteur sans lancer le transport arrangeur.
- Utilisez le canal MIDI pour viser un instrument du rack. Chaque instrument pilote par MIDI doit avoir son propre canal.
- Le clavier a l'ecran couvre \`C1..B7\` et utilise des gestes de pression/relachement du pointeur pour les note on/off.

### Guidage tonal

- Le clavier surligne les notes de la gamme et du mode selectionnes.
- Quand les sequenceurs melodiques actifs partagent la meme theorie, le piano roll suit cette gamme/ce mode communs pour le guidage visuel.
- Quand les sequenceurs actifs divergent, l'UI affiche un etat mixte et ne surligne que les notes communes aux theories actives.`,
    spanish: `### Comportamiento de entrada en vivo

- Un piano roll solo envia notas cuando su propia pista esta activada y el motor de instrumentos esta en marcha; su control Start puede iniciar el motor sin iniciar el transporte del arreglador.
- Usa el canal MIDI para apuntar a un instrumento del rack. Cada instrumento controlado por MIDI necesita un canal propio.
- El teclado en pantalla cubre \`C1..B7\` y utiliza gestos de pulsar/soltar con el puntero para note on/off.

### Guia tonal

- El teclado resalta las notas de la escala y el modo seleccionados.
- Cuando los secuenciadores melodicos en marcha comparten una misma teoria, el piano roll sigue esa escala/modo comun para guiar visualmente.
- Cuando los secuenciadores activos discrepan, la UI muestra un estado mixto y solo resalta las notas comunes a las teorias activas.`
  },
  sequencer_midi_controllers: {
    english: `### Manual CC Lanes

- This panel is for hands-on CC control, not repeating automation. Use controller sequencers when you need transport-synced curves.
- Each lane targets one MIDI controller number (\`0..127\`) and can be enabled or disabled independently.
- The knob and numeric readout edit the same live value, so you can make broad sweeps and still land on exact numbers.

### When Messages Are Sent

- CC messages are sent immediately when the instrument session is running and the lane is enabled.
- Up to six lanes can coexist, which is useful for filter, resonance, mix, or macro controls in one performance.
- Destinations on selected MIDI channels that listen to the same CC mapping react to the transmitted value.
- Both CSD exports include enabled lane values at render start so \`midictrl\` patches start from the same manual CC state.`,
    german: `### Manuelle CC-Spuren

- Dieses Panel ist fuer direkte CC-Steuerung gedacht, nicht fuer wiederholte Automation. Fuer transport-synchrone Kurven sind Controller-Sequencer gedacht.
- Jede Spur steuert genau eine MIDI-Controller-Nummer (\`0..127\`) und kann unabhaengig aktiviert oder deaktiviert werden.
- Drehregler und Zahlenanzeige bearbeiten denselben Live-Wert, sodass weite Sweeps und trotzdem exakte Zielwerte moeglich sind.

### Wann Nachrichten gesendet werden

- CC-Nachrichten werden sofort gesendet, wenn die Instrument-Session laeuft und die Spur aktiviert ist.
- Bis zu sechs Spuren koennen parallel existieren; das ist praktisch fuer Filter-, Resonanz-, Mix- oder Macro-Steuerungen in einer Performance.
- Ziele auf den ausgewählten MIDI-Kanälen mit derselben CC-Zuordnung reagieren auf den gesendeten Wert.
- Beide CSD-Exporte uebernehmen aktivierte Spurwerte beim Renderstart, damit \`midictrl\`-Patches mit demselben manuellen CC-Zustand starten.`,
    french: `### Voies CC manuelles

- Ce panneau sert au controle CC direct, pas a l'automation repetee. Utilisez les sequenceurs controleur quand vous avez besoin de courbes synchronisees au transport.
- Chaque voie cible un seul numero de controleur MIDI (\`0..127\`) et peut etre activee ou desactivee independamment.
- Le potentiometre et l'affichage numerique modifient la meme valeur live, ce qui permet de grands sweeps tout en retombant sur des chiffres precis.

### Quand les messages sont envoyes

- Les messages CC partent immediatement quand la session instrument tourne et que la voie est activee.
- Jusqu'a six voies peuvent coexister, utile pour des controles de filtre, resonance, mix ou macro dans une meme performance.
- Les destinations sur les canaux MIDI cochés avec le même mapping CC réagissent à la valeur transmise.
- Les deux exports CSD incluent les valeurs des voies activees au debut du rendu afin que les patches \`midictrl\` partent du meme etat CC manuel.`,
    spanish: `### Pistas CC manuales

- Este panel sirve para control CC directo, no para automatizacion repetitiva. Usa secuenciadores controladores cuando necesites curvas sincronizadas al transporte.
- Cada pista apunta a un solo numero de controlador MIDI (\`0..127\`) y puede activarse o desactivarse de forma independiente.
- La perilla y la lectura numerica editan el mismo valor en vivo, de modo que puedes hacer barridos amplios y aun asi caer en numeros exactos.

### Cuando se envian los mensajes

- Los mensajes CC se envian inmediatamente cuando la sesion de instrumentos esta en marcha y la pista esta activada.
- Pueden coexistir hasta seis pistas, lo que resulta util para controles de filtro, resonancia, mezcla o macros dentro de una misma performance.
- Los destinos en los canales MIDI marcados con el mismo mapeo CC reaccionan al valor transmitido.
- Ambos exports CSD incluyen los valores de las pistas activadas al empezar el render para que los patches \`midictrl\` arranquen con el mismo estado CC manual.`
  },
};

for (const language of ["english", "german", "french", "spanish"] as const) {
  const appendix = sequencerHelpAppendices.sequencer_instrument_rack;
  if (appendix) appendix[language] = (appendix[language] ?? "") + "\n\n" + audioRoutingHelp[language];
}

for (const language of ["english", "german", "french", "spanish"] as const) {
  sequencerHelpAppendices.sequencer_instrument_rack![language] += "\n\n" + performanceControllerHelp[language];
}

for (const language of ["english", "german", "french", "spanish"] as const) {
  for (const id of ["sequencer_instrument_rack", "sequencer_tracks", "sequencer_drummer_sequencer", "sequencer_controller_sequencer", "sequencer_arpeggiator", "sequencer_piano_rolls", "sequencer_midi_controllers", "sequencer_multitrack_arranger"] as const) {
    sequencerHelpDocuments[id][language].markdown += "\n\n" + collapsiblePanelHelp[language].perform;
  }
  sequencerHelpDocuments.sequencer_instrument_rack[language].markdown += "\n\n" + collapsiblePanelHelp[language].rack;
}


const controllerChannelHelp = {
  english: `### MIDI Channels

Check the channels that receive this device's CC messages. All 16 are checked by default (OMNI), including when loading older performances. At least one must remain checked. Selections are saved and included in native JSON/ZIP and both CSD exports.

Controller sequencers show 1–16 beside Clear Steps in one scrolling row; the selection applies to all pads. Channel edits follow the 80 ms live-edit path without resetting transport or queued pads. Manual controllers show 1–8 above 9–16 at the top right; changing channels while enabled immediately sends the current value to the new selection. Removed channels retain their last value.`,
  german: `### MIDI-Kanäle

Die Kanäle auswählen, die CC-Nachrichten dieses Geräts empfangen sollen. Standardmäßig sind alle 16 ausgewählt (OMNI), auch beim Laden älterer Performances. Mindestens einer muss ausgewählt bleiben. Die Auswahl wird gespeichert und in native JSON/ZIP- sowie beide CSD-Exporte übernommen.

Controller-Sequencer zeigen 1–16 neben „Steps loeschen“ in einer horizontal scrollbaren Zeile; die Auswahl gilt für alle Pads. Kanaländerungen folgen dem 80-ms-Live-Edit-Ablauf ohne Transport oder vorgemerkte Pads zurückzusetzen. Manuelle Controller zeigen oben rechts 1–8 über 9–16; bei aktivem Controller wird der aktuelle Wert sofort an die neue Auswahl gesendet. Abgewählte Kanäle behalten ihren letzten Wert.`,
  french: `### Canaux MIDI

Cochez les canaux qui reçoivent les messages CC de cet appareil. Les 16 sont cochés par défaut (OMNI), y compris au chargement des anciennes performances. Au moins un doit rester coché. La sélection est enregistrée et incluse dans les exports natifs JSON/ZIP et les deux exports CSD.

Les séquenceurs contrôleur affichent 1–16 près de « Effacer pas », sur une ligne à défilement horizontal ; la sélection s'applique à tous les pads. Les changements suivent le délai de 80 ms sans réinitialiser le transport ni les pads en attente. Les contrôleurs manuels affichent 1–8 au-dessus de 9–16 en haut à droite ; changer les canaux pendant leur activation envoie immédiatement la valeur actuelle à la nouvelle sélection. Les canaux décochés conservent leur dernière valeur.`,
  spanish: `### Canales MIDI

Marca los canales que reciben los mensajes CC de este dispositivo. Los 16 están marcados por defecto (OMNI), también al cargar performances antiguas. Al menos uno debe permanecer marcado. La selección se guarda y se incluye en los exports nativos JSON/ZIP y en ambos exports CSD.

Los secuenciadores controladores muestran 1–16 junto a « Limpiar pasos » en una fila con desplazamiento horizontal; la selección se aplica a todos los pads. Los cambios siguen el flujo de edición de 80 ms sin reiniciar el transporte ni los pads en cola. Los controladores manuales muestran 1–8 sobre 9–16 arriba a la derecha; cambiar los canales mientras están activados envía el valor actual inmediatamente a la nueva selección. Los canales desmarcados conservan su último valor.`
};

for (const language of ["english", "german", "french", "spanish"] as const) {
  for (const id of ["sequencer_controller_sequencer", "sequencer_midi_controllers"] as const) {
    sequencerHelpDocuments[id][language].markdown += "\n\n" + controllerChannelHelp[language];
  }
}

const noteTimingHelp = {
  english: `### Early / late timing

Move notes, chords or drum hits by −50% to +50% of a local step. Timing scales with tempo; the readout also shows milliseconds. Melodic steps have a slider, percentage field and reset. Drag drum hits left/right for timing and up/down for velocity; the first direction locks the edit. Left/Right arrows adjust timing. Right-click or Shift+F10 opens precise controls.

Note length and HOLD extensions move with the attack; the next attack can shorten an overlapping note. Early step 1 anticipates same-pad repeats but plays at the boundary on fresh starts or different-pad launches. Stops, pauses and finite endings suppress anticipation. Copying preserves timing; Clear Steps resets it. Inactive hits retain their setting. Saves, native bundles and both CSD exports preserve timing.`,
  german: `### Frühes / spätes Timing

Noten, Akkorde oder Drum-Schläge um −50% bis +50% eines lokalen Schritts verschieben. Timing folgt dem Tempo; die Anzeige zeigt auch Millisekunden. Melodie-Schritte haben Schieberegler, Prozentfeld und Reset. Drum-Schläge links/rechts für Timing, hoch/runter für Anschlagstärke ziehen; die erste Richtung legt den Parameter fest. Links/Rechts-Pfeile ändern Timing. Rechtsklick oder Shift+F10 öffnet genaue Regler.

Notenlänge und HOLD-Verlängerungen werden mitverschoben; der nächste Anschlag kann eine überlappende Note kürzen. Ein früher erster Schritt wird bei Wiederholung desselben Pads vorgezogen, bei Neustart oder Pad-Wechsel an der Grenze gespielt. Stopps, Pausen und endliche Enden verhindern das Vorziehen. Kopieren erhält Timing, Schritte löschen setzt es zurück. Inaktive Schläge behalten den Wert. Speichern, native Bundles und beide CSD-Exporte erhalten Timing.`,
  french: `### Placement en avance / en retard

Décalez notes, accords ou frappes de −50% à +50% d'un pas local. Le placement suit le tempo ; l'affichage indique aussi les millisecondes. Les pas mélodiques ont un curseur, un champ de pourcentage et une réinitialisation. Glissez les frappes gauche/droite pour le placement, haut/bas pour la vélocité ; la première direction fixe le paramètre. Les flèches gauche/droite règlent le placement. Clic droit ou Shift+F10 ouvre les réglages précis.

La durée et les prolongations HOLD suivent l'attaque ; l'attaque suivante peut raccourcir une note qui chevauche. Un premier pas anticipé précède la répétition du même pad, mais joue à la limite au démarrage ou lors d'un changement de pad. Arrêts, pauses et fins empêchent l'anticipation. La copie conserve le placement ; effacer les pas le réinitialise. Les frappes inactives gardent leur valeur. Sauvegardes, bundles natifs et les deux exports CSD conservent le placement.`,
  spanish: `### Tiempo adelantado / retrasado

Desplaza notas, acordes o golpes entre −50% y +50% de un paso local. El tiempo sigue el tempo; la lectura también muestra milisegundos. Los pasos melódicos tienen deslizador, porcentaje y reinicio. Arrastra golpes izquierda/derecha para tiempo, arriba/abajo para velocidad; la primera dirección fija el parámetro. Las flechas izquierda/derecha ajustan el tiempo. Clic derecho o Shift+F10 abre controles precisos.

La duración y extensiones HOLD se desplazan con el ataque; el siguiente ataque puede acortar una nota solapada. El primer paso adelantado anticipa repeticiones del mismo pad, pero suena en el límite al iniciar o cambiar de pad. Paradas, pausas y finales impiden anticipar. Copiar conserva el tiempo; borrar pasos lo restablece. Los golpes inactivos conservan su valor. Guardados, bundles nativos y ambos exports CSD conservan el tiempo.`
};
for (const language of ["english", "german", "french", "spanish"] as const) {
  for (const id of ["sequencer_tracks", "sequencer_drummer_sequencer"] as const) {
    sequencerHelpDocuments[id][language].markdown += "\n\n" + noteTimingHelp[language];
  }
}

for (const language of ["english", "german", "french", "spanish"] as const) {
  for (const id of ["sequencer_tracks", "sequencer_track_editor", "sequencer_drummer_sequencer", "sequencer_controller_sequencer", "sequencer_arpeggiator"] as const) {
    sequencerHelpDocuments[id][language].markdown += "\n\n" + arrangementHelp[language];
  }
}

for (const language of ["english", "german", "french", "spanish"] as const) {
  for (const id of ["sequencer_tracks", "sequencer_track_editor", "sequencer_drummer_sequencer", "sequencer_controller_sequencer", "sequencer_arpeggiator"] as const) {
    sequencerHelpDocuments[id][language].markdown += "\n\n" + patternWorkspaceHelp[language];
  }
}

for (const language of ["english", "german", "french", "spanish"] as const) {
  for (const id of ["sequencer_tracks", "sequencer_drummer_sequencer", "sequencer_controller_sequencer", "sequencer_arpeggiator", "sequencer_multitrack_arranger"] as const) {
    sequencerHelpDocuments[id][language].markdown += "\n\n" + independentPlaybackHelp[language];
  }
}

for (const language of ["english", "german", "french", "spanish"] as const) {
  for (const id of ["sequencer_tracks", "sequencer_drummer_sequencer", "sequencer_controller_sequencer", "sequencer_track_editor"] as const) {
    sequencerHelpDocuments[id][language].markdown += "\n\n" + sequencerTimingHelp[language];
  }
}
