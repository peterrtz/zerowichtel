# Konzept: Analoge Mitwichtelnde mit digitaler Helfer:in

Stand: 17. November 2026 · Status: **Vorschlag, nicht umgesetzt** · Grundlage: Code von 2.5.3 (`4ce1e4d`)

## 1. Idee

Manche wollen mitwichteln, haben aber kein Smartphone oder wollen keins benutzen (Oma, kleines Kind, Kollege ohne Diensthandy).
Diese **analogen Mitwichtelnden** werden ganz normal mitgezogen. Eine **digitale Helfer:in** sieht für sie,
wen sie beschenken, welche Wünsche diese Person hat, und trägt umgekehrt ihren Wunschzettel ein.

```yaml
regeln:                                  # Vorgaben aus der Idee
  - analog und eigene Helfer:in ziehen sich nicht gegenseitig
  - jede Person ist höchstens für EINE analoge Person Helfer:in
  - Helfer:in kann selbst mitwichteln oder nur helfen (ohne eigene Teilnahme)
  - die Zuordnung legt die Organisator:in fest – beim Einladen oder spätestens vor der Auslosung
  - die Zahl analoger Mitwichtelnder ist begrenzt, abhängig von der Gesamtzahl (Abschnitt 3)
```

## 2. Wie es technisch aussehen soll – fast ohne Server-Änderung

Kernidee: **Die analoge Person ist für den Server eine ganz normale teilnehmende Person.** Ihr Link liegt nicht bei ihr,
sondern bei der Helfer:in. Die Helfer:in öffnet ihn auf dem eigenen Gerät, sagt für die analoge Person zu (dabei entsteht
deren Schlüsselpaar auf dem Gerät der Helfer:in) und sieht später deren Zuordnung, Wünsche und Wichtelpost.

```yaml
organisator_in:
  einladen: "Person als 'analog' markieren → Helfer:in wählen: [Teilnehmende:r aus der Runde | jemand ohne eigene Teilnahme]"
  link: "Der Link der analogen Person wird an die Helfer:in geschickt (Text: 'Link für Erna – du hilfst ihr')"
  vor_der_auslosung: "Vorprüfung: Grenze (Abschnitt 3), jede Helfer:in nur einmal, analoge Person hat zugesagt"
helfer_in:
  geraet: "zwei Links in derselben Runde (eigener + 'für Erna'); die Ablage im Browser kann das schon (Schlüssel: Runde + Person)"
  sieht: "für Erna: wen sie beschenkt, deren Wünsche, Wichtelpost an und von Erna"
  traegt_ein: "Ernas Wunschzettel und Steckbrief, Ernas Antworten in der Wichtelpost"
andere:
  schenkende_von_erna: "sieht nach der Auslosung 'nimmt ohne Smartphone teil – Nachrichten liest eine Begleitperson'"
  vor_der_auslosung: "sehen wie bisher keine Namen anderer (geprüft in 2.5: /me liefert nur Zählerstände)"
server:
  neu: nichts Sichtbares         # Markierung 'analog' und Helfer-Zuordnung liegen verschlüsselt (siehe unten)
  schema: unverändert            # keine Migration nötig
```

### Wo die neuen Angaben liegen

| Angabe | Wo | Wer kann sie lesen |
| --- | --- | --- |
| „Erna ist analog, Peter hilft“ (Liste der Paare) | Organisator-Daten (`adminCt`, Schlüssel K_admin) | nur Organisator:in |
| Ausschluss Erna ↔ Peter | **zusätzlich** in der bestehenden Ausschlussliste (`exclusions`) | nur Organisator:in |
| Hinweis „nimmt ohne Smartphone teil“ | im verschlüsselten Profil der Person (K_round) | Teilnehmende der Runde, nicht der Server |

Der doppelte Eintrag in der Ausschlussliste ist Absicht: Eine **ältere, zwischengespeicherte App-Version** der Organisator:in
kennt „analog“ nicht, beachtet aber Ausschlüsse schon. So können sich Erna und Peter auch dann nicht gegenseitig ziehen,
wenn die Auslosung versehentlich mit einer alten Version läuft. Bestehende Runden und laufende Installationen bleiben unberührt.

