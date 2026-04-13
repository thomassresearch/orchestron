import type { HelpDocumentAppendixSet, HelpDocumentSet, SequencerHelpDocId } from "./helpDocumentationTypes";

export const sequencerHelpDocuments: HelpDocumentSet<SequencerHelpDocId> = {
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
      title: "Melodic Sequencers",
      markdown: `## Melodic Sequencers

Program step-based melodic or rhythmic patterns.

- Add/remove melodic sequencers.
- Set MIDI channel, scale, mode, and adjust each melodic sequencer's own meter/grid timing plus beat ratio.
- Synchronize a melodic sequencer to another melodic sequencer with \`Sync To\`.
- Reorder melodic sequencers by dragging the \`::\` handle on each sequencer card.
- Use pattern pads (P1..P8) for queued pattern changes on running sequencers and instant pattern edits on stopped sequencers.
- Copy a pattern pad by dragging one pad and dropping it onto another pad (copies notes and pad scale/mode settings).
- \`Beat Ratio\` changes how fast each sequencer advances against the shared transport without changing the stored pad length, meter, or grid.
- Pad edge transpose buttons (\`-\` / \`+\`):
- Short click: transpose the stored notes to the previous/next degree within the current scale (scale root and mode stay the same), and update configured step chords to matching diatonic chord types for the transposed step when available.
- Long press: move the pad tonic to the previous/next degree (key-step transpose), keep the mode, and update the pad scale root.
- Set per-step notes or rests.
- Drag a step \`::\` handle onto another step (including steps in other melodic sequencers) to copy step note/chord/velocity settings.
- Control global BPM and running state.`
    },
    german: {
      title: "Melodische Sequencer",
      markdown: `## Melodische Sequencer

Programmiert schrittbasierte melodische oder rhythmische Patterns.

- Melodische Sequencer hinzufuegen/entfernen.
- MIDI-Kanal, Skala, Modus, Takt-/Raster-Zeitbasis und Beat-Verhaeltnis jedes melodischen Sequencers setzen.
- Einen melodischen Sequencer ueber \`Sync zu\` mit einem anderen melodischen Sequencer synchronisieren.
- Reihenfolge der melodischen Sequencer per Drag-and-drop am \`::\`-Handle jeder Sequencer-Karte aendern.
- Pattern-Pads (P1..P8) fuer geplante Pattern-Wechsel bei laufenden Sequencern und fuer sofortige Pad-Wechsel bei gestoppten Sequencern nutzen.
- Ein Pattern-Pad per Drag-and-drop auf ein anderes Pad ziehen, um es zu kopieren (kopiert Noten sowie Pad-Skala/Modus-Einstellungen).
- Das Beat-Verhaeltnis aendert nur die Abspielgeschwindigkeit gegenueber dem gemeinsamen Transport; gespeicherte Pad-Laenge, Taktart und Raster bleiben gleich.
- Transpositions-Tasten am Pad-Rand (\`-\` / \`+\`):
- Kurzer Klick: gespeicherte Noten zur vorherigen/nächsten Stufe innerhalb der aktuellen Skala verschieben (Grundton und Modus bleiben gleich) und konfigurierte Step-Akkorde auf passende diatonische Akkordtypen für den transponierten Schritt aktualisieren (falls verfügbar).
- Langer Klick: Tonika zur vorherigen/nächsten Stufe verschieben (Key-Step-Transpose), Modus beibehalten und Pad-Grundton der Skala aktualisieren.
- Pro Schritt Noten oder Pausen setzen.
- Einen Schritt am \`::\`-Handle auf einen anderen Schritt ziehen (auch in anderen melodischen Sequencern), um Noten-/Akkord-/Velocity-Einstellungen zu kopieren.
- Globales BPM und Laufstatus steuern.`
    },
    french: {
      title: "Sequenceurs melodiques",
      markdown: `## Sequenceurs melodiques

Programme des patterns mélodiques ou rythmiques par pas.

- Ajouter/supprimer des sequenceurs melodiques.
- Regler canal MIDI, gamme, mode, mesure/grille et ratio de temps propres a chaque sequenceur melodique.
- Synchroniser un sequenceur melodique a un autre via \`Sync vers\`.
- Reordonner les sequenceurs melodiques par glisser-deposer avec la poignee \`::\` de chaque carte.
- Utiliser les pads P1..P8 pour file d'attente sur les sequenceurs en lecture et changement immediat sur les sequenceurs arretes.
- Copier un pad de pattern en le glissant-deposant sur un autre pad (copie les notes et les réglages de gamme/mode du pad).
- Le ratio de temps change seulement la vitesse de lecture face au transport partage ; la longueur stockee du pad, la mesure et la grille restent identiques.
- Boutons de transposition sur le bord du pad (\`-\` / \`+\`) :
- Clic court : transpose les notes stockées vers le degré précédent/suivant dans la gamme actuelle (tonique et mode inchangés) et met à jour les accords de pas configurés vers des types d'accords diatoniques correspondants pour le pas transposé quand c'est possible.
- Appui long : déplace la tonique du pad vers le degré précédent/suivant (transposition par degré), conserve le mode et met à jour la tonique de la gamme du pad.
- Définir note ou silence par pas.
- Glisser la poignee \`::\` d'un pas sur un autre pas (y compris dans un autre sequenceur melodique) pour copier les reglages note/accord/velocite du pas.
- Contrôler BPM global et état de lecture.`
    },
    spanish: {
      title: "Secuenciadores melodicos",
      markdown: `## Secuenciadores melodicos

Programa patrones melódicos o rítmicos por pasos.

- Agrega/elimina secuenciadores melodicos.
- Ajusta canal MIDI, escala, modo, metrica/cuadricula y relacion de pulso propias de cada secuenciador melodico.
- Sincroniza un secuenciador melodico con otro usando \`Sync con\`.
- Reordena los secuenciadores melodicos arrastrando el asa \`::\` en cada tarjeta.
- Usa pads P1..P8 para cambios en cola en secuenciadores en reproduccion y cambios inmediatos en secuenciadores detenidos.
- Copia un pad de patrón arrastrándolo y soltándolo sobre otro pad (copia notas y ajustes de escala/modo del pad).
- La relacion de pulso solo cambia la velocidad frente al transporte compartido; la longitud guardada del pad, el compas y la cuadricula no cambian.
- Botones de transposición en el borde del pad (\`-\` / \`+\`):
- Clic corto: transpone las notas guardadas al grado anterior/siguiente dentro de la escala actual (la raíz y el modo no cambian) y actualiza los acordes configurados del paso a tipos de acorde diatónicos correspondientes para el paso transpuesto cuando sea posible.
- Pulsación larga: mueve la tónica del pad al grado anterior/siguiente (transposición por grado), mantiene el modo y actualiza la raíz de la escala del pad.
- Define nota o silencio por paso.
- Arrastra el asa \`::\` de un paso sobre otro paso (incluyendo pasos de otros secuenciadores melodicos) para copiar ajustes de nota/acorde/velocidad.
- Controla BPM global y estado de reproducción.`
    }
  },
  sequencer_track_editor: {
    english: {
      title: "Melodic Sequencer",
      markdown: `## Melodic Sequencer

This help applies to one melodic sequencer card.

- Start/stop the sequencer independently (instrument transport must be running to start).
- Set MIDI channel, \`Sync To\` target, scale root/type, and mode for note generation.
- Use this sequencer's meter/grid timing, beat ratio, and pattern-pad length in beats (\`1..8\`), including the current meter numerator when needed.
- Drag the sequencer \`::\` handle in the header to reorder melodic sequencers in the panel.
- Clear all steps for the current sequencer.
- Use pattern pads (P1..P8) to queue changes for a running sequencer or switch immediately when that sequencer is stopped.
- \`Beat Ratio\` changes playback speed against the shared transport while keeping the stored pad length, meter, and grid unchanged.
- Use pad transpose buttons for short-click degree transpose (also remaps configured step chords to matching diatonic chord types when available) and long-press tonic/key-step transpose.
- Edit each step note, hold state, and velocity.
- Drag a step \`::\` handle onto another step (same sequencer or another melodic sequencer) to copy step note/chord/velocity settings.`
    },
    german: {
      title: "Melodischer Sequencer",
      markdown: `## Melodischer Sequencer

Diese Hilfe gilt fuer eine einzelne Karte eines melodischen Sequencers.

- Sequencer separat starten/stoppen (zum Starten muss der Instrument-Transport laufen).
- MIDI-Kanal, \`Sync zu\`-Ziel, Skalen-Grundton/-Typ und Modus für die Notenerzeugung setzen.
- Die Takt-/Raster-Zeitbasis, das Beat-Verhaeltnis und die Pattern-Pad-Laenge in Beats dieses melodischen Sequencers nutzen (\`1..8\`), bei Bedarf direkt inklusive des aktuellen Taktzaehlers.
- Das \`::\`-Handle in der Kopfzeile ziehen, um melodische Sequencer im Panel umzusortieren.
- Alle Schritte dieses Sequencers loeschen.
- Pattern-Pads (P1..P8) verwenden, um laufende Sequencer vorzumerken oder gestoppte Sequencer sofort umzuschalten.
- Das Beat-Verhaeltnis aendert nur die Abspielgeschwindigkeit gegenueber dem gemeinsamen Transport; gespeicherte Pad-Laenge, Taktart und Raster bleiben gleich.
- Pad-Transpositionsknöpfe für kurzen Klick (Stufentransposition; aktualisiert konfigurierte Step-Akkorde wenn möglich auf passende diatonische Akkordtypen) und langen Druck (Tonika/Key-Step-Transpose) nutzen.
- Pro Schritt Note, Hold-Zustand und Velocity bearbeiten.
- Einen Schritt am \`::\`-Handle auf einen anderen Schritt ziehen (gleicher oder anderer melodischer Sequencer), um Noten-/Akkord-/Velocity-Einstellungen zu kopieren.`
    },
    french: {
      title: "Sequenceur melodique",
      markdown: `## Sequenceur melodique

Cette aide s'applique a une carte individuelle de sequenceur melodique.

- Demarrer/arreter le sequenceur independamment (le transport instrument doit etre actif pour demarrer).
- Régler canal MIDI, cible \`Sync vers\`, tonique/type de gamme et mode pour la génération de notes.
- Utiliser la mesure/grille, le ratio de temps et la longueur du pad en temps de ce sequenceur (\`1..8\`), avec le numerateur courant propose si besoin.
- Glisser la poignee \`::\` de l'en-tete pour reordonner les sequenceurs melodiques dans le panneau.
- Effacer tous les pas de ce sequenceur.
- Utiliser les pads de pattern (P1..P8) pour mettre en file d'attente un sequenceur en lecture ou changer immediatement un sequenceur arrete.
- Le ratio de temps change seulement la vitesse de lecture face au transport partage ; la longueur stockee du pad, la mesure et la grille restent identiques.
- Utiliser les boutons de transposition de pad pour clic court (transposition par degré; met aussi à jour les accords de pas configurés vers des types diatoniques correspondants quand c'est possible) et appui long (tonique / transposition par degré de tonalité).
- Modifier note, état hold et vélocité pour chaque pas.
- Glisser la poignee \`::\` d'un pas sur un autre pas (meme sequenceur ou autre sequenceur melodique) pour copier les reglages note/accord/velocite du pas.`
    },
    spanish: {
      title: "Secuenciador melodico",
      markdown: `## Secuenciador melodico

Esta ayuda se aplica a una tarjeta individual de secuenciador melodico.

- Inicia/detiene el secuenciador de forma independiente (el transporte de instrumentos debe estar activo para iniciar).
- Ajusta canal MIDI, destino \`Sync con\`, raíz/tipo de escala y modo para la generación de notas.
- Usa la metrica/cuadricula, la relacion de pulso y la longitud del pad de este secuenciador en pulsos (\`1..8\`), con el numerador actual disponible cuando haga falta.
- Arrastra el asa \`::\` del encabezado para reordenar los secuenciadores melodicos en el panel.
- Borra todos los pasos de este secuenciador.
- Usa pads de patrón (P1..P8) para poner en cola un secuenciador en reproduccion o cambiar de inmediato uno detenido.
- La relacion de pulso solo cambia la velocidad frente al transporte compartido; la longitud guardada del pad, el compas y la cuadricula siguen iguales.
- Usa los botones de transposición del pad para clic corto (transposición por grado; también actualiza los acordes configurados del paso a tipos diatónicos correspondientes cuando sea posible) y pulsación larga (tónica / transposición por grado tonal).
- Edita nota, estado hold y velocidad de cada paso.
- Arrastra el asa \`::\` de un paso sobre otro paso (mismo secuenciador u otro secuenciador melodico) para copiar ajustes de nota/acorde/velocidad.`
    }
  },
  sequencer_multitrack_arranger: {
    english: {
      title: "Multitrack Arranger",
      markdown: `## Multitrack Arranger

Arrange melodic sequencers, drummer sequencers, and controller sequencers on one shared timeline.

- Use cassette transport to rewind, stop, play, or fast-forward the whole arrangement in one-beat blocks.
- Drag root-timeline tokens to reorder pads, groups, and super-groups.
- Use the right-click menu to insert pads, existing groups, or existing super-groups into a matching pause gap or at the end.
- Copy and paste selected pads, groups, and super-groups from the context menu to duplicate phrases.
- Click a group or super-group token to open its nested editor and build longer phrases.
- Use the loop ruler and zoom controls to focus playback on a selected arranger range, down to a single beat.`
    },
    german: {
      title: "Multitrack Arranger",
      markdown: `## Multitrack Arranger

Ordnet melodische Sequencer, Drummer-Sequencer und Controller-Sequencer auf einer gemeinsamen Timeline an.

- Mit dem Kassetten-Transport die gesamte Performance in Beat-Bloecken zurueckspulen, stoppen, starten oder vorspulen.
- Tokens auf der Root-Timeline ziehen, um Pads, Gruppen und Super-Gruppen neu anzuordnen.
- Mit dem Rechtsklick-Menue Pads, vorhandene Gruppen oder vorhandene Super-Gruppen in eine passende Pause oder ans Ende einfuegen.
- Ausgewaehlte Pads, Gruppen und Super-Gruppen per Kontextmenue kopieren und einfuegen, um Phrasen zu duplizieren.
- Auf ein Gruppen- oder Super-Gruppen-Token klicken, um den verschachtelten Editor fuer laengere Phrasen zu oeffnen.
- Mit Loop-Lineal und Zoom die Wiedergabe auf einen ausgewaehlten Arranger-Bereich bis hin zu einem einzelnen Beat fokussieren.`
    },
    french: {
      title: "Arrangeur multipiste",
      markdown: `## Arrangeur multipiste

Organise les sequenceurs melodiques, les sequenceurs batterie et les sequenceurs controleur sur une timeline partagee.

- Utiliser le transport cassette pour revenir en arriere, arreter, lancer ou avancer tout l'arrangement par blocs d'un temps.
- Faire glisser les jetons de la timeline principale pour reordonner pads, groupes et super-groupes.
- Utiliser le menu contextuel pour inserer des pads, des groupes existants ou des super-groupes existants dans une pause adaptee ou a la fin.
- Copier et coller des pads, groupes et super-groupes selectionnes depuis le menu contextuel pour dupliquer des phrases.
- Cliquer sur un jeton de groupe ou de super-groupe pour ouvrir son editeur imbrique et construire des phrases plus longues.
- Utiliser la regle de boucle et le zoom pour concentrer la lecture sur une plage choisie de l'arrangeur, jusqu'a un seul temps.`
    },
    spanish: {
      title: "Arreglador multipista",
      markdown: `## Arreglador multipista

Organiza secuenciadores melodicos, secuenciadores de bateria y secuenciadores de control en una linea de tiempo compartida.

- Usa el transporte tipo casete para rebobinar, detener, reproducir o adelantar todo el arreglo en bloques de un pulso.
- Arrastra los tokens de la linea principal para reordenar pads, grupos y supergrupos.
- Usa el menu contextual para insertar pads, grupos existentes o supergrupos existentes en una pausa adecuada o al final.
- Copia y pega pads, grupos y supergrupos seleccionados desde el menu contextual para duplicar frases.
- Haz clic en un token de grupo o supergrupo para abrir su editor anidado y construir frases mas largas.
- Usa la regla de bucle y el zoom para centrar la reproduccion en un rango concreto del arreglador, incluso de un solo pulso.`
    }
  },
  sequencer_drummer_sequencer: {
    english: {
      title: "Drummer Sequencer",
      markdown: `## Drummer Sequencer

Drum-machine style step sequencer for fixed MIDI drum keys.

- Add/remove drum rows (keys) and set each row key in the 0..127 MIDI range.
- Program steps by toggling row LEDs on/off for each step.
- Set per-cell velocity (0..127) for active hits by clicking and dragging up or down.
- Active hits show red LEDs; during playback the current-step active LEDs flash green.
- Use this drummer sequencer's meter/grid timing, beat ratio, and pad lengths in beats (\`1..8\`), including the current meter numerator when needed.
- Use pattern pads (P1..P8) for queued switching while the drummer sequencer is running, instant switching while it is stopped, and pad-loop sequences.
- \`Beat Ratio\` changes how fast the row pattern cycles against the shared transport without changing the stored beat length.
- No chord editing or transposition controls are used in this sequencer type.`
    },
    german: {
      title: "Drummer-Sequencer",
      markdown: `## Drummer-Sequencer

Drum-Machine-Step-Sequencer fuer feste MIDI-Drum-Keys.

- Drum-Reihen (Keys) hinzufuegen/entfernen und MIDI-Key 0..127 setzen.
- Steps programmieren durch Ein/Aus der LED pro Reihe und Schritt.
- Velocity pro Zelle (0..127) fuer aktive Hits durch Klicken und Ziehen nach oben oder unten setzen.
- Aktive Hits sind rot; beim Abspielen blinken aktive LEDs im aktuellen Schritt gruen.
- Die Takt-/Raster-Zeitbasis, das Beat-Verhaeltnis und Pad-Laengen dieses Drummer-Sequencers in Beats nutzen (\`1..8\`), bei Bedarf direkt inklusive des aktuellen Taktzaehlers.
- Pattern-Pads (P1..P8) fuer Warteschlangen-Wechsel waehrend des Laufens, sofortige Wechsel im gestoppten Zustand und beat-basierte Pad-Loop-Sequenzen nutzen.
- Das Beat-Verhaeltnis aendert nur, wie schnell das Row-Pattern gegenueber dem gemeinsamen Transport laeuft.
- Keine Akkord- oder Transpositionsfunktionen in diesem Sequencer-Typ.`
    },
    french: {
      title: "Séquenceur batterie",
      markdown: `## Séquenceur batterie

Séquenceur pas à pas type boîte à rythmes pour des touches MIDI fixes.

- Ajouter/supprimer des lignes de batterie et régler la touche MIDI (0..127).
- Programmer les pas en activant/désactivant les LED par ligne et par pas.
- Régler la vélocité par cellule (0..127) pour les frappes actives en cliquant et en faisant glisser vers le haut ou vers le bas.
- Les frappes actives sont rouges ; en lecture, les LED actives du pas courant clignotent en vert.
- Utiliser la mesure/grille, le ratio de temps et les longueurs de pad en temps de ce sequenceur batterie (\`1..8\`), avec le numerateur courant propose si besoin.
- Utiliser les pads de pattern (P1..P8) pour mise en file d'attente pendant la lecture, changement immediat a l'arret et sequences de boucle basees sur les temps.
- Le ratio de temps change seulement la vitesse du motif de lignes face au transport partage.
- Pas d'édition d'accords ni de transposition pour ce type de séquenceur.`
    },
    spanish: {
      title: "Secuenciador de batería",
      markdown: `## Secuenciador de batería

Secuenciador por pasos estilo caja de ritmos para teclas MIDI fijas.

- Agrega/elimina filas de batería y ajusta la tecla MIDI (0..127).
- Programa pasos activando/desactivando LEDs por fila y paso.
- Ajusta velocidad por celda (0..127) para golpes activos haciendo clic y arrastrando hacia arriba o hacia abajo.
- Los golpes activos se muestran en rojo; durante reproducción, los LEDs activos del paso actual parpadean en verde.
- Usa la metrica/cuadricula, la relacion de pulso y las longitudes de pad en pulsos de este secuenciador de bateria (\`1..8\`), con el numerador actual disponible cuando haga falta.
- Usa pads de patron (P1..P8) para cambios en cola durante la reproduccion, cambios inmediatos cuando esta detenido y secuencias de bucle basadas en pulsos.
- La relacion de pulso solo cambia la velocidad del patron de filas frente al transporte compartido.
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
- Choose the repeating curve length in beats (\`1..8\`, plus \`16\` for longer controller loops) and set the beat ratio.
- Use the curve editor to add, move, and shape key points.
- \`Beat Ratio\` changes how quickly the curve advances against the shared transport without moving the stored key points.
- The curve loops continuously while the lane is running.
- The displayed \`CC n\` badge shows the target controller currently sent.`
    },
    german: {
      title: "Controller-Sequencer",
      markdown: `## Controller-Sequencer

Automatisiert einen MIDI-CC-Wert über die Zeit mit einer Kurve.

- Diesen Controller-Sequencer separat starten/stoppen (zum Starten muss der Instrument-Transport laufen).
- MIDI-Controller-Nummer (\`0..127\`) festlegen.
- Die wiederholte Kurvenlaenge in Beats waehlen (\`1..8\`, plus \`16\` fuer laengere Controller-Loops) und das Beat-Verhaeltnis setzen.
- Im Kurveneditor Keypoints hinzufügen, verschieben und formen.
- Das Beat-Verhaeltnis aendert nur, wie schnell die Kurve gegenueber dem gemeinsamen Transport laeuft; gespeicherte Keypoints bleiben unveraendert.
- Die Kurve läuft in einer Schleife, solange die Spur aktiv ist.
- Das angezeigte \`CC n\`-Badge zeigt den aktuell gesendeten Ziel-Controller.`
    },
    french: {
      title: "Séquenceur contrôleur",
      markdown: `## Séquenceur contrôleur

Automatise une valeur MIDI CC dans le temps avec une courbe.

- Démarrer/arrêter ce séquenceur contrôleur indépendamment (le transport instrument doit être actif pour démarrer).
- Définir le numéro de contrôleur MIDI (\`0..127\`).
- Choisir la longueur repetee de la courbe en temps (\`1..8\`, plus \`16\` pour les boucles controleur plus longues) et regler le ratio de temps.
- Utiliser l'éditeur de courbe pour ajouter, déplacer et façonner des points-clés.
- Le ratio de temps change seulement la vitesse de lecture de la courbe face au transport partage ; les points-cles stockes restent au meme endroit.
- La courbe boucle en continu pendant l'exécution de la piste.
- Le badge \`CC n\` affiché indique le contrôleur cible envoyé.`
    },
    spanish: {
      title: "Secuenciador controlador",
      markdown: `## Secuenciador controlador

Automatiza un valor MIDI CC en el tiempo mediante una curva.

- Inicia/detiene este secuenciador controlador de forma independiente (el transporte de instrumentos debe estar activo para iniciar).
- Define el número de controlador MIDI (\`0..127\`).
- Elige la longitud repetida de la curva en pulsos (\`1..8\`, mas \`16\` para bucles de controlador mas largos) y ajusta la relacion de pulso.
- Usa el editor de curva para agregar, mover y dar forma a puntos clave.
- La relacion de pulso solo cambia la velocidad de la curva frente al transporte compartido; los puntos guardados no se mueven.
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
};

export const sequencerHelpAppendices: HelpDocumentAppendixSet<SequencerHelpDocId> = {
  sequencer_instrument_rack: {
    english: `### Rack Behavior

- Saving or loading a performance restores the full Perform-page state: rack assignments, sequencers, controller lanes, piano rolls, and arranger data.
- Each rack slot routes one saved patch to one MIDI channel. Reusing the same channel on multiple slots layers instruments on the same notes and CC messages.
- \`Level\` remains editable while instruments are running so you can rebalance the live mix without rebuilding the rack.
- Patch/channel add/remove controls lock while the engine is running because changing the rack would invalidate the active runtime session.

### Transport And Session State

- Starting instruments builds the current rack into a live backend session.
- The state badge reflects the backend instrument engine, not only the arranger transport.
- Import/export writes the perform configuration as JSON/ZIP so a live setup can be moved to another machine.
- \`Export CSD\` writes a separate offline render ZIP with the compiled performance CSD, arranger MIDI file, bundled assets, and exact Csound render instructions.`,
    german: `### Rack-Verhalten

- Das Speichern oder Laden einer Performance stellt den kompletten Zustand der Perform-Seite wieder her: Rack-Zuordnungen, Sequencer, Controller-Spuren, Piano Rolls und Arranger-Daten.
- Jeder Rack-Slot routet einen gespeicherten Patch auf genau einen MIDI-Kanal. Derselbe Kanal auf mehreren Slots layert Instrumente auf denselben Noten- und CC-Daten.
- \`Level\` bleibt waehrend laufender Instrumente editierbar, damit der Live-Mix ohne Neubau des Racks angepasst werden kann.
- Patch-/Kanal-, Add- und Remove-Steuerungen sperren waehrend die Engine laeuft, weil Rack-Aenderungen die aktive Runtime-Session ungueltig machen wuerden.

### Transport und Session-Status

- Das Starten der Instrumente baut das aktuelle Rack als Live-Session im Backend auf.
- Das Status-Badge zeigt den Zustand der Backend-Instrument-Engine, nicht nur den Arranger-Transport.
- Import/Export schreibt die Perform-Konfiguration als JSON/ZIP, damit ein Live-Setup auf einen anderen Rechner uebertragen werden kann.
- \`Export CSD\` schreibt ein separates Offline-Render-ZIP mit der kompilierten Performance-CSD, der Arranger-MIDI-Datei, gebuendelten Assets und dem exakten Csound-Renderkommando.`,
    french: `### Comportement du rack

- Enregistrer ou charger une performance restaure tout l'etat de la page Perform : affectations du rack, sequenceurs, lanes de controle, piano rolls et donnees d'arrangeur.
- Chaque slot du rack route un patch sauvegarde vers un seul canal MIDI. Reutiliser le meme canal sur plusieurs slots superpose les instruments sur les memes notes et messages CC.
- \`Level\` reste editable pendant que les instruments jouent afin de reequilibrer le mix live sans reconstruire le rack.
- Les controles d'ajout/suppression et de patch/canal se verrouillent pendant l'execution, car modifier le rack invaliderait la session runtime active.

### Transport et etat de session

- Le demarrage des instruments construit le rack courant comme session live cote backend.
- Le badge d'etat reflete l'etat reel du moteur instrument backend, pas seulement le transport de l'arrangeur.
- L'import/export ecrit la configuration Perform en JSON/ZIP pour deplacer facilement un setup live vers une autre machine.
- \`Export CSD\` ecrit un ZIP de rendu hors ligne distinct avec la CSD compilee de la performance, le fichier MIDI de l'arrangeur, les assets inclus et la commande Csound exacte.`,
    spanish: `### Comportamiento del rack

- Guardar o cargar una performance restaura todo el estado de la pagina Perform: asignaciones del rack, secuenciadores, pistas de control, piano rolls y datos del arreglador.
- Cada slot del rack enruta un patch guardado a un solo canal MIDI. Reutilizar el mismo canal en varios slots superpone instrumentos sobre las mismas notas y mensajes CC.
- \`Level\` sigue editable mientras los instrumentos estan en marcha para reequilibrar la mezcla en vivo sin reconstruir el rack.
- Los controles de patch/canal y de agregar/eliminar se bloquean mientras el motor esta ejecutandose porque un cambio del rack invalidaria la sesion runtime activa.

### Transporte y estado de sesion

- Iniciar los instrumentos construye el rack actual como una sesion en vivo en el backend.
- La insignia de estado refleja el motor de instrumentos del backend, no solo el transporte del arreglador.
- Importar/exportar escribe la configuracion Perform como JSON/ZIP para mover un setup en vivo a otra maquina.
- \`Export CSD\` escribe un ZIP de render offline separado con la CSD compilada de la performance, el archivo MIDI del arreglador, los assets incluidos y el comando exacto de Csound.`
  },
  sequencer_tracks: {
    english: `### Timing Model

- \`Meter\`, \`Grid\`, \`Beats\`, and \`Beat Ratio\` belong to each sequencer individually, so one performance can mix different bar lengths and playback speeds.
- Steps are derived as \`beats * grid\`; a \`4\`-beat pad at grid \`4\` yields \`16\` editable steps.
- \`Sync To\` lets one sequencer follow another sequencer's cycle boundary instead of free-running against the shared transport.
- Pattern pad changes queue to the next loop boundary while a sequencer is running, and switch immediately while it is stopped.

### Step Programming Notes

- Pitch class and octave are edited separately to make note entry faster.
- In-scale notes are highlighted with degree labels, but chromatic notes stay available for borrowed tones and passing notes.
- \`HOLD\` sustains the previous note instead of sending a fresh note trigger on that step.`,
    german: `### Timing-Modell

- \`Takt\`, \`Raster\`, \`Beats\` und \`Beat-Verhaeltnis\` gehoeren zu jedem Sequencer einzeln, sodass eine Performance unterschiedliche Taktlaengen und Abspielgeschwindigkeiten mischen kann.
- Die Schrittzahl ergibt sich aus \`beats * grid\`; ein \`4\`-Beat-Pad mit Raster \`4\` ergibt \`16\` bearbeitbare Schritte.
- \`Sync zu\` laesst einen Sequencer an der Zyklusgrenze eines anderen Sequencers folgen, statt frei gegen den gemeinsamen Transport zu laufen.
- Pattern-Pad-Wechsel werden im laufenden Zustand bis zur naechsten Loop-Grenze vorgemerkt und im gestoppten Zustand sofort umgeschaltet.

### Hinweise zur Step-Programmierung

- Tonklasse und Oktave werden getrennt bearbeitet, damit die Noteneingabe schneller geht.
- Skaleninterne Noten sind mit Stufen markiert; chromatische Noten bleiben fuer Borrowed Tones und Durchgangsnoten verfuegbar.
- \`HOLD\` verlaengert die vorherige Note, statt in diesem Schritt einen neuen Note-Trigger zu senden.`,
    french: `### Modele temporel

- \`Meter\`, \`Grid\`, \`Beats\` et \`Beat Ratio\` appartiennent a chaque sequenceur individuellement ; une meme performance peut donc melanger plusieurs longueurs de mesure et vitesses de lecture.
- Le nombre de pas vaut \`beats * grid\` ; un pad de \`4\` temps avec une grille \`4\` donne \`16\` pas editables.
- \`Sync vers\` permet a un sequenceur de suivre la frontiere de cycle d'un autre sequenceur au lieu de tourner librement sur le transport partage.
- Les changements de pad sont mis en file jusqu'a la prochaine frontiere de boucle pendant la lecture et s'appliquent immediatement quand le sequenceur est arrete.

### Notes sur l'edition des pas

- La hauteur (classe) et l'octave se reglent separement, ce qui accelere la saisie des notes.
- Les notes dans la gamme sont surlignees avec leurs degres, mais les notes chromatiques restent disponibles pour les emprunts et notes de passage.
- \`HOLD\` prolonge la note precedente au lieu d'envoyer un nouveau declenchement sur ce pas.`,
    spanish: `### Modelo temporal

- \`Meter\`, \`Grid\`, \`Beats\` y \`Beat Ratio\` pertenecen a cada secuenciador por separado, asi que una misma performance puede mezclar longitudes de compas y velocidades distintas.
- Los pasos se derivan como \`beats * grid\`; un pad de \`4\` pulsos con cuadricula \`4\` produce \`16\` pasos editables.
- \`Sync con\` permite que un secuenciador siga el limite de ciclo de otro en lugar de correr libremente contra el transporte compartido.
- Los cambios de pad se ponen en cola hasta el siguiente limite de bucle mientras el secuenciador esta en marcha y cambian al instante cuando esta detenido.

### Notas sobre la programacion por pasos

- La clase de nota y la octava se editan por separado para agilizar la entrada.
- Las notas de la escala se resaltan con grados, pero las cromaticas siguen disponibles para notas prestadas y de paso.
- \`HOLD\` prolonga la nota anterior en vez de disparar una nota nueva en ese paso.`
  },
  sequencer_track_editor: {
    english: `### Editing One Sequencer Card

- \`Start\` and \`Stop\` only arm this sequencer; the rack's instrument engine must already be running before notes will sound.
- \`Clear Steps\` resets the active pattern pad of this sequencer, not every pad in the performance.
- \`Beats\` changes the pad length in beats, while \`Meter\` and \`Grid\` determine how many editable steps fit inside that span.

### Pads And Copy Behavior

- P1..P8 are alternate pattern memories for the same sequencer.
- Dragging a step \`::\` handle copies note/chord/velocity data to another step, including across melodic sequencers.
- Short pad transpose keeps the current tonic and mode and shifts notes by scale degree; long press moves the pad tonic itself.`,
    german: `### Eine Sequencer-Karte bearbeiten

- \`Start\` und \`Stop\` schalten nur diesen Sequencer scharf; die Instrument-Engine des Racks muss bereits laufen, damit Noten hoerbar sind.
- \`Clear Steps\` setzt nur das aktive Pattern-Pad dieses Sequencers zurueck, nicht alle Pads der Performance.
- \`Beats\` aendert die Pad-Laenge in Beats, waehrend \`Takt\` und \`Raster\` festlegen, wie viele bearbeitbare Schritte in diese Laenge passen.

### Pad- und Kopierverhalten

- P1..P8 sind alternative Pattern-Speicher fuer denselben Sequencer.
- Das Ziehen eines Schritt-\`::\`-Handles kopiert Noten-/Akkord-/Velocity-Daten auf einen anderen Schritt, auch ueber mehrere melodische Sequencer hinweg.
- Kurze Pad-Transposition behaelt Tonika und Modus bei und verschiebt Noten nach Skalenstufen; langer Druck verschiebt die Tonika des Pads selbst.`,
    french: `### Edition d'une carte de sequenceur

- \`Start\` et \`Stop\` n'arment que ce sequenceur ; le moteur instrument du rack doit deja tourner pour entendre des notes.
- \`Clear Steps\` reinitialise uniquement le pad de pattern actif de ce sequenceur, pas tous les pads de la performance.
- \`Beats\` change la longueur du pad en temps, tandis que \`Meter\` et \`Grid\` determinent combien de pas editables tiennent dans cette duree.

### Comportement des pads et copies

- P1..P8 sont des memoires de pattern alternatives pour le meme sequenceur.
- Faire glisser la poignee \`::\` d'un pas copie les donnees note/accord/velocite vers un autre pas, y compris entre sequenceurs melodiques.
- Une transposition courte conserve tonique et mode et deplace les notes par degre ; un appui long deplace la tonique du pad elle-meme.`,
    spanish: `### Edicion de una tarjeta de secuenciador

- \`Start\` y \`Stop\` solo activan este secuenciador; el motor de instrumentos del rack ya debe estar en marcha para que suenen notas.
- \`Clear Steps\` reinicia solo el pad de patron activo de este secuenciador, no todos los pads de la performance.
- \`Beats\` cambia la longitud del pad en pulsos, mientras \`Meter\` y \`Grid\` determinan cuantos pasos editables caben en ese tramo.

### Comportamiento de pads y copias

- P1..P8 son memorias alternativas de patron para el mismo secuenciador.
- Arrastrar el asa \`::\` de un paso copia datos de nota/acorde/velocidad a otro paso, incluso entre secuenciadores melodicos.
- La transposicion corta mantiene tonica y modo y mueve las notas por grado; la pulsacion larga mueve la tonica del propio pad.`
  },
  sequencer_multitrack_arranger: {
    english: `### Timeline Structure

- Each row represents one melodic, drummer, or controller sequencer and reuses that track's pads, groups, and super-groups.
- Root tokens \`1..8\`, letter groups, and roman-numeral super-groups all resolve to beat-based spans on the shared playhead.
- Pause gaps stay hidden in the root overview, but they are recreated automatically whenever timing must be preserved.

### Playback And Editing

- \`Play\` starts all enabled perform tracks from the current playhead. \`Stop\` preserves position, and double-click \`Stop\` resets to the loop start or beat \`0\`.
- Right-click menus insert pads/groups into a gap or the sequence end, and \`Copy\` / \`Paste\` duplicate whole phrase blocks.
- Loop range selection constrains playback to the highlighted beat span without rewriting the stored arrangement.`,
    german: `### Aufbau der Timeline

- Jede Zeile repraesentiert einen melodischen Sequencer, Drummer-Sequencer oder Controller-Sequencer und nutzt dessen Pads, Gruppen und Super-Gruppen.
- Root-Tokens \`1..8\`, Buchstaben-Gruppen und roemische Super-Gruppen werden alle in beat-basierte Bereiche auf dem gemeinsamen Playhead aufgeloest.
- Pausenbereiche bleiben in der Root-Uebersicht verborgen, werden aber automatisch wieder erzeugt, sobald das Timing erhalten bleiben muss.

### Wiedergabe und Bearbeitung

- \`Play\` startet alle aktivierten Perform-Spuren ab der aktuellen Playhead-Position. \`Stop\` behaelt die Position bei; Doppelklick auf \`Stop\` setzt auf Loop-Start oder Beat \`0\` zurueck.
- Rechtsklick-Menues fuegen Pads/Gruppen in eine Luecke oder ans Sequenzende ein, und \`Copy\` / \`Paste\` duplizieren ganze Phrasenbloecke.
- Die Loop-Bereichsauswahl begrenzt die Wiedergabe auf den markierten Beat-Bereich, ohne das gespeicherte Arrangement umzuschreiben.`,
    french: `### Structure de la timeline

- Chaque ligne represente un sequenceur melodique, batterie ou controleur et reutilise les pads, groupes et super-groupes de cette piste.
- Les jetons racine \`1..8\`, les groupes lettres et les super-groupes en chiffres romains se resolvent tous en segments bases sur les temps du playhead partage.
- Les silences restent caches dans la vue racine, mais sont recrees automatiquement quand il faut preserver le timing.

### Lecture et edition

- \`Play\` lance toutes les pistes Perform actives depuis la position courante du playhead. \`Stop\` conserve la position ; un double-clic sur \`Stop\` revient au debut de boucle ou au temps \`0\`.
- Les menus clic droit inserent pads/groupes dans un vide ou en fin de sequence, et \`Copy\` / \`Paste\` dupliquent des blocs de phrase entiers.
- La selection de boucle limite la lecture a la plage de temps surlignee sans reecrire l'arrangement stocke.`,
    spanish: `### Estructura de la linea de tiempo

- Cada fila representa un secuenciador melodico, de bateria o controlador y reutiliza los pads, grupos y supergrupos de esa pista.
- Los tokens raiz \`1..8\`, los grupos con letras y los supergrupos en numeros romanos se resuelven como tramos basados en pulsos sobre el playhead compartido.
- Los huecos de pausa permanecen ocultos en la vista raiz, pero se recrean automaticamente cuando hace falta conservar el timing.

### Reproduccion y edicion

- \`Play\` inicia todas las pistas activas de Perform desde la posicion actual del playhead. \`Stop\` conserva la posicion y el doble clic en \`Stop\` vuelve al inicio del bucle o al pulso \`0\`.
- Los menus de clic derecho insertan pads/grupos en un hueco o al final de la secuencia, y \`Copy\` / \`Paste\` duplican bloques completos de frase.
- La seleccion de rango de bucle limita la reproduccion al tramo resaltado sin reescribir el arreglo guardado.`
  },
  sequencer_drummer_sequencer: {
    english: `### Row And Hit Model

- Each row is one fixed MIDI note number. Use separate rows for kick, snare, hat, or any drum mapping your target instrument expects.
- Changing a row key while instruments are running sends a short preview note on that drummer sequencer's MIDI channel.
- Velocity is stored per active hit, so two hits in the same column can have different strengths.

### Timing And Pads

- \`Meter\`, \`Grid\`, \`Beats\`, and \`Beat Ratio\` work like melodic sequencers, but pad content stores row/hit data instead of note/chord data.
- Pattern pad changes queue to the next loop boundary while the drummer sequencer is running, and switch immediately while it is stopped.
- Drummer pads do not use scale, chord, or transpose controls.`,
    german: `### Zeilen- und Hit-Modell

- Jede Zeile ist genau eine feste MIDI-Notennummer. Verwende getrennte Zeilen fuer Kick, Snare, Hi-Hat oder jede andere Drum-Zuordnung des Zielinstruments.
- Das Aendern eines Row-Keys sendet waehrend laufender Instrumente eine kurze Vorschau-Note auf dem MIDI-Kanal dieses Drummer-Sequencers.
- Velocity wird pro aktivem Hit gespeichert, sodass zwei Hits in derselben Spalte unterschiedliche Staerken haben koennen.

### Timing und Pads

- \`Takt\`, \`Raster\`, \`Beats\` und \`Beat-Verhaeltnis\` funktionieren wie bei melodischen Sequencern, aber der Pad-Inhalt speichert Row-/Hit-Daten statt Noten-/Akkord-Daten.
- Pattern-Pad-Wechsel werden im laufenden Zustand bis zur naechsten Loop-Grenze vorgemerkt und im gestoppten Zustand sofort umgeschaltet.
- Drummer-Pads verwenden keine Skalen-, Akkord- oder Transpositionssteuerungen.`,
    french: `### Modele des lignes et impacts

- Chaque ligne correspond a un numero de note MIDI fixe. Utilisez des lignes distinctes pour kick, caisse claire, charley ou tout mapping batterie attendu par l'instrument cible.
- Modifier une touche de ligne pendant que les instruments tournent envoie une courte note de preecoute sur le canal MIDI de ce sequenceur batterie.
- La velocite est stockee pour chaque impact actif ; deux impacts dans la meme colonne peuvent donc avoir des intensites differentes.

### Timing et pads

- \`Meter\`, \`Grid\`, \`Beats\` et \`Beat Ratio\` fonctionnent comme pour les sequenceurs melodiques, mais le contenu du pad stocke des donnees ligne/impact au lieu de notes/accords.
- Les changements de pattern pad sont mis en file jusqu'a la prochaine frontiere de boucle pendant la lecture et s'appliquent immediatement a l'arret.
- Les pads batterie n'utilisent ni gamme, ni accords, ni commandes de transposition.`,
    spanish: `### Modelo de filas y golpes

- Cada fila corresponde a un numero de nota MIDI fijo. Usa filas separadas para bombo, caja, hi-hat o cualquier mapeo de bateria que espere el instrumento destino.
- Cambiar la tecla de una fila mientras los instrumentos estan en marcha envia una nota corta de vista previa por el canal MIDI de ese secuenciador de bateria.
- La velocidad se guarda por golpe activo, asi que dos golpes en la misma columna pueden tener intensidades distintas.

### Timing y pads

- \`Meter\`, \`Grid\`, \`Beats\` y \`Beat Ratio\` funcionan como en los secuenciadores melodicos, pero el contenido del pad guarda datos de fila/golpe en lugar de notas/acordes.
- Los cambios de pad se ponen en cola hasta el siguiente limite de bucle mientras el secuenciador de bateria esta en marcha y cambian al instante cuando esta detenido.
- Los pads de bateria no usan controles de escala, acorde ni transposicion.`
  },
  sequencer_controller_sequencer: {
    english: `### Curve Playback

- The selected controller number is sent repeatedly from the sampled curve while this lane is running.
- Curve length changes the loop duration, but key points keep their relative position across the full span.
- \`Beat Ratio\` changes how quickly the curve cycles against the shared transport, which is useful for slow sweeps or faster rhythmic modulation.

### Editing Rules

- Click the background to add an interior point, drag points to reshape the curve, and double-click an interior point to remove it.
- The first and last points act as boundary anchors so the loop always has a defined start and end.
- If the same CC is driven from multiple sources, the latest transmitted value wins at the receiver.`,
    german: `### Kurven-Wiedergabe

- Die gewaehlte Controller-Nummer wird waehrend des Laufens dieser Spur fortlaufend aus der gesampelten Kurve gesendet.
- Die Kurvenlaenge aendert die Loop-Dauer, aber Keypoints behalten ihre relative Position ueber die gesamte Laenge.
- Das \`Beat-Verhaeltnis\` aendert, wie schnell die Kurve gegen den gemeinsamen Transport zyklisch laeuft; das ist nuetzlich fuer langsame Sweeps oder schnellere rhythmische Modulation.

### Bearbeitungsregeln

- Hintergrund anklicken, um einen inneren Punkt hinzuzufuegen; Punkte ziehen, um die Kurve zu formen; einen inneren Punkt doppelklicken, um ihn zu entfernen.
- Der erste und letzte Punkt sind Randanker, sodass die Schleife immer einen definierten Start und ein definiertes Ende hat.
- Wenn dieselbe CC von mehreren Quellen gesteuert wird, gewinnt am Empfaenger der zuletzt gesendete Wert.`,
    french: `### Lecture de courbe

- Le numero de controleur choisi est emis en continu depuis la courbe echantillonnee tant que cette piste tourne.
- La longueur de courbe change la duree de boucle, mais les points-cles gardent leur position relative sur toute la plage.
- \`Beat Ratio\` change la vitesse de cycle de la courbe face au transport partage ; c'est utile pour des sweeps lents ou des modulations rythmiques plus rapides.

### Regles d'edition

- Cliquez sur le fond pour ajouter un point interieur, faites glisser les points pour remodeler la courbe et double-cliquez un point interieur pour le supprimer.
- Le premier et le dernier point servent d'ancrages de bord, de sorte que la boucle garde toujours un debut et une fin definis.
- Si le meme CC est pilote par plusieurs sources, c'est la valeur envoyee en dernier qui gagne cote recepteur.`,
    spanish: `### Reproduccion de la curva

- El numero de controlador elegido se envia de forma continua desde la curva muestreada mientras esta pista esta en marcha.
- La longitud de la curva cambia la duracion del bucle, pero los puntos clave mantienen su posicion relativa en todo el tramo.
- \`Beat Ratio\` cambia la velocidad con la que la curva cicla frente al transporte compartido; resulta util para barridos lentos o modulaciones ritmicas mas rapidas.

### Reglas de edicion

- Haz clic en el fondo para agregar un punto interior, arrastra puntos para remodelar la curva y haz doble clic en un punto interior para eliminarlo.
- El primer y el ultimo punto actuan como anclas de borde, de modo que el bucle siempre tiene un inicio y un final definidos.
- Si el mismo CC esta controlado por varias fuentes, en el receptor prevalece el ultimo valor transmitido.`
  },
  sequencer_piano_rolls: {
    english: `### Live Input Behavior

- A piano roll only sends notes when its own lane is enabled and the instrument engine is already running.
- Use the MIDI channel to target one rack instrument or intentionally layer several instruments on the same channel.
- The on-screen keyboard spans \`C1..B7\` and uses pointer press/release gestures for note on/off.

### Scale Guidance

- The keyboard highlights notes from the selected scale and mode.
- When running melodic sequencers agree on one theory, the piano roll follows that shared scale/mode for visual guidance.
- When running sequencers disagree, the UI shows a mixed state and highlights only notes common to the active theories.`,
    german: `### Live-Eingabeverhalten

- Eine Piano Roll sendet nur dann Noten, wenn ihre eigene Spur aktiviert ist und die Instrument-Engine bereits laeuft.
- Ueber den MIDI-Kanal kann gezielt ein Rack-Instrument angesteuert oder bewusst ein Layer mehrerer Instrumente auf demselben Kanal gebaut werden.
- Die Onscreen-Tastatur reicht von \`C1..B7\` und nutzt Pointer-Press/Release fuer Note On/Off.

### Skalenfuehrung

- Die Tastatur markiert Noten der ausgewaehlten Skala und des Modus.
- Wenn laufende melodische Sequencer dieselbe Theorie teilen, folgt die Piano Roll dieser gemeinsamen Skala/diesem Modus als visuelle Orientierung.
- Wenn laufende Sequencer unterschiedliche Theorien haben, zeigt die UI einen Mixed-Zustand und markiert nur die gemeinsamen Noten der aktiven Theorien.`,
    french: `### Comportement en entree live

- Un piano roll n'envoie des notes que si sa propre voie est active et que le moteur instrument tourne deja.
- Utilisez le canal MIDI pour viser un instrument du rack ou pour superposer volontairement plusieurs instruments sur le meme canal.
- Le clavier a l'ecran couvre \`C1..B7\` et utilise des gestes de pression/relachement du pointeur pour les note on/off.

### Guidage tonal

- Le clavier surligne les notes de la gamme et du mode selectionnes.
- Quand les sequenceurs melodiques actifs partagent la meme theorie, le piano roll suit cette gamme/ce mode communs pour le guidage visuel.
- Quand les sequenceurs actifs divergent, l'UI affiche un etat mixte et ne surligne que les notes communes aux theories actives.`,
    spanish: `### Comportamiento de entrada en vivo

- Un piano roll solo envia notas cuando su propia pista esta activada y el motor de instrumentos ya esta en marcha.
- Usa el canal MIDI para apuntar a un instrumento del rack o para superponer intencionalmente varios instrumentos en el mismo canal.
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
- If multiple destinations listen to the same CC mapping, all of them react to the transmitted value.`,
    german: `### Manuelle CC-Spuren

- Dieses Panel ist fuer direkte CC-Steuerung gedacht, nicht fuer wiederholte Automation. Fuer transport-synchrone Kurven sind Controller-Sequencer gedacht.
- Jede Spur steuert genau eine MIDI-Controller-Nummer (\`0..127\`) und kann unabhaengig aktiviert oder deaktiviert werden.
- Drehregler und Zahlenanzeige bearbeiten denselben Live-Wert, sodass weite Sweeps und trotzdem exakte Zielwerte moeglich sind.

### Wann Nachrichten gesendet werden

- CC-Nachrichten werden sofort gesendet, wenn die Instrument-Session laeuft und die Spur aktiviert ist.
- Bis zu sechs Spuren koennen parallel existieren; das ist praktisch fuer Filter-, Resonanz-, Mix- oder Macro-Steuerungen in einer Performance.
- Wenn mehrere Ziele auf dieselbe CC-Zuordnung hoeren, reagieren alle auf den gesendeten Wert.`,
    french: `### Voies CC manuelles

- Ce panneau sert au controle CC direct, pas a l'automation repetee. Utilisez les sequenceurs controleur quand vous avez besoin de courbes synchronisees au transport.
- Chaque voie cible un seul numero de controleur MIDI (\`0..127\`) et peut etre activee ou desactivee independamment.
- Le potentiometre et l'affichage numerique modifient la meme valeur live, ce qui permet de grands sweeps tout en retombant sur des chiffres precis.

### Quand les messages sont envoyes

- Les messages CC partent immediatement quand la session instrument tourne et que la voie est activee.
- Jusqu'a six voies peuvent coexister, utile pour des controles de filtre, resonance, mix ou macro dans une meme performance.
- Si plusieurs destinations ecoutent le meme mapping CC, elles reagissent toutes a la valeur transmise.`,
    spanish: `### Pistas CC manuales

- Este panel sirve para control CC directo, no para automatizacion repetitiva. Usa secuenciadores controladores cuando necesites curvas sincronizadas al transporte.
- Cada pista apunta a un solo numero de controlador MIDI (\`0..127\`) y puede activarse o desactivarse de forma independiente.
- La perilla y la lectura numerica editan el mismo valor en vivo, de modo que puedes hacer barridos amplios y aun asi caer en numeros exactos.

### Cuando se envian los mensajes

- Los mensajes CC se envian inmediatamente cuando la sesion de instrumentos esta en marcha y la pista esta activada.
- Pueden coexistir hasta seis pistas, lo que resulta util para controles de filtro, resonancia, mezcla o macros dentro de una misma performance.
- Si varios destinos escuchan el mismo mapeo CC, todos reaccionan al valor transmitido.`
  },
};
