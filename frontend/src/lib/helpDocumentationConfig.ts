import type { HelpDocumentAppendixSet, HelpDocumentSet, ConfigHelpDocId } from "./helpDocumentationTypes";

export const configHelpDocuments: HelpDocumentSet<ConfigHelpDocId> = {
  config_audio_engine: {
    english: {
      title: "Audio Engine Configuration",
      markdown: `## Audio Engine Configuration

Configure patch-level Csound engine timing plus browser-clock latency controls when browser-clock audio is active.

- \`sr\`: audio sample rate.
- target control rate: used to derive \`ksmps\`.
- software buffer (\`-b\`) and hardware buffer (\`-B\`).
- in browser-clock mode, additional browser PCM queue, render burst, and request parallelism settings appear.
- apply validated values to the current patch.
- browser-clock latency settings are stored in app state, not in the patch.

The GUI language setting controls integrated help and opcode docs language.`
    },
    german: {
      title: "Audio Engine Konfiguration",
      markdown: `## Audio Engine Konfiguration

Konfiguriert Patch-Timing der Csound-Engine plus Browser-Clock-Latenzwerte, wenn Browser-Clock-Audio aktiv ist.

- \`sr\`: Audio-Sample-Rate.
- Ziel-Control-Rate: daraus wird \`ksmps\` abgeleitet.
- Software-Buffer (\`-b\`) und Hardware-Buffer (\`-B\`).
- im Browser-Clock-Modus erscheinen zusaetzliche Werte fuer PCM-Warteschlange, Render-Burst und Anfrage-Parallelitaet.
- Gültige Werte auf den aktuellen Patch anwenden.
- Browser-Clock-Latenzwerte werden im App-State gespeichert, nicht im Patch.

Die GUI-Sprache steuert integrierte Hilfe und Opcode-Dokumentation.`
    },
    french: {
      title: "Configuration du moteur audio",
      markdown: `## Configuration du moteur audio

Configure le timing Csound du patch ainsi que les reglages de latence browser-clock quand l'audio browser-clock est actif.

- \`sr\` : fréquence d'échantillonnage audio.
- fréquence de contrôle cible : dérive \`ksmps\`.
- buffer logiciel (\`-b\`) et buffer matériel (\`-B\`).
- en mode browser-clock, des reglages supplementaires apparaissent pour la file PCM, les bursts de rendu et le parallelisme des requetes.
- appliquer les valeurs validées au patch courant.
- les reglages de latence browser-clock sont stockes dans l'etat applicatif, pas dans le patch.

La langue GUI contrôle l'aide intégrée et la doc opcode.`
    },
    spanish: {
      title: "Configuración del motor de audio",
      markdown: `## Configuración del motor de audio

Configura tiempos de Csound del patch y tambien ajustes de latencia browser-clock cuando el audio browser-clock esta activo.

- \`sr\`: frecuencia de muestreo de audio.
- tasa de control objetivo: deriva \`ksmps\`.
- buffer software (\`-b\`) y hardware (\`-B\`).
- en modo browser-clock aparecen ajustes adicionales para la cola PCM, los bursts de render y el paralelismo de solicitudes.
- aplicar valores validados al patch actual.
- los ajustes de latencia browser-clock se guardan en el estado de la app, no en el patch.

El idioma de GUI controla la ayuda integrada y docs de opcodes.`
    }
  },
  config_browser_clock_latency: {
    english: {
      title: "Browser-Clock Latency",
      markdown: `## Browser-Clock Latency

These settings are shown only when the backend runtime mode is \`browser_clock\`.

- \`steady low/high water\`: the normal browser PCM queue target. Lower values reduce latency, higher values reduce underruns.
- \`startup low/high water\`: the larger queue target used while the browser is still priming the stream.
- \`underrun recovery boost\`: extra buffer added after an underrun is detected.
- \`max underrun boost\`: cap for the temporary recovery buffer.
- \`max blocks per request\`: maximum render size the browser asks from the backend in one request.
- \`steady/startup/recovery parallel requests\`: how many render requests may stay in flight at once in each state.
- \`immediate note render blocks\`: small urgent render burst sent after a live note-on.
- \`immediate note render cooldown\`: throttle for those urgent note-triggered render bursts.

These values are stored in app state for the current workspace and runtime path, not in the patch.`
    },
    german: {
      title: "Browser-Clock-Latenz",
      markdown: `## Browser-Clock-Latenz

Diese Einstellungen erscheinen nur, wenn der Backend-Runtime-Modus \`browser_clock\` ist.

- \`steady low/high water\`: normales Ziel fuer die browserseitige PCM-Warteschlange. Niedrigere Werte reduzieren Latenz, hoehere Werte reduzieren Underruns.
- \`startup low/high water\`: groesseres Queue-Ziel, solange der Browser den Stream noch auffuellt.
- \`underrun recovery boost\`: zusaetzlicher Buffer nach einem erkannten Underrun.
- \`max underrun boost\`: Obergrenze fuer diesen temporaeren Recovery-Buffer.
- \`max blocks per request\`: maximale Render-Groesse, die der Browser pro Anfrage vom Backend anfordert.
- \`steady/startup/recovery parallel requests\`: wie viele Render-Anfragen in den jeweiligen Zustaenden gleichzeitig offen sein duerfen.
- \`immediate note render blocks\`: kleiner dringender Render-Burst nach einem Live-Note-On.
- \`immediate note render cooldown\`: Drosselung fuer diese dringenden Note-On-Render-Bursts.

Diese Werte werden fuer aktuellen Workspace und Runtime-Pfad im App-State gespeichert, nicht im Patch.`
    },
    french: {
      title: "Latence browser-clock",
      markdown: `## Latence browser-clock

Ces reglages apparaissent uniquement lorsque le mode runtime du backend est \`browser_clock\`.

- \`steady low/high water\` : cible normale de file PCM cote navigateur. Des valeurs plus faibles reduisent la latence, des valeurs plus hautes reduisent les underruns.
- \`startup low/high water\` : cible de file plus grande pendant l'amorcage du flux.
- \`underrun recovery boost\` : buffer supplementaire ajoute apres detection d'un underrun.
- \`max underrun boost\` : plafond de ce buffer temporaire de recovery.
- \`max blocks per request\` : taille maximale de rendu demandee au backend par requete.
- \`steady/startup/recovery parallel requests\` : nombre de requetes de rendu pouvant rester en vol dans chaque etat.
- \`immediate note render blocks\` : petit burst de rendu urgent apres un note-on joue en direct.
- \`immediate note render cooldown\` : limitation de frequence pour ces bursts urgents declenches par note-on.

Ces valeurs sont stockees dans l'etat applicatif pour le workspace et le chemin runtime courants, pas dans le patch.`
    },
    spanish: {
      title: "Latencia browser-clock",
      markdown: `## Latencia browser-clock

Estos ajustes solo aparecen cuando el modo runtime del backend es \`browser_clock\`.

- \`steady low/high water\`: objetivo normal de la cola PCM del navegador. Valores mas bajos reducen latencia, valores mas altos reducen underruns.
- \`startup low/high water\`: objetivo de cola mas grande mientras el navegador sigue cebando el flujo.
- \`underrun recovery boost\`: buffer extra que se anade despues de detectar un underrun.
- \`max underrun boost\`: limite de ese buffer temporal de recovery.
- \`max blocks per request\`: tamano maximo de render que el navegador pide al backend en una sola solicitud.
- \`steady/startup/recovery parallel requests\`: cuantas solicitudes de render pueden permanecer en vuelo a la vez en cada estado.
- \`immediate note render blocks\`: pequeno burst urgente de render despues de un note-on en vivo.
- \`immediate note render cooldown\`: limitacion para esos bursts urgentes disparados por note-on.

Estos valores se guardan en el estado de la app para el workspace y la ruta runtime actuales, no en el patch.`
    }
  },
  config_engine_values: {
    english: {
      title: "Current Patch Engine Values",
      markdown: `## Current Patch Engine Values

Read-only view of normalized engine values currently stored in the patch:

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Use this panel to verify what will be used during compile/start.`
    },
    german: {
      title: "Aktuelle Patch Engine Werte",
      markdown: `## Aktuelle Patch Engine Werte

Nur-Lese Ansicht der normalisierten Engine-Werte im Patch:

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Dieses Panel zeigt die Werte für Compile/Start.`
    },
    french: {
      title: "Valeurs moteur du patch courant",
      markdown: `## Valeurs moteur du patch courant

Vue en lecture seule des valeurs moteur normalisées stockées dans le patch :

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Ce panneau confirme les valeurs utilisées en compile/start.`
    },
    spanish: {
      title: "Valores del motor en el patch actual",
      markdown: `## Valores del motor en el patch actual

Vista de solo lectura de valores normalizados del motor en el patch:

- \`sr\`
- \`control_rate\`
- \`ksmps\`
- \`software_buffer\`
- \`hardware_buffer\`

Este panel permite verificar valores para compilar/iniciar.`
    }
  }
};

