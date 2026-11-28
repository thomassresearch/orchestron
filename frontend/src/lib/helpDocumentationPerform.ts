import type { HelpDocId } from "../types";
import { performanceControllerHelp } from "./helpDocumentationPerformanceControllers";
import type { HelpDocumentSet } from "./helpDocumentationTypes";

export const performHelpDocuments: HelpDocumentSet<Extract<HelpDocId, `perform_${string}`>> = {
  perform_project_transport: {
    english: {
      title: "Project and song transport",
      markdown: `### Load and save a performance

Open **Project** and choose a song under **Load Performance**, or choose **New** to start one. Enter its name and description, then click **Save Performance** in the top bar to store the song, rack and mix. Use **Clone** to make a separate copy. Use **Export** and **Import** to move a performance between installations. Stop the instruments before loading or importing.

### Play and move through the song

**Play** starts or resumes the song and starts the instruments if needed. **Pause** holds the current position. **Stop** returns to the loop start or the beginning of the song. Rewind and fast-forward move one beat at a time. Enter a beat in **Position** and press Enter to jump there. Enter the tempo in **BPM** and press Enter or leave the field to apply it to the whole performance. Escape restores the previous value.

### Repeat a passage

In Arrange, select a clip or a range of patterns inside it, then turn on **Loop** to repeat that passage across all tracks. To repeat the whole song, click empty timeline space to clear the selection first. Click **Loop** again to turn it off. In older pad-based arrangements, **Loop** toggles whole-song repetition. Drag across the arranger’s loop ruler to repeat a shorter range.`
    },
    german: {
      title: "Projekt und Songtransport",
      markdown: `### Performance laden und speichern

Öffne **Projekt** und wähle unter **Performance laden** einen Song aus. Mit **Neu** beginnst du einen neuen Song. Gib Namen und Beschreibung ein und klicke oben auf **Performance speichern**, um Song, Rack und Mix zu sichern. **Klonen** erstellt eine eigene Kopie. Mit Export und Import überträgst du eine Performance auf eine andere Installation. Stoppe die Instrumente vor dem Laden oder Importieren.

### Song abspielen und Position wechseln

Mit der Wiedergabetaste startest du den Song oder setzt ihn fort. Bei Bedarf starten die Instrumente mit. **Pause** hält die aktuelle Position. **Stopp** kehrt zum Schleifenanfang oder zum Songanfang zurück. Mit Rücklauf und Vorlauf springst du jeweils einen Schlag. Gib unter **Position** einen Schlag ein und drücke die Eingabetaste, um dorthin zu springen. Gib das Tempo unter **BPM** ein. Mit der Eingabetaste oder beim Verlassen des Felds übernimmst du es für die gesamte Performance. Escape stellt den bisherigen Wert wieder her.

### Eine Passage wiederholen

Wähle im Arrangement einen Clip oder mehrere aufeinanderfolgende Patterns darin aus. Aktiviere **Wiederholen**, damit alle Spuren diese Passage wiederholen. Für den ganzen Song hebst du zuerst die Auswahl mit einem Klick auf eine freie Stelle der Zeitleiste auf. Klicke erneut auf **Wiederholen**, um die Schleife auszuschalten. In älteren Pad-Arrangements schaltet **Wiederholen** die Wiederholung des ganzen Songs ein oder aus. Ziehe auf dem Schleifenlineal des Arrangers einen kürzeren Bereich auf, um nur diesen zu wiederholen.`
    },
    french: {
      title: "Projet et lecture du morceau",
      markdown: `### Charger et enregistrer une performance

Ouvrez **Projet** et choisissez un morceau dans **Charger performance**, ou cliquez sur **Nouveau** pour en créer un. Saisissez son nom et sa description, puis cliquez sur **Enregistrer performance** dans la barre du haut pour conserver le morceau, le rack et le mixage. **Cloner** crée une copie indépendante. L’export et l’import permettent de transférer une performance entre installations. Arrêtez les instruments avant de charger ou d’importer un morceau.

### Lire le morceau et se déplacer

Le bouton de lecture lance ou reprend le morceau et démarre les instruments si nécessaire. **Pause** garde la position actuelle. Le bouton d’arrêt ramène au début de la boucle ou du morceau. Les boutons de recul et d’avance déplacent le curseur d’un temps. Saisissez un temps dans **Position** et appuyez sur Entrée pour le rejoindre. Saisissez le tempo dans **BPM**, puis appuyez sur Entrée ou quittez le champ pour l’appliquer à toute la performance. Échap rétablit la valeur précédente.

### Répéter un passage

Dans Arrangement, sélectionnez un clip ou une suite de motifs à l’intérieur du clip, puis activez **Boucle**. Toutes les pistes répètent ce passage. Pour répéter le morceau entier, cliquez d’abord dans un espace vide de la chronologie pour effacer la sélection. Cliquez à nouveau sur **Boucle** pour la désactiver. Dans les anciens arrangements à pads, **Boucle** active ou désactive la répétition du morceau entier. Pour répéter un passage plus court, délimitez-le en faisant glisser le pointeur sur la règle de boucle de l’arrangeur.`
    },
    spanish: {
      title: "Proyecto y reproducción de la canción",
      markdown: `### Cargar y guardar una interpretación

Abre **Proyecto** y elige una canción en **Cargar performance**, o pulsa **Nuevo** para crear una. Escribe el nombre y la descripción y pulsa **Guardar performance** en la barra superior para guardar la canción, el rack y la mezcla. **Clonar** crea una copia independiente. Usa la exportación y la importación para llevar la canción a otra instalación. Detén los instrumentos antes de cargar o importar.

### Reproducir y cambiar de posición

El botón de reproducción inicia o reanuda la canción y arranca los instrumentos si hace falta. **Pausa** mantiene la posición actual. El botón de parada vuelve al inicio del bucle o de la canción. Los botones de retroceso y avance desplazan el cursor un pulso. Escribe un pulso en **Posición** y pulsa Intro para saltar hasta él. Escribe el tempo en **BPM** y pulsa Intro o sal del campo para aplicarlo a toda la interpretación. Esc restaura el valor anterior.

### Repetir un pasaje

En Arreglo, selecciona un clip o varios patrones consecutivos dentro de él y activa **Bucle**. Todas las pistas repetirán ese pasaje. Para repetir toda la canción, haz clic primero en un espacio vacío de la línea de tiempo para quitar la selección. Pulsa **Bucle** otra vez para desactivarlo. En los arreglos antiguos basados en pads, **Bucle** activa o desactiva la repetición de toda la canción. Para repetir un pasaje más corto, arrastra el puntero sobre la regla de bucle del arreglador.`
    }
  },
  perform_arrange: {
    english: {
      title: "Arrange",
      markdown: `Use **Add track** to choose a track type, then place clips on its timeline in the order you want to hear them. Select a clip to see its properties in the **Inspector**. Expand the track to see the patterns inside a clip.

Double-click a pattern to edit its notes, drum hits or controller curve. For a shared pattern, choose whether to change this occurrence or all linked occurrences. Use **Play edit** to hear the draft. The arranger’s **Save** applies the edits together. **Save Performance** stores the song.

In an older pad-based arrangement, double-click a pad occurrence to edit the physical pad. Every occurrence of that pad plays the edit.`
    },
    german: {
      title: "Arrangement",
      markdown: `Wähle über **Spur hinzufügen** einen Spurtyp und platziere Clips in der gewünschten Spielreihenfolge auf der Zeitleiste. Wähle einen Clip aus, um seine Eigenschaften im **Inspektor** zu sehen. Klappe die Spur auf, um die Patterns im Clip zu sehen.

Öffne ein Pattern per Doppelklick, um Noten, Schlagzeugschläge oder eine Reglerkurve zu bearbeiten. Bei einem gemeinsam genutzten Pattern wählst du, ob du dieses Vorkommen oder alle verknüpften Vorkommen ändern möchtest. Mit **Entwurf abspielen** hörst du deine Änderungen. **Speichern** im Arranger übernimmt die Änderungen zusammen. **Performance speichern** sichert den Song.

In älteren Pad-Arrangements öffnet ein Doppelklick auf ein Vorkommen das zugehörige Pad. Seine Änderungen sind an jeder Stelle zu hören, an der dieses Pad spielt.`
    },
    french: {
      title: "Arrangement",
      markdown: `Choisissez un type de piste avec **Ajouter une piste**, puis placez les clips dans l’ordre de lecture sur sa chronologie. Sélectionnez un clip pour voir ses propriétés dans l’**Inspecteur**. Dépliez la piste pour voir les motifs du clip.

Double-cliquez sur un motif pour modifier ses notes, ses frappes de batterie ou sa courbe de contrôle. Pour un motif partagé, choisissez si la modification porte sur cette occurrence ou sur toutes les occurrences liées. **Écouter le brouillon** permet d’entendre le résultat. **Enregistrer** dans l’arrangeur applique les modifications ensemble. **Enregistrer performance** conserve le morceau.

Dans un ancien arrangement à pads, double-cliquez sur une occurrence pour modifier le pad physique. La modification s’entend à chaque occurrence de ce pad.`
    },
    spanish: {
      title: "Arreglo",
      markdown: `Elige un tipo de pista con **Añadir pista** y coloca los clips en la línea de tiempo en el orden en que quieras oírlos. Selecciona un clip para ver sus propiedades en el **Inspector**. Despliega la pista para ver los patrones del clip.

Haz doble clic en un patrón para editar sus notas, golpes de batería o curva de control. Si el patrón se comparte, elige si quieres cambiar esta aparición o todas las apariciones vinculadas. **Escuchar borrador** permite oír los cambios. **Guardar** en el arreglador aplica las ediciones juntas. **Guardar performance** conserva la canción.

En un arreglo antiguo basado en pads, haz doble clic en una aparición para editar el pad físico. El cambio se escucha en cada aparición de ese pad.`
    }
  },
  perform_live: {
    english: {
      title: "Live",
      markdown: `Find the device by its name, MIDI channel and instrument. Select a pattern, then press **Play** in that device’s row. During playback, tap another pad to queue it. For manual pads, the device row shows when it will switch. Score pads default to the next bar. The playing and queued indicators show which pattern you hear now and which comes next.

Hold a pad’s speaker briefly to preview it. Release it to return to the underlying part. Open **Keyboard** to play along. To edit one of a device’s eight pads, choose **Edit physical pads**, select the pad and open its editor. Open **Arrange** to edit a saved arrangement pattern.`
    },
    german: {
      title: "Live",
      markdown: `Suche das Gerät anhand von Name, MIDI-Kanal und Instrument. Wähle ein Pattern und drücke die Wiedergabetaste in der Gerätezeile. Tippe während der Wiedergabe auf ein anderes Pad, um es vorzumerken. Bei manuellen Pads zeigt die Gerätezeile den Umschaltzeitpunkt an. Partitur-Pads wechseln standardmäßig zum nächsten Takt. Die Markierungen zeigen, welches Pattern gerade spielt und welches als Nächstes kommt.

Halte das Lautsprechersymbol eines Pads kurz gedrückt, um es vorzuhören. Lass los, um wieder den ursprünglichen Part zu hören. Öffne die **Klaviatur**, um mitzuspielen. Um eines der acht Geräte-Pads zu bearbeiten, wechsle zu den physischen Pads, wähle das Pad aus und öffne seinen Editor. Gespeicherte Arrangement-Patterns bearbeitest du im **Arrangement**.`
    },
    french: {
      title: "Live",
      markdown: `Repérez l’appareil grâce à son nom, son canal MIDI et son instrument. Sélectionnez un motif, puis appuyez sur le bouton de lecture de sa ligne. Pendant la lecture, touchez un autre pad pour le mettre en attente. Pour les pads manuels, la ligne de l’appareil indique le moment du changement. Les pads de partition passent par défaut à la mesure suivante. Les indicateurs distinguent le motif audible de celui qui prendra le relais.

Maintenez brièvement le bouton du haut-parleur d’un pad pour le préécouter. Relâchez-le pour retrouver la partie en cours. Ouvrez le **Clavier** pour jouer en même temps. Pour modifier l’un des huit pads d’un appareil, passez aux pads physiques, sélectionnez le pad et ouvrez son éditeur. Ouvrez **Arrangement** pour modifier un motif enregistré dans l’arrangement.`
    },
    spanish: {
      title: "En vivo",
      markdown: `Localiza el dispositivo por su nombre, canal MIDI e instrumento. Selecciona un patrón y pulsa el botón de reproducción de esa fila. Durante la reproducción, toca otro pad para ponerlo en cola. En los pads manuales, la fila del dispositivo indica cuándo se producirá el cambio. Los pads de partitura cambian por defecto en el siguiente compás. Los indicadores muestran el patrón que suena y el que entrará después.

Mantén pulsado un momento el altavoz de un pad para escucharlo. Suéltalo para volver a la parte que estaba sonando. Abre **Teclado** para tocar a la vez. Para editar uno de los ocho pads del dispositivo, cambia a los pads físicos, selecciona uno y abre su editor. Abre **Arreglo** para editar un patrón guardado del arreglo.`
    }
  },
  perform_mix: {
    english: {
      title: "Mix",
      markdown: `Start in **Rack** to add an instrument and assign its MIDI channel. Open **Routing** to connect its output to an effect or Master. In **Mixer**, play the song and balance the channels while listening.

Use **Compact rack** to select an instrument. Open its controls to adjust the sound, or choose **Samples** for a Sample Player. In DX7 instrument controls, import a 32-voice SysEx bank into slot 1–16 while stopped. Click **Save Performance** in the DX7 controls, then choose another cartridge slot for the next file. Use the adjacent **Preset** control when the instrument supplies one. Bank 0 contains the instrument sounds. Bank and program changes apply to new notes. Switching Mix pages keeps the song playing. Use **Save Performance** to keep the instruments, their connections and the mix together.`
    },
    german: {
      title: "Mix",
      markdown: `Füge im **Rack** ein Instrument hinzu und weise ihm einen MIDI-Kanal zu. Verbinde unter **Routing** seinen Ausgang mit einem Effekt oder dem Master. Starte den Song und stimme im **Mischpult** die Kanalpegel beim Hören aufeinander ab.

Wähle im **kompakten Rack** ein Instrument aus. Öffne die Instrumentregler, um den Klang einzustellen, oder **Samples** für einen Sample Player. Importiere bei gestoppten Instrumenten eine SysEx-Bank mit 32 Stimmen in Platz 1–16 der DX7-Instrumentregler. Klicke dort auf **Performance speichern** und wähle für die nächste Datei einen anderen Speicherplatz. Hat das Instrument einen **Preset**-Regler, findest du ihn neben der Bankauswahl. Bank 0 enthält die Instrumentklänge. Bank und Programm gelten ab der nächsten Note. Beim Wechsel zwischen den Mix-Seiten spielt der Song weiter. Mit **Performance speichern** sicherst du die Instrumente, ihre Verbindungen und den Mix zusammen.`
    },
    french: {
      title: "Mixage",
      markdown: `Dans **Rack**, ajoutez un instrument et affectez-lui un canal MIDI. Ouvrez **Routage** pour relier sa sortie à un effet ou au Master. Lancez le morceau et équilibrez les niveaux à l’oreille dans le **Mixeur**.

Sélectionnez un instrument dans le **Rack compact**. Ouvrez ses commandes pour régler le son, ou choisissez **Échantillons** pour un Sample Player. Dans les commandes DX7, importez à l’arrêt une banque SysEx de 32 voix dans un emplacement de 1 à 16. Cliquez sur **Enregistrer performance** dans les commandes DX7, puis choisissez un autre emplacement pour le fichier suivant. Si l’instrument possède une commande **Preset**, elle se trouve à côté du sélecteur de banque. La banque 0 contient les sons de l’instrument. Les changements s’appliquent aux nouvelles notes. La lecture continue quand vous changez de page de mixage. **Enregistrer performance** conserve ensemble les instruments, leurs connexions et le mixage.`
    },
    spanish: {
      title: "Mezcla",
      markdown: `En **Rack**, añade un instrumento y asígnale un canal MIDI. Abre **Rutas** para conectar su salida a un efecto o al Máster. Reproduce la canción y equilibra los niveles de oído en el **Mezclador**.

Selecciona un instrumento en **Rack compacto**. Abre sus controles para ajustar el sonido, o elige **Muestras** si usas un Sample Player. Con los instrumentos detenidos, importa un banco SysEx de 32 voces en las ranuras 1–16 de los controles DX7. Pulsa **Guardar performance** en esos controles y elige otra ranura para el siguiente archivo. Si el instrumento tiene un control **Preset**, aparece junto al selector de banco. El banco 0 contiene los sonidos del instrumento. Los cambios se aplican a las notas nuevas. La canción sigue sonando cuando cambias de página de mezcla. **Guardar performance** conserva juntos los instrumentos, sus conexiones y la mezcla.`
    }
  },
  perform_mixer: {
    english: {
      title: "Mixer",
      markdown: `Set each strip’s level with its dB fader and place it in stereo with pan or balance. **Mute** silences a strip. **Solo** lets you hear it in isolation. You can adjust these controls, existing sends and insert **Bypass** during playback.

Scroll the strips to reach more channels. **Master** stays on the right and controls everything routed through it. The stereo **Audio Output** meter also includes strips routed directly to the speakers. If sound remains when Master is muted, check strips marked **Direct Audio Output**.`
    },
    german: {
      title: "Mischpult",
      markdown: `Stelle den Pegel jedes Kanalzugs mit dem dB-Fader ein und platziere ihn mit Panorama oder Balance im Stereobild. **Stumm** schaltet den Kanal stumm. Mit **Solo** hörst du ihn einzeln. Diese Regler, vorhandene Sends und den **Bypass** von Insert-Effekten kannst du während der Wiedergabe bedienen.

Scrolle seitlich, um weitere Kanäle zu erreichen. Der **Master** bleibt rechts und regelt alle über ihn geführten Signale. Die Stereoanzeige **Audioausgang** erfasst auch Kanäle, die direkt zu den Lautsprechern führen. Hörst du bei stummgeschaltetem Master noch etwas, prüfe die Kanäle mit der Kennzeichnung **Direkter Audioausgang**.`
    },
    french: {
      title: "Mixeur",
      markdown: `Réglez le niveau de chaque tranche avec son fader en dB et placez-la dans l’image stéréo avec le panoramique ou la balance. **Muet** coupe la tranche. **Solo** permet de l’écouter seule. Pendant la lecture, vous pouvez aussi régler les envois existants et utiliser le **Bypass** des inserts.

Faites défiler les tranches pour accéder aux autres canaux. Le **Master** reste à droite et règle tous les signaux qui le traversent. Le vumètre stéréo **Sortie audio** inclut aussi les tranches reliées directement aux enceintes. Si vous entendez encore du son après avoir coupé le Master, vérifiez les tranches marquées **Sortie audio directe**.`
    },
    spanish: {
      title: "Mezclador",
      markdown: `Ajusta el nivel de cada canal con su fader en dB y sitúalo en el campo estéreo con el panorama o el balance. **Silenciar** corta el sonido del canal. **Solo** permite escucharlo de forma aislada. Durante la reproducción también puedes ajustar los envíos existentes y usar **Bypass** en los efectos de inserción.

Desplázate horizontalmente para ver más canales. El **Máster** permanece a la derecha y controla las señales que pasan por él. El medidor estéreo **Salida de audio** incluye también los canales conectados directamente a los altavoces. Si oyes sonido con el Máster silenciado, revisa los canales marcados como **Salida de audio directa**.`
    }
  },
  perform_rack: {
    english: {
      title: "Rack",
      markdown: `Stop the instruments, choose **Add instrument/effect**, then select a saved patch. For a note-triggered instrument, set the MIDI channel to match its track or keyboard. Continuous instruments such as effects run when the engine starts. Drag the handle on a rack card to reorder it within its group.

${performanceControllerHelp("english", "rack")}`
    },
    german: {
      title: "Rack",
      markdown: `Stoppe die Instrumente und wähle über **Instrument/Effekt hinzufügen** einen gespeicherten Patch. Stelle bei einem durch Noten ausgelösten Instrument den MIDI-Kanal der zugehörigen Spur oder Klaviatur ein. Kontinuierliche Instrumente wie Effekte laufen, sobald die Engine startet. Ziehe eine Rack-Karte an ihrem Griff, um sie innerhalb ihrer Gruppe zu verschieben.

${performanceControllerHelp("german", "rack")}`
    },
    french: {
      title: "Rack",
      markdown: `Arrêtez les instruments, puis choisissez un patch enregistré avec **Ajouter un instrument/effet**. Pour un instrument déclenché par des notes, réglez le canal MIDI sur celui de la piste ou du clavier. Les instruments continus, comme les effets, fonctionnent dès le démarrage du moteur. Déplacez une carte par sa poignée pour changer sa place dans le groupe.

${performanceControllerHelp("french", "rack")}`
    },
    spanish: {
      title: "Rack",
      markdown: `Detén los instrumentos, pulsa **Añadir instrumento/efecto** y elige un patch guardado. Para un instrumento que se activa con notas, selecciona el mismo canal MIDI que su pista o teclado. Los instrumentos continuos, como los efectos, funcionan desde que arranca el motor. Arrastra el asa de una tarjeta para cambiar su posición dentro del grupo.

${performanceControllerHelp("spanish", "rack")}`
    }
  },
  perform_routing: {
    english: {
      title: "Routing",
      markdown: `Follow the cables from an instrument’s output through any effects to **Master** or **Audio Output**. You can inspect connections while the song plays. Stop the instruments to change them. Click an output socket, choose the connection type, then click a highlighted input. Select a cable to inspect its channel mapping. To move a card, focus its heading and press the arrow keys. Hold Shift for one-pixel steps.

Use an insert for an effect in series with one strip. Use a send to share a return effect across strips. **Check routing** lists errors and warnings. Select an issue to locate the affected card or cable. If the report shows a feedback loop, remove or redirect the connection that sends audio back into its own path.`
    },
    german: {
      title: "Routing",
      markdown: `Verfolge die Kabel vom Instrumentenausgang über mögliche Effekte bis zum **Master** oder **Audioausgang**. Du kannst die Verbindungen während der Wiedergabe prüfen. Stoppe die Instrumente, um Verbindungen zu ändern. Klicke auf eine Ausgangsbuchse, wähle die Verbindungsart und klicke dann auf einen hervorgehobenen Eingang. Wähle ein Kabel aus, um seine Kanalzuordnung zu sehen. Um eine Karte zu verschieben, fokussiere ihre Überschrift und drücke die Pfeiltasten. Mit gedrückter Umschalttaste verschiebst du sie pixelweise.

Ein Insert schaltet einen Effekt in Reihe mit einem Kanalzug. Über Sends können mehrere Kanäle denselben Effektweg nutzen. **Routing prüfen** listet Fehler und Warnungen auf. Wähle einen Eintrag, um die betroffene Karte oder das Kabel zu finden. Bei einer Rückkopplung entfernst du die Verbindung, die das Signal in seinen eigenen Pfad zurückführt, oder wählst ein anderes Ziel.`
    },
    french: {
      title: "Routage",
      markdown: `Suivez les câbles depuis la sortie d’un instrument, à travers les effets éventuels, jusqu’au **Master** ou à la **Sortie audio**. Vous pouvez examiner les connexions pendant la lecture. Arrêtez les instruments pour les modifier. Cliquez sur une prise de sortie, choisissez le type de connexion, puis cliquez sur une entrée en surbrillance. Sélectionnez un câble pour voir les canaux reliés. Pour déplacer une carte, placez le focus sur son titre et utilisez les flèches. Maintenez Maj pour la déplacer d’un pixel à la fois.

Un insert place un effet en série sur une tranche. Un envoi permet à plusieurs tranches de partager le même retour d’effet. **Vérifier le routage** affiche les erreurs et les avertissements. Sélectionnez un message pour retrouver la carte ou le câble concerné. En cas de boucle, supprimez ou redirigez la connexion qui renvoie le signal dans son propre chemin.`
    },
    spanish: {
      title: "Rutas",
      markdown: `Sigue los cables desde la salida de un instrumento, pasando por sus efectos, hasta el **Máster** o la **Salida de audio**. Puedes examinar las conexiones durante la reproducción. Detén los instrumentos para modificarlas. Pulsa en un conector de salida, elige el tipo de conexión y pulsa en una de las entradas resaltadas. Selecciona un cable para ver qué canales conecta. Para mover una tarjeta, lleva el foco a su título y usa las flechas. Mantén Mayús para moverla un píxel cada vez.

Una inserción coloca un efecto en serie en un canal. Un envío permite que varios canales compartan el mismo retorno de efecto. **Comprobar rutas** muestra errores y avisos. Selecciona uno para localizar la tarjeta o el cable afectado. Si aparece un bucle de realimentación, elimina o redirige la conexión que devuelve la señal a su propia ruta.`
    }
  }
};
