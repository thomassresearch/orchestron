import type { GuiLanguage } from "../types";

export const scoreHelp: Record<GuiLanguage, string> = {
  english: `## Collect a melody on the keyboard

Choose a MIDI Channel matching a rack instrument. Press and hold a vertical piano key to hear that pitch at velocity 100; release it to stop. Focused keys also respond to Enter and Space. The instrument engine starts automatically if needed, without starting the score or arranger. It stays running until you stop it. A key released during startup is cancelled. Scale colours guide your playing; all 128 MIDI pitches remain available.

Double-click a key to append one quarter note at velocity 100 to the pad being edited. An empty pad starts at zero; otherwise the note starts exactly after the latest note end, including hidden notes. This ignores the drawing subdivision. A quarter note is one local beat in /4 or two in /8. Pattern length stays fixed: if the complete note will not fit, increase Pattern length first. Insertion works even when audio is unavailable. Each insertion is one Undo action and selects and reveals the new note. Collect pitches first, then arrange their rhythm and duration.

## Draw, select and edit

- Draw: drag empty space to create a note. Drag a note to move it; drag either edge to resize it. These gestures snap to the selected subdivision. Changing subdivision leaves existing notes in place.
- Select: drag a rectangle; Ctrl/Cmd-click adds or removes notes. Drag selected notes together.
- Right-click a note, or select it and press Shift+F10, for velocity and Add chord. In scale and Out of scale chords inherit the root's start, duration and velocity; identical notes are not duplicated.
- Copy/Paste uses the last clicked score position; the clipboard is shared between this device's pads. Delete/Backspace removes selected notes. Ctrl/Cmd+A selects all, C/V copies/pastes, Z undoes and Shift+Z redoes. Escape cancels a gesture.
- Time zoom, Pitch zoom and Fit score control the view. The keyboard stays on the left. − ♪ / + ♪ transpose by a scale degree; Shift transposes an octave. Scale and Mode change highlighting without moving notes.

## Edit a pattern in the clip arranger

Choose Add track → Score, then add a clip with the track's + or by double-clicking empty lane space. In the clip, choose + / Add content → New pattern. Double-click the nested pattern box (or focus its name and press Enter) to open this Score editor. Hold keys to audition and double-click to collect quarter notes. Play edit auditions the pattern. Save chooses Only this occurrence (a new variation) or All linked occurrences; cancelling retains the draft. Save the pattern before saving/exporting the performance. Pattern length and the clip window are independent; musical saves keep clip boundaries. Fit clip to content adjusts the window. The clip breadcrumb and draft controls replace the old pad workspace/source controls.

## Length, pads and playback

The grid ends at Pattern length. Drawing, resizing the right edge or moving a note can place its end exactly on that boundary; resizing the left edge keeps its end fixed. Empty space beyond the boundary does not create notes.

Each device has eight pads. Meter, subdivision and playback speed apply to the whole device; Pattern length and scale belong to the edited pad. Length supports 1–8,192 whole local beats. Set length to arrangement uses the other arranged lanes. Shortening preserves hidden notes; expand to recover them or use Trim hidden notes to remove/cut them. Each pad supports 10,000 notes; a performance supports 16 Score Sequencers and 50,000 score notes.

Play starts the selected source. Manual pads plays the editing pad; while running, another pad click selects it for editing and queues it at Next bar or End of score. Orange is queued, cyan is playing. Stopped or Arrangement devices only select the editing pad on a pad click. Copy pad to copies notes, length and scale. Assemble phrases in the pattern workspace and song order in the arranger. Hold a speaker for 250 ms to preview a phrase; release restores prior playback.

Each pad has 25 Undo/Redo actions. Selection, clipboard, history, zoom and scroll survive collapse during the session; New/Load/Import reset them. Collapse releases held keyboard notes while sequenced playback continues. Live score edits use the existing preparation path. Save and native export preserve notes, hidden material and pad settings. The ? button opens this help in the selected GUI language.`,
  german: `## Eine Melodie auf der Klaviatur sammeln

Wähle einen MIDI-Kanal, der zu einem Rack-Instrument passt. Halte eine Taste der vertikalen Klaviatur gedrückt, um den Ton mit Anschlagstärke 100 zu hören; Loslassen beendet ihn. Fokussierte Tasten reagieren auch auf Enter und Leertaste. Die Instrument-Engine startet bei Bedarf automatisch, ohne Partitur oder Arranger zu starten. Sie läuft bis zum manuellen Stoppen weiter. Während des Starts losgelassene Tasten werden verworfen. Tonleiterfarben geben Orientierung; alle 128 MIDI-Töne bleiben verfügbar.

Ein Doppelklick hängt eine Viertelnote mit Anschlagstärke 100 an das bearbeitete Pad an. Ein leeres Pad beginnt bei null; sonst beginnt die Note genau nach dem spätesten Notenende, einschließlich verborgener Noten. Das Zeichenraster wird ignoriert. Eine Viertelnote entspricht einem lokalen Beat in /4 oder zwei in /8. Die Pattern-Länge bleibt fest: Passt die vollständige Note nicht hinein, erhöhe zuerst die Pattern-Länge. Einfügen funktioniert auch ohne Audio. Jeder Doppelklick ist ein Rückgängig-Schritt und wählt die neue Note aus und zeigt sie an. Sammle zuerst Tonhöhen und bearbeite danach Rhythmus und Dauer.

## Zeichnen, auswählen und bearbeiten

- Zeichnen: Im leeren Bereich ziehen erstellt eine Note. Noten ziehen verschiebt sie; beide Ränder ändern die Dauer. Diese Gesten rasten im gewählten Raster ein. Ein Rasterwechsel verschiebt vorhandene Noten nicht.
- Auswählen: Einen Rahmen ziehen; Strg/Cmd-Klick ergänzt oder entfernt Noten. Ausgewählte Noten lassen sich gemeinsam verschieben.
- Rechtsklick auf eine Note oder Auswahl und Umschalt+F10 öffnet Anschlagstärke und Akkord hinzufügen. Akkorde innerhalb und außerhalb der Tonleiter übernehmen Beginn, Dauer und Anschlagstärke des Grundtons; identische Noten werden nicht dupliziert.
- Kopieren/Einfügen verwendet die zuletzt angeklickte Partiturposition; die Zwischenablage gilt für alle Pads dieses Geräts. Entf/Rücktaste löscht die Auswahl. Strg/Cmd+A wählt alles, C/V kopiert/fügt ein, Z macht rückgängig und Umschalt+Z wiederholt. Escape bricht Gesten ab.
- Zeitzoom, Tonhöhenzoom und Gesamte Partitur steuern die Ansicht. Die Klaviatur bleibt links. − ♪ / + ♪ transponiert um eine Tonleiterstufe, mit Umschalt um eine Oktave. Tonleiter und Modus ändern die Hervorhebung, ohne Noten zu verschieben.

## Ein Pattern im Clip-Arranger bearbeiten

Wähle Spur hinzufügen → Partitur und füge mit dem + der Spur oder per Doppelklick in die leere Spur einen Clip hinzu. Im Clip wählst du + / Inhalt hinzufügen → Neues Pattern. Doppelklicke auf das enthaltene Pattern (oder fokussiere seinen Namen und drücke Enter), um diesen Score-Editor zu öffnen. Halte Tasten zum Probehören und sammle Viertelnoten per Doppelklick. Entwurf abspielen spielt das Pattern vor. Speichern bietet Nur dieses Vorkommen (eine neue Variation) oder Alle verknüpften Vorkommen; Abbrechen behält den Entwurf. Speichere das Pattern vor dem Speichern/Exportieren der Performance. Pattern-Länge und Clip-Fenster sind unabhängig; musikalische Änderungen behalten die Clip-Grenzen. Clip an Inhalt anpassen ändert das Fenster. Clip-Pfad und Entwurfssteuerung ersetzen die alte Pad-Arbeitsfläche und Quellenwahl.

## Länge, Pads und Wiedergabe

Das Raster endet an der Pattern-Länge. Zeichnen, Ziehen am rechten Rand oder Verschieben kann eine Note genau an dieser Grenze enden lassen; Ziehen am linken Rand behält das Ende bei. Im leeren Bereich dahinter entstehen keine Noten.

Jedes Gerät hat acht Pads. Taktart, Raster und Wiedergabegeschwindigkeit gelten geräteweit; Pattern-Länge und Tonleiter gehören zum bearbeiteten Pad. Die Länge umfasst 1–8.192 ganze lokale Beats. Länge an Arrangement anpassen verwendet die anderen arrangierten Spuren. Verkürzen bewahrt verborgene Noten: Verlängern stellt sie wieder her, Verborgene Noten abschneiden entfernt oder kürzt sie. Pro Pad sind 10.000 Noten erlaubt, pro Performance 16 Score-Sequenzer und 50.000 Score-Noten.

Start spielt die gewählte Quelle. Manuelle Pads startet das bearbeitete Pad. Während der Wiedergabe wählt ein anderer Pad-Klick dieses zum Bearbeiten und merkt es für Nächster Takt oder Partiturende vor. Orange bedeutet vorgemerkt, Cyan spielt. Bei gestoppten Geräten oder Arrangement wählt der Klick nur das bearbeitete Pad. Pad kopieren nach übernimmt Noten, Länge und Tonleiter. Phrasen in der Pattern-Arbeitsfläche zusammenstellen, die Songreihenfolge im Arranger. Einen Lautsprecher 250 ms halten startet die Phrasenvorschau; Loslassen stellt die vorige Wiedergabe wieder her.

Jedes Pad hat 25 Rückgängig-/Wiederholen-Schritte. Auswahl, Zwischenablage, Verlauf, Zoom und Scrollposition bleiben beim Einklappen in der Sitzung erhalten; Neu/Laden/Import setzt sie zurück. Einklappen beendet gehaltene Klaviaturnoten, während Sequenzen weiterspielen. Live-Änderungen verwenden die vorhandene Vorbereitung. Speichern und nativer Export erhalten Noten, verborgenes Material und Pad-Einstellungen. ? öffnet diese Hilfe in der gewählten GUI-Sprache.`,
  french: `## Composer une mélodie au clavier

Choisissez un canal MIDI correspondant à un instrument du rack. Maintenez une touche du clavier vertical pour entendre cette hauteur à la vélocité 100 ; relâchez pour l’arrêter. Une touche ayant le focus répond aussi à Entrée et Espace. Le moteur démarre automatiquement si nécessaire, sans lancer la partition ni l’arrangeur. Il reste actif jusqu’à son arrêt manuel. Une touche relâchée pendant le démarrage est annulée. Les couleurs de gamme vous guident ; les 128 hauteurs MIDI restent disponibles.

Double-cliquez sur une touche pour ajouter une noire à la vélocité 100 au pad en cours d’édition. Un pad vide commence à zéro ; sinon la note commence exactement après la fin la plus tardive, notes masquées comprises. Cette insertion ignore la subdivision de dessin. Une noire vaut un temps local en /4 ou deux en /8. La longueur du motif reste fixe : si la note entière ne tient pas, augmentez d’abord cette longueur. L’insertion fonctionne même sans audio. Chaque insertion est une action Annuler et sélectionne et affiche la nouvelle note. Choisissez d’abord les hauteurs, puis ajustez rythme et durée.

## Dessiner, sélectionner et modifier

- Dessiner : glissez dans le vide pour créer une note. Déplacez une note ou tirez l’un de ses bords pour modifier sa durée. Ces gestes suivent la subdivision choisie ; changer celle-ci ne déplace pas les notes existantes.
- Sélectionner : tracez un cadre ; Ctrl/Cmd-clic ajoute ou retire des notes. Déplacez ensemble les notes sélectionnées.
- Clic droit sur une note, ou sélection puis Maj+F10, ouvre vélocité et Ajouter un accord. Les accords Dans la gamme et Hors gamme héritent du début, de la durée et de la vélocité de la fondamentale ; les notes identiques ne sont pas dupliquées.
- Copier/Coller utilise la dernière position cliquée dans la partition ; le presse-papiers est partagé entre les pads de cet appareil. Suppr/Retour arrière efface la sélection. Ctrl/Cmd+A sélectionne tout, C/V copie/colle, Z annule et Maj+Z rétablit. Échap annule un geste.
- Zoom temporel, Zoom des hauteurs et Afficher la partition règlent la vue. Le clavier reste à gauche. − ♪ / + ♪ transpose d’un degré, ou d’une octave avec Maj. Gamme et Mode modifient le surlignage sans déplacer les notes.

## Modifier un motif dans l’arrangeur de clips

Choisissez Ajouter une piste → Partition, puis ajoutez un clip avec le + de la piste ou un double-clic dans la piste vide. Dans le clip, choisissez + / Ajouter du contenu → Nouveau motif. Double-cliquez sur le motif imbriqué (ou placez le focus sur son nom et appuyez sur Entrée) pour ouvrir cet éditeur de partition. Maintenez les touches pour écouter et double-cliquez pour ajouter des noires. Écouter le brouillon préécoute le motif. Enregistrer propose Cette occurrence uniquement (une nouvelle variation) ou Toutes les occurrences liées ; annuler conserve le brouillon. Enregistrez le motif avant de sauvegarder/exporter la performance. Longueur du motif et fenêtre du clip sont indépendantes ; les modifications musicales conservent les limites du clip. Ajuster le clip au contenu modifie la fenêtre. Le fil du clip et les commandes du brouillon remplacent l’ancien espace de pads et le choix de source.

## Longueur, pads et lecture

La grille s’arrête à la longueur du motif. Dessiner, tirer le bord droit ou déplacer une note permet de la terminer exactement à cette limite ; tirer le bord gauche conserve sa fin. L’espace vide au-delà ne crée pas de notes.

Chaque appareil possède huit pads. Mesure, subdivision et vitesse s’appliquent à l’appareil ; longueur et gamme appartiennent au pad édité. La longueur accepte 1 à 8 192 temps locaux entiers. Adapter à l’arrangement utilise les autres pistes arrangées. Raccourcir conserve les notes masquées : allongez pour les retrouver ou utilisez Supprimer les notes masquées pour les supprimer/raccourcir. Limites : 10 000 notes par pad, 16 séquenceurs de partition et 50 000 notes de partition par performance.

Lecture démarre la source choisie. Pads manuels joue le pad édité ; pendant la lecture, cliquer sur un autre pad le sélectionne pour l’édition et programme son lancement à Mesure suivante ou Fin de partition. Orange indique l’attente, cyan la lecture. À l’arrêt ou en mode Arrangement, un clic ne change que le pad édité. Copier le pad vers conserve notes, longueur et gamme. Assemblez les phrases dans l’espace de motifs et l’ordre du morceau dans l’arrangeur. Maintenez un haut-parleur 250 ms pour préécouter une phrase ; relâcher restaure la lecture précédente.

Chaque pad possède 25 actions Annuler/Rétablir. Sélection, presse-papiers, historique, zoom et défilement survivent au repli pendant la session ; Nouveau/Charger/Importer les réinitialise. Replier relâche les touches tenues sans arrêter les séquences. Les modifications en direct suivent la préparation habituelle. Sauvegarde et export natif conservent notes, contenu masqué et réglages. ? ouvre cette aide dans la langue de l’interface.`,
  spanish: `## Crear una melodía con el teclado

Elige un canal MIDI que corresponda a un instrumento del rack. Mantén una tecla del piano vertical para oír esa altura con velocidad 100; suéltala para detenerla. Las teclas enfocadas también responden a Intro y Espacio. El motor arranca automáticamente cuando hace falta, sin iniciar la partitura ni el arreglador. Sigue activo hasta que lo detengas. Una tecla soltada durante el arranque se cancela. Los colores de escala sirven de guía; las 128 alturas MIDI siguen disponibles.

Haz doble clic en una tecla para añadir una negra con velocidad 100 al pad que editas. Un pad vacío empieza en cero; en otro caso, la nota empieza exactamente después del final más tardío, incluidas las notas ocultas. Esta inserción ignora la subdivisión de dibujo. Una negra ocupa un pulso local en /4 o dos en /8. La longitud del patrón permanece fija: si la nota completa no cabe, aumenta primero la longitud. La inserción funciona incluso sin audio. Cada inserción es una acción Deshacer y selecciona y muestra la nota nueva. Elige las alturas primero y ajusta después el ritmo y la duración.

## Dibujar, seleccionar y editar

- Dibujar: arrastra en un espacio vacío para crear una nota. Arrastra una nota para moverla, o cualquiera de sus bordes para cambiar su duración. Estos gestos siguen la subdivisión elegida; cambiarla no mueve las notas existentes.
- Seleccionar: arrastra un marco; Ctrl/Cmd-clic añade o quita notas. Mueve juntas las notas seleccionadas.
- Clic derecho en una nota, o selección y Mayús+F10, abre velocidad y Añadir acorde. Los acordes En la escala y Fuera de la escala heredan inicio, duración y velocidad de la raíz; no se duplican notas idénticas.
- Copiar/Pegar usa la última posición pulsada en la partitura; el portapapeles se comparte entre los pads del dispositivo. Supr/Retroceso borra la selección. Ctrl/Cmd+A selecciona todo, C/V copia/pega, Z deshace y Mayús+Z rehace. Escape cancela un gesto.
- Zoom temporal, Zoom de altura y Ver partitura completa controlan la vista. El teclado permanece a la izquierda. − ♪ / + ♪ transpone un grado, o una octava con Mayús. Escala y Modo cambian el resaltado sin mover notas.

## Editar un patrón en el arreglador de clips

Elige Añadir pista → Partitura y añade un clip con el + de la pista o con doble clic en la pista vacía. Dentro del clip, elige + / Añadir contenido → Nuevo patrón. Haz doble clic en el patrón anidado (o enfoca su nombre y pulsa Intro) para abrir este editor de partitura. Mantén las teclas para escuchar y haz doble clic para añadir negras. Escuchar borrador permite escuchar el patrón. Guardar ofrece Solo esta aparición (una variación nueva) o Todas las apariciones vinculadas; cancelar conserva el borrador. Guarda el patrón antes de guardar/exportar la performance. La longitud del patrón y la ventana del clip son independientes; las ediciones musicales conservan los límites del clip. Ajustar clip al contenido modifica la ventana. La ruta del clip y los controles del borrador sustituyen el antiguo espacio de pads y el selector de fuente.

## Longitud, pads y reproducción

La cuadrícula termina en la longitud del patrón. Dibujar, arrastrar el borde derecho o mover una nota permite terminarla exactamente en ese límite; arrastrar el borde izquierdo conserva su final. El espacio vacío posterior no crea notas.

Cada dispositivo tiene ocho pads. Compás, subdivisión y velocidad de reproducción se aplican al dispositivo; longitud y escala pertenecen al pad editado. La longitud admite 1–8192 pulsos locales enteros. Ajustar al arreglo usa las otras pistas arregladas. Acortar conserva las notas ocultas: amplía para recuperarlas o usa Recortar notas ocultas para eliminarlas/recortarlas. Límites: 10 000 notas por pad, 16 secuenciadores de partitura y 50 000 notas de partitura por performance.

Reproducir inicia la fuente elegida. Pads manuales reproduce el pad editado; durante la reproducción, pulsar otro pad lo selecciona para editar y programa su inicio en Próximo compás o Fin de partitura. Naranja indica espera y cian reproducción. Detenido o en modo Arreglo, pulsar un pad solo cambia la selección de edición. Copiar pad a conserva notas, longitud y escala. Monta frases en el espacio de patrones y el orden de la canción en el arreglador. Mantén un altavoz 250 ms para escuchar una frase; soltar restaura la reproducción anterior.

Cada pad tiene 25 acciones Deshacer/Rehacer. Selección, portapapeles, historial, zoom y desplazamiento sobreviven al plegado durante la sesión; Nuevo/Cargar/Importar los reinicia. Plegar libera las teclas mantenidas mientras las secuencias siguen sonando. Las ediciones en directo usan la preparación existente. Guardar y exportar en formato nativo conserva notas, contenido oculto y ajustes. ? abre esta ayuda en el idioma de la interfaz.`
};
