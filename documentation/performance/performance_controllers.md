# Performance Controllers

**Navigation:** [Up](performance.md) | [Rack and transport](instrument_rack_and_engine_transport.md) | [Import and export](performance_import_export.md)

Use `perf_controller` to adapt a patch to a particular performance: envelope times, sustain, distortion amount, or another parameter accepting I-rate. Each rack instance owns its settings, even when several instances use the same patch.

## Define a Controller

Add `perf_controller` from Constants in Instrument Design. Click its gear button and configure:

| Field | Initial value | Meaning |
| --- | --- | --- |
| Minimum | 0 | Lowest setting |
| Maximum | 1 | Highest setting |
| Default | 0.5 | Setting before a rack override |
| Scale | Linear | Linear or logarithmic knob movement |
| Label | Parameter | Caption displayed in the rack |

The fields are fixed values, without input sockets or formulas. Numbers must be finite, minimum smaller than maximum, and default within the range. Logarithmic minimum must be positive. For a logarithmic attack-time control, try minimum `0.001`, maximum `5`, default `0.01`, and label `Attack (s)`. Connect `iout` to the envelope’s I-rate attack input, then save the patch.

## Tune a Rack Instrument

Controllers appear in patch-node order beneath patch and channel. Their compact rack layout fits five controls across a standard instrument card before wrapping onto another row. Each shows a caption, scale dashes, endpoints, LIN/LOG indicator, and current value. Linear ticks are equally spaced; logarithmic ticks follow ratios and mark decade boundaries.

- Drag vertically, or use arrow keys. Hold Shift for fine adjustment.
- Enter an exact number below the knob; Enter or leaving the field applies it. Escape cancels.
- Home and End choose the endpoints. Double-click, Delete, or Backspace on the focused knob resets to the patch default.
- Changes affect newly started notes. Sounding notes keep their initialized value. Continuous instruments require a rack restart.

## Save, Reload, and Export

Untouched controls follow the patch default. After a value changes, an explicit instance override remains until reset, including when it is subsequently set to the current default. App state retains edits immediately through the existing persistence workflow; Save Performance is required to update a saved performance. Native JSON/ZIP bundles and both CSD (MIDI) and CSD (SCORE) exports preserve instance values. The CSD contains its initial settings and runs without a controller client. These controls do not send MIDI CC and do not become MIDI automation.

Node IDs identify controls; duplicate labels are allowed. Changing the selected patch clears its overrides. Editing a patch range clamps saved values; deleting a controller removes its override, with a notice in the rack. Standalone patch export and isolated audition use defaults; audition within a performance uses the selected instance’s values.

