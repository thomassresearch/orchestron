# If, Switch and Drumset

**Navigation:** [Graph Editor](graph_editor.md) | [Supported constructs](supported_opcodes.md) | [Audio Mixer](../performance/audio_mixer_and_routing.md)

## English — choose a synthesis case at note start

**If** and **Switch**, in the **Control flow** catalog category, are editor constructs that generate Csound `if/elseif/else/endif`. Each instrument instance chooses one case when its note starts. Only that case initializes and performs; selection remains fixed until the voice ends. Different notes, including repetitions of the same note, have independent voices.

1. Add If or Switch. New blocks produce stereo audio. If compares two init-rate inputs using `==`, `!=`, `<`, `<=`, `>` or `>=`. Switch compares its init-rate selector with unique numeric case values. For drums, connect `notnum.inote` to `selector`. Input connections and the existing arithmetic Input Formula Assistant take precedence over literal values in **Configure branches**.
2. Expand the cases on the canvas. Use **Add node to case**, or select ordinary nodes and choose **Move selected nodes** to a case or **Main graph**. Dragging changes positions only; moving the block moves its contents. A rejected scope move lists the connections to repair. Sources in the main graph may feed several cases. A case cannot feed its sibling or expose internal values directly to the main graph.
3. Connect each synthesis case to its managed **Case Result** audio inputs. Several sources can sum at an input, or use an input formula. Connect the block's common output to shared processing or a named Stereo Output. Every non-silent case needs a value for every result channel, even if that case is rarely selected.
4. False and Default initially use **Silence**. Silence assigns zero to every output and contains no synthesis nodes. Changing an existing case to Silence previews the nodes, connections and formulas that will be removed. Switch cases can be renamed, reordered, added and deleted; Default remains last and cannot be deleted. If keeps its two ordered True/False cases.
5. Collapse to see the condition, case summary, shared inputs and common output. Node IDs, selection, positions and the viewport survive collapse, save and reload. Captured input formulas are retained; expand to edit them. Format changes show an impact preview: mono preserves `left` and removes `right` wiring only after confirmation; switching back to stereo leaves `right` unconnected. Block/case deletion removes owned content and associated formulas and configuration together.

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
- `graph.ui_layout.control_flow_blocks[blockId]`: `true` means collapsed. Positions stay on ordinary node records. Input formulas retain their existing `ui_layout.input_formulas["nodeId::portId"]` format. Presentation never defines execution scope.

The compiler orders the main graph with each block as one operation, orders each case separately, emits shared dependencies first and downstream consumers afterwards, and assigns the common audio variables on every path. Score export retains the `notnum` to score-note conversion. CLI transformations of existing graphs must retain `control_flow` and patch version 2; the CLI's high-level layer syntax does not create branching automatically. Use the full drumset fixture as a complete authoring reference.

## Deutsch — Synthesezweig beim Notenstart

**If** und **Switch** sind Editor-Konstrukte in **Kontrollfluss**. Sie erzeugen Csound-Bedingungen. Jede Stimme wählt beim Notenstart genau einen Zweig, der allein initialisiert und ausgeführt wird. Die Auswahl bleibt bis zum Ende dieser Stimme bestehen; auch wiederholte gleiche Noten sind unabhängig.

If vergleicht zwei Eingänge mit i-Rate über `==`, `!=`, `<`, `<=`, `>` oder `>=`. Switch nutzt einen Auswahlwert und eindeutige numerische Zweigwerte sowie einen letzten Standardzweig. Verbindungen und arithmetische Eingangsformeln haben Vorrang vor den Zahlenfeldern. Neue Blöcke liefern Stereo.

Zweige auf dem vorhandenen Canvas ausklappen. **Knoten zum Zweig hinzufügen** oder **Ausgewählte Knoten verschieben** ordnet Knoten ausdrücklich einem Synthesezweig oder dem Hauptgraphen zu. Ziehen ändert nur die Position; der Block nimmt seine Inhalte mit. Ungültige Verschiebungen nennen betroffene Verbindungen. Gemeinsame Quellen dürfen in Zweige führen. Interne Werte verlassen den Zweig nur über das **Zweigergebnis**. Dort jeden Audiokanal anschließen; mehrere Quellen können summiert oder durch eine Eingangsformel kombiniert werden.

