import type { BrowserPlaybackMode, BrowserPlaybackState, GuiLanguage } from "../types";

type PlaybackCopy = {
  mode: string; timeout: string; advanced: string; idle: string;
  modes: Record<BrowserPlaybackMode, string>;
  states: Record<BrowserPlaybackState, string>;
  description: string; transition: string; tuning: string; buffers: string;
};

export const BROWSER_PLAYBACK_COPY: Record<GuiLanguage, PlaybackCopy> = {
  english: {
    mode: "Playback mode", timeout: "Auto inactivity timeout (seconds)", advanced: "Live buffering and recovery", idle: "Applies when audio starts",
    modes: { auto: "Auto", live: "Live", listening: "Listening" },
    states: { live: "Live", listening: "Listening", switching_to_live: "Switching to Live" },
    description: "Auto uses Live for piano keyboards, manual MIDI controls and external MIDI input. It returns to Listening after inactivity; held notes, sustain and controller gestures keep Live active. Sequencers and controller initialization do not trigger Live.",
    transition: "Queued audio always plays out when switching. The first note after Listening may still be delayed. Select Live in advance for immediate playing.",
    tuning: "These are the Live settings. Listening uses at least 750/1500 ms steady and 1000/1800 ms startup buffering, with up to 512 blocks per request. Larger custom queue targets are retained. Mode and timeout are saved in this workspace.",
    buffers: "Csound I/O buffers do not set browser playback buffering. Use Playback mode and the browser queue settings below."
  },
  german: {
    mode: "Wiedergabemodus", timeout: "Auto-Inaktivitätszeit (Sekunden)", advanced: "Live-Pufferung und Wiederherstellung", idle: "Gilt ab Audiostart",
    modes: { auto: "Auto", live: "Live", listening: "Zuhören" },
    states: { live: "Live", listening: "Zuhören", switching_to_live: "Wechsel zu Live" },
    description: "Auto nutzt Live für Klaviaturen, manuelle MIDI-Regler und externe MIDI-Eingaben. Nach Inaktivität wird zu Zuhören gewechselt; gehaltene Noten, Sustain und Reglergesten halten Live aktiv. Sequenzer und initiale Reglerwerte lösen Live nicht aus.",
    transition: "Gepuffertes Audio wird beim Wechsel vollständig abgespielt. Die erste Note nach Zuhören kann noch verzögert sein. Für direktes Spielen vorher Live wählen.",
    tuning: "Dies sind die Live-Einstellungen. Zuhören nutzt mindestens 750/1500 ms im Betrieb und 1000/1800 ms beim Start sowie bis zu 512 Blöcke pro Anfrage. Größere eigene Pufferziele bleiben erhalten. Modus und Zeitlimit werden im Workspace gespeichert.",
    buffers: "Csound-I/O-Puffer bestimmen nicht die Browser-Pufferung. Dafür den Wiedergabemodus und die Browser-Warteschlange unten verwenden."
  },
  french: {
    mode: "Mode de lecture", timeout: "Délai d’inactivité Auto (secondes)", advanced: "Tampons Live et récupération", idle: "Appliqué au démarrage audio",
    modes: { auto: "Auto", live: "Live", listening: "Écoute" },
    states: { live: "Live", listening: "Écoute", switching_to_live: "Passage en Live" },
    description: "Auto utilise Live pour les claviers, les contrôleurs MIDI manuels et l’entrée MIDI externe. Après inactivité, il revient à Écoute ; les notes tenues, le sustain et les gestes de contrôle maintiennent Live. Les séquenceurs et les valeurs initiales des contrôleurs ne déclenchent pas Live.",
    transition: "L’audio déjà en file est toujours joué lors du changement. La première note après Écoute peut encore être retardée. Choisir Live à l’avance pour jouer immédiatement.",
    tuning: "Ce sont les réglages Live. Écoute utilise au moins 750/1500 ms en régime stable et 1000/1800 ms au démarrage, avec au plus 512 blocs par requête. Les cibles personnalisées plus grandes sont conservées. Le mode et le délai sont enregistrés dans cet espace de travail.",
    buffers: "Les tampons d’E/S Csound ne règlent pas les tampons du navigateur. Utiliser le mode de lecture et la file audio du navigateur ci-dessous."
  },
  spanish: {
    mode: "Modo de reproducción", timeout: "Tiempo de inactividad Auto (segundos)", advanced: "Búferes Live y recuperación", idle: "Se aplica al iniciar el audio",
    modes: { auto: "Auto", live: "Live", listening: "Escucha" },
    states: { live: "Live", listening: "Escucha", switching_to_live: "Cambiando a Live" },
    description: "Auto usa Live para teclados, controles MIDI manuales y entrada MIDI externa. Tras la inactividad vuelve a Escucha; las notas mantenidas, el sustain y los gestos de control mantienen Live. Los secuenciadores y los valores iniciales de los controles no activan Live.",
    transition: "El audio en cola siempre se reproduce al cambiar. La primera nota después de Escucha aún puede tener retardo. Selecciona Live de antemano para tocar de inmediato.",
    tuning: "Estos son los ajustes Live. Escucha usa al menos 750/1500 ms en régimen estable y 1000/1800 ms al iniciar, con hasta 512 bloques por solicitud. Se conservan los objetivos personalizados mayores. El modo y el tiempo se guardan en este espacio de trabajo.",
    buffers: "Los búferes de E/S de Csound no controlan los del navegador. Usa el modo de reproducción y la cola de audio del navegador que aparecen abajo."
  }
};
