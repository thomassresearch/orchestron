# If, Switch and Drumset

**Navigation:** [Graph Editor](graph_editor.md) | [Supported constructs](supported_opcodes.md) | [Audio Mixer](../performance/audio_mixer_and_routing.md)

## English — choose a synthesis case at note start

**If** and **Switch**, in the **Control flow** catalog category, are editor constructs that generate Csound `if/elseif/else/endif`. Each instrument instance chooses one case when its note starts. Only that case initializes and performs; selection remains fixed until the voice ends. Different notes, including repetitions of the same note, have independent voices.

1. Add If or Switch. New blocks produce stereo audio. If compares two init-rate inputs using `==`, `!=`, `<`, `<=`, `>` or `>=`. Switch compares its init-rate selector with unique numeric case values. For drums, connect `notnum.inote` to `selector`. Input connections and the existing arithmetic Input Formula Assistant take precedence over literal values in **Configure branches**.
2. Expand the cases on the canvas and drag opcodes from the catalog into a case. A valid drop into **Silence** changes it to **Synthesis** and exposes its result inputs. Ordinary canvas drops create main-graph nodes. Dropping onto a collapsed block expands it; drop again into a specific case.
3. Connect each synthesis case to its managed **Case Result** audio inputs. Several sources can sum at an input, or use an input formula. Connect the block's common output to shared processing or a named Stereo Output. Every non-silent case needs a value for every result channel, even if that case is rarely selected.
4. False and Default initially use **Silence**. Silence assigns zero to every output and contains no synthesis nodes. Changing an existing case to Silence previews the nodes, connections and formulas that will be removed. Switch cases can be renamed, reordered, added and deleted; Default remains last and cannot be deleted. If keeps its two ordered True/False cases.
5. Collapse to see the condition, case summary, shared inputs and common output. Node IDs, selection, positions and the viewport survive collapse, save and reload. Captured input formulas are retained; expand to edit them. Format changes show an impact preview: mono preserves `left` and removes `right` wiring only after confirmation; switching back to stereo leaves `right` unconnected. Block/case deletion removes owned content and associated formulas and configuration together.

### Arrange and transfer nodes

The block stays above and left-aligned with the first case, with room for its complete body and buttons. Case frames measure every visible parameter row at any zoom. They automatically grow to the right and bottom and retain their size when nodes move inward, are removed, or become smaller; **Case Result** stays in a separate row at the bottom-right. Later cases move down or up without changing their internal arrangement. The title band is 40 graph units, padding is 24, and cases have a 32-unit gap. Empty cases keep a 240 × 160 content area.

Drag the **Case Result title or unused body** to resize a branch in both dimensions, including shrinking it. This also works for the Silence marker. The pointer displacement sets the requested size; complete node bounds, padding and the reserved result row limit how small it can become. Other selected nodes stay still and selection is preserved. Sockets, formula editing and help buttons keep their usual actions. Release commits the size and managed positions together; **Escape**, cancellation or focus loss restores the full prior layout. Ordinary dragging retains the largest frame size reached during the gesture. Bright purple borders stay about two screen pixels wide at every zoom. Sizes survive collapse, block movement, reordering, save/reload, copies and export/import.

- Drag main-graph nodes into an expanded case to transfer them. Dragging existing case members normally only rearranges them within that case. Their top and left movement limits keep them clear of the header; selected groups keep their relative spacing. Moving the block moves all contents together.
- Hold **Alt/Option before starting the drag** to transfer case members to another case or the main graph. Keep the desired group selected. **Move selected nodes** in Configure branches is the alternative, with identical validation.
- A transfer requires every connection and formula binding touching a moved node to end at another moved node or a node already in the destination scope. A cyan border marks an allowed target; a red border and diagnostic list refused connections and unselected endpoints. Nothing is automatically selected, disconnected or deleted. An isolated ordinary node can always transfer.
- This restriction applies to **membership transfers**. Existing shared main-graph inputs remain valid; you can deliberately connect them after placing the nodes. Case-local values still leave through Case Result only. Main-graph-only constructs, nested blocks and independent Case Result transfers are refused.
- Release to commit positions and membership together. A refused drop, **Escape**, pointer cancellation or loss of focus restores the entire group and clears highlighting. A refused drop leaves Silence unchanged.