`perf_controller` is an Orchestron editor construct lowered to [I-rate chnget](https://csound.com/docs/manual/chnget.html) and channel initialization. It is not a native Csound opcode.

## Agent CLI

Patch specs accept an ordered `performance_controllers` list with stable node IDs, target inputs, ranges, defaults, scales, and labels. The performance CLI exposes `edit performance-controllers list/set/reset --binding ID`; `set` additionally takes `--node NODE_ID --value NUMBER`, and `reset` takes `--node NODE_ID`. Use `edit validate` and `edit commit` to save, or `edit push-runtime` to update an attached session with unchanged rack and patch definitions. Always-on instruments still need restart. See the skill references for [patch authoring](../../integrations/skills/orchestron-patch-creator/references/performance_controllers.md) and [instance settings](../../integrations/skills/orchestron-performance-creator/references/performance_controllers.md).

## Deutsch

Die Agent-CLI unterstützt `performance_controllers` in Patch-Spezifikationen und `edit performance-controllers list/set/reset --binding ID` für Instanzwerte. `edit commit` speichert die Performance; `edit push-runtime` aktualisiert die Laufzeit. Kontinuierliche Instrumente benötigen weiterhin einen Neustart.

Virtueller Orchestron-Opcode für instrumentspezifische Performance-Einstellungen wie ADSR-Zeiten oder Verzerrung. Das Zahnrad öffnet feste Felder für Minimum, Maximum, Standardwert, Skala (linear oder logarithmisch) und Beschriftung; es gibt keine Eingangsanschlüsse. Vorgaben: 0, 1, 0.5, linear und Parameter. Zahlen müssen endlich sein, das Minimum kleiner als das Maximum und der Standardwert im Bereich liegen. Das logarithmische Minimum muss positiv sein. Jede Rack-Instanz zeigt eigene beschriftete Regler unter Patch und Kanal; weitere Regler umbrechen in neue Zeilen. Vertikal ziehen, Pfeiltasten verwenden (Umschalt für Feineinstellung) oder einen exakten Wert eingeben. Doppelklick stellt den Patch-Standard wieder her. Der I-rate-Ausgang wird beim Notenstart gelesen: gehaltene Noten behalten ihre Einstellung, neue Noten nutzen den geänderten Wert. Kontinuierliche Instrumente übernehmen Änderungen nach einem Rack-Neustart. Unberührte Regler folgen dem Patch-Standard; geänderte Werte bleiben bis zum Zurücksetzen gespeichert. Der App-Zustand behält Änderungen; Performance speichern und native JSON/ZIP-Exporte sichern sie für späteres Laden. CSD (MIDI) und CSD (SCORE) initialisieren die Einstellungen im Orchester ohne MIDI-CC oder externen Client. Einzelpatch-Export und isoliertes Vorhören nutzen Standardwerte; Vorhören einer Performance-Instanz nutzt deren Einstellungen. Beschriftungen dürfen sich wiederholen; Knoten-IDs identifizieren die Regler. Ein Patch-Wechsel löscht die Einstellungen. Geänderte Bereiche begrenzen gespeicherte Werte, entfernte Knoten löschen ihre Werte; ein Hinweis erscheint.

## Français

La CLI des agents accepte `performance_controllers` dans les spécifications de patch et `edit performance-controllers list/set/reset --binding ID` pour les valeurs par instance. `edit commit` enregistre la performance ; `edit push-runtime` actualise la session. Les instruments continus nécessitent toujours un redémarrage.

Opcode virtuel Orchestron pour les réglages propres à un instrument dans une performance, comme les temps ADSR ou la distorsion. La roue dentée ouvre les champs fixes Minimum, Maximum, Valeur par défaut, Échelle (linéaire ou logarithmique) et Libellé ; aucun port d’entrée. Valeurs initiales : 0, 1, 0.5, linéaire et Parameter. Les nombres doivent être finis, le minimum inférieur au maximum et la valeur par défaut dans la plage. Le minimum logarithmique doit être positif. Chaque instance du rack affiche ses propres boutons sous le patch et le canal, sur plusieurs lignes si nécessaire. Glissez verticalement, utilisez les flèches (Maj pour un réglage fin) ou saisissez une valeur exacte. Double-cliquez pour rétablir la valeur du patch. La sortie I-rate est lue au début de chaque note : les notes tenues conservent leur réglage, les nouvelles utilisent la valeur modifiée. Les instruments continus adoptent les changements après le redémarrage du rack. Les contrôles intacts suivent les valeurs du patch ; les valeurs modifiées persistent jusqu’à réinitialisation. L’état de l’application conserve les modifications ; Enregistrer la performance et les exports JSON/ZIP les préservent pour un chargement ultérieur. CSD (MIDI) et CSD (SCORE) initialisent les réglages dans l’orchestre sans CC MIDI ni client externe. L’export du patch seul et l’écoute isolée utilisent les valeurs par défaut ; l’écoute en performance utilise les réglages de l’instance. Les libellés peuvent se répéter ; les identifiants des nœuds identifient les contrôles. Changer de patch efface les réglages. Les plages modifiées limitent les valeurs enregistrées et les nœuds supprimés retirent leurs valeurs, avec un message.

## Español

La CLI de agentes admite `performance_controllers` en las especificaciones de patch y `edit performance-controllers list/set/reset --binding ID` para valores por instancia. `edit commit` guarda la interpretación; `edit push-runtime` actualiza la sesión. Los instrumentos continuos siguen necesitando un reinicio.

Opcode virtual de Orchestron para ajustes de un instrumento específicos de una interpretación, como tiempos ADSR o distorsión. El engranaje abre campos fijos de Mínimo, Máximo, Valor predeterminado, Escala (lineal o logarítmica) y Etiqueta; no hay puertos de entrada. Valores iniciales: 0, 1, 0.5, lineal y Parameter. Los números deben ser finitos, el mínimo menor que el máximo y el valor predeterminado dentro del rango. El mínimo logarítmico debe ser positivo. Cada instancia del rack muestra sus propios controles debajo del patch y canal, en filas adicionales si hace falta. Arrastre verticalmente, use las flechas (Mayús para ajuste fino) o introduzca un valor exacto. Haga doble clic para restaurar el valor del patch. La salida I-rate se lee al comenzar la nota: las notas sostenidas conservan su ajuste y las nuevas usan el valor modificado. Los instrumentos continuos adoptan cambios tras reiniciar el rack. Los controles intactos siguen los valores del patch; los valores modificados persisten hasta restablecerlos. El estado de la aplicación conserva las modificaciones; Guardar interpretación y las exportaciones JSON/ZIP las preservan para cargarlas después. CSD (MIDI) y CSD (SCORE) inicializan los ajustes en la orquesta sin CC MIDI ni cliente externo. La exportación del patch y la escucha aislada usan valores predeterminados; la escucha en interpretación usa los ajustes de la instancia. Las etiquetas pueden repetirse; los identificadores de nodo identifican los controles. Cambiar de patch borra los ajustes. Los rangos modificados limitan los valores guardados y los nodos eliminados retiran sus valores, con un aviso.