### Grenzen, die man ehrlich benennen muss

- **„Nur einmal Helfer:in“ lässt sich nur in der App durchsetzen.** Die Organisator:in kann einen Link immer auch außerhalb
  der App weitergeben. Die App verhindert nur, dass sie dieselbe Person zweimal als Helfer:in einträgt.
- **Externe Helfer:innen** (ohne eigene Teilnahme) sind für die App nur ein Name. Ob dahinter wirklich jemand anderes
  steckt als eine Teilnehmer:in, kann sie nicht prüfen.
- **Die Helfer:in weiß mehr als alle anderen:** zwei Zuordnungen statt einer. Das ist der Preis der Funktion;
  Abschnitt 3 begrenzt, wie viel man daraus erraten kann.

## 3. Dynamische Grenze

### Ergebnis

```yaml
grenze: "höchstens ⌊(n − 2) / 3⌋ analoge Mitwichtelnde"
n: "alle, die mitgezogen werden (analoge eingeschlossen, Helfer:innen ohne eigene Teilnahme nicht)"
beispiele:            # n → höchstens
  "3–4": 0
  "5–7": 1
  "8–10": 2
  "11–13": 3
  "14–16": 4
  "20": 6
  "30": 9
  "50 (Maximum)": 16
```

### Wie die Grenze zustande kommt

ZeroWichtel zieht einen **einzigen zufälligen Kreis**, gleichverteilt über alle Kreise, die die Regeln erfüllen
(`draw.js`: Zurückweisung, dann Suche). Jedes Paar analog ↔ Helfer:in verbietet zwei Kanten des Kreises.

Gemessen habe ich, **wie gut eine Helfer:in die Zuordnung einer dritten Person erraten kann**. Sie kennt ihr eigenes Ziel,
das Ziel der analogen Person und die Regeln. Kennzahl: ihre beste Ratewahrscheinlichkeit für eine fremde Zuordnung,
im Mittel über alle möglichen Auslosungen, verglichen mit einer gewöhnlichen Person in einer Runde ohne analoge
Mitwichtelnde (dort 1 / (n − 2)).

**Kriterium:** Die Helfer:in darf höchstens **1,5-mal so gut raten** können wie eine gewöhnliche Person,
und sie darf nie eine fremde Zuordnung **sicher** wissen.

Ergebnis (Faktor gegenüber gewöhnlicher Person; **fett** = Grenze nach der Formel; ✗ = Kriterium verletzt):

| n | k = 1 | k = 2 | k = 3 | k = 4 | k = 5 | k = 6 |
|---|---|---|---|---|---|---|
| 4 | ✗ alles sicher | | | | | |
| 5 | **1,50** | ✗ 2,25 (50 % sicher) | | | | |
| 6 | **1,33** | ✗ 1,83 | ✗ 2,50 | | | |
| 7 | **1,25** | ✗ 1,61 | ✗ 2,00 | | | |
| 8 | 1,20 | **1,47** | ✗ 1,77 | ✗ 1,69 | | |
| 9 | 1,17 | **1,39** | ✗ 1,62 | ✗ 1,57 | | |
| 10 | 1,14 | **1,32** | ✗ 1,52 | 1,49 | 1,43 | |
| 11 | 1,12 | 1,28 | **1,45** | 1,42 | 1,38 | |
| 12 | | | **1,39** | 1,37 | | 1,30 |

Gerechnet für n = 4 bis 12 **exakt** über alle gültigen Kreise (bis 22 Mio. je Fall). Für große Runden per Stichprobe
(300 000 Kreise je Fall, schlechtester von vier Fällen, was die Helfer:in sehen kann); dass die Stichprobe stimmt,
zeigt der Abgleich bei n = 12, k = 3 (exakt 1,39, Stichprobe 1,41):

| n | k nach Formel | Faktor |
|---|---|---|
| 20 | 6 | 1,19 |
| 30 | 9 | 1,14 |
| 50 | 16 | 1,11 |