### Play the Drumset template

Choose **New from template → Drumset**. Notes **36**, **38**, and **42** play kick, snare, and hi-hat; all other notes select Default Silence. The kick uses a falling-pitch sine, the snare combines filtered noise and tone, and the hi-hat uses high-pass-filtered noise. Velocity scales finite amplitude envelopes. Branch-local `xtratim` preserves their decays after short MIDI notes. Audition offers a **Test MIDI note** field; for this template it starts at 36. Save, assign the patch to a MIDI channel in Perform, and route its named Stereo Output to the mixer destination. Send 36, 38 and 42 together to play all three sounds.

Processing after the block runs **once per voice**. Put effects in the performance mixer when they should process the **sum of the whole kit**. The example `examples/velocity_if.patch.json` uses `ampmidi` and If to choose sine or saw timbre by velocity; it requires no separate layering subsystem.

Continuous switching, nested blocks, numeric results, raw jumps, crossfades, MIDI learn, ranges and choke groups are outside this release. Keep `outs`, `inleta`, `outleta`, `sfload` and `maxalloc` in the main graph. GEN nodes and duration controls may belong to cases. Cycles and illegal scope crossings are compile errors, and all cases are validated.

## Patch/API format

Existing patches remain at `schema_version: 1`. Adding a block promotes the patch to **2**; removing the last block does not downgrade it. Create, update and compile use the existing APIs. Unsupported versions and malformed structural records are rejected. Native instrument/performance exports, application state, patch copies, audition and both CSD export modes retain the configuration.

The graph remains flat. Add a typed `graph.control_flow` map keyed by the structural node's ID; each key must reference an `If` or `Switch` node. The example below describes a mono Switch whose ordinary flat node array also contains `kit`, `kick`, `kick_result` and `default_result`:

```json
{
  "kit": {
    "kind": "switch",
    "output_format": "mono",
    "operator": "==",
    "cases": [
      {"id": "kick_case", "name": "Kick", "value": 36,
       "node_ids": ["kick", "kick_result"],
       "result_node_id": "kick_result", "silence": false},
      {"id": "default_case", "name": "Default", "value": null,
       "node_ids": ["default_result"],
       "result_node_id": "default_result", "silence": true}
    ]
  }
}
```

- `kind`: `if` or `switch`; `output_format`: `mono` or `stereo`.
- `operator`: one of the six comparison operators; only If uses it.
- `cases`: ordered records with stable `id`, editable `name`, numeric `value` for Switch cases, and `null` for Default or both If cases.
- `node_ids`: exclusive membership, including the managed `CaseResult` node identified by `result_node_id`. Nesting and overlapping membership are invalid.
- `silence`: explicit boolean. A silent case contains only its result marker, with no input wiring, parameters or formulas.
- Block inputs: `lhs`/`rhs` for If, `selector` for Switch, all init-rate. Result and block output ports: `left`, plus `right` for stereo. CaseResult has no output ports.
- `graph.ui_layout.editor_state`: optional presentation with `selection` (`nodeIds` and canonical `connections`) and `viewport` (`x`, `y`, positive zoom `k`).
- `graph.ui_layout.control_flow_blocks[blockId]`: `true` means collapsed.
- `graph.ui_layout.control_flow_case_sizes[blockId][caseId]`: optional `{ "width": 1200, "height": 900 }` dimensions in graph units. Missing or malformed entries are initialized after all visible bodies are measured. Case/block deletion removes corresponding entries. Positions stay on ordinary node records; measured bounds and drag previews are transient. Input formulas retain their existing `ui_layout.input_formulas["nodeId::portId"]` format. Presentation never defines execution scope.