export const configHelpAppendices: HelpDocumentAppendixSet<ConfigHelpDocId> = {
  config_audio_engine: {
    english: `### How Each Field Affects Runtime

- \`sr\` sets the audio sample rate used when the patch compiles and starts. Higher values extend bandwidth but cost more CPU.
- The target control rate defines the desired control update frequency. VisualCSound derives an integer \`ksmps\` from \`sr / control_rate\`, so the actual control rate may be rounded slightly.
- Software buffer (\`-b\`) is the internal Csound block size. Hardware buffer (\`-B\`) is the device-facing buffer and is usually kept equal to or larger than \`-b\`.
- In browser-clock mode, the extra latency section adjusts browser-owned PCM queue depth, render request size, recovery boost, and request parallelism.

### Practical Tuning

- Lower buffer values reduce latency but glitch sooner on heavy patches or slower machines.
- Higher buffer values are safer for complex patches but feel less immediate when playing live.
- Browser-clock latency settings apply to the current workspace/runtime path and are stored in app state, not in the patch.
- Applying the engine form only updates the current patch state. Save the patch as well if these settings should persist in the patch library.`,
    german: `### Wie jedes Feld die Runtime beeinflusst

- \`sr\` setzt die Audio-Sample-Rate fuer Compile/Start des Patches. Hoehere Werte erweitern die Bandbreite, kosten aber mehr CPU.
- Die Ziel-Control-Rate definiert die gewuenschte Frequenz von Control-Updates. VisualCSound leitet daraus ein ganzzahliges \`ksmps\` aus \`sr / control_rate\` ab; die tatsaechliche Control-Rate kann daher leicht gerundet sein.
- Software-Buffer (\`-b\`) ist die interne Csound-Blockgroesse. Hardware-Buffer (\`-B\`) ist der geraeteseitige Buffer und sollte meist gleich gross oder groesser als \`-b\` sein.
- Im Browser-Clock-Modus passt der zusaetzliche Latenzbereich die browserseitige PCM-Warteschlange, Render-Groesse, Recovery-Boosts und Anfrage-Parallelitaet an.

### Praktische Abstimmung

- Niedrige Buffer-Werte reduzieren Latenz, erzeugen bei schweren Patches oder langsameren Rechnern aber frueher Aussetzer.
- Hoehere Buffer-Werte sind fuer komplexe Patches sicherer, fuehlen sich live jedoch weniger direkt an.
- Browser-Clock-Latenzwerte gelten fuer aktuellen Workspace und Runtime-Pfad und werden im App-State gespeichert, nicht im Patch.
- Das Anwenden des Engine-Formulars aktualisiert nur den Zustand des aktuellen Patches. Den Patch zusaetzlich speichern, wenn die Werte in der Patch-Bibliothek erhalten bleiben sollen.`,
    french: `### Effet de chaque champ sur la runtime

- \`sr\` fixe le taux d'echantillonnage audio utilise au compile/start du patch. Des valeurs plus hautes etendent la bande passante mais coutent plus de CPU.
- Le taux de controle cible definit la frequence souhaitee des mises a jour de controle. VisualCSound derive un \`ksmps\` entier depuis \`sr / control_rate\` ; le taux de controle reel peut donc etre legerement arrondi.
- Le buffer logiciel (\`-b\`) correspond a la taille de bloc interne Csound. Le buffer materiel (\`-B\`) fait face au device et reste generalement egal ou superieur a \`-b\`.
- En mode browser-clock, la section de latence supplementaire regle la profondeur de file PCM, la taille des requetes de rendu, les boosts de recovery et le parallelisme.

### Reglage pratique

- Des buffers plus faibles reduisent la latence mais provoquent plus vite des glitches sur des patches lourds ou des machines lentes.
- Des buffers plus eleves sont plus surs pour les patches complexes, mais donnent une sensation moins immediate en jeu live.
- Les reglages de latence browser-clock s'appliquent au workspace/runtime courant et sont stockes dans l'etat applicatif, pas dans le patch.
- Appliquer le formulaire moteur met uniquement a jour l'etat du patch courant. Enregistrez aussi le patch si ces reglages doivent rester dans la bibliotheque.`,
    spanish: `### Como afecta cada campo al runtime

- \`sr\` fija la frecuencia de muestreo de audio usada al compilar/iniciar el patch. Valores mas altos amplian el ancho de banda pero consumen mas CPU.
- La tasa de control objetivo define la frecuencia deseada de actualizacion de control. VisualCSound deriva un \`ksmps\` entero a partir de \`sr / control_rate\`, por lo que la tasa real puede quedar ligeramente redondeada.
- El buffer software (\`-b\`) es el tamano interno de bloque de Csound. El buffer hardware (\`-B\`) mira al dispositivo y normalmente conviene mantenerlo igual o mayor que \`-b\`.
- En modo browser-clock, la seccion adicional de latencia ajusta la profundidad de la cola PCM, el tamano de las solicitudes de render, los boosts de recovery y el paralelismo.

### Ajuste practico

- Valores bajos de buffer reducen la latencia, pero producen fallos antes en patches pesados o maquinas lentas.
- Valores altos de buffer son mas seguros para patches complejos, aunque se sienten menos inmediatos en interpretacion en vivo.
- Los ajustes de latencia browser-clock se aplican al workspace/runtime actual y se guardan en el estado de la app, no en el patch.
- Aplicar el formulario del motor solo actualiza el estado del patch actual. Guarda tambien el patch si quieres conservar estos valores en la biblioteca.`
  },
  config_browser_clock_latency: {
    english: `### Practical Tuning Order

1. Start with \`steady low/high water\`. These are the strongest latency vs stability controls.
2. If live notes still feel late, lower \`immediate note render blocks\` carefully or reduce \`steady high water\`.
3. If you hear regular clicks, increase the steady/startup watermarks slightly before raising request parallelism.
4. Use \`max blocks per request\` to limit large render bursts that can add head-of-line delay.

### What The States Mean

- \`startup\`: used while the queue is still filling after connect or recovery.
- \`steady\`: normal playback after the stream is primed.
- \`recovery\`: temporary behavior after underruns are detected.`,
    german: `### Praktische Abstimmungsreihenfolge

1. Mit \`steady low/high water\` beginnen. Diese Werte sind die staerksten Regler fuer Latenz gegen Stabilitaet.
2. Wenn Live-Noten noch zu spaet wirken, \`immediate note render blocks\` vorsichtig senken oder \`steady high water\` reduzieren.
3. Wenn regelmaessig Klicks auftreten, zuerst die steady/startup-Wasserstaende leicht erhoehen, bevor die Anfrage-Parallelitaet steigt.
4. \`max blocks per request\` begrenzt grosse Render-Bursts, die zusaetzliche Kopfzeilen-Latenz verursachen koennen.

### Bedeutung der Zustaende

- \`startup\`: wird verwendet, solange sich die Queue nach Connect oder Recovery noch fuellt.
- \`steady\`: normaler Betrieb, nachdem der Stream aufgefuellt ist.
- \`recovery\`: temporaeres Verhalten nach erkannten Underruns.`,
    french: `### Ordre pratique de reglage

1. Commencez par \`steady low/high water\`. Ce sont les reglages les plus importants pour l'equilibre latence/stabilite.
2. Si les notes en direct semblent encore tardives, reduisez prudemment \`immediate note render blocks\` ou baissez \`steady high water\`.
3. Si vous entendez des clics reguliers, augmentez legerement les seuils steady/startup avant d'augmenter le parallelisme des requetes.
4. \`max blocks per request\` limite les gros bursts de rendu qui peuvent ajouter du delai.

### Signification des etats

- \`startup\` : utilise pendant que la file se remplit apres la connexion ou la recovery.
- \`steady\` : lecture normale une fois le flux amorce.
- \`recovery\` : comportement temporaire apres detection d'underruns.`,
    spanish: `### Orden practico de ajuste

1. Empieza por \`steady low/high water\`. Son los controles mas fuertes para equilibrar latencia y estabilidad.
2. Si las notas en vivo siguen sintiendose tardias, reduce con cuidado \`immediate note render blocks\` o baja \`steady high water\`.
3. Si oyes clics regulares, sube un poco los niveles steady/startup antes de aumentar el paralelismo de solicitudes.
4. \`max blocks per request\` limita bursts grandes de render que pueden anadir retraso adicional.

### Que significan los estados

- \`startup\`: se usa mientras la cola sigue llenandose tras conectar o recuperarse.
- \`steady\`: reproduccion normal una vez cebado el flujo.
- \`recovery\`: comportamiento temporal despues de detectar underruns.`
  },
  config_engine_values: {
    english: `### What This Panel Shows

- The values here are the normalized numbers already stored in the patch, not the raw text currently typed into the editable form.
- \`control_rate\` is the target value saved with the patch, while \`ksmps\` is the derived block size the engine will actually use.
- \`software_buffer\` and \`hardware_buffer\` are the exact values passed to Csound during compile/start.
- If the editable form contains invalid input, this read-only panel still shows the last valid patch configuration.

### When To Use It

- Compare this panel with the preview badges on the left before applying changes.
- Reopen the Config page after loading another patch to confirm which engine settings belong to that patch.`,
    german: `### Was dieses Panel zeigt

- Die Werte hier sind die normalisierten Zahlen, die bereits im Patch gespeichert sind, nicht der rohe Text aus dem editierbaren Formular.
- \`control_rate\` ist der im Patch gespeicherte Zielwert, waehrend \`ksmps\` die daraus abgeleitete Blockgroesse ist, die die Engine tatsaechlich benutzt.
- \`software_buffer\` und \`hardware_buffer\` sind die exakten Werte, die beim Compile/Start an Csound uebergeben werden.
- Enthält das editierbare Formular ungueltige Eingaben, zeigt dieses Nur-Lese-Panel weiterhin die letzte gueltige Patch-Konfiguration.

### Wann es hilfreich ist

- Dieses Panel vor dem Anwenden mit den Vorschau-Badges links vergleichen.
- Nach dem Laden eines anderen Patches die Config-Seite erneut pruefen, um die zu diesem Patch gehoerenden Engine-Werte zu bestaetigen.`,
    french: `### Ce que montre ce panneau

- Les valeurs affichees ici sont les nombres normalises deja stockes dans le patch, pas le texte brut actuellement saisi dans le formulaire editable.
- \`control_rate\` est la valeur cible sauvegardee avec le patch, tandis que \`ksmps\` est la taille de bloc derivee que le moteur utilisera reellement.
- \`software_buffer\` et \`hardware_buffer\` sont les valeurs exactes transmises a Csound pendant compile/start.
- Si le formulaire editable contient une entree invalide, ce panneau en lecture seule continue d'afficher la derniere configuration valide du patch.

### Quand l'utiliser

- Comparez ce panneau avec les badges de previsualisation a gauche avant d'appliquer des changements.
- Rouvrez la page Config apres avoir charge un autre patch pour confirmer quels reglages moteur appartiennent a ce patch.`,
    spanish: `### Que muestra este panel

- Los valores de aqui son los numeros normalizados ya guardados en el patch, no el texto bruto que este escrito en el formulario editable.
- \`control_rate\` es el valor objetivo guardado con el patch, mientras que \`ksmps\` es el tamano de bloque derivado que el motor usara realmente.
- \`software_buffer\` y \`hardware_buffer\` son los valores exactos que se pasan a Csound durante compilar/iniciar.
- Si el formulario editable contiene una entrada invalida, este panel de solo lectura sigue mostrando la ultima configuracion valida del patch.

### Cuando usarlo

- Compara este panel con las insignias de vista previa de la izquierda antes de aplicar cambios.
- Vuelve a abrir la pagina Config despues de cargar otro patch para confirmar que ajustes del motor pertenecen a ese patch.`
  }
};