Falsch und Standard beginnen mit **Stille**: alle Ausgänge erhalten null, ohne Syntheseknoten. Wechsel zu Stille, Zweiglöschung und Formatwechsel zeigen betroffene Elemente vor der Bestätigung. Mono behält `left`; Stereo ergänzt einen unverbundenen `right`-Kanal. Standard bleibt zuletzt und kann nicht gelöscht werden. Einklappen, Speichern und Neuladen erhalten IDs, Auswahl, Positionen, Ansichtsfenster und Formeln; für Formeln an ausgeblendeten Eingängen wieder ausklappen.

**Neue Vorlage → Schlagzeug**: 36 Kick, 38 Snare, 42 Hi-Hat, sonst Stille. Anschlagstärke skaliert die Hüllkurven, lokales `xtratim` erhält das Ausklingen nach kurzem Note-off. Die MIDI-Testnote im Vorhören startet bei 36. Speichern, in Perform einen MIDI-Kanal zuweisen und Stereo Output im Mixer verbinden. Effekte nach dem Block wirken pro Stimme; Mixer-Effekte bearbeiten das gesamte summierte Schlagzeug. Das If-Beispiel wählt Sinus oder Sägezahn nach Anschlagstärke.

**Datenformat:** Bestehende Patches bleiben Version 1; Verzweigungen führen dauerhaft zu Version 2. `graph.control_flow` enthält pro Block `kind`, `output_format`, `operator` und geordnete `cases`. Jeder Zweig speichert stabile `id`, `name`, `value`, exklusive `node_ids`, `result_node_id` und `silence`. Die JSON-Feldnamen und das Beispiel oben gelten in allen Sprachen. `ui_layout.control_flow_blocks` speichert nur die Darstellung. Speichern, Kopieren, App-Zustand sowie Instrument-, Performance- und CSD-Export behalten die Struktur. Unbekannte Versionen, Zyklen und ungültige Zugehörigkeit werden abgewiesen. Keine Verschachtelung oder laufende Umschaltung; `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` bleiben im Hauptgraphen. GEN und Dauersteuerung sind im Zweig erlaubt.

## Français — choisir au début de la note

**If** et **Switch**, dans **Contrôle de flux**, sont des constructions de l'éditeur qui produisent des conditions Csound. Chaque voix choisit un seul cas au début de sa note. Seul ce cas est initialisé et exécuté jusqu'à la fin de la voix. Les notes différentes ou répétées restent indépendantes.

If compare deux entrées de taux i avec `==`, `!=`, `<`, `<=`, `>` ou `>=`. Switch compare son sélecteur à des valeurs numériques uniques et garde un cas Par défaut en dernier. Connexions et formules arithmétiques d'entrée sont prioritaires sur les valeurs littérales. Les nouveaux blocs produisent de la stéréo.

Développez les cas sur le canevas existant. Utilisez **Ajouter un nœud au cas** ou **Déplacer les nœuds sélectionnés** vers un cas de synthèse ou le graphe principal. Glisser un nœud modifie uniquement sa position ; déplacer le bloc déplace son contenu. Un déplacement invalide indique les connexions concernées. Les sources communes peuvent alimenter plusieurs cas. Reliez chaque canal audio au **Résultat du cas**, avec somme de sources ou formule d'entrée si nécessaire. Les valeurs internes ne peuvent sortir que par ce résultat commun.

Faux et Par défaut commencent en **Silence**, avec zéro sur chaque sortie et aucun nœud de synthèse. Passer à Silence, supprimer un cas ou changer de format présente les éléments affectés avant confirmation. Mono conserve `left`; revenir en stéréo ajoute `right` sans connexion. Par défaut reste obligatoire. Réduire, enregistrer et recharger conserve identifiants, sélection, positions, cadrage et formules ; développez-le pour modifier une formule d'entrée masquée.