The compiler orders the main graph with each block as one operation, orders each case separately, emits shared dependencies first and downstream consumers afterwards, and assigns the common audio variables on every path. Score export retains the `notnum` to score-note conversion. CLI transformations of existing graphs must retain `control_flow` and patch version 2; the CLI's high-level layer syntax does not create branching automatically. Use the full drumset fixture as a complete authoring reference.

## Deutsch — Synthesezweig beim Notenstart

**If** und **Switch** sind Editor-Konstrukte in **Kontrollfluss**. Sie erzeugen Csound-Bedingungen. Jede Stimme wählt beim Notenstart genau einen Zweig, der allein initialisiert und ausgeführt wird. Die Auswahl bleibt bis zum Ende dieser Stimme bestehen; auch wiederholte gleiche Noten sind unabhängig.

If vergleicht zwei Eingänge mit i-Rate über `==`, `!=`, `<`, `<=`, `>` oder `>=`. Switch nutzt einen Auswahlwert und eindeutige numerische Zweigwerte sowie einen letzten Standardzweig. Verbindungen und arithmetische Eingangsformeln haben Vorrang vor den Zahlenfeldern. Neue Blöcke liefern Stereo.

Zweige auf dem Canvas ausklappen und Katalogknoten direkt darin ablegen. Ein gültiges Ablegen in **Stille** schaltet auf **Synthese** und zeigt die Ergebniseingänge. Auf freiem Canvas entstehen Hauptgraphknoten. Ein eingeklappter Block wird beim Ablegen zunächst ausgeklappt; danach einen bestimmten Zweig wählen.

Der Block bleibt linksbündig oberhalb des ersten Zweigs, einschließlich seiner Bedienelemente. Rahmen messen alle Parameterzeilen unabhängig vom Zoom und wachsen nach rechts und unten. Sie behalten ihre Größe, wenn Knoten nach innen verschoben, entfernt oder kleiner werden. Das **Zweigergebnis** bleibt unten rechts in einer eigenen Zeile. Nachfolgende Zweige werden mit unveränderter innerer Anordnung verschoben. Titelbereich: 40 Graph-Einheiten, Innenabstand: 24, Zweigabstand: 32, leerer Inhaltsbereich mindestens 240 × 160.

Zum Vergrößern oder Verkleinern eines Zweigs den **Titel oder freien Körper des Zweigergebnisses ziehen**; das funktioniert auch mit dem Stille-Marker. Die Zeigerbewegung bestimmt Breite und Höhe. Vollständige Knotengrenzen, Innenabstände und Ergebniszeile begrenzen die Mindestgröße. Andere ausgewählte Knoten bleiben stehen; die Auswahl bleibt erhalten. Buchsen, Formeleditor und Hilfeschaltflächen funktionieren wie bisher. Loslassen übernimmt Größe und verwaltete Positionen gemeinsam; **Escape**, Abbruch oder Fokusverlust stellt die gesamte vorherige Anordnung wieder her. Normales Ziehen behält die größte während der Geste erreichte Rahmengröße. Helle violette Rahmen bleiben bei jedem Zoom etwa zwei Bildschirmpixel breit. Größen bleiben beim Einklappen, Blockverschieben, Umsortieren, Speichern, Neuladen, Kopieren und Export/Import erhalten.

Hauptgraphknoten können durch normales Ziehen in einen Zweig wechseln. Normales Ziehen vorhandener Zweigknoten ändert nur deren Anordnung; obere und linke Grenzen begrenzen die gesamte Auswahl gemeinsam. Zum Wechsel in einen anderen Zweig oder den Hauptgraphen **Alt/Option bereits beim Beginn des Ziehens halten**. **Ausgewählte Knoten verschieben** bleibt als Alternative mit derselben Prüfung verfügbar.

