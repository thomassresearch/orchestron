import type { HelpDocumentAppendixSet, HelpDocumentSet, InstrumentHelpDocId } from "./helpDocumentationTypes";

export const instrumentHelpDocuments: HelpDocumentSet<InstrumentHelpDocId> = {
  instrument_patch_toolbar: {
    english: {
      title: "Instrument Patch Toolbar",
      markdown: `## Instrument Patch Toolbar

Use this area to organize patch files and main patch actions.

- Rename the current patch and edit its short description.
- Load an existing patch into the current tab.
- Create a new patch draft.
- Save the current patch to the backend.
- Compile the current graph into Csound ORC/CSD.
- Export the compiled CSD file.

Each instrument tab keeps its own editable graph snapshot.`
    },
    german: {
      title: "Instrument Patch Toolbar",
      markdown: `## Instrument Patch Toolbar

Dieser Bereich steuert Patch-Dateien und Hauptaktionen.

- Aktuellen Patch umbenennen und Beschreibung bearbeiten.
- Vorhandenen Patch in den aktuellen Tab laden.
- Neuen Patch-Entwurf erstellen.
- Aktuellen Patch im Backend speichern.
- Aktuellen Graphen in Csound ORC/CSD kompilieren.
- Kompilierte CSD-Datei exportieren.

Jeder Instrument-Tab behält eine eigene bearbeitbare Graph-Kopie.`
    },
    french: {
      title: "Barre de patch instrument",
      markdown: `## Barre de patch instrument

Cette zone gère les fichiers de patch et les actions principales.

- Renommer le patch courant et modifier sa description.
- Charger un patch existant dans l'onglet courant.
- Créer un nouveau brouillon de patch.
- Enregistrer le patch courant sur le backend.
- Compiler le graphe courant en Csound ORC/CSD.
- Exporter le fichier CSD compilé.

Chaque onglet instrument garde son propre état de graphe éditable.`
    },
    spanish: {
      title: "Barra de patch de instrumento",
      markdown: `## Barra de patch de instrumento

Esta zona controla archivos de patch y acciones principales.

- Renombrar el patch actual y editar su descripción.
- Cargar un patch existente en la pestaña actual.
- Crear un nuevo borrador de patch.
- Guardar el patch actual en el backend.
- Compilar el grafo actual a Csound ORC/CSD.
- Exportar el archivo CSD compilado.

Cada pestaña de instrumento mantiene su propio estado editable del grafo.`
    }
  },
  instrument_opcode_catalog: {
    english: {
      title: "Opcode Catalog",
      markdown: `## Opcode Catalog

Browse and insert opcodes into the graph editor.

- Search by opcode name, category, tags, or description.
- Click an opcode to add it to the graph.
- Drag and drop opcodes from this list into the graph canvas.

The icon and category help identify the signal role of each opcode.`
    },
    german: {
      title: "Opcode-Katalog",
      markdown: `## Opcode-Katalog

Hier werden Opcodes für den Graph Editor gesucht und eingefügt.

- Suche nach Opcode-Name, Kategorie, Tags oder Beschreibung.
- Klick auf ein Opcode fügt es in den Graphen ein.
- Drag-and-drop aus dieser Liste in die Graph-Fläche.

Icon und Kategorie helfen bei der Einordnung der Signalrolle.`
    },
    french: {
      title: "Catalogue Opcode",
      markdown: `## Catalogue Opcode

Parcourez et insérez des opcodes dans l'éditeur de graphe.

- Rechercher par nom, catégorie, tags ou description.
- Cliquer sur un opcode pour l'ajouter au graphe.
- Glisser-deposer des opcodes vers le canevas du graphe.

L'icône et la catégorie aident à identifier le rôle du signal.`
    },
    spanish: {
      title: "Catálogo de Opcode",
      markdown: `## Catálogo de Opcode

Explora e inserta opcodes en el editor de grafos.

- Busca por nombre, categoría, etiquetas o descripción.
- Haz clic en un opcode para agregarlo al grafo.
- Arrastra y suelta opcodes de esta lista al lienzo.

El ícono y la categoría ayudan a identificar el rol de la señal.`
    }
  },
  instrument_graph_editor: {
    english: {
      title: "Graph Editor",
      markdown: `## Graph Editor

This is the visual patching area for signal routing.

- Connect compatible ports between nodes.
- Edit node parameters in controls on each node.
- Select nodes or cables to inspect and delete them.
- Use the node-level \`?\` button to open opcode documentation.

Compilation order is derived from graph dependencies.`
    },
    german: {
      title: "Graph Editor",
      markdown: `## Graph Editor

Dies ist der visuelle Patch-Bereich für Signalrouting.

- Kompatible Ports zwischen Nodes verbinden.
- Parameter direkt auf den Nodes bearbeiten.
- Nodes oder Kabel auswählen, prüfen und löschen.
- Die Node-\`?\`-Taste öffnet die Opcode-Dokumentation.

Die Kompilierungsreihenfolge folgt den Graph-Abhängigkeiten.`
    },
    french: {
      title: "Éditeur de graphe",
      markdown: `## Éditeur de graphe

Zone visuelle de patch pour le routage des signaux.

- Connecter des ports compatibles entre nœuds.
- Modifier les paramètres sur chaque nœud.
- Sélectionner nœuds ou connexions pour inspection/suppression.
- Le bouton \`?\` d'un nœud ouvre la documentation opcode.

L'ordre de compilation suit les dépendances du graphe.`
    },
    spanish: {
      title: "Editor de grafos",
      markdown: `## Editor de grafos

Zona visual de patch para enrutar señales.

- Conectar puertos compatibles entre nodos.
- Editar parámetros en cada nodo.
- Seleccionar nodos o conexiones para inspeccionar/eliminar.
- El botón \`?\` del nodo abre la documentación del opcode.

El orden de compilación depende de las dependencias del grafo.`
    }
  },
  instrument_runtime_panel: {
    english: {
      title: "Runtime Panel",
      markdown: `## Runtime Panel

Monitor and control runtime session behavior.

- Bind the active MIDI input for the current session.
- Inspect generated ORC output after compile.
- Review recent session events from WebSocket updates.

Use this panel while testing patches live.`
    },
    german: {
      title: "Runtime-Panel",
      markdown: `## Runtime-Panel

Überwachen und steuern der laufenden Session.

- Aktiven MIDI-Eingang für die Session binden.
- Generierten ORC-Output nach der Kompilierung prüfen.
- Letzte Session-Events aus WebSocket-Updates ansehen.

Dieses Panel während Live-Tests verwenden.`
    },
    french: {
      title: "Panneau Runtime",
      markdown: `## Panneau Runtime

Surveillance et contrôle de la session runtime.

- Associer l'entrée MIDI active à la session courante.
- Inspecter la sortie ORC après compilation.
- Consulter les événements récents de session (WebSocket).

Utilisez ce panneau pendant les tests en direct.`
    },
    spanish: {
      title: "Panel Runtime",
      markdown: `## Panel Runtime

Monitorea y controla el comportamiento de la sesión runtime.

- Vincula la entrada MIDI activa para la sesión actual.
- Revisa la salida ORC generada tras compilar.
- Consulta eventos recientes de sesión via WebSocket.

Usa este panel durante pruebas en vivo.`
    }
  },
};