**Nouveau modèle → Batterie** : 36 grosse caisse, 38 caisse claire, 42 charleston, sinon silence. La vélocité règle les enveloppes, et `xtratim` local conserve leur décroissance après une note courte. La note MIDI de test de l'audition commence à 36. Enregistrez, affectez un canal MIDI dans Perform et routez Stereo Output dans le mixeur. Les effets après le bloc traitent chaque voix ; ceux du mixeur traitent la somme de la batterie. L'exemple If choisit sinus ou dent de scie selon la vélocité.

**Format des données :** les anciens patches restent en version 1 ; les branches font passer durablement à la version 2. `graph.control_flow` stocke `kind`, `output_format`, `operator` et les `cases` ordonnés. Chaque cas contient une `id` stable, `name`, `value`, les `node_ids` exclusifs, `result_node_id` et `silence`. Les champs JSON et l'exemple ci-dessus sont identiques dans toutes les langues. `ui_layout.control_flow_blocks` conserve seulement la présentation. Sauvegardes, copies, état de l'application et exports instrument, performance et CSD préservent la structure. Versions inconnues, cycles et appartenances invalides sont rejetés. Pas d'imbrication ni de commutation continue ; `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` restent dans le graphe principal. GEN et les contrôles de durée sont permis dans les cas.

## Español — elegir al inicio de la nota

**If** y **Switch**, en **Flujo de control**, son construcciones del editor que generan condiciones Csound. Cada voz elige un caso al inicio de su nota. Solo ese caso se inicializa y ejecuta hasta el final de la voz. Las notas distintas o repetidas son independientes.

If compara dos entradas de tasa i con `==`, `!=`, `<`, `<=`, `>` o `>=`. Switch compara su selector con valores numéricos únicos y mantiene Por defecto al final. Las conexiones y fórmulas aritméticas de entrada tienen prioridad sobre los números literales. Los bloques nuevos producen estéreo.

Expande los casos en el lienzo existente. Usa **Añadir nodo al caso** o **Mover nodos seleccionados** hacia un caso de síntesis o el grafo principal. Arrastrar cambia solo la posición; mover el bloque mueve su contenido. Un movimiento inválido identifica las conexiones afectadas. Las fuentes comunes pueden alimentar varios casos. Conecta cada canal al **Resultado del caso**, sumando fuentes o usando una fórmula si hace falta. Los valores internos solo salen por este resultado común.

Falso y Por defecto empiezan con **Silencio**: cero en todas las salidas y ningún nodo de síntesis. Cambiar a Silencio, borrar un caso o cambiar de formato muestra los elementos afectados antes de confirmar. Mono conserva `left`; volver a estéreo añade `right` sin conectar. Por defecto es obligatorio. Contraer, guardar y recargar conserva IDs, selección, posiciones, encuadre y fórmulas; expande para editar las fórmulas de entradas ocultas.

**Nueva plantilla → Batería**: 36 bombo, 38 caja, 42 charles; el resto produce silencio. La velocidad escala las envolventes, y `xtratim` local conserva el decaimiento tras notas cortas. La nota MIDI de prueba de Audición empieza en 36. Guarda, asigna un canal MIDI en Perform y conecta Stereo Output en el mezclador. Los efectos posteriores al bloque procesan cada voz; los del mezclador procesan la suma de la batería. El ejemplo If elige seno o diente de sierra según la velocidad.

**Formato de datos:** los patches existentes siguen en versión 1; añadir ramas eleva permanentemente la versión a 2. `graph.control_flow` guarda `kind`, `output_format`, `operator` y los `cases` ordenados. Cada caso contiene una `id` estable, `name`, `value`, `node_ids` exclusivos, `result_node_id` y `silence`. Los campos JSON y el ejemplo anterior son iguales en todos los idiomas. `ui_layout.control_flow_blocks` solo guarda presentación. Guardado, copias, estado de aplicación y exportaciones de instrumento, performance y CSD conservan la estructura. Se rechazan versiones desconocidas, ciclos y pertenencias inválidas. No se admite anidamiento ni conmutación continua; `outs`, `inleta`, `outleta`, `sfload`, `maxalloc` permanecen en el grafo principal. GEN y controles de duración sí pueden pertenecer a casos.

## Csound references

- [Csound if](https://csound.com/docs/manual/if.html)
- [Csound xtratim](https://csound.com/docs/manual/xtratim.html)