Bei einem Zugehörigkeitswechsel müssen alle Verbindungen und Formelbindungen eines verschobenen Knotens zu mitverschobenen Knoten oder Knoten im Zielbereich führen. Türkis markiert erlaubte Ziele; Rot und eine Diagnose nennen unzulässige Verbindungen und nicht ausgewählte Endpunkte. Es wird nichts automatisch ausgewählt, getrennt oder gelöscht. Ein unverbundener gewöhnlicher Knoten kann immer wechseln. Bestehende gemeinsame Eingänge aus dem Hauptgraphen bleiben gültig und können nach der Platzierung bewusst verdrahtet werden. Interne Werte verlassen den Zweig nur über das Zweigergebnis; dort jeden Audiokanal anschließen, bei Bedarf mit Summe oder Eingangsformel. Verschachtelte Blöcke, Hauptgraph-Konstrukte im Zweig und unabhängig verschobene Ergebnisse sind unzulässig.

Loslassen übernimmt Positionen und Zugehörigkeit gemeinsam. Abgewiesenes Ablegen, **Escape**, Abbruch oder Fokusverlust stellt die gesamte Gruppe wieder her und entfernt die Hervorhebung. Stille bleibt bei ungültigem Ablegen unverändert. Der Block nimmt beim Verschieben alle Inhalte mit.

Falsch und Standard beginnen mit **Stille**: alle Ausgänge erhalten null, ohne Syntheseknoten. Wechsel zu Stille, Zweiglöschung und Formatwechsel zeigen betroffene Elemente vor der Bestätigung. Mono behält `left`; Stereo ergänzt einen unverbundenen `right`-Kanal. Standard bleibt zuletzt und kann nicht gelöscht werden. Einklappen, Speichern und Neuladen erhalten IDs, Auswahl, Positionen, Ansichtsfenster und Formeln; für Formeln an ausgeblendeten Eingängen wieder ausklappen.

**Neue Vorlage → Schlagzeug**: 36 Kick, 38 Snare, 42 Hi-Hat, sonst Stille. Anschlagstärke skaliert die Hüllkurven, lokales `xtratim` erhält das Ausklingen nach kurzem Note-off. Die MIDI-Testnote im Vorhören startet bei 36. Speichern, in Perform einen MIDI-Kanal zuweisen und Stereo Output im Mixer verbinden. Effekte nach dem Block wirken pro Stimme; Mixer-Effekte bearbeiten das gesamte summierte Schlagzeug. Das If-Beispiel wählt Sinus oder Sägezahn nach Anschlagstärke.

**Datenformat:** Bestehende Patches bleiben Version 1; Verzweigungen führen dauerhaft zu Version 2. `graph.control_flow` enthält pro Block `kind`, `output_format`, `operator` und geordnete `cases`. Jeder Zweig speichert stabile `id`, `name`, `value`, exklusive `node_ids`, `result_node_id` und `silence`. Die JSON-Feldnamen und das Beispiel oben gelten in allen Sprachen. `ui_layout.control_flow_blocks` speichert den Einklappzustand; `ui_layout.control_flow_case_sizes[blockId][caseId]` speichert `{width, height}` in Graph-Einheiten. Ungültige oder fehlende Größen werden nach vollständiger Messung neu ermittelt, bei Löschung werden die zugehörigen Einträge entfernt. Beides ist reine Darstellung. Speichern, Kopieren, App-Zustand sowie Instrument-, Performance- und CSD-Export behalten die Struktur. Unbekannte Versionen, Zyklen und ungültige Zugehörigkeit werden abgewiesen. Keine Verschachtelung oder laufende Umschaltung; `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` bleiben im Hauptgraphen. GEN und Dauersteuerung sind im Zweig erlaubt.

## Français — choisir au début de la note

