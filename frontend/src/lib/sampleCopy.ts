import type { GuiLanguage } from "../types";

const copy = {
  title: ["Samples", "Samples", "Samples", "Muestras"],
  noMap: ["No samples yet. Assign a WAV, MP3 or M4A to a MIDI note.", "Noch keine Samples. Weise einer MIDI-Note eine WAV-, MP3- oder M4A-Datei zu.", "Aucun sample. Assignez un WAV, MP3 ou M4A à une note MIDI.", "No hay muestras. Asigna un WAV, MP3 o M4A a una nota MIDI."],
  help: [
    "Each mapped MIDI note plays its WAV, MP3 or M4A once at the original speed and pitch. Releasing a key does not cut the sound; repeated hits overlap. Stop for that source and Panic end its voices. A note chased after a seek restarts its sample. Stop Instruments to edit. Save Performance preserves the map; native ZIPs include the originals and both CSD ZIPs include playable audio.",
    "Jede zugewiesene MIDI-Note spielt ihre WAV-, MP3- oder M4A-Datei einmal in Originaltempo und -tonhöhe. Loslassen beendet das Sample nicht; Wiederholungen überlappen. Quellen-Stopp und Panic beenden die betroffenen Stimmen. Eine beim Springen erneut ausgelöste Note startet das Sample neu. Zum Bearbeiten die Instrumente stoppen. Die Performance speichert die Zuordnung; native ZIPs enthalten die Originale, beide CSD-ZIPs das spielbare Audio.",
    "Chaque note MIDI assignée joue son WAV, MP3 ou M4A une fois à sa vitesse et hauteur d’origine. Relâcher la touche ne coupe pas le son ; les frappes répétées se superposent. L’arrêt de la source et Panic coupent les voix concernées. Une note relancée après un déplacement redémarre le sample. Arrêtez les instruments pour éditer. La performance conserve la table ; le ZIP natif contient les originaux et les deux ZIP CSD l’audio lisible.",
    "Cada nota MIDI asignada reproduce su WAV, MP3 o M4A una vez a su velocidad y tono originales. Soltar la tecla no corta el sonido y los ataques repetidos se superponen. Detener la fuente y Pánico finalizan sus voces. Una nota retomada tras un salto reinicia la muestra. Detén los instrumentos para editar. La interpretación conserva el mapa; el ZIP nativo incluye los originales y ambos ZIP CSD incluyen audio reproducible."
  ],
  info: ["Sample Player help", "Hilfe zum Sample-Player", "Aide du lecteur de samples", "Ayuda del reproductor de muestras"],
  lock: ["Stop Instruments to edit sample assignments.", "Instrumente stoppen, um Samples zu bearbeiten.", "Arrêtez les instruments pour modifier les assignations.", "Detén los instrumentos para editar las asignaciones."],
  incompatible: ["This patch no longer has a Sample Player. Restore the node or clear this map.", "Dieser Patch hat keinen Sample-Player mehr. Stelle den Knoten wieder her oder leere die Zuordnung.", "Ce patch ne contient plus de lecteur. Restaurez le nœud ou effacez les assignations.", "Este patch ya no tiene reproductor. Restaura el nodo o borra el mapa."],
  cleared: ["The sample map was cleared when you changed this instrument’s patch.", "Die Sample-Zuordnung wurde beim Patch-Wechsel geleert.", "Le changement de patch a effacé les assignations de cet instrument.", "El cambio de patch borró el mapa de este instrumento."],
  collision: ["That MIDI note already has a sample.", "Diese MIDI-Note hat bereits ein Sample.", "Cette note MIDI a déjà un sample.", "Esa nota MIDI ya tiene una muestra."],
  range: ["Choose a whole MIDI note number from 0 to 127.", "Wähle eine ganze MIDI-Notennummer von 0 bis 127.", "Choisissez un numéro de note MIDI entier de 0 à 127.", "Elige un número MIDI entero entre 0 y 127."],
  note: ["MIDI note", "MIDI-Note", "Note MIDI", "Nota MIDI"],
  mono: ["Mono", "Mono", "Mono", "Mono"],
  stereo: ["Stereo", "Stereo", "Stéréo", "Estéreo"],
  add: ["Assign file", "Datei zuweisen", "Assigner un fichier", "Asignar archivo"],
  replace: ["Replace file", "Datei ersetzen", "Remplacer le fichier", "Reemplazar archivo"],
  remove: ["Remove", "Entfernen", "Retirer", "Quitar"],
  clear: ["Clear map", "Zuordnung leeren", "Effacer la table", "Borrar mapa"],
  noChannel: ["No free MIDI channel is available.", "Kein freier MIDI-Kanal verfügbar.", "Aucun canal MIDI libre.", "No hay canales MIDI libres."],
  preview: ["Preview", "Vorhören", "Écouter", "Escuchar"],
  stopPreview: ["Stop preview", "Vorhören stoppen", "Arrêter l’écoute", "Detener escucha"],
  cancel: ["Cancel upload", "Upload abbrechen", "Annuler l’envoi", "Cancelar carga"],
  busy: ["Uploading and preparing audio…", "Audio wird geladen und vorbereitet…", "Envoi et préparation de l’audio…", "Cargando y preparando audio…"],
  wait: ["Wait for the sample upload to finish or cancel it.", "Warte, bis der Upload abgeschlossen ist, oder brich ihn ab.", "Attendez la fin de l’envoi ou annulez-le.", "Espera a que termine la carga o cancélala."],
  stale: ["The rack changed before the sample could be assigned.", "Das Rack wurde vor der Zuweisung geändert.", "Le rack a changé avant l’assignation.", "El rack cambió antes de asignar la muestra."],
  emptyAudition: ["This draft has no sample map. Add samples in Perform after saving the patch.", "Dieser Entwurf hat keine Sample-Zuordnung. Speichere den Patch und weise Samples unter Perform zu.", "Ce brouillon n’a pas d’assignations. Enregistrez le patch puis ajoutez des samples dans Perform.", "Este borrador no tiene mapa. Guarda el patch y añade las muestras en Perform."]
} as const;

export function sampleCopy(language: GuiLanguage) {
  const index = ({ english: 0, german: 1, french: 2, spanish: 3 } as const)[language] ?? 0;
  return Object.fromEntries(Object.entries(copy).map(([key, values]) => [key, values[index]])) as Record<keyof typeof copy, string>;
}
