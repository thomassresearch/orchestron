import type { GuiLanguage } from "../types";

export const arrangementHelp: Record<GuiLanguage, string> = {
  english: `## Song order and reusable phrases

The multitrack arranger is the only song-order editor. Select a lane to use its pad, group, supergroup and rest palette. Drag or Add into available silence; occupied destinations are rejected. Insert and shift later items works at boundaries on this lane only. Delete/Backspace leaves equal-duration silence; Remove and close gap closes time. Rest-edge drags and Duration edits shift later items. Fit includes trailing rests.

Click a pad to edit it; selection never launches playback. Playing, Queued and Auditioning are separate from Editing. Sequencers and arranger Edit share the same definition library. Changes affect all occurrences; length changes shift subsequent material. Unused and empty draft definitions are retained. Empty drafts cannot be placed or auditioned; referenced definitions cannot be emptied or deleted. The library shows their uses. Duplicate occurrence retains a reference; Create variation copies the definition or uses an available pad slot.

Playback source selects Arrangement or Manual pads. At end selects Stop track or Repeat track sequence in the arranger. New devices stop; imported repeat settings remain. Empty lanes are manual; adding their first item selects Arrangement. Loop selected range is a separate shared loop.

Audition temporarily repeats a pad or phrase on this track, beginning at its next pad/rest boundary. Other tracks continue. Return to arrangement takes effect at the next boundary at the current song position, including rests and ended tracks. Stop audition stops this track without restarting the song. With transport stopped, audition starts only this track. Seeks and loops restart auditions from their first token. Queued audition changes take effect at the seek or loop destination. Song boundaries remain authoritative.

Arranger Play clears auditions, starts Arrangement lanes and stops Manual pads sequencers. Stop clears auditions and stops Arrangement lanes while preserving independently started manual tracks. Live arpeggiators retain their existing behavior. Audition state is never saved or exported; musical edits still save normally.`,
  german: `## Songfolge und wiederverwendbare Phrasen

Nur der Multitrack Arranger bearbeitet die Songfolge. Eine Spur wählen und Pads, Gruppen, Supergruppen oder Pausen aus der Palette ziehen oder hinzufügen. Belegte Ziele werden abgelehnt. Einfügen und Folgeelemente verschieben funktioniert an Elementgrenzen nur auf dieser Spur. Delete/Backspace lässt gleich lange Stille; Entfernen und Lücke schließen verkürzt die Zeit. Pausenrand oder Dauer ändern verschiebt folgende Elemente. Einpassen berücksichtigt Endpausen.

Ein Pad anklicken wählt es zum Bearbeiten, ohne Wiedergabe auszulösen. Bearbeitung, Wiedergabe, Vormerkung und Vorhören sind getrennt. Sequencer und Arranger nutzen denselben Definitionseditor. Änderungen gelten für alle Vorkommen; Längenänderungen verschieben Folgematerial. Unbenutzte Definitionen und leere Entwürfe bleiben erhalten. Leere Entwürfe lassen sich nicht platzieren oder vorhören; verwendete Definitionen nicht leeren oder löschen. Verwendungen werden angezeigt. Duplizieren behält die Referenz; Variation erstellen kopiert die Definition oder nutzt einen freien Pad-Platz.

Wiedergabequelle wählt Arrangement oder Manuelle Pads. Am Ende bietet im Arranger Spur stoppen oder Spursequenz wiederholen. Neue Geräte stoppen; importierte Einstellungen bleiben erhalten. Leere Spuren sind manuell; das erste Element aktiviert Arrangement. Ausgewählten Bereich wiederholen ist der gemeinsame Transport-Loop.

Vorhören wiederholt ein Pad oder eine Phrase ab der nächsten Pad-/Pausengrenze nur auf dieser Spur. Andere Spuren laufen weiter. Zurück zum Arrangement rekonstruiert an der nächsten Grenze die aktuelle Songposition, auch in Pausen oder nach dem Spur-Ende. Vorhören stoppen stoppt diese Spur ohne automatischen Neustart. Bei gestopptem Transport startet Vorhören nur diese Spur. Positionswechsel und Loops starten das Vorhören beim ersten Token; vorgemerkte Vorhörwechsel gelten am Ziel. Songgrenzen gelten weiterhin.

Arranger-Play beendet Vorhören, startet Arrangement-Spuren und stoppt manuelle Sequencer. Stop beendet Vorhören und Arrangement-Spuren; unabhängig gestartete manuelle Spuren laufen weiter. Live-Arpeggiatoren bleiben unabhängig. Vorhörzustände werden weder gespeichert noch exportiert; musikalische Änderungen werden normal gespeichert.`,
  french: `## Ordre du morceau et phrases réutilisables

Seul l’arrangeur multipiste modifie l’ordre du morceau. Sélectionnez une piste et utilisez la palette de pads, groupes, supergroupes et silences. Glissez ou ajoutez dans un espace libre ; les destinations occupées sont refusées. Insérer et décaler la suite agit aux limites des éléments sur cette piste. Suppr/Retour arrière laisse un silence équivalent ; Supprimer et fermer l’espace retire la durée. Redimensionner un silence décale la suite. Ajuster inclut les silences finaux.

Cliquer sur un pad le sélectionne pour l’édition sans le lancer. Édition, Lecture, En attente et Écoute temporaire sont distincts. Le séquenceur et l’action Modifier de l’arrangeur partagent l’éditeur de définitions. Les changements affectent toutes les occurrences ; la durée décale les suivantes. Les définitions inutilisées et brouillons vides restent enregistrés. Un brouillon vide ne peut être placé ni écouté ; une définition référencée ne peut être vidée ni supprimée. Ses utilisations sont affichées. Dupliquer conserve la référence ; Créer une variation copie la définition ou utilise un pad libre.

Source de lecture choisit Arrangement ou Pads manuels. À la fin choisit Arrêter la piste ou Répéter la séquence dans l’arrangeur. Les nouveaux appareils s’arrêtent ; les réglages importés restent intacts. Une piste vide est manuelle ; son premier élément active Arrangement. Boucler la plage sélectionnée commande la boucle commune.

Écouter répète temporairement un pad ou une phrase sur cette piste dès la prochaine limite de pad/silence. Les autres pistes continuent. Retour à l’arrangement reprend à la prochaine limite la position actuelle, y compris un silence ou une piste terminée. Arrêter l’écoute stoppe cette piste sans relancer son arrangement. Transport arrêté, seule cette piste démarre. Les déplacements et boucles reprennent l’écoute au premier élément ; les changements d’écoute en attente s’appliquent à destination. Les limites du morceau restent prioritaires.

Play termine les écoutes, lance les pistes Arrangement et arrête les séquenceurs manuels. Stop termine les écoutes et pistes Arrangement, en préservant les pistes manuelles lancées séparément. Les arpégiateurs Live restent indépendants. L’écoute temporaire n’est ni sauvegardée ni exportée ; les modifications musicales le sont.`,
  spanish: `## Orden del tema y frases reutilizables

Solo el arreglador multipista edita el orden del tema. Selecciona una pista y usa su paleta de pads, grupos, supergrupos y silencios. Arrastra o añade en un hueco libre; se rechazan destinos ocupados. Insertar y desplazar los siguientes actúa en límites de elementos de esta pista. Supr/Retroceso deja silencio de igual duración; Eliminar y cerrar hueco retira el tiempo. Cambiar el borde o duración de un silencio desplaza lo siguiente. Ajustar incluye silencios finales.

Pulsar un pad lo selecciona para editar sin lanzarlo. Edición, Reproducción, En espera y Escucha temporal son estados separados. Secuenciadores y Editar del arreglador comparten el editor de definiciones. Los cambios afectan todas las apariciones; cambiar duración desplaza las siguientes. Se conservan definiciones sin usar y borradores vacíos. Un borrador vacío no puede colocarse ni escucharse; una definición referenciada no puede vaciarse ni borrarse. Se muestran sus usos. Duplicar conserva la referencia; Crear una variación copia la definición o usa un pad libre.

Fuente de reproducción elige Arreglo o Pads manuales. Al finalizar elige Detener pista o Repetir secuencia en el arreglador. Los dispositivos nuevos se detienen; se conservan los ajustes importados. Una pista vacía es manual; su primer elemento activa Arreglo. Repetir intervalo seleccionado es el bucle compartido.

Escuchar repite temporalmente un pad o frase de esta pista desde el próximo límite de pad/silencio. Las demás continúan. Volver al arreglo restaura en el próximo límite la posición actual, incluso silencios o pistas terminadas. Detener escucha para esta pista sin reiniciar su arreglo. Con transporte detenido inicia solo esta pista. Saltos y bucles reinician la escucha desde su primer elemento; los cambios de escucha pendientes se aplican en el destino. Los límites del tema siguen vigentes.

Play termina las escuchas, inicia pistas Arreglo y detiene secuenciadores manuales. Stop termina escuchas y pistas Arreglo, conservando pistas manuales iniciadas aparte. Los arpegiadores Live siguen independientes. La escucha temporal no se guarda ni exporta; los cambios musicales sí.`
};