**If** et **Switch**, dans **Contrôle de flux**, sont des constructions de l'éditeur qui produisent des conditions Csound. Chaque voix choisit un seul cas au début de sa note. Seul ce cas est initialisé et exécuté jusqu'à la fin de la voix. Les notes différentes ou répétées restent indépendantes.

If compare deux entrées de taux i avec `==`, `!=`, `<`, `<=`, `>` ou `>=`. Switch compare son sélecteur à des valeurs numériques uniques et garde un cas Par défaut en dernier. Connexions et formules arithmétiques d'entrée sont prioritaires sur les valeurs littérales. Les nouveaux blocs produisent de la stéréo.

Développez les cas et déposez-y directement les nœuds du catalogue. Un dépôt valide dans **Silence** active **Synthèse** et affiche les entrées du résultat. Un dépôt sur le canevas libre crée un nœud dans le graphe principal. Déposer sur un bloc réduit le développe ; déposez ensuite dans un cas précis.

Le bloc reste au-dessus du premier cas, aligné à gauche, avec de la place pour ses boutons. Les cadres mesurent toutes les lignes de paramètres indépendamment du zoom et s'agrandissent vers la droite et le bas. Ils conservent leur taille lorsque les nœuds sont déplacés vers l’intérieur, supprimés ou deviennent plus petits. Le **Résultat du cas** reste en bas à droite dans une ligne réservée. Les cas suivants se décalent sans changer leur disposition interne. Bande de titre : 40 unités du graphe, marge intérieure : 24, espacement entre cas : 32, contenu vide minimal : 240 × 160.

Glissez le **titre ou une zone libre du Résultat du cas** pour agrandir ou réduire la branche dans les deux dimensions, y compris le marqueur Silence. Le déplacement du pointeur définit la taille souhaitée ; les limites complètes des nœuds, les marges et la ligne du résultat fixent le minimum. Les autres nœuds sélectionnés restent immobiles et la sélection est conservée. Prises, formules et boutons d’aide gardent leurs actions habituelles. Relâcher valide ensemble la taille et les positions gérées ; **Échap**, une annulation ou une perte de focus restaure toute la disposition précédente. Un glissement ordinaire conserve la plus grande taille atteinte pendant le geste. Les bordures violet clair gardent environ deux pixels à l’écran quel que soit le zoom. Les tailles survivent à la réduction, au déplacement du bloc, au réordonnancement, à la sauvegarde, au rechargement, aux copies et à l’export/import.

Un glissement normal transfère les nœuds du graphe principal dans un cas. Pour les membres d'un cas, il modifie seulement leur disposition ; les limites supérieure et gauche s'appliquent au groupe entier. Maintenez **Alt/Option dès le début du glissement** pour transférer vers un autre cas ou le graphe principal. **Déplacer les nœuds sélectionnés** reste disponible avec la même validation.

Lors d'un transfert, chaque connexion et liaison de formule touchant un nœud déplacé doit aboutir à un autre nœud déplacé ou déjà dans le périmètre cible. Une bordure cyan signale un dépôt autorisé ; une bordure rouge et un diagnostic indiquent les connexions refusées et les extrémités non sélectionnées. Rien n'est sélectionné, déconnecté ou supprimé automatiquement. Un nœud ordinaire isolé peut toujours être transféré. Les entrées communes du graphe principal restent valides et peuvent être câblées volontairement après placement. Les valeurs internes sortent uniquement par le résultat ; reliez chaque canal, avec somme ou formule si nécessaire. Les blocs imbriqués, les constructions réservées au graphe principal et le transfert indépendant des résultats sont refusés.

Relâcher valide ensemble positions et appartenance. Un refus, **Échap**, une annulation ou une perte de focus restaure tout le groupe et retire la surbrillance. Un dépôt refusé conserve Silence. Déplacer le bloc déplace tout son contenu.

