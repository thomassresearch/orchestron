import type { GuiLanguage } from "../types";

export const arpeggiatorHelp: Record<GuiLanguage, string> = {
  english: `## Arpeggiator

Send notes to the unique Input Channel; the named Target Channel receives the generated MIDI and plays an existing rack instrument. Both controls are always visible in the top row as Input Channel → Target Channel. Inputs can come from sequencers, keyboards or external MIDI. Arpeggiators cannot chain.

### Playback and Hold

Arranger mode follows arranger Play/Stop, seeks and loop selections. Live starts its own clock on the first input note while the engine runs. Both use global BPM. Chord changes keep the pulse. Continue preserves phrase position; First held note, Every beat and Every bar restart the phrase on the beat grid.

Hold defaults to Off, preserving input rests. Hold and replace remembers a released chord and replaces it on the next fresh gesture. Add/remove notes toggles pitches. Clear held notes releases owned notes and cancels pending events. Active generates notes; Bypass forwards input; Mute consumes it silently.

### Pads and Grid

Click #1–#8 to edit; use the separate play button to launch. Drag pads to copy. Editing stays on your selected pad while playback changes. A rhythm has 1–32 steps, independently of its pad duration (1–8 or 16 master beats). New pads use 16 sixteenths and four beats. Repeated identical pads continue the phrase; changing pads restarts it. Edit reusable groups and supergroups in Patterns and phrases; place them with rests in the multitrack arranger. In Arrangement mode, the play button auditions at the next pad/rest boundary until Return to arrangement. In Live mode, launches retain the Next cycle or Next master bar setting.

Steps play Next note, a wrapping Chord-note position, Rest, Tie or Chord. Positions use the ascending octave-expanded input pool. Ties extend the preceding note/chord; an initial tie is silent. Set relative velocity bars, gate up to 200%, probability and 1–4 ratchets. Rests/misses keep the note cursor unless Advance through rests is enabled. Note repeats repeats pitches. Left/Right moves selection; Space toggles rest; Delete inserts rest; T ties; C plays a chord; N restores Next note.

Note previews use large labels; narrow grids scroll horizontally. Hover over a step for its complete note list and scale degrees, also available to screen readers. Follow source and Custom use the piano keyboard’s border colours: 1 red, 2 orange, 3 yellow, 4 green, 5 teal, 6 blue, 7 violet. Degrees follow the generated pitches after transposition and quantization, using each note’s source scale or the pad fallback. Chords show separate equal segments in degree order; octave repetitions share a colour. Scale Off, missing previews, rests and ties stay neutral. Previews appear only on the playing pad. The cyan outer outline marks selection; playback background and keyboard focus remain separate.

### Expression, Harmony and Presets

Swing keeps each pair's duration. Full range expands octaves before note order; octave-by-octave is available in Advanced timing. Input, Fixed and Random velocity are available. Repeat variation reuses the saved seed; Evolve varies by cycle; New variation changes the seed. Scale is Off, Follow source (with pad fallback), or Custom. Pitch preview, effective scale and audible playback highlights explain the result.

Presets apply to the editing pad only. Modified, Update preset and Save as preset preserve routing and other pads. Changes coalesce for 80 ms and apply at audio boundaries without resetting transport. Invalid changes retain the working configuration. Collapse preserves editing state and playback.

Version 15 migrates older settings into #1, accents into velocity steps, and other pads to defaults. Existing performances adopt Arranger, Hold Off, Continue, corrected swing and full-range ordering. Save/export persists the migration; runtime held notes and queued launches are not saved.`,
  german: `## Arpeggiator

Noten an den eindeutigen Eingangskanal senden; der benannte Zielkanal spielt ein vorhandenes Rack-Instrument. Beide Bedienelemente sind in der obersten Zeile als Eingangskanal → Zielkanal immer sichtbar. Quellen können Sequencer, Bildschirmtastatur oder externes MIDI sein. Arpeggiatoren lassen sich nicht verketten.

### Wiedergabe und Halten

Arranger folgt Play/Stop, Positionswechseln und Loop-Auswahl. Live startet seine eigene Uhr mit der ersten Eingangsnote bei laufender Engine. Beide verwenden das globale BPM. Akkordwechsel behalten den Puls. Weiterlaufen erhält die Phrasenposition; Erste gehaltene Note, Jeder Beat und Jeder Takt starten die Phrase im Taktraster neu.

Halten ist zunächst Aus und erhält Eingangspausen. Halten und ersetzen merkt sich einen losgelassenen Akkord und ersetzt ihn bei der nächsten neuen Tastengeste. Noten hinzufügen/entfernen schaltet Tonhöhen um. Gehaltene Noten löschen beendet eigene Noten und ausstehende Ereignisse. Aktiv erzeugt Noten, Durchleiten gibt den Eingang weiter, Stumm verarbeitet ihn lautlos.

### Pads und Raster

#1–#8 zum Bearbeiten wählen; die separate Play-Taste startet das Pad. Ziehen kopiert Pads. Automatische Wechsel ändern das bearbeitete Pad nicht. Ein Rhythmus hat 1–32 Schritte, unabhängig von seiner Pad-Dauer (1–8 oder 16 Master-Beats). Standard: 16 Sechzehntel und vier Beats. Dasselbe Pad läuft über Wiederholungen weiter; ein anderes Pad startet die Phrase neu. Wiederverwendbare Gruppen und Supergruppen unter Patterns und Phrasen bearbeiten; im Multitrack-Arranger mit Pausen platzieren. Im Arrangement-Modus startet Play das Vorhören an der nächsten Pad-/Pausengrenze bis Zurück zum Arrangement. Im Live-Modus bleibt die Einstellung Nächster Zyklus oder Master-Takt erhalten.

Schritte spielen Nächste Note, eine umlaufende Akkordnotenposition, Pause, Bindung oder Akkord. Positionen beziehen sich auf den aufsteigenden, um Oktaven erweiterten Notenvorrat. Bindungen verlängern die vorige Note/den Akkord; ohne Vorgänger bleiben sie stumm. Relative Velocity, Gate bis 200%, Wahrscheinlichkeit und 1–4 Mehrfachanschläge sind pro Schritt einstellbar. Pausen/Fehlschläge behalten den Notenzeiger; Bei Pausen weiterschalten ändert dies. Notenwiederholungen wiederholt Tonhöhen. Links/Rechts wählt, Leertaste schaltet Pause um, Entf setzt Pause, T bindet, C spielt den Akkord, N setzt Nächste Note.

Die Notenvorschau verwendet große Beschriftungen; schmale Raster scrollen horizontal. Beim Überfahren eines Schritts erscheinen alle Noten und Tonleiterstufen, auch für Screenreader verfügbar. Quelle folgen und Benutzerdefiniert verwenden die Randfarben der Klaviatur: 1 Rot, 2 Orange, 3 Gelb, 4 Grün, 5 Türkis, 6 Blau, 7 Violett. Die Stufen beziehen sich auf die erzeugten Tonhöhen nach Transposition und Quantisierung, mit der Quelltonleiter jeder Note oder der Pad-Tonleiter als Rückfall. Akkorde zeigen gleich große, getrennte Segmente in Stufenreihenfolge; Oktavwiederholungen behalten die Farbe. Tonleiter Aus, fehlende Vorschau, Pausen und Bindungen bleiben neutral. Die Vorschau erscheint nur beim spielenden Pad. Der äußere cyanfarbene Rahmen markiert die Auswahl; Wiedergabehintergrund und Tastaturfokus bleiben getrennt.

### Ausdruck, Harmonie und Presets

Swing erhält die Dauer jedes Paars. Gesamter Bereich erweitert Oktaven vor der Notenreihenfolge; Oktave für Oktave ist eine Alternative. Velocity folgt dem Eingang, einem Festwert oder Zufall. Variation wiederholen nutzt den gespeicherten Startwert; Weiterentwickeln variiert je Zyklus; Neue Variation ändert den Startwert. Tonleiter: Aus, Quelle folgen mit Pad-Rückfall oder Benutzerdefiniert. Notenvorschau, wirksame Tonleiter und hörbare Wiedergabemarkierungen helfen beim Bearbeiten.

Presets gelten nur für das bearbeitete Pad. Geändert, Preset aktualisieren und Als Preset speichern erhalten Routing und andere Pads. Änderungen werden nach 80 ms am Audioblock übernommen; ungültige Änderungen ersetzen die spielende Konfiguration nicht. Einklappen erhält Entwürfe und Wiedergabe.

Version 15 übernimmt alte Einstellungen nach #1, Akzente als Velocity-Schritte und Standardwerte für andere Pads. Bestehende Performances verwenden Arranger, Halten Aus, Weiterlaufen, korrigierten Swing und den gesamten Oktavbereich. Speichern/Export schreibt die Migration; gehaltene Noten und vorgemerkte Starts werden nicht gespeichert.`,
  french: `## Arpégiateur

Envoyez des notes au canal d’entrée unique ; le canal cible nommé joue un instrument existant du rack. Les deux commandes restent visibles sur la première ligne : Canal entree → Canal cible. Les sources peuvent être les séquenceurs, le clavier ou le MIDI externe. Les arpégiateurs ne se chaînent pas.

### Lecture et maintien

Arrangeur suit Play/Stop, les déplacements et la sélection de boucle. Live établit son horloge à la première note reçue lorsque le moteur tourne. Les deux utilisent le BPM global. Les changements d’accord conservent la pulsation. Continuer conserve la position ; Première note maintenue, Chaque temps et Chaque mesure redémarrent la phrase sur la grille.

Maintien est Désactivé par défaut pour respecter les silences d’entrée. Maintenir et remplacer mémorise l’accord relâché et le remplace au prochain geste. Ajouter/retirer des notes bascule les hauteurs. Effacer les notes maintenues libère les notes et annule les événements en attente. Actif génère les notes, Contourner transmet l’entrée, Muet la consomme silencieusement.

### Pads et grille

Cliquez #1–#8 pour éditer ; le bouton de lecture séparé lance le pad. Glisser copie les pads. Les changements automatiques ne déplacent pas l’édition. Le cycle comporte 1–32 pas, indépendamment de la durée du pad (1–8 ou 16 temps maîtres). Par défaut : 16 doubles croches et quatre temps. Le même pad poursuit la phrase ; un pad différent la redémarre. Les groupes et supergroupes se modifient dans Motifs et phrases et se placent avec les silences dans l’arrangeur multipiste. En mode Arrangement, la lecture lance une écoute à la prochaine limite de pad/silence, jusqu’au Retour à l’arrangement. Le mode Live conserve le prochain cycle ou la prochaine mesure maître.

Actions : Note suivante, Position dans l’accord avec retour circulaire, Silence, Liaison ou Accord. Les positions utilisent les notes ascendantes étendues aux octaves. Une liaison prolonge la note/l’accord précédent, sinon elle reste silencieuse. Réglez vélocité relative, durée jusqu’à 200%, probabilité et 1–4 répétitions rapides. Les silences/échecs gardent le curseur de notes sauf avec Avancer pendant les silences. Répétitions de note répète les hauteurs. Gauche/Droite sélectionne, Espace alterne silence, Suppr insère silence, T lie, C joue l’accord, N restaure Note suivante.

Les notes de l’aperçu sont agrandies ; les grilles étroites défilent horizontalement. Survolez un pas pour lire toutes les notes et leurs degrés, également accessibles aux lecteurs d’écran. Suivre la source et Personnalisé utilisent les couleurs de bordure du clavier : 1 rouge, 2 orange, 3 jaune, 4 vert, 5 turquoise, 6 bleu, 7 violet. Les degrés décrivent les hauteurs produites après transposition et quantification, selon la gamme source de chaque note ou celle du pad en repli. Les accords affichent des segments égaux et distincts dans l’ordre des degrés ; les répétitions à l’octave gardent leur couleur. Gamme désactivée, aperçu absent, silences et liaisons restent neutres. L’aperçu apparaît uniquement sur le pad en lecture. Le contour cyan extérieur indique la sélection ; le fond de lecture et le focus clavier restent distincts.

### Expression, harmonie et presets

Le swing conserve la durée de chaque paire. Toute la tessiture étend les octaves avant l’ordre des notes ; Octave par octave est disponible. Vélocité d’entrée, fixe ou aléatoire. Répéter la variation utilise la graine sauvegardée ; Évoluer varie par cycle ; Nouvelle variation change la graine. Gamme : Désactivé, Suivre la source avec repli sur le pad, ou Personnalisé. Aperçu des hauteurs, gamme effective et surbrillance audible guident l’édition.

Les presets s’appliquent au pad édité. Modifié, Actualiser le preset et Enregistrer un preset préservent routage et autres pads. Les modifications sont regroupées pendant 80 ms puis appliquées au bloc audio ; une erreur conserve la configuration jouée. Replier conserve brouillons et lecture.

La version 15 migre les anciens réglages vers #1, les accents vers les vélocités et initialise les autres pads. Les performances adoptent Arrangeur, maintien désactivé, Continuer, swing corrigé et tessiture complète. Enregistrer/exporter persiste cette migration ; les notes maintenues et lancements en attente ne sont pas sauvegardés.`,
  spanish: `## Arpegiador

Envíe notas al canal de entrada exclusivo; el canal destino con nombre toca un instrumento existente del rack. Ambos controles están siempre visibles en la fila superior como Canal de entrada → Canal destino. Las fuentes pueden ser secuenciadores, teclado o MIDI externo. Los arpegiadores no se encadenan.

### Reproducción y retención

Arreglador sigue Play/Stop, desplazamientos y selección de bucle. En vivo inicia su reloj con la primera nota recibida mientras funciona el motor. Ambos usan el BPM global. Cambiar de acorde conserva el pulso. Continuar conserva la posición; Primera nota retenida, Cada pulso y Cada compás reinician la frase sobre la cuadrícula.

Retener está Desactivado por defecto y conserva los silencios de entrada. Retener y reemplazar recuerda el acorde soltado y lo sustituye en el siguiente gesto. Añadir/quitar notas alterna alturas. Borrar notas retenidas libera notas y cancela eventos pendientes. Activo genera notas, Paso directo transmite la entrada, Silenciar la consume sin sonido.

### Pads y cuadrícula

Pulse #1–#8 para editar; el botón de reproducción separado lanza el pad. Arrastrar copia pads. Los cambios automáticos conservan el pad editado. El ritmo tiene 1–32 pasos, independientemente de su duración (1–8 o 16 pulsos maestros). Por defecto: 16 semicorcheas y cuatro pulsos. Repetir el mismo pad continúa la frase; cambiar de pad la reinicia. Edita grupos y supergrupos en Patrones y frases y colócalos con silencios en el arreglador multipista. En modo Arreglo, la reproducción inicia una escucha en el siguiente límite de pad/silencio, hasta Volver al arreglo. El modo Live conserva el siguiente ciclo o compás maestro.

Acciones: Siguiente nota, Posición en el acorde circular, Silencio, Ligadura o Acorde. Las posiciones usan el conjunto ascendente ampliado por octavas. Una ligadura prolonga la nota/acorde anterior; sin anterior queda en silencio. Ajuste velocidad relativa, duración hasta 200%, probabilidad y 1–4 repeticiones rápidas. Los silencios/fallos conservan el cursor salvo con Avanzar en silencios. Repeticiones de nota repite alturas. Izquierda/Derecha selecciona, Espacio alterna silencio, Supr inserta silencio, T liga, C toca acorde, N restaura Siguiente nota.

Las notas de vista previa usan letras grandes; las cuadrículas estrechas se desplazan horizontalmente. Pase el puntero sobre un paso para leer todas las notas y sus grados, también accesibles a lectores de pantalla. Seguir origen y Personalizado usan los colores del teclado en los bordes: 1 rojo, 2 naranja, 3 amarillo, 4 verde, 5 turquesa, 6 azul, 7 violeta. Los grados corresponden a las alturas generadas tras transposición y cuantización, usando la escala de origen de cada nota o la del pad como respaldo. Los acordes muestran segmentos iguales y separados en orden de grado; las repeticiones de octava conservan el color. Escala desactivada, vista previa ausente, silencios y ligaduras mantienen bordes neutros. La vista previa solo aparece en el pad que se reproduce. El contorno exterior cian indica la selección; el fondo de reproducción y el foco del teclado siguen separados.

### Expresión, armonía y presets

Swing conserva la duración de cada pareja. Rango completo amplía octavas antes del orden; Octava por octava es una alternativa. Velocidad de entrada, fija o aleatoria. Repetir variación usa la semilla guardada; Evolucionar varía por ciclo; Nueva variación cambia la semilla. Escala: Desactivado, Seguir origen con respaldo del pad o Personalizado. Vista previa de alturas, escala efectiva y resaltado audible explican el resultado.

Los presets afectan solo al pad editado. Modificado, Actualizar preset y Guardar como preset conservan rutas y otros pads. Los cambios se agrupan durante 80 ms y se aplican en el bloque de audio; un error conserva la configuración activa. Contraer conserva borradores y reproducción.

La versión 15 migra los ajustes antiguos a #1, los acentos a velocidades e inicializa los demás pads. Las performances adoptan Arreglador, retención desactivada, Continuar, swing corregido y rango completo. Guardar/exportar persiste la migración; notas retenidas y lanzamientos pendientes no se guardan.`
};
