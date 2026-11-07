import type { GuiLanguage } from "../types";

type Copy = { pending: string; title: string; single: string; parallel: string; stopped: string; unavailable: string;
  process: string; optIn: string; optInHelp: string; fallback: string; disabled: string; cpuHelp: string; help: string };
export const ENGINE_STATS_COPY: Record<GuiLanguage, Copy> = {
  english: {
    pending: "Checking engine", title: "Engine stats", single: "Single", parallel: "Parallel", stopped: "Stopped", unavailable: "CPU usage unavailable",
    process: "Server process", optIn: "Parallel playback", fallback: "Single fallback", disabled: "Parallel playback disabled on server",
    optInHelp: "Opt in while stopped. Uses parallel playback only for a qualified workload, build and settings with enough capacity; otherwise uses single rendering. Resets on reload.",
    cpuHelp: "Linux logical CPU load on the renderer's assigned CPUs, including other work. Single rendering shows server-process CPU usage (100% = one CPU). Green: 0–50%; orange: above 50–85%; red: above 85%.",
    help: "In Perform, the fixed Engine stats line shows the selected renderer and CPU usage. Enable Parallel playback while stopped to opt in for the next session. Only qualified workloads, builds and settings with sufficient capacity use parallel rendering; other cases retain single rendering. The choice resets on reload and is not saved in performances or exports. CPU readings update about once a second while this view is visible. Parallel shows Linux load on assigned logical CPUs, including other work; single shows server-process usage, where 100% is one CPU. Unsupported platforms show unavailable. Green is 0–50%, orange above 50–85%, red above 85%. Timing and buffers stay unchanged."
  },
  german: {
    pending: "Engine wird geprüft", title: "Engine-Statistik", single: "Einzeln", parallel: "Parallel", stopped: "Gestoppt", unavailable: "CPU-Auslastung nicht verfügbar",
    process: "Serverprozess", optIn: "Parallele Wiedergabe", fallback: "Einzel-Rendering als Rückfall", disabled: "Parallele Wiedergabe am Server deaktiviert",
    optInHelp: "Im gestoppten Zustand aktivieren. Parallel nur für qualifizierte Workloads, Builds und Einstellungen bei ausreichender Kapazität; sonst Einzel-Rendering. Wird beim Neuladen zurückgesetzt.",
    cpuHelp: "Linux-Auslastung der zugewiesenen logischen CPUs einschließlich anderer Arbeit. Einzel-Rendering zeigt den Serverprozess (100% = eine CPU). Grün: 0–50%; Orange: über 50–85%; Rot: über 85%.",
    help: "In Perform zeigt die feste Engine-Statistik den Renderer und die CPU-Auslastung. Parallele Wiedergabe im gestoppten Zustand für die nächste Sitzung aktivieren. Nur qualifizierte Workloads, Builds und Einstellungen mit ausreichender Kapazität werden parallel gerendert; sonst bleibt Einzel-Rendering aktiv. Die Auswahl wird beim Neuladen zurückgesetzt und nicht in Performances oder Exporten gespeichert. Die Anzeige aktualisiert sich ungefähr jede Sekunde, solange die Ansicht sichtbar ist. Parallel zeigt die Linux-Auslastung zugewiesener logischer CPUs einschließlich anderer Arbeit; einzeln die Auslastung des Serverprozesses, wobei 100% einer CPU entspricht. Nicht unterstützte Plattformen zeigen nicht verfügbar. Grün: 0–50%, Orange: über 50–85%, Rot: über 85%. Timing und Puffer bleiben unverändert."
  },
  french: {
    pending: "Vérification du moteur", title: "Statistiques moteur", single: "Unique", parallel: "Parallèle", stopped: "Arrêté", unavailable: "Charge CPU indisponible",
    process: "Processus serveur", optIn: "Lecture parallèle", fallback: "Repli sur un moteur unique", disabled: "Lecture parallèle désactivée sur le serveur",
    optInHelp: "Activer à l’arrêt. Lecture parallèle uniquement pour une charge, une version et des réglages qualifiés avec une capacité suffisante ; sinon moteur unique. Réinitialisé au rechargement.",
    cpuHelp: "Charge Linux des CPU logiques affectés au moteur, autres tâches comprises. Le moteur unique affiche le processus serveur (100% = un CPU). Vert : 0–50% ; orange : au-delà de 50–85% ; rouge : au-delà de 85%.",
    help: "Dans Perform, la ligne fixe Statistiques moteur affiche le moteur sélectionné et la charge CPU. Activer Lecture parallèle à l’arrêt pour la prochaine session. Seuls les charges, versions et réglages qualifiés avec une capacité suffisante utilisent le rendu parallèle ; sinon le moteur reste unique. Le choix est réinitialisé au rechargement et n’est pas enregistré dans les performances ou exports. Les mesures sont actualisées environ chaque seconde lorsque la vue est visible. Le mode parallèle affiche la charge Linux des CPU logiques affectés, autres tâches comprises ; le mode unique affiche le processus serveur, où 100% représente un CPU. Les plateformes non prises en charge indiquent indisponible. Vert : 0–50%, orange : au-delà de 50–85%, rouge : au-delà de 85%. Le timing et les buffers restent inchangés."
  },
  spanish: {
    pending: "Comprobando el motor", title: "Estadísticas del motor", single: "Único", parallel: "Paralelo", stopped: "Detenido", unavailable: "Uso de CPU no disponible",
    process: "Proceso del servidor", optIn: "Reproducción paralela", fallback: "Respaldo con motor único", disabled: "Reproducción paralela desactivada en el servidor",
    optInHelp: "Activar con la reproducción detenida. Solo usa procesamiento paralelo con carga, versión y ajustes cualificados y capacidad suficiente; si no, usa un solo motor. Se restablece al recargar.",
    cpuHelp: "Carga Linux de las CPU lógicas asignadas al motor, incluido otro trabajo. El motor único muestra el proceso del servidor (100% = una CPU). Verde: 0–50%; naranja: más de 50–85%; rojo: más de 85%.",
    help: "En Perform, la línea fija Estadísticas del motor muestra el motor y el uso de CPU. Active Reproducción paralela con la reproducción detenida para la próxima sesión. Solo las cargas, versiones y ajustes cualificados con capacidad suficiente usan procesamiento paralelo; los demás conservan un solo motor. La selección se restablece al recargar y no se guarda en las interpretaciones ni exportaciones. Los datos se actualizan aproximadamente cada segundo mientras la vista está visible. El modo paralelo muestra la carga Linux de las CPU lógicas asignadas, incluido otro trabajo; el modo único muestra el proceso del servidor, donde 100% equivale a una CPU. Las plataformas no compatibles indican no disponible. Verde: 0–50%, naranja: más de 50–85%, rojo: más de 85%. El tiempo y los buffers no cambian."
  }
};
