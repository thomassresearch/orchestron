import type { GuiLanguage } from "../types";

export const PARALLEL_PLAYBACK_COPY: Record<GuiLanguage, {
  title: string; frames: string; apply: string; description: string; storage: string; locked: string;
}> = {
  english: {
    title: "Parallel Playback", frames: "Batch size (samples)", apply: "Apply Batch Size",
    description: "Samples processed between worker handoffs. Default: 256; range: 32–1024. Larger batches reduce communication overhead but may delay new live input slightly. Synthesis timing and browser buffers stay unchanged.",
    storage: "Saved in app state. Applies on the next start with Parallel playback enabled in Perform. Rounded down to whole synthesis blocks, with at least one block per batch.",
    locked: "Stop playback before applying a different batch size."
  },
  german: {
    title: "Parallele Wiedergabe", frames: "Batch-Größe (Samples)", apply: "Batch-Größe anwenden",
    description: "Samples zwischen den Übergaben der Worker. Standard: 256; Bereich: 32–1024. Größere Batches verringern den Kommunikationsaufwand, können neue Live-Eingaben aber etwas verzögern. Synthese-Timing und Browser-Puffer bleiben unverändert.",
    storage: "Im App-State gespeichert. Gilt ab dem nächsten Start mit aktivierter paralleler Wiedergabe in Perform. Auf ganze Syntheseblöcke abgerundet, mindestens ein Block pro Batch.",
    locked: "Wiedergabe stoppen, bevor eine andere Batch-Größe angewendet wird."
  },
  french: {
    title: "Lecture parallèle", frames: "Taille du lot (échantillons)", apply: "Appliquer la taille du lot",
    description: "Échantillons traités entre les échanges des processus. Par défaut : 256 ; plage : 32–1024. Les lots plus grands réduisent les échanges, mais peuvent retarder légèrement les nouvelles entrées en direct. Le timing de synthèse et les tampons du navigateur restent inchangés.",
    storage: "Enregistré dans l’état de l’application. S’applique au prochain démarrage avec la lecture parallèle activée dans Perform. Arrondi vers le bas en blocs de synthèse entiers, avec au moins un bloc par lot.",
    locked: "Arrêtez la lecture avant d’appliquer une autre taille de lot."
  },
  spanish: {
    title: "Reproducción paralela", frames: "Tamaño del lote (muestras)", apply: "Aplicar tamaño del lote",
    description: "Muestras procesadas entre intercambios de los procesos. Predeterminado: 256; rango: 32–1024. Los lotes mayores reducen la comunicación, pero pueden retrasar ligeramente las nuevas entradas en vivo. Los tiempos de síntesis y los búferes del navegador no cambian.",
    storage: "Guardado en el estado de la aplicación. Se aplica en el siguiente inicio con la reproducción paralela activada en Perform. Se redondea hacia abajo a bloques de síntesis completos, con al menos un bloque por lote.",
    locked: "Detén la reproducción antes de aplicar otro tamaño de lote."
  }
};
