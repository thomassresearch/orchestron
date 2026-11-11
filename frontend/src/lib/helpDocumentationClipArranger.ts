import type { GuiLanguage } from "../types";

/** The clip workflow has its own entry point; legacy pad arrangements keep their help. */
export const clipArrangerHelp: Record<GuiLanguage, string> = {
  english: `## Arrange clips and reusable content

Choose **Add track** for a Melodic, Score, Drummer, Controller or Arpeggiator lane. Assign its instrument and MIDI channel in the rack. Click the track header to expand it. Double-click empty timeline space or use the track **+** to create an empty four-beat clip; its inline **+** adds patterns, groups, supergroups or rests.

Drag a clip header to move its window and its edges to trim it. Start, length and source offset use master beats. **Once** plays content once, then leaves silence; **Loop** repeats it inside the fixed window. Trimming retains hidden content. **Fit clip to content** explicitly changes the window. Moving or deleting a clip leaves other clips in place; clips on the same lane cannot overlap.

### Edit and save

Double-click a pattern, group or supergroup, or focus its name and press Enter. For shared content, choose **Edit linked pattern/group/supergroup** or **Create variation here** before editing. Independent content opens directly. The editor keeps the scope visible; **Change scope** preserves your edits. **Play edit** auditions the draft. Save uses the chosen scope without asking again. A local loop variation splits the clip into before, edited and after windows.

Loop repetitions use a lighter fill and ↻; ↔ marks shared content. Selecting one occurrence highlights its linked uses without selecting them for moving or deleting. Counts include arranged repetitions and off-screen clips; unused references and repeating lane cycles are shown separately. The selection toolbar and context menu offer the same editing actions.

The first direct structural action waits for a scope choice when it changes shared definitions. Cancel leaves the draft and selection unchanged; subsequent actions reuse the choice. Root-only edits and grouping across repetitions are local. Scope, affected definitions, window changes and collision errors appear before **Save structure**. Musical conflicts use their already chosen scope.

Performance save and export use saved definitions. Resolve changed drafts or explicitly choose the saved version. Autosave does not commit drafts; drafts survive view switches but not a reload. New, Load and Import ask you to resolve them.

### Sections, pitch and lane controls

**Sections** copies all tracks or the selected track and previews overwrite, insertion or closing time before applying one undoable edit. Undo/Redo retains up to 25 clip edits; adding or removing tracks clears clip history.

Use **↕** to transpose patterns, groups or supergroups without changing their notes. Shared repetition settings and local placement offsets can combine; review the scope before saving. Lane Mute/Solo is temporary, independent of Mixer Mute/Solo, and excluded from saved performances.`,
  german: `## Clips und wiederverwendbare Inhalte anordnen

Mit **Spur hinzufügen** eine Melodie-, Score-, Drummer-, Controller- oder Arpeggiator-Spur erstellen. Instrument und MIDI-Kanal im Rack zuweisen. Den Spurkopf anklicken, um die Spur aufzuklappen. Ein Doppelklick auf freie Zeitleistenfläche oder das **+** der Spur erstellt einen leeren Clip mit vier Schlägen; sein internes **+** fügt Patterns, Gruppen, Supergruppen oder Pausen hinzu.

Den Clip-Kopf ziehen, um sein Fenster zu verschieben; die Ränder ziehen, um es zu beschneiden. Start, Länge und Quellversatz verwenden Master-Schläge. **Einmal** spielt den Inhalt einmal und lässt danach Stille; **Schleife** wiederholt ihn im festen Fenster. Beschneiden erhält verborgene Inhalte. **Clip an Inhalt anpassen** ändert das Fenster ausdrücklich. Verschieben oder Löschen lässt andere Clips an ihrer Position; Clips derselben Spur dürfen sich nicht überlappen.

### Bearbeiten und speichern

Ein Pattern, eine Gruppe oder Supergruppe doppelklicken oder den Namen fokussieren und Enter drücken. Bei verknüpftem Inhalt vorab **Verknüpftes Pattern/Gruppe/Supergruppe bearbeiten** oder **Hier eine Variante erstellen** wählen. Unabhängiger Inhalt öffnet sich direkt. Der Umfang bleibt sichtbar; **Umfang ändern** erhält die Bearbeitung. **Entwurf abspielen** hört vor. Speichern verwendet den gewählten Umfang ohne erneute Abfrage. Eine lokale Schleifenvariante teilt den Clip in Fenster davor, bearbeitet und danach.

Wiederholungen erscheinen heller mit ↻; ↔ kennzeichnet verknüpften Inhalt. Ein ausgewähltes Vorkommen hebt seine Verknüpfungen hervor, ohne sie zum Verschieben oder Löschen auszuwählen. Zähler enthalten angeordnete Wiederholungen und nicht sichtbare Clips; ungenutzte Verweise und Spurzyklen werden separat angezeigt. Auswahlleiste und Kontextmenü bieten dieselben Bearbeitungsaktionen.

Die erste direkte Strukturaktion wartet bei gemeinsam genutzten Definitionen auf die Umfangswahl. Abbrechen erhält Entwurf und Auswahl; weitere Aktionen verwenden denselben Umfang. Änderungen nur an der Clip-Wurzel und Gruppieren über Wiederholungen hinweg sind lokal. Umfang, betroffene Definitionen, Fensteränderungen und Kollisionen erscheinen vor **Struktur speichern**. Musikalische Konflikte verwenden den bereits gewählten Umfang.

Performance-Speichern und Export verwenden gespeicherte Definitionen. Geänderte Entwürfe auflösen oder ausdrücklich die gespeicherte Fassung wählen. Autosave übernimmt keine Entwürfe; sie überstehen Ansichtswechsel, aber kein Neuladen. Neu, Laden und Import verlangen ihre Auflösung.

### Abschnitte, Tonhöhe und Spurregler

**Abschnitte** kopiert alle Spuren oder die ausgewählte Spur und zeigt vor Überschreiben, Einfügen oder Schließen von Zeit eine Vorschau. Die Änderung ist als Ganzes rückgängig machbar. Undo/Redo erhält bis zu 25 Clip-Änderungen; Hinzufügen oder Entfernen von Spuren leert diesen Verlauf.

Mit **↕** Patterns, Gruppen oder Supergruppen transponieren, ohne ihre Noten zu ändern. Gemeinsame Wiederholungseinstellungen und lokale Platzierungsversätze können sich addieren; vor dem Speichern den Geltungsbereich prüfen. Spur-Stumm/Solo ist temporär, unabhängig vom Mischpult und wird nicht mit der Performance gespeichert.`,
  french: `## Organiser les clips et les contenus réutilisables

Choisissez **Ajouter une piste** mélodique, de partition, de batterie, de contrôleur ou d’arpégiateur. Attribuez son instrument et son canal MIDI dans le rack. Cliquez sur l’en-tête de piste pour la déplier. Double-cliquez dans une zone vide de la chronologie ou utilisez le **+** de la piste pour créer un clip vide de quatre temps ; son **+** interne ajoute motifs, groupes, supergroupes ou silences.

Glissez l’en-tête d’un clip pour déplacer sa fenêtre et ses bords pour la rogner. Début, durée et décalage de source utilisent les temps maîtres. **Une fois** joue le contenu une fois, puis laisse du silence ; **Boucle** le répète dans la fenêtre fixe. Rogner conserve le contenu masqué. **Ajuster le clip au contenu** modifie explicitement la fenêtre. Déplacer ou supprimer un clip laisse les autres en place ; les clips d’une même piste ne peuvent pas se chevaucher.

### Modifier et enregistrer

Double-cliquez sur un motif, groupe ou supergroupe, ou focalisez son nom et appuyez sur Entrée. Pour le contenu partagé, choisissez **Modifier le motif/groupe/supergroupe lié** ou **Créer une variante ici** avant de modifier. Le contenu indépendant s’ouvre directement. La portée reste visible ; **Changer la portée** conserve vos modifications. **Écouter le brouillon** permet de l’auditionner. L’enregistrement utilise la portée choisie sans nouvelle question. Une variante locale de boucle sépare le clip en fenêtres avant, modifiée et après.

Les répétitions ont un fond plus clair et ↻ ; ↔ indique le contenu partagé. Sélectionner une occurrence met ses utilisations liées en évidence sans les sélectionner pour un déplacement ou une suppression. Les compteurs incluent les répétitions placées et les clips hors écran ; les références inutilisées et cycles de piste sont indiqués séparément. La barre de sélection et le menu contextuel proposent les mêmes actions.

La première action structurelle directe attend un choix de portée si elle modifie des définitions partagées. Annuler conserve le brouillon et la sélection ; les actions suivantes réutilisent le choix. Les modifications de la racine seule et le groupement entre répétitions sont locaux. Portée, définitions affectées, changements des fenêtres et collisions apparaissent avant **Enregistrer la structure**. Les conflits musicaux utilisent la portée déjà choisie.

L’enregistrement de la performance et l’export utilisent les définitions enregistrées. Résolvez les brouillons modifiés ou choisissez explicitement la version enregistrée. La sauvegarde automatique ne valide pas les brouillons ; ils survivent aux changements de vue, mais pas au rechargement. Nouveau, Charger et Importer demandent de les résoudre.

### Sections, hauteur et commandes de piste

**Sections** copie toutes les pistes ou la piste sélectionnée et prévisualise l’écrasement, l’insertion ou la fermeture du temps avant une modification annulable en une étape. Annuler/Rétablir conserve jusqu’à 25 modifications de clips ; ajouter ou supprimer une piste efface cet historique.

Utilisez **↕** pour transposer motifs, groupes ou supergroupes sans modifier leurs notes. Les réglages de répétition partagés et les décalages locaux peuvent s’additionner ; vérifiez la portée avant d’enregistrer. Muet/Solo de piste est temporaire, indépendant du mixeur et exclu des performances enregistrées.`,
  spanish: `## Organizar clips y contenido reutilizable

Elige **Añadir pista** melódica, de partitura, batería, controlador o arpegiador. Asigna su instrumento y canal MIDI en el rack. Haz clic en la cabecera de pista para expandirla. Haz doble clic en un espacio vacío de la línea temporal o usa el **+** de la pista para crear un clip vacío de cuatro pulsos; su **+** interno añade patrones, grupos, supergrupos o silencios.

Arrastra la cabecera de un clip para mover su ventana y sus bordes para recortarla. Inicio, duración y desplazamiento de origen usan pulsos maestros. **Una vez** reproduce el contenido una vez y después deja silencio; **Bucle** lo repite dentro de la ventana fija. Recortar conserva el contenido oculto. **Ajustar clip al contenido** cambia la ventana explícitamente. Mover o eliminar un clip deja los demás en su sitio; los clips de una misma pista no pueden solaparse.

### Editar y guardar

Haz doble clic en un patrón, grupo o supergrupo, o enfoca su nombre y pulsa Enter. Para contenido compartido, elige **Editar patrón/grupo/supergrupo vinculado** o **Crear variación aquí** antes de editar. El contenido independiente se abre directamente. El alcance permanece visible; **Cambiar alcance** conserva tus cambios. **Reproducir edición** permite escuchar el borrador. Guardar utiliza el alcance elegido sin volver a preguntar. Una variación local de bucle separa el clip en ventanas anterior, editada y posterior.

Las repeticiones usan un fondo más claro y ↻; ↔ indica contenido compartido. Seleccionar una aparición resalta sus usos vinculados sin seleccionarlos para moverlos o eliminarlos. Los contadores incluyen repeticiones colocadas y clips fuera de pantalla; las referencias sin usar y los ciclos de pista aparecen por separado. La barra de selección y el menú contextual ofrecen las mismas acciones.

La primera acción estructural directa espera un alcance si modifica definiciones compartidas. Cancelar conserva el borrador y la selección; las acciones siguientes reutilizan el alcance. Los cambios solo en la raíz y la agrupación entre repeticiones son locales. El alcance, las definiciones afectadas, los cambios de ventanas y las colisiones aparecen antes de **Guardar estructura**. Los conflictos musicales utilizan el alcance ya elegido.

Guardar la interpretación y exportar usan las definiciones guardadas. Resuelve los borradores modificados o elige explícitamente la versión guardada. El autoguardado no confirma borradores; estos sobreviven a cambios de vista, pero no a una recarga. Nuevo, Cargar e Importar piden resolverlos.

### Secciones, altura y controles de pista

**Secciones** copia todas las pistas o la seleccionada y muestra una vista previa antes de sobrescribir, insertar o cerrar tiempo como una única edición deshacible. Deshacer/Rehacer conserva hasta 25 ediciones de clips; añadir o eliminar pistas borra ese historial.

Usa **↕** para transponer patrones, grupos o supergrupos sin cambiar sus notas. Los ajustes compartidos de repetición y los desplazamientos locales pueden sumarse; revisa el alcance antes de guardar. Silencio/Solo de pista es temporal, independiente del mezclador y no se guarda con la interpretación.`
};
