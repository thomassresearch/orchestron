# Monophonic Legato

**Navigation:** [Up](instrument_design.md) | [Opcode catalog](opcode_catalog_and_documentation.md)

## English

Add one **midi_legato** node from **MIDI** to the main graph of a MIDI instrument. Connect **Frequency (Hz)** to control-rate oscillator frequencies and **Velocity** to amplitude and blowing-pressure formulas. Use **madsr** for phrase envelopes. Keep **cpsmidi** and **ampmidi** for initial values needed by init-rate inputs.

- Touching and overlapping notes share one synthesis voice. Pitch changes immediately without glide. Envelopes, oscillator phase, resonances and vibrato continue.
- The last note played has priority. Releasing it returns to the most recently held note, including its velocity.
- Velocity is MIDI velocity divided by 128, matching `ampmidi 1`. Its first value is immediate; changes have a **10 ms half-time**.
- A gap starts a new phrase, even during a release tail. Initialization contours and performance-controller values refresh then. Connected notes retain phrase-initial settings and do not repeat attack bursts or pressure overshoots.
- All events within the existing Csound control boundary settle together. There is **no extra legato grace period**. Live resolution follows `ksmps`; CSD exports use `ksmps=1`.
- `madsr` retains delay, attack, decay, sustain and release semantics, including explicit `ireltim`. A new phrase applies a 2 ms amplitude declick to interrupt an old release; this is not pitch glide.
- `maxalloc` limits synthesis voices; internal note collectors remain available. Each rack instance has separate state. Live MIDI, sequencers and MIDI/SCORE CSD exports use the same phrase logic. Stop clears the engine; MIDI panic releases the phrase.

This is an **Orchestron virtual opcode**, not a native Csound opcode. Use it once, outside If/Switch cases, on a MIDI-activated instrument. Native release/turnoff opcodes other than `madsr` are not supported in a legato graph. Patches without this node retain their normal voice behavior. Recompile/restart a running instrument after adding it.

## Deutsch

Einmal **midi_legato** aus **MIDI** im Hauptgraphen eines MIDI-Instruments einsetzen. **Frequency (Hz)** mit Oszillatorfrequenzen auf Kontrollrate verbinden, **Velocity** mit Amplituden- und Blasdruckformeln. **madsr** steuert die Phrasenhüllkurven; **cpsmidi** und **ampmidi** liefern weiterhin Anfangswerte für i-Rate-Eingänge.

Direkt anschließende oder überlappende Noten behalten eine Stimme mit Hüllkurven, Phase, Resonanz und Vibrato. Die Tonhöhe wechselt sofort ohne Gleiten. Die zuletzt gespielte Note hat Vorrang; nach ihrem Loslassen wird die zuletzt noch gehaltene Note samt Anschlagstärke wieder aufgenommen. Die Anschlagstärke entspricht MIDI / 128 und folgt Änderungen mit **10 ms Halbwertszeit**.

Eine Lücke beginnt eine neue Phrase, auch während des Ausklangs. Dann starten Initialisierungsverläufe neu und Performance-Regler werden erneut gelesen. Verbundene Noten behalten deren Anfangswerte. Ereignisse derselben Csound-Kontrollgrenze werden gemeinsam ausgewertet, **ohne zusätzliche Toleranzzeit**. Live gilt `ksmps`, beim CSD-Export `ksmps=1`. `madsr` behält seine ADSR- und `ireltim`-Semantik. Ein unterbrochener Ausklang wird über 2 ms in der Amplitude geglättet.

`maxalloc` begrenzt nur die Synthese, nicht die internen Notensammler. Jede Rack-Instanz hat eigenen Zustand. Live-MIDI, Sequencer und beide CSD-Exportarten teilen das Verhalten. Stop löscht den Engine-Zustand; MIDI-Panik beendet die Phrase. Dieser virtuelle Orchestron-Opcode gehört einmal in den Hauptgraphen, außerhalb von If/Switch, nicht in Continuous-Instrumente. Native Release-/Turnoff-Opcodes außer `madsr` sind nicht unterstützt. Andere Patches bleiben unverändert. Nach dem Hinzufügen neu kompilieren/starten.

