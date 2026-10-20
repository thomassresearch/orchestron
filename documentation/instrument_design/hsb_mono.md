# HSB Mono

**Navigation:** [Instrument Design](instrument_design.md) · [Monophonic Legato](midi_legato.md)

## English

Import [HSB Mono](../../examples/instruments/HSB_Mono.orch.instrument.json), add it
to the performance rack, and route **Stereo Output → Master**. Play MIDI notes
36–84 for the intended bass/lead range. The sound blends five sine-wave octaves.

| Performance parameter | Range | Default | MIDI CC |
| --- | --- | --- | --- |
| Tonality (octave cycle) | 0–1 | 0 | 20 |
| Brightness (octaves) | −2 to +2 | 0 | 74 |
| Legato half-time (s) | 0.001–0.5, logarithmic | 0.060 | 5 |
| MIDI control channel | 1–16 | 16 | — |

Send CCs on the selected control channel, independently of the note channel.
For each mapped controller, **value 0 recalls the rack setting**; values 1–127
span its full range. Use controller-sequencer **Reset Value 0**. CC changes have
10 ms smoothing and affect held notes; rack settings refresh at phrase start.
Instances sharing a control channel share MIDI automation.

Touching or overlapping notes share one voice and envelope; the newest held note
wins. Gaps up to approximately **20 ms** retain pitch glide, while longer gaps
start directly at the new pitch. A positive gap restarts the amplitude envelope.
Larger half-times produce slower slides. The 20 ms window is fixed in this patch
and quantized to the control block. Existing monophonic support and The Real TB303
are unchanged.

Tonality is cyclic: 0 and 1 give the same pitch class. Brightness moves the
spectral weighting across octaves. The amplitude envelope is 6 ms / 150 ms /
80% / 80 ms and responds to note velocity.

## Deutsch

[HSB Mono importieren](../../examples/instruments/HSB_Mono.orch.instrument.json),
zum Rack hinzufügen und **Stereo Output → Master** verbinden. Empfohlener Bereich:
MIDI 36–84. Fünf gemischte Sinusoktaven bilden den Klang.

**Tonality** steuert den zyklischen Toncharakter (0–1, Standard 0, CC20);
**Brightness** die Oktavgewichtung (−2 bis +2, Standard 0, CC74);
**Legato half-time** die Gleit-Halbwertszeit (1–500 ms, Standard 60 ms, CC5).
Der MIDI-Steuerkanal ist einstellbar, standardmäßig **16**.
CC-Wert 0 stellt den Rack-Wert wieder her, 1–127 durchlaufen den gesamten Bereich.
Im Controller-Sequencer Reset Value auf 0 setzen. MIDI wirkt auch auf gehaltene
Noten; Rack-Werte werden beim Phrasenbeginn gelesen. Die Glättung beträgt 10 ms.

Direkt anschließende oder überlappende Noten teilen Stimme und Hüllkurve; die
zuletzt gehaltene Note hat Vorrang. Lücken bis ungefähr **20 ms** behalten das
Gleiten, größere Lücken starten direkt auf der neuen Tonhöhe. Jede positive Lücke
startet die Lautstärkehüllkurve neu. Größere Halbwertszeiten gleiten langsamer.
Tonality 0 und 1 entsprechen derselben Tonklasse. Die bestehende monophone
Implementierung und The Real TB303 bleiben unverändert.

## Français

Importer [HSB Mono](../../examples/instruments/HSB_Mono.orch.instrument.json),
l’ajouter au rack et relier **Stereo Output → Master**. Registre conseillé :
MIDI 36–84. Le son mélange cinq octaves sinusoïdales.

**Tonality** règle la tonalité cyclique (0–1, défaut 0, CC20), **Brightness**
la pondération des octaves (−2 à +2, défaut 0, CC74) et **Legato half-time**
la demi-vie du glissement (1–500 ms, défaut 60 ms, CC5).
Le canal MIDI de commande est réglable, **16** par défaut.
La valeur CC 0 rappelle le réglage du rack ; 1–127 parcourent toute la plage.
Choisir Reset Value 0 dans le séquenceur de contrôleurs. Les CC agissent sur les
notes tenues avec un lissage de 10 ms ; le rack est relu au début d’une phrase.

Les notes jointives ou superposées partagent voix et enveloppe, avec priorité à
la dernière note tenue. Les pauses d’environ **20 ms** au maximum conservent le
glissement ; les pauses plus longues démarrent directement à la nouvelle hauteur.
Toute pause positive redémarre l’enveloppe d’amplitude. Une demi-vie plus grande
ralentit le glissement. Tonality 0 et 1 donnent la même classe de hauteur.
Le fonctionnement monophonique existant et The Real TB303 restent inchangés.

## Español

Importar [HSB Mono](../../examples/instruments/HSB_Mono.orch.instrument.json),
añadirlo al rack y conectar **Stereo Output → Master**. Registro recomendado:
MIDI 36–84. El sonido combina cinco octavas sinusoidales.

**Tonality** controla la tonalidad cíclica (0–1, predeterminado 0, CC20),
**Brightness** el peso de las octavas (−2 a +2, predeterminado 0, CC74), y
**Legato half-time** la semivida del deslizamiento (1–500 ms, predeterminado
60 ms, CC5). El canal MIDI de control es ajustable; su valor predeterminado es **16**.
El valor CC 0 recupera el ajuste del rack; 1–127 recorren todo el intervalo.
Usar Reset Value 0 en el secuenciador de controladores. Los CC afectan las notas
sostenidas con un suavizado de 10 ms; el rack se relee al comenzar cada frase.

Las notas contiguas o superpuestas comparten voz y envolvente, con prioridad a la
última nota sostenida. Las pausas de hasta aproximadamente **20 ms** conservan el
deslizamiento; las pausas mayores comienzan directamente en la nueva altura.
Cualquier pausa positiva reinicia la envolvente de amplitud. Una semivida mayor
produce un deslizamiento más lento. Tonality 0 y 1 dan la misma clase de altura.
El funcionamiento monofónico existente y The Real TB303 permanecen intactos.

[Authoring details and reproducible previews](../../examples/instruments/hsb_mono/README.md).
