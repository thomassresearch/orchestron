import type { GuiLanguage } from "../types";

/** The clip workflow has its own entry point; legacy pad arrangements keep their help. */
export const clipArrangerHelp: Record<GuiLanguage, string> = {
  english: `## Arrange clips and reusable content

The lane header shows the assigned rack instrument below the track name, alongside its MIDI information and controls. Select the lane and open the Inspector to read long instrument names in full. Controller lanes list their target channels. Arpeggiators show input → output. Click the channel badge, such as **CH01 ▾**, to choose a channel or add a sound by category. The **+** in Compact rack adds a sound directly. Right-click a rack instrument to remove it. A warning lists any tracks using it. Select a nested occurrence, then press **Editor** or Enter. The breadcrumb shows the repetition you are editing.

Choose **Add track** for a Melodic, Score, Drummer, Controller or Arpeggiator lane. The **Add track** control sits below the lanes. The new track focuses its channel and its editor stays closed. Click the track header to expand it. Double-click empty timeline space or use the track **+** to create an empty four-beat clip; its inline **+** adds patterns, groups, supergroups or rests.

Drag a clip header to move its window and its edges to trim it. Start, length and source offset use master beats. **Once** plays content once, then leaves silence; **Loop** repeats it inside the fixed window. Trimming retains hidden content. **Fit clip to content** explicitly changes the window. Moving or deleting a clip leaves other clips in place; clips on the same lane cannot overlap.

Click the clip header to select the whole window. Right-click anywhere inside it for **Duplicate clip** or **Delete clip**. Duplicate uses the next gap that fits on the same track. Click a pattern or group to select its contents. Right-click within a selected range to keep the range.

The ruler and tracks share subdivisions, beats, bars and four-bar accents. Zoom out for longer intervals. Expand a track to see its own meter and speed when its timing differs.

### Edit and save

Amber marks identify pending edits. A plus marks a new clip and hatching marks a former position. Open the change count to see affected clips, including linked uses. Arrange Play previews the batch across tracks. Close the editor to continue elsewhere.

**Undo** and **Redo** step through gestures. **Save** commits them together, so one Undo restores the previous arrangement. **Cancel** restores it at the current playhead. Save Performance, autosave and export use the committed arrangement.

Right-click a pattern and choose **Rename pattern**, edit **Pattern name** and save. In the Inspector, click the pencil beside a clip or pattern name.

Double-click a pattern, group or supergroup, or focus its name and press Enter. The original loop pass opens its linked definition directly. On a later pass, choose **Edit linked** to update every use or **Create variation here** to edit only this occurrence. The editor keeps the scope visible; **Change scope** preserves your edits. **Play edit** auditions the draft. Save uses the chosen scope without asking again. A local loop variation splits the clip into before, edited and after windows.

Loop repetitions use a lighter fill and ↻; ↔ marks shared content. Selecting one occurrence highlights its linked uses without selecting them for moving or deleting. Counts include arranged repetitions and off-screen clips; unused references and repeating lane cycles are shown separately. The selection toolbar and context menu offer the same editing actions.

The first direct structural action waits for a scope choice when it changes shared definitions.

Save Performance, autosave and export use the committed arrangement. New, Load and Import ask before replacing pending work.

### Sections, pitch and lane controls

Section operations join the pending arrangement edits. The last 25 saved edits are available after reloading.

Use **↕** to transpose patterns, groups or supergroups without changing their notes. Shared repetition settings and local placement offsets can combine; review the scope before saving. Lane Mute/Solo is temporary, independent of Mixer Mute/Solo, and excluded from saved performances.`,
  german: `## Clips und wiederverwendbare Inhalte anordnen

Unter dem Spurnamen steht das zugewiesene Rack-Instrument. MIDI-Kanal und Spurbedienelemente bleiben im Spurkopf sichtbar. Wähle die Spur und öffne den Inspektor, um lange Instrumentennamen vollständig zu lesen. Controller-Spuren zeigen ihre Zielkanäle, Arpeggiatoren den Eingang → Ausgang. Klicke auf **CH01 ▾** im Spurkopf, um den Kanal zu wählen oder ein Instrument nach Kategorie hinzuzufügen. Das **+** im kompakten Rack fügt ein Instrument direkt hinzu. Das Kontextmenü entfernt ein Instrument oder zeigt die Spuren, die es verwenden. Wähle ein verschachteltes Vorkommen und drücke **Editor** oder die Eingabetaste. Der Pfad zeigt den bearbeiteten Durchlauf.

Mit **Spur hinzufügen** eine Melodie-, Score-, Drummer-, Controller- oder Arpeggiator-Spur erstellen. Das **+** unter den Spuren setzt den Fokus auf den Kanal der neuen Spur. Der Editor bleibt geschlossen. Den Spurkopf anklicken, um die Spur aufzuklappen. Ein Doppelklick auf freie Zeitleistenfläche oder das **+** der Spur erstellt einen leeren Clip mit vier Schlägen; sein internes **+** fügt Patterns, Gruppen, Supergruppen oder Pausen hinzu.

Den Clip-Kopf ziehen, um sein Fenster zu verschieben; die Ränder ziehen, um es zu beschneiden. Start, Länge und Quellversatz verwenden Master-Schläge. **Einmal** spielt den Inhalt einmal und lässt danach Stille; **Schleife** wiederholt ihn im festen Fenster. Beschneiden erhält verborgene Inhalte. **Clip an Inhalt anpassen** ändert das Fenster ausdrücklich. Verschieben oder Löschen lässt andere Clips an ihrer Position; Clips derselben Spur dürfen sich nicht überlappen.

Klicke auf den Clip-Kopf, um das ganze Fenster auszuwählen. Ein Rechtsklick im Fenster öffnet **Clip duplizieren** und **Clip löschen**. Die Kopie kommt in die nächste passende Lücke derselben Spur. Klicke auf ein Pattern oder eine Gruppe, um den Inhalt auszuwählen. Ein Rechtsklick im markierten Bereich behält die Auswahl bei.

Lineal und Spuren teilen Unterteilungen, Schläge, Takte und Viertaktmarken. Beim Herauszoomen werden größere Abstände sichtbar. Eine aufgeklappte Spur mit anderem Takt oder Tempoverhältnis zeigt zusätzlich ihr eigenes Raster.

### Bearbeiten und speichern

Bernsteinfarbene Markierungen zeigen Änderungen. Ein Plus kennzeichnet neue Clips, eine Schraffur die frühere Position. Die Änderungsübersicht nennt auch verknüpfte Verwendungen außerhalb des sichtbaren Bereichs. Die Wiedergabe berücksichtigt alle Spuren. Beim Schließen des Editors bleiben die Änderungen erhalten.

**Rückgängig** und **Wiederholen** gelten für einzelne Bearbeitungsschritte. **Speichern** übernimmt sie gemeinsam als einen Schritt. **Abbrechen** stellt das gespeicherte Arrangement an der aktuellen Abspielposition wieder her. Performance-Speicherung, Autosave und Export verwenden das übernommene Arrangement.

Klicke mit der rechten Maustaste auf ein Pattern, wähle **Pattern umbenennen**, ändere den **Patternnamen** und speichere. Klicke im Inspektor auf den Stift neben dem Clip- oder Patternnamen.

Ein Pattern, eine Gruppe oder Supergruppe doppelklicken oder den Namen fokussieren und Enter drücken. Im ersten Schleifendurchlauf öffnet sich die verknüpfte Definition direkt. Bei einer Wiederholung ändert **Verknüpftes Pattern bearbeiten** alle Vorkommen. **Hier eine Variante erstellen** ändert nur dieses Vorkommen. Das gilt auch für Gruppen und Supergruppen. Der Umfang bleibt sichtbar; **Umfang ändern** erhält die Bearbeitung. **Entwurf abspielen** hört vor. Speichern verwendet den gewählten Umfang ohne erneute Abfrage. Eine lokale Schleifenvariante teilt den Clip in Fenster davor, bearbeitet und danach.

Wiederholungen erscheinen heller mit ↻; ↔ kennzeichnet verknüpften Inhalt. Ein ausgewähltes Vorkommen hebt seine Verknüpfungen hervor, ohne sie zum Verschieben oder Löschen auszuwählen. Zähler enthalten angeordnete Wiederholungen und nicht sichtbare Clips; ungenutzte Verweise und Spurzyklen werden separat angezeigt. Auswahlleiste und Kontextmenü bieten dieselben Bearbeitungsaktionen.

Die erste direkte Strukturaktion wartet bei gemeinsam genutzten Definitionen auf die Umfangswahl.

Performance-Speicherung, Autosave und Export verwenden das gespeicherte Arrangement. Neu, Laden und Importieren fragen vor dem Ersetzen eines Entwurfs nach.

### Abschnitte, Tonhöhe und Spurregler

Abschnittsänderungen gehören zum aktuellen Entwurf. Die letzten 25 gespeicherten Bearbeitungen bleiben nach dem Laden verfügbar.

Mit **↕** Patterns, Gruppen oder Supergruppen transponieren, ohne ihre Noten zu ändern. Gemeinsame Wiederholungseinstellungen und lokale Platzierungsversätze können sich addieren; vor dem Speichern den Geltungsbereich prüfen. Spur-Stumm/Solo ist temporär, unabhängig vom Mischpult und wird nicht mit der Performance gespeichert.`,
  french: `## Organiser les clips et les contenus réutilisables

Le nom de l’instrument du rack figure sous le nom de la piste. Le canal MIDI et les commandes restent visibles dans l’en-tête. Sélectionnez la piste et ouvrez l’Inspecteur pour lire les noms d’instruments en entier. Les pistes de contrôleur affichent leurs canaux cibles et les arpégiateurs indiquent entrée → sortie. Cliquez sur **CH01 ▾** dans l’en-tête pour choisir un canal ou ajouter un instrument par catégorie. Le **+** du rack compact ajoute un instrument. Son menu contextuel permet de le retirer ou affiche les pistes qui l’utilisent. Sélectionnez une occurrence imbriquée puis activez **Éditeur** ou appuyez sur Entrée. Le chemin indique le passage en cours de modification.

Choisissez **Ajouter une piste** mélodique, de partition, de batterie, de contrôleur ou d’arpégiateur. Le **+** sous les pistes place le focus sur le canal de la nouvelle piste. L’éditeur reste fermé. Cliquez sur l’en-tête de piste pour la déplier. Double-cliquez dans une zone vide de la chronologie ou utilisez le **+** de la piste pour créer un clip vide de quatre temps ; son **+** interne ajoute motifs, groupes, supergroupes ou silences.

Glissez l’en-tête d’un clip pour déplacer sa fenêtre et ses bords pour la rogner. Début, durée et décalage de source utilisent les temps maîtres. **Une fois** joue le contenu une fois, puis laisse du silence ; **Boucle** le répète dans la fenêtre fixe. Rogner conserve le contenu masqué. **Ajuster le clip au contenu** modifie explicitement la fenêtre. Déplacer ou supprimer un clip laisse les autres en place ; les clips d’une même piste ne peuvent pas se chevaucher.

Cliquez sur l’en-tête du clip pour sélectionner toute la fenêtre. Un clic droit dans celle-ci propose **Dupliquer le clip** et **Supprimer le clip**. La copie occupe le prochain espace libre assez grand sur la piste. Cliquez sur un motif ou un groupe pour sélectionner son contenu. Un clic droit dans une plage sélectionnée conserve cette plage.

La règle et les pistes partagent subdivisions, temps, mesures et accents toutes les quatre mesures. Un zoom arrière espace les repères. Dépliez une piste dont la mesure ou la vitesse diffère pour voir sa grille locale.

### Modifier et enregistrer

Les marques ambre indiquent les modifications. Un plus signale un nouveau clip, les hachures son ancienne position. Ouvrez le récapitulatif pour voir les utilisations liées hors écran. La lecture tient compte de toutes les pistes. Fermer l’éditeur conserve les modifications.

Avant l’enregistrement, vous pouvez annuler ou rétablir chaque geste. **Enregistrer** valide tout le lot en une seule opération réversible. **Annuler** restaure l’arrangement enregistré à la position de lecture actuelle. La bibliothèque, la sauvegarde automatique et l’export utilisent la version validée.

Faites un clic droit sur un motif, choisissez **Renommer le motif**, modifiez le **Nom du motif** et enregistrez. Dans l’inspecteur, cliquez sur le crayon à côté du nom du clip ou du motif.

Double-cliquez sur un motif, groupe ou supergroupe, ou focalisez son nom et appuyez sur Entrée. Le premier passage de la boucle ouvre directement la définition liée. Sur une répétition, choisissez **Modifier le motif lié** pour modifier toutes les occurrences ou **Créer une variante ici** pour modifier uniquement celle-ci. Ce choix vaut aussi pour les groupes et supergroupes. La portée reste visible ; **Changer la portée** conserve vos modifications. **Écouter le brouillon** permet de l’auditionner. L’enregistrement utilise la portée choisie sans nouvelle question. Une variante locale de boucle sépare le clip en fenêtres avant, modifiée et après.

Les répétitions ont un fond plus clair et ↻ ; ↔ indique le contenu partagé. Sélectionner une occurrence met ses utilisations liées en évidence sans les sélectionner pour un déplacement ou une suppression. Les compteurs incluent les répétitions placées et les clips hors écran ; les références inutilisées et cycles de piste sont indiqués séparément. La barre de sélection et le menu contextuel proposent les mêmes actions.

La première action structurelle directe attend un choix de portée si elle modifie des définitions partagées.

La bibliothèque, la sauvegarde automatique et l’export utilisent l’arrangement validé. Nouveau, Charger et Importer demandent confirmation avant de remplacer les modifications en cours.

### Sections, hauteur et commandes de piste

Les opérations sur les sections rejoignent les modifications en cours. Les 25 dernières opérations enregistrées restent disponibles après rechargement.

Utilisez **↕** pour transposer motifs, groupes ou supergroupes sans modifier leurs notes. Les réglages de répétition partagés et les décalages locaux peuvent s’additionner ; vérifiez la portée avant d’enregistrer. Muet/Solo de piste est temporaire, indépendant du mixeur et exclu des performances enregistrées.`,
  spanish: `## Organizar clips y contenido reutilizable

El instrumento del rack aparece junto al canal de la pista. El canal MIDI y los controles siguen visibles en la cabecera. Selecciona la pista y abre el Inspector para leer los nombres completos de los instrumentos. Las pistas de controlador indican sus canales de destino y los arpegiadores muestran entrada → salida. Pulsa **CH01 ▾** en la cabecera para elegir un canal o añadir un instrumento por categoría. El **+** del rack compacto añade un instrumento. Su menú contextual permite quitarlo o muestra las pistas que lo usan. Selecciona una aparición anidada y pulsa **Editor** o Intro. La ruta muestra la pasada que estás editando.

Elige **Añadir pista** melódica, de partitura, batería, controlador o arpegiador. El **+** debajo de las pistas sitúa el foco en el canal de la pista nueva. El editor permanece cerrado. Haz clic en la cabecera de pista para expandirla. Haz doble clic en un espacio vacío de la línea temporal o usa el **+** de la pista para crear un clip vacío de cuatro pulsos; su **+** interno añade patrones, grupos, supergrupos o silencios.

Arrastra la cabecera de un clip para mover su ventana y sus bordes para recortarla. Inicio, duración y desplazamiento de origen usan pulsos maestros. **Una vez** reproduce el contenido una vez y después deja silencio; **Bucle** lo repite dentro de la ventana fija. Recortar conserva el contenido oculto. **Ajustar clip al contenido** cambia la ventana explícitamente. Mover o eliminar un clip deja los demás en su sitio; los clips de una misma pista no pueden solaparse.

Haz clic en la cabecera del clip para seleccionar toda la ventana. Un clic derecho dentro de ella ofrece **Duplicar clip** y **Eliminar clip**. La copia ocupa el siguiente hueco suficiente en la misma pista. Haz clic en un patrón o grupo para seleccionar su contenido. Un clic derecho dentro de un rango seleccionado conserva el rango.

La regla y las pistas comparten subdivisiones, pulsos, compases y acentos cada cuatro compases. Al alejar la vista, aumenta la distancia musical entre las marcas. Expande una pista con otro compás o velocidad para ver su cuadrícula local.

### Editar y guardar

Las marcas ámbar identifican los cambios. Un signo más indica un clip nuevo y el rayado muestra la posición anterior. Abre el resumen para ver los usos vinculados fuera de pantalla. La reproducción incluye los cambios de todas las pistas. Cerrar el editor conserva los cambios.

**Deshacer** y **Rehacer** recorren los gestos individuales. **Guardar** confirma el conjunto como una sola operación reversible. **Cancelar** restaura el arreglo guardado en la posición de reproducción actual. La biblioteca, el autoguardado y la exportación utilizan el arreglo confirmado.

Haz clic derecho en un patrón, elige **Renombrar patrón**, edita el **Nombre del patrón** y guarda. En el Inspector, pulsa el lápiz junto al nombre del clip o del patrón.

Haz doble clic en un patrón, grupo o supergrupo, o enfoca su nombre y pulsa Enter. La primera pasada del bucle abre directamente la definición vinculada. En una repetición, elige **Editar patrón vinculado** para cambiar todas las apariciones o **Crear variación aquí** para cambiar solo esa aparición. Lo mismo se aplica a los grupos y supergrupos. El alcance permanece visible; **Cambiar alcance** conserva tus cambios. **Reproducir edición** permite escuchar el borrador. Guardar utiliza el alcance elegido sin volver a preguntar. Una variación local de bucle separa el clip en ventanas anterior, editada y posterior.

Las repeticiones usan un fondo más claro y ↻; ↔ indica contenido compartido. Seleccionar una aparición resalta sus usos vinculados sin seleccionarlos para moverlos o eliminarlos. Los contadores incluyen repeticiones colocadas y clips fuera de pantalla; las referencias sin usar y los ciclos de pista aparecen por separado. La barra de selección y el menú contextual ofrecen las mismas acciones.

La primera acción estructural directa espera un alcance si modifica definiciones compartidas.

La biblioteca, el autoguardado y la exportación utilizan el arreglo confirmado. Nuevo, Cargar e Importar piden confirmación antes de sustituir los cambios pendientes.

### Secciones, altura y controles de pista

Las operaciones con secciones se incorporan a los cambios pendientes. Las últimas 25 operaciones guardadas siguen disponibles al volver a cargar.

Usa **↕** para transponer patrones, grupos o supergrupos sin cambiar sus notas. Los ajustes compartidos de repetición y los desplazamientos locales pueden sumarse; revisa el alcance antes de guardar. Silencio/Solo de pista es temporal, independiente del mezclador y no se guarda con la interpretación.`
};
