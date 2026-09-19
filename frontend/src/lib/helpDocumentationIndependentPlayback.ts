export const independentPlaybackHelp = {
  english: `### Develop a pattern with backing parts

Device Play starts only that device and starts the instrument engine when needed. With Playback source set to Arrangement, the first device starts at the selected loop's beginning, or at the stopped arranger cursor without a loop. A cursor at song end restarts from the beginning. Further Arrangement devices join the current song position. Rests and each lane's end setting still apply.

With Manual pads, Play repeats the pad selected for editing from its beginning. Selecting a pad alone never launches it. Manual playback keeps its phase through song seeks, loops and endings. Arranger Play starts all Arrangement devices while preserving playing Manual pads; Arranger Stop stops the backing parts and clears temporary previews/workspaces while preserving independent manual playback. Device Stop affects only that device. Switching Playback source while playing changes only that device.

Groups and supergroups play through their speaker preview or workspace Play. Device Play follows Playback source. The arranger cursor and global Play indicator stay stopped during independently started playback. These rules include controller sequencers and Arranger-mode arpeggiators; Live arpeggiators retain their behavior. Arpeggiators still require input notes.`,
  german: `### Ein Pattern mit Begleitspuren entwickeln

Play am Gerät startet nur dieses Gerät und bei Bedarf die Instrument-Engine. Bei Wiedergabequelle Arrangement beginnt das erste Gerät am Anfang des gewählten Loop-Bereichs, ohne Loop am gestoppten Arranger-Cursor. Am Songende beginnt es wieder von vorn. Weitere Arrangement-Geräte steigen an der aktuellen Songposition ein. Pausen und das eingestellte Verhalten am Spurende bleiben wirksam.

Bei Manuellen Pads wiederholt Play das zum Bearbeiten ausgewählte Pad von Anfang an. Eine Auswahl allein startet nichts. Manuelle Wiedergabe behält ihre Phase bei Positionssprüngen, Loops und am Songende. Arranger-Play startet alle Arrangement-Geräte und lässt laufende manuelle Pads weiterspielen. Arranger-Stop stoppt die Begleitspuren und beendet temporäres Vorhören und Workspace-Wiedergabe; unabhängig laufende manuelle Pads bleiben aktiv. Geräte-Stop betrifft nur dieses Gerät. Ein Wechsel der Wiedergabequelle während des Abspielens betrifft ebenfalls nur dieses Gerät.

Gruppen und Supergruppen lassen sich über ihren Lautsprecher oder Workspace-Play anhören. Geräte-Play folgt der Wiedergabequelle. Bei unabhängig gestarteter Wiedergabe bleiben Arranger-Cursor und globale Play-Anzeige gestoppt. Dies gilt auch für Controller-Sequencer und Arpeggiatoren im Arranger-Modus; Live-Arpeggiatoren behalten ihr Verhalten. Arpeggiatoren benötigen weiterhin Eingangsnoten.`,
  french: `### Développer un motif avec un accompagnement

Play sur un appareil démarre seulement cet appareil et, si nécessaire, le moteur audio. Avec la source Arrangement, le premier appareil part du début de la boucle sélectionnée ou, sans boucle, du curseur arrêté de l'arrangeur. À la fin du morceau, il repart du début. Les autres appareils Arrangement rejoignent la position actuelle du morceau. Les silences et le réglage de fin de chaque piste restent respectés.

Avec Pads manuels, Play répète depuis son début le pad sélectionné pour l'édition. Sélectionner seul ne lance rien. La lecture manuelle conserve sa phase lors des déplacements, boucles et fins du morceau. Play de l'arrangeur démarre tous les appareils Arrangement en préservant les pads manuels en cours. Stop de l'arrangeur arrête l'accompagnement et les aperçus/ateliers temporaires, tout en préservant la lecture manuelle indépendante. Stop sur un appareil n'affecte que celui-ci. Changer la source pendant la lecture ne change que cet appareil.

Les groupes et supergroupes se jouent avec leur haut-parleur ou Play de l'atelier. Play de l'appareil suit sa source. Le curseur et l'indicateur Play global restent arrêtés pendant la lecture indépendante. Ces règles incluent les séquenceurs contrôleur et les arpégiateurs en mode Arrangeur ; le mode Live reste inchangé. Les arpégiateurs nécessitent toujours des notes d'entrée.`,
  spanish: `### Desarrollar un patrón con acompañamiento

Play en un dispositivo inicia solo ese dispositivo y, si hace falta, el motor de audio. Con la fuente Arreglo, el primero empieza al inicio del intervalo de bucle seleccionado o, sin bucle, en el cursor detenido del arreglador. Al final del tema vuelve al principio. Los demás dispositivos Arreglo se incorporan a la posición actual del tema. Se respetan los silencios y el ajuste de final de cada pista.

Con Pads manuales, Play repite desde el principio el pad seleccionado para editar. Seleccionar por sí solo no inicia nada. La reproducción manual conserva su fase durante saltos, bucles y finales del tema. Play del arreglador inicia todos los dispositivos Arreglo y conserva los pads manuales en marcha. Stop del arreglador detiene el acompañamiento y las escuchas/espacios de trabajo temporales, conservando la reproducción manual independiente. Stop de un dispositivo afecta solo a ese dispositivo. Cambiar la fuente durante la reproducción afecta solo a ese dispositivo.

Los grupos y supergrupos se escuchan con su altavoz o Play del espacio de trabajo. Play del dispositivo sigue su fuente. El cursor y el indicador Play global permanecen detenidos durante la reproducción independiente. Estas reglas incluyen los secuenciadores controladores y arpegiadores en modo Arreglador; Live conserva su comportamiento. Los arpegiadores siguen necesitando notas de entrada.`
};
