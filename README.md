# Fokus

Gewohnheiten abhaken und Fokus-Sitzungen mitschreiben. Läuft unter
**fokus.it-wolf.org**. Technisches steht in [BETRIEB.md](BETRIEB.md).

## Anmelden

Dieselbe Anmeldung wie die ToDo-Liste. Bist du dort angemeldet, kommst du hier
ohne weiteres rein.

Sonst: E-Mail-Adresse eintragen, Mail abwarten, auf **Jetzt anmelden** klicken.
Die Seite geht von selbst auf. Wer die Mail auf dem Handy liest und sich am
Laptop anmelden will, tippt stattdessen den sechsstelligen Code ab.

**Abmelden meldet dich auch aus der ToDo-Liste ab** — es ist dieselbe Sitzung.
Die App fragt vorher nach.

## Gewohnheiten

Zwei Arten:

- **Abhaken** — erledigt oder nicht. Ein Tipp auf den Kreis.
- **Mit Zielmenge** — zum Beispiel „30 Min lesen", Einheit optional. Drei
  Zustände: offen (grau), angefangen (gelb), Ziel erreicht (grün). Menge ins
  Zahlenfeld tippen, mit „+" um eins erhöhen, oder den Kreis antippen, um
  direkt aufs Ziel zu springen.

Bei „Mit Zielmenge" legst du zusätzlich die Ziel-Art fest:

- **Mindestens** — das Ziel ist ein Soll, zum Beispiel „30 Min lesen".
- **Höchstens** — das Ziel ist eine Obergrenze, zum Beispiel „30 Min
  Instagram". Kein Gelb: entweder im Rahmen (grün) oder drüber (rot). Ein Tipp
  auf den Kreis trägt **0** ein, nicht die Grenze — geschafft heißt hier ja
  „möglichst wenig davon", und die 0 ist der beste Tag. Nochmal antippen macht
  den Tag wieder leer.

Doppeltipp auf eine Gewohnheit öffnet sie zum Bearbeiten — Name, Ziel,
Rhythmus, alles änderbar außer der Art (Abhaken/Mit Zielmenge) und der
Ziel-Art, sobald ein Tag erfasst ist.

### Rhythmus

Drei Möglichkeiten, wie oft eine Gewohnheit dran ist:

- **Täglich** — jeden Tag.
- **Feste Wochentage** — zum Beispiel Mo/Mi/Fr. An anderen Tagen taucht die
  Gewohnheit in „Heute" gar nicht erst auf.
- **X Mal die Woche** — ein Wochenziel ohne feste Tage. Sobald es erreicht ist,
  verschwindet die Gewohnheit für den Rest der Woche aus „Heute"; die Karte
  zeigt bis dahin den Fortschritt („3 von 4 diese Woche").

Bei festen Wochentagen zählt die Strähne (🔥) geplante Tage in Folge, Tage
dazwischen unterbrechen sie nicht. Bei „X Mal die Woche" zählt sie erreichte
Wochen in Folge.

Der Rhythmus lässt sich jederzeit ändern, wirkt sich aber nur auf Anzeige und
Strähne **ab jetzt** aus — anders als beim Ziel gibt es dafür keine rückwirkende
Neubewertung vergangener Tage.

### Nachtragen

Im Reiter **Verlauf** steht ein Monatskalender, eine Gewohnheit auf einmal —
oben zwischen den Gewohnheiten wechseln, mit den Pfeilen durch die Monate
blättern. Tipp auf einen Tag, um ihn einzutragen — auch rückwirkend. Bei festen
Wochentagen sind nicht geplante Tage gedimmt und lassen sich nicht antippen.

Ein gelber Tag wird grün, sobald du die fehlende Menge nachträgst. **Die Strähne
heilt dabei rückwirkend**: war die Kette nur wegen dieses einen Tages
unterbrochen, ist sie es danach nicht mehr.

Es gibt keinen Übertrag von heute auf gestern. Jeder Tag steht für sich, und die
Zahl im Verlauf ist die, die an dem Tag wirklich zusammenkam.

Bei „Höchstens" zählt schon die 0 als erledigt — einen versehentlich
eingetragenen Tag machst du dort über **Eintrag löschen** im Tag-Dialog wieder
leer, nicht über die Menge.

Tage in der Zukunft lassen sich nicht eintragen.

### Ziel ändern

Ein neues Ziel gilt **ab heute**. Vergangene Tage behalten das Ziel, das damals
galt — hebst du „30 Min lesen" auf 60 an, werden alte grüne Tage nicht
nachträglich gelb.

Die Art einer Gewohnheit (abhaken / mit Zielmenge) lässt sich nachträglich nicht
ändern. Das würde die ganze Historie neu bewerten. Leg in dem Fall eine neue an.

### Aufräumen

**Archivieren** nimmt eine Gewohnheit aus der Tagesansicht, die Historie bleibt.
Zu finden im Zahnrad-Menü unter *Archiv* — dort kannst du sie zurückholen oder
endgültig löschen. Endgültig heißt: mit allen eingetragenen Tagen, unwiderruflich.

## Fokus-Timer

Start drücken, arbeiten. Standard sind 25 Minuten, änderbar im Zahnrad-Menü.

Am Ende meldet sich die App mit Ton, Tab-Titel und — wenn du es erlaubst — einer
Benachrichtigung.

**Die Sitzung läuft weiter, auch wenn du den Tab schließt oder das Handy
sperrst.** Sie liegt auf dem Server, nicht im Browser: kommst du zurück, steht
der Countdown an der richtigen Stelle, auch auf einem anderen Gerät.

Vergisst du eine Sitzung ganz, landen trotzdem höchstens die geplanten Minuten
im Log — aus 25 geplanten Minuten werden nie fünf Stunden.

**Stopp** vor der Zeit beendet die Sitzung mit der tatsächlichen Dauer.

Die Statistik darunter zählt Fokusminuten pro Woche (Montag bis Sonntag), die
letzten acht Wochen. Sie hat mit den Gewohnheiten nichts zu tun.

## Auf den Home-Bildschirm legen

Im Browser das Teilen-Menü öffnen und „Zum Home-Bildschirm". Danach startet die
App ohne Adresszeile wie eine normale App.

## Ohne Verbindung

Abhaken und Mengen gehen auch offline. Die Karte springt sofort um und trägt
ein *↻ nicht gespeichert*, bis wieder Netz da ist — dann geht alles von selbst
raus, spätestens wenn du die App das nächste Mal öffnest. Auch die Liste selbst
ist offline da: sie zeigt den Stand vom letzten Mal.

Zwei Dinge, die dabei nicht mitkommen:

- **Die Flamme bleibt stehen.** Sie wird auf dem Server aus der ganzen
  Historie gerechnet. Nach dem Nachtragen stimmt sie wieder.
- **Gewohnheiten anlegen oder ändern braucht Netz**, genauso der Fokus-Timer.
  Beim Timer ist das Absicht: er misst die Zeit auf dem Server, eine Stunde
  später nachgereicht wäre die Sitzung erfunden.

## Hell und dunkel

Umschalter im Zahnrad-Menü unter *Darstellung*. Beim ersten Aufruf folgt die
App der Systemeinstellung.
