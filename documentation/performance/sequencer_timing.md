# Sequencer timing

[Performance](performance.md) · English / Deutsch / Français / Español

## Meter, pattern length and subdivision

For a one-bar triplet bass alongside ordinary drums, choose **Meter 4/4**, **Pattern length 1 bar · 4 beats**, and **Subdivision Eighth-note triplets · 3 per beat**. The bass shows **12 steps in four labeled beat groups**. Leave Playback speed at 1×. At 120 BPM both one-bar patterns last two seconds.

Pattern length applies to the selected pad: any integer from 1–16 local beats for melodic/drum pads, or 1–32 for controller pads. Whole bars show both bars and beats; partial bars show beats. Meter, subdivision and playback speed apply to all pads of that sequencer. Subdivision offers 1, 2, 3, 4, 6 or 8 steps per meter beat. Musical names follow the denominator: three steps per beat means eighth-note triplets in /4 and sixteenth-note triplets in /8.

Global BPM counts quarter notes. A local beat is a quarter note in /4 and an eighth note in /8: one bar of 6/8 lasts three song beats (1.5 seconds at 120 BPM). Changing the meter numerator changes grouping without resizing pads. Changing the denominator retains the beat count and steps, but changes elapsed duration. Compound-meter accent grouping is not applied.

Changing subdivision keeps numbered step positions, notes, holds, velocities and timing offsets. It changes the number of visible steps within the same pattern duration; it does not redistribute the music. Hidden steps remain stored and return when you expand the pattern. Controller keypoints keep their normalized positions. Each pad has a 128-step limit; choices that would exceed it on any affected pad are disabled with an explanation.

**Advanced timing → Playback speed** contains the existing ratios, with multipliers: 1:1 = 1×, 3:2 = 1.5×, 2:1 = 2×. A nonnormal speed stays visible when Advanced timing is closed. The summary shows step count, subdivision and elapsed quarter-note song beats, separate from the pad's local length. Bar boundaries are stronger than beat boundaries, including incomplete final bars; no silent cells are added. Controller guides use bar.beat labels.

Live edits use the usual coalesced preparation path without restarting transport. A preparation failure retains the playing configuration and the edited draft. Older /8 performances retain their sound and arrangement: loading doubles local beat lengths and halves subdivision, preserving step arrays, ratios, rests and valid undo history. For example, an old six-beat /8 pad becomes twelve eighth-note beats.

## Taktart, Pattern-Länge und Unterteilung

Für einen Bass mit Triolen neben geraden Drums **Taktart 4/4**, **Pattern-Länge 1 Takt · 4 Zählzeiten** und **Unterteilung Achtelnoten (Triolen) · 3 pro Zählzeit** wählen. Es erscheinen **12 Schritte in vier beschrifteten Gruppen**. Wiedergabegeschwindigkeit bei 1× lassen. Bei 120 BPM dauern beide eintaktigen Patterns zwei Sekunden.

Die Länge gilt für das gewählte Pad: 1–16 ganze lokale Zählzeiten für Melodie/Drums, 1–32 für Controller. Ganze Takte zeigen Takte und Zählzeiten, Teil-Takte nur Zählzeiten. Taktart, Unterteilung und Geschwindigkeit gelten für alle Pads des Sequencers. Unterteilungen: 1, 2, 3, 4, 6 oder 8 Schritte pro Zählzeit. Drei Schritte heißen in /4 Achteltriolen, in /8 Sechzehnteltriolen.

Globale BPM zählen Viertelnoten. Eine lokale Zählzeit ist in /4 eine Viertel-, in /8 eine Achtelnote. Ein Takt 6/8 dauert drei Viertelschläge im Song, bei 120 BPM 1,5 Sekunden. Der Taktzähler ändert nur die Gruppierung; der Nenner ändert die Dauer bei gleicher Schrittfolge und Zählzeitenzahl. Zusammengesetzte Akzentgruppen werden nicht eingeführt.

Beim Ändern der Unterteilung bleiben Schrittnummern, Noten, HOLD, Anschlagstärke und Timing erhalten. Es wird nichts umverteilt. Verdeckte Schritte bleiben gespeichert und werden beim Verlängern wieder sichtbar. Controller-Stützpunkte behalten ihre normierten Positionen. Jedes Pad hat höchstens 128 Schritte; unzulässige Optionen sind für alle betroffenen Pads gesperrt und erklärt.

**Erweitertes Timing → Wiedergabegeschwindigkeit** zeigt Verhältnis und Faktor: 1:1 = 1×, 3:2 = 1,5×, 2:1 = 2×. Abweichende Geschwindigkeit bleibt sichtbar. Die Zusammenfassung nennt Schritte, Unterteilung und tatsächliche Dauer in Viertelschlägen des Songs, getrennt von lokaler Pad-Länge. Taktgrenzen sind stärker als Zählzeitgrenzen; unvollständige Takte erhalten keine zusätzlichen leeren Schritte. Controller-Hilfslinien zeigen Takt.Zählzeit.