## Français

Ajouter un seul **midi_legato** depuis **MIDI** au graphe principal d’un instrument MIDI. Relier **Frequency (Hz)** aux fréquences de contrôle des oscillateurs, **Velocity** aux formules d’amplitude et de souffle. Utiliser **madsr** pour les enveloppes ; **cpsmidi** et **ampmidi** fournissent les valeurs initiales aux entrées de taux i.

Les notes jointives ou superposées conservent une voix, ses enveloppes, sa phase, sa résonance et son vibrato. La hauteur change immédiatement sans glissando. La dernière note jouée est prioritaire ; son relâchement reprend la note maintenue la plus récente et sa vélocité. La vélocité vaut MIDI / 128 et suit les changements avec une **demi-vie de 10 ms**.

Une interruption commence une nouvelle phrase, même pendant une fin de note. Les contours d’initialisation redémarrent et les réglages de performance sont relus ; les notes liées conservent leurs valeurs initiales. Tous les événements d’une même période de contrôle Csound sont évalués ensemble, **sans délai de tolérance**. La résolution suit `ksmps` en direct et `ksmps=1` dans les exports CSD. `madsr` garde ses paramètres ADSR et `ireltim`. Une nouvelle phrase adoucit sur 2 ms l’amplitude d’une fin interrompue.

`maxalloc` limite uniquement la synthèse, pas les collecteurs de notes. Chaque instance du rack possède son état. MIDI direct, séquenceurs et les deux exports CSD partagent le comportement. Stop efface l’état du moteur ; la panique MIDI termine la phrase. Cet opcode virtuel Orchestron appartient au graphe principal, hors If/Switch et hors instruments Continuous. Les opcodes natifs de relâchement/arrêt autres que `madsr` ne sont pas pris en charge. Les autres patches restent inchangés. Recompiler/redémarrer après l’ajout.

## Español

Añadir un solo **midi_legato** desde **MIDI** al grafo principal de un instrumento MIDI. Conectar **Frequency (Hz)** a frecuencias de osciladores de tasa de control y **Velocity** a fórmulas de amplitud y presión del soplo. Usar **madsr** para las envolventes; **cpsmidi** y **ampmidi** aportan los valores iniciales para entradas de tasa i.

Las notas contiguas o superpuestas conservan una voz, sus envolventes, fase, resonancia y vibrato. La altura cambia inmediatamente sin deslizamiento. Tiene prioridad la última nota tocada; al soltarla se retoma la nota mantenida más reciente y su velocidad. La velocidad equivale a MIDI / 128 y sigue los cambios con una **semivida de 10 ms**.

Una pausa inicia una frase nueva, incluso durante una cola. Reinicia los contornos de inicialización y vuelve a leer los controles de interpretación; las notas ligadas conservan sus valores iniciales. Los eventos del mismo límite de control Csound se evalúan juntos, **sin tiempo de tolerancia adicional**. La resolución sigue `ksmps` en vivo y `ksmps=1` en los exports CSD. `madsr` conserva sus parámetros ADSR e `ireltim`. Una frase nueva suaviza durante 2 ms la amplitud de una cola interrumpida.

`maxalloc` limita solo la síntesis, no los colectores de notas. Cada instancia del rack tiene su estado. MIDI en vivo, secuenciadores y ambas exportaciones CSD comparten el comportamiento. Stop borra el estado del motor; el pánico MIDI termina la frase. Este opcode virtual de Orchestron pertenece al grafo principal, fuera de If/Switch y de instrumentos Continuous. No se admiten opcodes nativos de liberación/apagado distintos de `madsr`. Los demás patches no cambian. Recompilar/reiniciar después de añadirlo.

## Implementation references

[Csound release](https://csound.com/docs/manual/release.html), [madsr](https://csound.com/docs/manual/madsr.html), [reinit](https://csound.com/docs/manual/reinit.html), [portk](https://csound.com/docs/manual/portk.html).