Faux et Par défaut commencent en **Silence**, avec zéro sur chaque sortie et aucun nœud de synthèse. Passer à Silence, supprimer un cas ou changer de format présente les éléments affectés avant confirmation. Mono conserve `left`; revenir en stéréo ajoute `right` sans connexion. Par défaut reste obligatoire. Réduire, enregistrer et recharger conserve identifiants, sélection, positions, cadrage et formules ; développez-le pour modifier une formule d'entrée masquée.

**Nouveau modèle → Batterie** : 36 grosse caisse, 38 caisse claire, 42 charleston, sinon silence. La vélocité règle les enveloppes, et `xtratim` local conserve leur décroissance après une note courte. La note MIDI de test de l'audition commence à 36. Enregistrez, affectez un canal MIDI dans Perform et routez Stereo Output dans le mixeur. Les effets après le bloc traitent chaque voix ; ceux du mixeur traitent la somme de la batterie. L'exemple If choisit sinus ou dent de scie selon la vélocité.

**Format des données :** les anciens patches restent en version 1 ; les branches font passer durablement à la version 2. `graph.control_flow` stocke `kind`, `output_format`, `operator` et les `cases` ordonnés. Chaque cas contient une `id` stable, `name`, `value`, les `node_ids` exclusifs, `result_node_id` et `silence`. Les champs JSON et l'exemple ci-dessus sont identiques dans toutes les langues. `ui_layout.control_flow_blocks` conserve l’état réduit ; `ui_layout.control_flow_case_sizes[blockId][caseId]` conserve `{width, height}` en unités du graphe. Les tailles absentes ou invalides sont recalculées après mesure complète ; supprimer un cas ou bloc retire ses entrées. Ces champs concernent uniquement la présentation. Sauvegardes, copies, état de l'application et exports instrument, performance et CSD préservent la structure. Versions inconnues, cycles et appartenances invalides sont rejetés. Pas d'imbrication ni de commutation continue ; `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` restent dans le graphe principal. GEN et les contrôles de durée sont permis dans les cas.

## Español — elegir al inicio de la nota

**If** y **Switch**, en **Flujo de control**, son construcciones del editor que generan condiciones Csound. Cada voz elige un caso al inicio de su nota. Solo ese caso se inicializa y ejecuta hasta el final de la voz. Las notas distintas o repetidas son independientes.

If compara dos entradas de tasa i con `==`, `!=`, `<`, `<=`, `>` o `>=`. Switch compara su selector con valores numéricos únicos y mantiene Por defecto al final. Las conexiones y fórmulas aritméticas de entrada tienen prioridad sobre los números literales. Los bloques nuevos producen estéreo.

Expande los casos y suelta directamente en ellos los nodos del catálogo. Una operación válida en **Silencio** activa **Síntesis** y muestra las entradas del resultado. Soltar sobre el lienzo libre crea nodos en el grafo principal. Soltar sobre un bloque contraído lo expande; después suelta en un caso concreto.

El bloque permanece encima del primer caso, alineado a la izquierda, con espacio para sus botones. Los marcos miden todas las filas de parámetros independientemente del zoom y crecen hacia la derecha y abajo. Conservan su tamaño cuando los nodos se desplazan hacia dentro, se eliminan o se hacen más pequeños. El **Resultado del caso** permanece abajo a la derecha en una fila reservada. Los casos posteriores se desplazan sin alterar su organización interna. Banda de título: 40 unidades del grafo, margen interior: 24, separación entre casos: 32, área vacía mínima: 240 × 160.

Arrastra el **título o una zona libre del Resultado del caso** para ampliar o reducir la rama en ambas dimensiones, también con el marcador Silencio. El desplazamiento del puntero define el tamaño solicitado; los límites completos de los nodos, los márgenes y la fila del resultado fijan el mínimo. Los demás nodos seleccionados permanecen inmóviles y se conserva la selección. Conectores, fórmulas y botones de ayuda mantienen sus acciones habituales. Soltar confirma el tamaño y las posiciones gestionadas juntos; **Escape**, cancelación o pérdida de foco restaura toda la disposición anterior. El arrastre normal conserva el mayor tamaño alcanzado durante el gesto. Los bordes violeta claro mantienen unos dos píxeles de pantalla con cualquier zoom. Los tamaños sobreviven a contraer, mover el bloque, reordenar, guardar, recargar, copiar y exportar/importar.