**Lesart:** Bis n = 11 ist die Formel genau die größte Zahl k, bis zu der jede Anzahl von 1 bis k das Kriterium erfüllt. (Bei n = 10 läge k = 4 mit 1,49 knapp darunter, k = 3 aber mit 1,52 darüber – eine Grenze, bei der 4 erlaubt, 3 aber verboten wäre, ergibt keinen Sinn.) Ab n = 12 ist sie strenger als nötig
– dort begrenzt sie vor allem den **Anteil**: Höchstens ein Drittel analog bedeutet, dass mindestens ein Drittel der Runde
ganz ohne Sonderregel mitzieht. Mehr analoge Mitwichtelnde wären bei großen Runden mathematisch harmlos, aber die Runde
würde zu einer Veranstaltung, die überwiegend über Begleitpersonen läuft.

### Was die Rechnung nicht abdeckt

- **Andere Ausschlüsse und Untergruppen** verschärfen das Raten zusätzlich. Ob überhaupt noch eine Auslosung möglich ist,
  prüft die vorhandene Vorprüfung; die Ratewahrscheinlichkeit prüft sie nicht. Vorschlag: so lassen (Verhalten wie bisher).
- Gerechnet ist der **ungünstigste Fall**, dass alle wissen, wer analog ist und wer hilft. In der App sehen Teilnehmende
  das vor der Auslosung nicht.
- **Absprachen** zwischen mehreren Personen sind nicht eingerechnet – das gilt beim Wichteln ohnehin: Wer seine Zuordnung
  weitererzählt, verrät sie.
- Das Kriterium „1,5-fach“ ist eine **Festlegung**, kein Naturgesetz. Mit „1,33-fach“ ergäbe sich etwa ⌊(n − 2) / 4⌋.

Nachrechnen: `node tools/analyse/analog-exakt.mjs <n> <k>` und `node tools/analyse/analog-stichprobe.mjs <n> <k> 300000`.

## 4. Offene Entscheidungen

| Nr. | Frage | Vorschlag |
| --- | --- | --- |
| 1 | Zählen analoge Mitwichtelnde mit **externer** Helfer:in in die Grenze? Mathematisch kosten sie nichts (kein Ausschluss). | **Ja**, eine einzige Regel ist leichter zu erklären. Folge: Bei n = 4 ist kein analoger Platz möglich, auch nicht mit externer Hilfe. |
| 2 | Was sieht die schenkende Person der analogen Person? | „Nimmt ohne Smartphone teil – Nachrichten liest eine Begleitperson“, **ohne** Namen der Helfer:in |
| 3 | Analoge Mitwichtelnde auch in **Team-Runden**? | Vorerst **nein**; erst Personenrunden, Teams später, falls gewünscht |
| 4 | Was passiert, wenn die Helfer:in vor der Auslosung absagt? | Auslosung gesperrt, bis eine neue Helfer:in eingetragen ist; der Link der analogen Person wird neu an diese verschickt |
| 5 | Schrottwichteln (ohne Auslosung) | Funktion dort ausblenden, weil es nichts zu übermitteln gibt |

## 5. Aufwand und Prüfung

```yaml
umfang: mittel                        # Organisator-Ansicht, Ansicht 'für Erna', Vorprüfung, Texte de/en
server: keine Änderung erwartet        # wird bei der Umsetzung per API-Test bestätigt, nicht angenommen
schema: unverändert (7)
tests:
  - Unit: Grenze, Vorprüfung (Helfer:in doppelt, Grenze überschritten, Helfer:in abgesagt)
  - Ziehung: 10 000 Auslosungen → analog und Helfer:in ziehen sich nie
  - Browser: Organisator:in markiert, Helfer:in sagt für zwei zu, sieht beide Zuordnungen, schreibt Post für Erna
  - Kompatibilität: Auslosung mit 2.5.3-Organisator-Client beachtet die Paare (über die Ausschlussliste)
  - Upgrade: bestehende Runden aus 2.4/2.5 unverändert lesbar
  - Security-Review der Änderungen vor dem Release
```