Live-Änderungen nutzen die bestehende verzögerte Vorbereitung ohne Transport-Neustart. Fehler erhalten laufende Konfiguration und Entwurf. Alte /8-Performances behalten Klang und Arrangement: lokale Längen werden verdoppelt, Unterteilungen halbiert; Schritte, Verhältnisse, Pausen und gültige Undo-Historie bleiben erhalten. Aus sechs alten /8-Zählzeiten werden zwölf Achtel-Zählzeiten.

## Mesure, longueur du motif et subdivision

Pour une basse en triolets avec une batterie régulière, choisir **Mesure 4/4**, **Longueur du motif 1 mesure · 4 temps** et **Subdivision Croches (triolets) · 3 par temps**. Les **12 pas sont regroupés en quatre temps étiquetés**. Garder la vitesse à 1× : à 120 BPM, chaque motif d'une mesure dure deux secondes.

La longueur concerne le pad sélectionné : tout entier de 1–16 temps locaux pour mélodie/batterie, de 1–32 pour contrôleurs. Les mesures entières indiquent mesures et temps ; les mesures partielles indiquent les temps. Mesure, subdivision et vitesse concernent tous les pads du séquenceur. Choix : 1, 2, 3, 4, 6 ou 8 pas par temps. Trois pas correspondent à des triolets de croches en /4 et de doubles croches en /8.

Le BPM global compte les noires. Un temps local vaut une noire en /4 et une croche en /8. Une mesure de 6/8 dure trois noires du morceau, soit 1,5 seconde à 120 BPM. Le numérateur change le regroupement sans redimensionner les pads ; le dénominateur change la durée en conservant le nombre de temps et les pas. Aucun regroupement d'accents composés n'est ajouté.

Changer la subdivision conserve les positions numérotées, notes, tenues HOLD, vélocités et décalages temporels, sans redistribution. Les pas masqués restent stockés et réapparaissent lors de l'agrandissement. Les points des courbes gardent leurs positions normalisées. Chaque pad est limité à 128 pas ; les choix dépassant cette limite sur un pad concerné sont désactivés et expliqués.

**Réglages temporels avancés → Vitesse de lecture** affiche rapports et facteurs : 1:1 = 1×, 3:2 = 1,5×, 2:1 = 2×. Une vitesse différente reste visible. Le résumé distingue nombre de pas, subdivision et durée réelle en noires du morceau de la longueur locale. Les limites de mesure sont renforcées, même pour une dernière mesure incomplète ; aucun pas silencieux n'est ajouté. Les guides des courbes indiquent mesure.temps.

Les modifications en lecture suivent la préparation différée habituelle sans redémarrer le transport. Une erreur conserve la configuration jouée et le brouillon. Les anciennes performances en /8 gardent leur son et leur arrangement : les longueurs sont doublées et la subdivision divisée par deux, avec conservation des pas, rapports, silences et historique valide. Six anciens temps /8 deviennent douze temps de croche.

## Compás, duración del patrón y subdivisión

Para un bajo con tresillos junto a batería regular, elige **Compás 4/4**, **Duración del patrón 1 compás · 4 pulsos** y **Subdivisión Corcheas (tresillos) · 3 por pulso**. Aparecen **12 pasos agrupados en cuatro pulsos etiquetados**. Mantén la velocidad en 1×: a 120 BPM ambos patrones de un compás duran dos segundos.

La duración pertenece al pad seleccionado: cualquier entero de 1–16 pulsos locales para melodía/batería, de 1–32 para controladores. Los compases completos muestran compases y pulsos; los parciales muestran pulsos. Compás, subdivisión y velocidad afectan a todos los pads del secuenciador. Hay 1, 2, 3, 4, 6 u 8 pasos por pulso. Tres pasos son tresillos de corchea en /4 y de semicorchea en /8.

El BPM global cuenta negras. Un pulso local es una negra en /4 y una corchea en /8. Un compás de 6/8 dura tres negras de la canción: 1,5 segundos a 120 BPM. El numerador cambia la agrupación sin cambiar la duración del pad en pulsos; el denominador cambia el tiempo transcurrido conservando pasos y pulsos. No se añade agrupación de acentos compuestos.

Cambiar la subdivisión conserva posiciones numeradas, notas, HOLD, velocidades y desplazamientos temporales sin redistribución. Los pasos ocultos se guardan y reaparecen al ampliar. Los puntos de curva conservan posiciones normalizadas. El límite es 128 pasos por pad; las opciones que lo exceden en cualquier pad afectado se desactivan con explicación.

**Ajustes de tiempo avanzados → Velocidad de reproducción** muestra relación y multiplicador: 1:1 = 1×, 3:2 = 1,5×, 2:1 = 2×. Una velocidad diferente queda visible. El resumen distingue pasos, subdivisión y duración real en negras de la canción de la duración local. Los límites de compás son más fuertes, incluso en compases finales incompletos; no se añaden celdas silenciosas. Las guías del controlador indican compás.pulso.

Las ediciones en reproducción usan la preparación diferida habitual sin reiniciar el transporte. Un error conserva la configuración en reproducción y el borrador. Las antiguas performances en /8 mantienen sonido y arreglo: se duplican duraciones locales y se divide la subdivisión por dos, conservando pasos, relaciones, silencios e historial válido. Seis pulsos antiguos /8 pasan a doce pulsos de corchea.