Arrastrar normalmente transfiere nodos del grafo principal a un caso. Para miembros de un caso, solo cambia su disposición; los límites superior e izquierdo se aplican al grupo completo. Mantén **Alt/Opción desde el inicio del arrastre** para transferir a otro caso o al grafo principal. **Mover nodos seleccionados** sigue disponible con la misma validación.

En una transferencia, cada conexión y vínculo de fórmula que toque un nodo movido debe terminar en otro nodo movido o en uno que ya pertenezca al ámbito de destino. Un borde cian indica un destino válido; un borde rojo y un diagnóstico enumeran conexiones rechazadas y extremos no seleccionados. No se selecciona, desconecta ni borra nada automáticamente. Un nodo ordinario aislado siempre puede transferirse. Las entradas compartidas del grafo principal siguen siendo válidas y pueden conectarse deliberadamente después de colocar los nodos. Los valores internos solo salen por el resultado; conecta cada canal, usando sumas o fórmulas si hace falta. Se rechazan bloques anidados, construcciones exclusivas del grafo principal y transferencias independientes de resultados.

Soltar confirma a la vez posiciones y pertenencia. Un rechazo, **Escape**, una cancelación o la pérdida de foco restaura todo el grupo y elimina el resaltado. Una operación inválida conserva Silencio. Mover el bloque mueve todo su contenido.

Falso y Por defecto empiezan con **Silencio**: cero en todas las salidas y ningún nodo de síntesis. Cambiar a Silencio, borrar un caso o cambiar de formato muestra los elementos afectados antes de confirmar. Mono conserva `left`; volver a estéreo añade `right` sin conectar. Por defecto es obligatorio. Contraer, guardar y recargar conserva IDs, selección, posiciones, encuadre y fórmulas; expande para editar las fórmulas de entradas ocultas.

**Nueva plantilla → Batería**: 36 bombo, 38 caja, 42 charles; el resto produce silencio. La velocidad escala las envolventes, y `xtratim` local conserva el decaimiento tras notas cortas. La nota MIDI de prueba de Audición empieza en 36. Guarda, asigna un canal MIDI en Perform y conecta Stereo Output en el mezclador. Los efectos posteriores al bloque procesan cada voz; los del mezclador procesan la suma de la batería. El ejemplo If elige seno o diente de sierra según la velocidad.

**Formato de datos:** los patches existentes siguen en versión 1; añadir ramas eleva permanentemente la versión a 2. `graph.control_flow` guarda `kind`, `output_format`, `operator` y los `cases` ordenados. Cada caso contiene una `id` estable, `name`, `value`, `node_ids` exclusivos, `result_node_id` y `silence`. Los campos JSON y el ejemplo anterior son iguales en todos los idiomas. `ui_layout.control_flow_blocks` guarda el estado contraído; `ui_layout.control_flow_case_sizes[blockId][caseId]` guarda `{width, height}` en unidades del grafo. Los tamaños ausentes o inválidos se recalculan tras medir todos los nodos; borrar casos o bloques elimina sus entradas. Ambos campos son solo presentación. Guardado, copias, estado de aplicación y exportaciones de instrumento, performance y CSD conservan la estructura. Se rechazan versiones desconocidas, ciclos y pertenencias inválidas. No se admite anidamiento ni conmutación continua; `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` permanecen en el grafo principal. GEN y controles de duración sí pueden pertenecer a casos.

## Csound references

- [Csound if](https://csound.com/docs/manual/if.html)
- [Csound xtratim](https://csound.com/docs/manual/xtratim.html)