export const instrumentHelpAppendices: HelpDocumentAppendixSet<InstrumentHelpDocId> = {
  instrument_patch_toolbar: {
    english: `### Patch Library Workflow

- Tabs are local working slots. Switching tabs keeps each draft graph open, but does not save anything to the backend library by itself.
- \`Load Patch\` replaces the active tab with a saved patch snapshot, which is useful for comparing or reusing library patches without closing other tabs.
- \`Save\` persists the current graph, metadata, layout, and engine settings only after compile validation succeeds.

### Action Differences

- \`Compile\` refreshes the generated ORC/CSD artifacts and compile status, but does not store the patch in the library.
- \`New\` starts a fresh unsaved draft, while \`Clone\` creates another saved patch from the current one.
- \`Export\` / \`Import\` move Orchestron instrument bundles, while \`Export CSD\` downloads the raw compiled Csound file for use outside the app.`,
    german: `### Workflow der Patch-Bibliothek

- Tabs sind lokale Arbeits-Slots. Beim Wechseln bleiben Entwuerfe offen, es wird aber nichts automatisch in der Backend-Bibliothek gespeichert.
- \`Load Patch\` ersetzt den aktiven Tab durch einen gespeicherten Patch-Snapshot. Das ist praktisch, um Library-Patches zu vergleichen oder wiederzuverwenden, ohne andere Tabs zu schliessen.
- \`Save\` persistiert den aktuellen Graphen, die Metadaten, das Layout und die Engine-Werte erst dann, wenn die Compile-Validierung erfolgreich war.

### Unterschiede der Aktionen

- \`Compile\` aktualisiert die erzeugten ORC/CSD-Artefakte und den Compile-Status, speichert den Patch aber nicht in der Bibliothek.
- \`New\` startet einen neuen ungespeicherten Entwurf, waehrend \`Clone\` einen zweiten gespeicherten Patch aus dem aktuellen erzeugt.
- \`Export\` / \`Import\` bewegen Orchestron-Instrument-Bundles; \`Export CSD\` laedt die rohe kompilierte Csound-Datei fuer die Nutzung ausserhalb der App herunter.`,
    french: `### Workflow de la bibliotheque de patchs

- Les onglets sont des espaces de travail locaux. Changer d'onglet conserve chaque brouillon ouvert, mais ne sauvegarde rien dans la bibliotheque backend.
- \`Load Patch\` remplace l'onglet actif par un snapshot de patch sauvegarde ; c'est pratique pour comparer ou reutiliser des patchs de la bibliotheque sans fermer les autres onglets.
- \`Save\` persiste le graphe courant, les metadonnees, la mise en page et les reglages moteur uniquement apres une validation de compilation reussie.

### Differences entre les actions

- \`Compile\` rafraichit les artefacts ORC/CSD generes et l'etat de compilation, mais n'enregistre pas le patch dans la bibliotheque.
- \`New\` demarre un nouveau brouillon non sauvegarde, tandis que \`Clone\` cree un deuxieme patch sauvegarde a partir du patch courant.
- \`Export\` / \`Import\` deplacent des bundles d'instrument Orchestron, alors que \`Export CSD\` telecharge le fichier Csound compile brut pour une utilisation hors de l'app.`,
    spanish: `### Flujo de biblioteca de patches

- Las pestanas son espacios de trabajo locales. Cambiar de pestana mantiene cada borrador abierto, pero no guarda nada por si solo en la biblioteca del backend.
- \`Load Patch\` reemplaza la pestana activa con un snapshot guardado del patch; esto sirve para comparar o reutilizar patches de la biblioteca sin cerrar otras pestanas.
- \`Save\` persiste el grafo actual, los metadatos, el layout y los ajustes del motor solo despues de que la validacion de compilacion haya sido correcta.

### Diferencias entre acciones

- \`Compile\` actualiza los artefactos ORC/CSD generados y el estado de compilacion, pero no guarda el patch en la biblioteca.
- \`New\` inicia un borrador nuevo sin guardar, mientras que \`Clone\` crea otro patch guardado a partir del actual.
- \`Export\` / \`Import\` mueven bundles de instrumento de Orchestron, mientras que \`Export CSD\` descarga el archivo Csound compilado en bruto para usarlo fuera de la app.`
  },
  instrument_opcode_catalog: {
    english: `### Search And Discovery

- Search matches opcode name, category, tags, and description, so functional terms such as \`filter\`, \`midi\`, or \`reverb\` are enough to find relevant nodes.
- Icon and category labels mirror the graph editor's visual grouping, which helps identify generators, filters, MIDI utilities, and similar signal roles before insertion.
- Click insertion is fastest for rough sketching; drag-and-drop is better when node placement already matters.

### Catalog Help vs Opcode Docs

- This help explains how to find and place supported opcodes inside VisualCSound.
- Technical opcode details open from the placed node's \`?\` button and include ports, syntax, tags, and the direct Csound reference link.
- Only opcodes with app support appear here, so search results reflect what the graph editor and compiler can render end-to-end.`,
    german: `### Suche und Orientierung

- Die Suche gleicht Opcode-Name, Kategorie, Tags und Beschreibung ab, daher reichen Funktionsbegriffe wie \`filter\`, \`midi\` oder \`reverb\`, um passende Nodes zu finden.
- Icon und Kategorie spiegeln die visuelle Gruppierung des Graph Editors wider und helfen schon vor dem Einfuegen bei Generatoren, Filtern, MIDI-Helfern und aehnlichen Signalrollen.
- Klick-Einfuegen ist am schnellsten fuer grobe Skizzen; Drag-and-drop ist besser, wenn die Node-Position bereits wichtig ist.

### Katalog-Hilfe vs. Opcode-Dokumentation

- Diese Hilfe erklaert, wie unterstuetzte Opcodes in VisualCSound gefunden und platziert werden.
- Technische Opcode-Details oeffnen ueber die \`?\`-Taste eines platzierten Nodes und enthalten Ports, Syntax, Tags sowie den direkten Csound-Referenzlink.
- Hier erscheinen nur Opcodes mit App-Unterstuetzung; die Suchergebnisse entsprechen also dem, was Graph Editor und Compiler Ende-zu-Ende verarbeiten koennen.`,
    french: `### Recherche et reperage

- La recherche couvre le nom d'opcode, la categorie, les tags et la description ; des termes fonctionnels comme \`filter\`, \`midi\` ou \`reverb\` suffisent donc pour trouver les bons nœuds.
- Les icones et categories reprennent le regroupement visuel de l'editeur de graphe et aident a identifier generateurs, filtres, utilitaires MIDI et roles similaires avant insertion.
- Le clic pour inserer est le plus rapide pour esquisser un patch ; le glisser-deposer est preferable quand le placement du nœud compte deja.

### Aide du catalogue vs documentation opcode

- Cette aide explique comment trouver et placer les opcodes pris en charge dans VisualCSound.
- Les details techniques d'un opcode s'ouvrent depuis le bouton \`?\` du nœud place et incluent ports, syntaxe, tags et lien direct vers la reference Csound.
- Seuls les opcodes pris en charge par l'application apparaissent ici ; les resultats de recherche correspondent donc a ce que l'editeur de graphe et le compilateur savent rendre de bout en bout.`,
    spanish: `### Busqueda y orientacion

- La busqueda coincide con nombre de opcode, categoria, etiquetas y descripcion, asi que terminos funcionales como \`filter\`, \`midi\` o \`reverb\` bastan para encontrar nodos relevantes.
- El icono y la categoria reflejan la agrupacion visual del editor de grafos y ayudan a identificar generadores, filtros, utilidades MIDI y roles similares antes de insertar.
- Insertar con clic es lo mas rapido para esbozar; arrastrar y soltar funciona mejor cuando la posicion del nodo ya importa.

### Ayuda del catalogo vs documentacion de opcode

- Esta ayuda explica como encontrar y colocar opcodes compatibles dentro de VisualCSound.
- Los detalles tecnicos del opcode se abren desde el boton \`?\` del nodo colocado e incluyen puertos, sintaxis, etiquetas y el enlace directo a la referencia de Csound.
- Aqui solo aparecen opcodes con soporte de la app, asi que los resultados de busqueda reflejan lo que el editor de grafos y el compilador pueden procesar de extremo a extremo.`
  },
  instrument_graph_editor: {
    english: `### Working In The Graph

- The canvas stores node positions, input-formula metadata, and other UI layout details with the patch, so reopening a saved patch restores the last arranged view.
- Connections should follow compatible port types, but the backend compiler remains the final source of truth for missing inputs, invalid formulas, and compile errors.
- The delete action only removes explicitly selected nodes or cables; casual socket interaction is intentionally prevented from tearing down existing wiring.
- Constant nodes expose inline value editing, so simple control or init values can be adjusted without opening another inspector.

### Combining Multiple Signals On One Input

If multiple signals are connected to the **same input** of an opcode:

1. Select the opcode node.
2. Double-click the input connector of that target input.
3. The **Input Formula Assistant** opens.
4. Define how the signals are combined (for example \`in1 + in2\`, or \`in1 * 0.6 + in2 * 0.4\`).
5. Save the formula.

| Token | Meaning |
| --- | --- |
| \`in1\`, \`in2\`, ... | Connected incoming signals |
| \`sr\` | Audio sample rate configured for the patch |
| \`+\`, \`-\`, \`*\`, \`/\` | Arithmetic operators |
| \`(\`, \`)\` | Grouping / precedence |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Unary functions |`,
    german: `### Arbeiten im Graph Editor

- Die Canvas speichert Node-Positionen, Input-Formula-Metadaten und weitere UI-Layout-Details zusammen mit dem Patch, sodass ein gespeicherter Patch wieder in der zuletzt angeordneten Ansicht oeffnet.
- Verbindungen sollten kompatiblen Port-Typen folgen, aber der Backend-Compiler bleibt die letzte Instanz fuer fehlende Eingänge, ungueltige Formeln und Compile-Fehler.
- Die Delete-Aktion entfernt nur explizit ausgewaehlte Nodes oder Kabel; lockere Socket-Interaktionen sollen bestehendes Wiring bewusst nicht versehentlich zerreissen.
- Constant-Nodes erlauben Inline-Wertbearbeitung, damit einfache Control- oder Init-Werte ohne zusaetzlichen Inspector angepasst werden koennen.

### Mehrere Signale auf demselben Eingang kombinieren

Wenn mehrere Signale mit **demselben Eingang** eines Opcodes verbunden sind:

1. Den Opcode-Node auswählen.
2. Den Eingangs-Connector dieses Eingangs doppelklicken.
3. Der **Input Formula Assistant** wird geöffnet.
4. Definieren, wie Signale kombiniert werden (z.B. \`in1 + in2\` oder \`in1 * 0.6 + in2 * 0.4\`).
5. Formel speichern.

| Token | Bedeutung |
| --- | --- |
| \`in1\`, \`in2\`, ... | Verbundene Eingangssignale |
| \`sr\` | Im Patch konfigurierte Audio-Sample-Rate |
| \`+\`, \`-\`, \`*\`, \`/\` | Arithmetische Operatoren |
| \`(\`, \`)\` | Gruppierung / Priorität |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Unäre Funktionen |`,
    french: `### Travailler dans l'editeur de graphe

- Le canevas stocke les positions des nœuds, les metadonnees de formule d'entree et d'autres details de mise en page UI avec le patch ; rouvrir un patch sauvegarde restaure donc la derniere vue organisee.
- Les connexions doivent suivre des types de ports compatibles, mais le compilateur backend reste l'autorite finale pour les entrees manquantes, les formules invalides et les erreurs de compilation.
- L'action de suppression ne retire que les nœuds ou cables explicitement selectionnes ; une interaction normale avec les sockets ne doit pas casser le cablage existant par accident.
- Les nœuds constants exposent une edition inline des valeurs, ce qui permet d'ajuster des valeurs simples de controle ou d'init sans ouvrir un autre inspecteur.

### Combiner plusieurs signaux sur la même entrée

Si plusieurs signaux sont connectés à **la même entrée** d'un opcode :

1. Sélectionnez le nœud opcode.
2. Double-cliquez le connecteur d'entrée cible.
3. L'**Input Formula Assistant** s'ouvre.
4. Définissez la formule de combinaison (ex. \`in1 + in2\` ou \`in1 * 0.6 + in2 * 0.4\`).
5. Enregistrez la formule.

| Token | Signification |
| --- | --- |
| \`in1\`, \`in2\`, ... | Signaux entrants connectés |
| \`sr\` | Fréquence d'échantillonnage audio configurée pour le patch |
| \`+\`, \`-\`, \`*\`, \`/\` | Opérateurs arithmétiques |
| \`(\`, \`)\` | Groupement / priorité |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Fonctions unaires |`,
    spanish: `### Trabajo en el editor de grafos

- El lienzo guarda posiciones de nodos, metadatos de formulas de entrada y otros detalles de layout de la UI junto con el patch, asi que al reabrir un patch guardado se recupera la ultima disposicion.
- Las conexiones deben seguir tipos de puerto compatibles, pero el compilador del backend sigue siendo la referencia final para entradas faltantes, formulas invalidas y errores de compilacion.
- La accion de borrar solo elimina nodos o cables seleccionados de forma explicita; una interaccion casual con sockets no debe romper el cableado existente por accidente.
- Los nodos constantes exponen edicion inline de valores para ajustar controles o valores init simples sin abrir otro inspector.

### Combinar múltiples señales en la misma entrada

Si múltiples señales están conectadas a **la misma entrada** de un opcode:

1. Selecciona el nodo opcode.
2. Haz doble clic en el conector de esa entrada.
3. Se abre el **Input Formula Assistant**.
4. Define la fórmula de combinación (por ejemplo \`in1 + in2\` o \`in1 * 0.6 + in2 * 0.4\`).
5. Guarda la fórmula.

| Token | Significado |
| --- | --- |
| \`in1\`, \`in2\`, ... | Señales entrantes conectadas |
| \`sr\` | Frecuencia de muestreo de audio configurada en el patch |
| \`+\`, \`-\`, \`*\`, \`/\` | Operadores aritméticos |
| \`(\`, \`)\` | Agrupación / precedencia |
| \`abs()\`, \`ceil()\`, \`floor()\`, \`ampdb()\`, \`dbamp()\` | Funciones unarias |`
  },
  instrument_runtime_panel: {
    english: `### Live Test Workflow

- The MIDI input selector binds external hardware or DAW input to the active runtime session of the current patch. It is session-specific, so changing sessions can change the available binding.
- Compile output shows the generated ORC used for runtime, which is useful when checking how formulas, GEN data, and meta-opcodes were rendered.
- Session events list recent backend/runtime messages so start, stop, compile, and error transitions can be verified without leaving the patch page.

### Audio Mode Details

- In browser-clock mode, this panel reports browser-audio status while the browser owns the PCM queue and renders playback through AudioWorklet.
- In local DAC mode, audio stays on the backend machine and the panel focuses on diagnostics instead of browser playback.
- If the panel is collapsed, the graph header can show it again with \`Show runtime\`.`,
    german: `### Workflow fuer Live-Tests

- Der MIDI-Input-Selector bindet externe Hardware- oder DAW-Eingaben an die aktive Runtime-Session des aktuellen Patches. Die Bindung ist sessionspezifisch; ein Session-Wechsel kann also auch die Zuweisung aendern.
- Der Compile-Output zeigt das erzeugte ORC, das die Runtime wirklich benutzt. Das hilft beim Pruefen, wie Formeln, GEN-Daten und Meta-Opcodes gerendert wurden.
- Session-Events listen juengste Backend-/Runtime-Meldungen auf, sodass Start-, Stop-, Compile- und Fehler-Uebergaenge direkt auf der Patch-Seite nachvollzogen werden koennen.

### Details zum Audio-Modus

- Im Browser-Clock-Modus zeigt dieses Panel den Browser-Audio-Status, waehrend der Browser die PCM-Warteschlange besitzt und die Wiedergabe ueber AudioWorklet rendert.
- Im lokalen DAC-Modus bleibt das Audio auf dem Backend-Rechner; das Panel konzentriert sich dann auf Diagnostik statt Browser-Wiedergabe.
- Ist das Panel eingeklappt, kann es ueber \`Show runtime\` in der Kopfzeile des Graph Editors wieder eingeblendet werden.`,
    french: `### Workflow de test live

- Le selecteur d'entree MIDI relie le materiel externe ou l'entree DAW a la session runtime active du patch courant. Cette liaison est propre a la session ; changer de session peut donc changer l'affectation disponible.
- La sortie de compilation montre l'ORC genere utilise par la runtime, ce qui aide a verifier comment les formules, donnees GEN et meta-opcodes ont ete rendus.
- Les evenements de session listent les messages backend/runtime recents afin de verifier les transitions de demarrage, d'arret, de compilation et d'erreur sans quitter la page du patch.

### Details du mode audio

- En mode browser-clock, ce panneau affiche l'etat audio du navigateur pendant que le navigateur possede la file PCM et rend la lecture via AudioWorklet.
- En mode DAC local, l'audio reste sur la machine backend ; le panneau se concentre alors sur le diagnostic plutot que sur la lecture dans le navigateur.
- Si le panneau est replie, l'en-tete du graphe peut le rouvrir via \`Show runtime\`.`,
    spanish: `### Flujo de prueba en vivo

- El selector de entrada MIDI enlaza hardware externo o entrada de DAW con la sesion runtime activa del patch actual. La vinculacion es especifica de la sesion, asi que al cambiar de sesion puede cambiar tambien la asignacion disponible.
- La salida de compilacion muestra el ORC generado que usa el runtime, lo que ayuda a comprobar como se renderizaron formulas, datos GEN y meta-opcodes.
- Los eventos de sesion listan mensajes recientes del backend/runtime para verificar transiciones de inicio, parada, compilacion y error sin salir de la pagina del patch.

### Detalles del modo de audio

- En modo browser-clock, este panel informa del estado de audio del navegador mientras el navegador posee la cola PCM y renderiza la reproduccion mediante AudioWorklet.
- En modo DAC local, el audio permanece en la maquina del backend y el panel se centra en diagnostico en lugar de reproduccion en navegador.
- Si el panel esta colapsado, el encabezado del editor de grafos puede volver a mostrarlo con \`Show runtime\`.`
  },
};
