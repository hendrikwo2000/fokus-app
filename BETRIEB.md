# Betrieb

Technische Doku zum Fokus-Tracker (`fokus.it-wolf.org`). Für die Bedienung
siehe [README.md](README.md).

Eigenes Cloudflare-Pages-Projekt, kein Build-Schritt, Vanilla JS. Getrennt von
der ToDo-Liste deployt — ein Deploy hier kann dort nichts kaputt machen.
Geteilt werden nur zwei Dinge: die Anmeldung und die Datenbank.

## Geteilter Login

Wer bei `todo.it-wolf.org` angemeldet ist, ist es hier auch. Das hängt an zwei
Dingen, und beide müssen stimmen:

1. **Das Cookie heißt in beiden Apps `todo_session`** und ist auf
   `Domain=.it-wolf.org` gesetzt (nicht host-only auf einer Subdomain).
2. **Beide Pages-Projekte binden dieselbe D1-Datenbank `todo` als `DB`.** Ein
   Cookie allein reicht nicht — der Token wird bei jeder Anfrage in `sessions`
   nachgeschlagen.

Die Domain wird **nur auf it-wolf.org-Hosts** gesetzt (`domainFlag` in
`functions/_lib/session.js`). Auf `127.0.0.1` und den `*.pages.dev`-Adressen
würde der Browser ein fremdes Domain-Attribut still verwerfen — das Cookie käme
gar nicht erst an, und die Anmeldung bräche ohne sichtbaren Fehler.

`functions/_lib/session.js` ist eine Spiegelung der Datei aus der ToDo-Liste.
**Ändert sich dort die Cookie-Mechanik, muss sie hier mitgezogen werden.** Es
gibt bewusst keinen gemeinsamen Ort dafür: zwei Repos, zwei Deployments.

**Abmelden meldet aus beiden Apps ab.** Es ist eine Sitzung, kein zweites
Konto. Die App fragt vorher nach und sagt das dazu.

## Zugang

Angemeldet zu sein reicht nicht. Wer den Fokus-Tracker benutzen darf, steht in
der geteilten `users`-Tabelle: Spalte **`users.fokus_zugang`** (0/1),
unabhängig von `role` und von der Schwester-Spalte `todo_zugang`. Ein
ToDo-Konto gibt NICHT automatisch Fokus-Zugang — Fokus ist Eigennutz-Werkzeug,
kein Angebot für alle ToDo-Nutzer (Begründung im Kommentar zu `users` in
`ToDo/web/schema.sql`).

**Bis 08.08.2026 stand das in der Umgebungsvariable `FOKUS_ZUGANG`** auf diesem
Pages-Projekt — von `todo.it-wolf.org/admin` aus weder einsehbar noch
änderbar. Seither sitzt die Berechtigung in der Datenbank
(`migration-fokus-zugang.sql` in `ToDo/web/`) und lässt sich aus demselben
Dashboard vergeben wie der ToDo-Zugang: Nutzerliste → „Fokus-Zugang
geben/entziehen". `functions/_lib/zugang.js` (`darfRein`) fragt das bei jedem
Zugriff frisch ab, nicht aus dem Cookie — sonst behielte jemand entzogenen
Zugang bis zu 400 Tage (so lange gilt die Sitzung).

**Neue Adressen** (noch gar kein Konto) kommen über die eigene „Noch keinen
Zugang?"-Maske hier auf der Seite (`POST /api/waitlist`, schreibt mit
`quelle='fokus'` in dieselbe `waitlist`-Tabelle wie die ToDo-Liste).
Freischalten passiert weiterhin nur unter `todo.it-wolf.org/admin` — dort
setzt es bei `quelle='fokus'` `fokus_zugang=1` (und NICHT `todo_zugang`).

**Seit 08.08.2026 symmetrisch selbstbedienbar: nur die erste Freischaltung
braucht einen Admin.** Ein Konto mit `todo_zugang` aber ohne `fokus_zugang`
(z. B. ein reines ToDo-Konto) holt sich Fokus selbst, zwei gleichwertige Wege -
keiner davon geht über die Warteliste oder einen Admin:
- Knopf „Zugang zur ToDo-Liste holen" bzw. hier umgekehrt „Zugang zum
  Fokus-Tracker holen" in den Einstellungen der App, die schon da ist -
  `POST /api/auth/fokus-zugang` (ToDo-Seite) / `POST /api/auth/todo-zugang`
  (hier), setzt die Spalte sofort, ohne Rückfrage.
- Einfach ein Login-Versuch hier: `request-code.js` setzt `fokus_zugang=1`
  still mit, BEVOR der Code verschickt wird - sieht wie ein ganz normaler
  Login aus, keine eigene Meldung. Genauso `link.js` beim Einlösen eines
  Anmeldelinks, der drüben (ToDo) angefordert wurde - `login_codes` ist
  geteilt, ein dort erzeugter Link kann also legitim hier landen.

Jeder kann seinen eigenen Fokus-Zugang auch wieder aufgeben, ohne die
Gewohnheiten/Historie zu löschen: Einstellungen → „Fokus-Zugang aufgeben"
(`POST /api/auth/zugang-aufgeben`, eigene Datei pro App - ToDo hat ihre
eigene gleichnamige für `todo_zugang`). Ein erneuter Login-Versuch holt den
Zugang genau wie oben beschrieben von selbst zurück.

Geprüft wird an zwei Stellen: beim Einlösen des Codes/Links (`verify-code.js`,
`link.js` - defensiv, falls `fokus_zugang` zwischen Codeversand und Einlösen
entzogen wurde) und **in jedem Daten-Endpunkt**
(`nutzerOderFehler` in `_lib/zugang.js`). Ohne den zweiten Punkt käme jemand
mit einer gültigen ToDo-Sitzung per `curl` direkt an die API. Ein gesperrtes
Konto bekommt **403**, nicht 401: es ist ja angemeldet, ein 401 würde die App
in eine Anmeldeschleife schicken.

## Variablen

Cloudflare-Dashboard → Pages → fokus → Settings → Environment variables.

| Variable | Zweck |
| --- | --- |
| `RESEND_KEY` | Resend-API-Key mit Sendezugriff auf `mail.it-wolf.org`. Derselbe wie bei der ToDo-Liste. Ohne ihn schlägt jeder Login fehl. |
| `ADMIN_MAIL` | Optional: wohin Wartelisten-Benachrichtigungen aus `/api/waitlist` gehen. Ohne sie gehen sie an alle Konten mit `role='admin'`. Dieselbe Variable wie bei der ToDo-Liste, hier separat gesetzt (getrenntes Pages-Projekt). |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push-Schlüsselpaar. **Dieselben Werte wie im ToDo-Projekt** — VAPID identifiziert den absendenden Server gegenüber dem Push-Dienst, nicht die Domain, ein Wiederverwenden ist unbedenklich und erspart ein zweites Schlüsselpaar. Siehe [Benachrichtigungen](#benachrichtigungen). |
| `PUSH_CRON_SECRET` | Geteiltes Geheimnis für `/api/push/pruefen` — eigener Wert, nicht identisch mit dem der ToDo-Liste (ein geleakter Wert legt sonst beide Cron-Endpunkte offen). Ohne korrekten Header antwortet der Endpunkt mit 403. |

`FOKUS_ZUGANG` gibt es seit 08.08.2026 nicht mehr — Fokus-Zugang steht jetzt in
der Datenbank, siehe Abschnitt „Zugang" oben.

Dazu die D1-Bindung: Variablenname **`DB`** → Datenbank **`todo`**.

Absender ist `Fokus <login@mail.it-wolf.org>` — dieselbe Sendedomain wie die
ToDo-Liste, weil dort SPF/DKIM/DMARC schon liegen. Eine eigene Sendedomain wäre
neue DNS-Arbeit ohne Gegenwert.

## Datenmodell

Vier Tabellen, alle in der `todo`-Datenbank (`schema-fokus.sql`). Rein additiv —
nur `CREATE`, kein `DROP`. Der laufende ToDo-Code liest sie nicht, es gibt also
kein Zeitfenster, in dem etwas bricht.

| Tabelle | Inhalt |
| --- | --- |
| `gewohnheiten` | Name, Typ (`binaer`/`menge`), Zielmenge, Einheit, Rhythmus (`taeglich`/`wochentage`/`x_pro_woche`) mit Wochentage-Bitmaske bzw. Wochenziel, archiviert |
| `gewohnheit_logs` | Ein Tag: `(gewohnheit_id, datum)` als Schlüssel, Menge, `ziel_damals` |
| `fokus_sitzungen` | Start, geplante/echte Dauer, Pausen, vollständig |
| `fokus_einstellungen` | Standarddauer pro Nutzer |

Fremdschlüssel auf `users(id)` mit `ON DELETE CASCADE` — löschst du dein Konto
in der ToDo-Liste, räumt die Datenbank die Fokus-Daten selbst mit weg. Genau
dafür liegen die Tabellen in derselben Datenbank.

Dazu `fokus_push_subscriptions` (`migration-push.sql`, separat von
`schema-fokus.sql` — siehe [Benachrichtigungen](#benachrichtigungen)) mit
derselben Cascade-Regel.

`gewohnheiten.position` bestimmt die Reihenfolge in der Tagesansicht
(`ORDER BY archiviert, position, created_at`) und lässt sich über
`PUT /api/gewohnheiten/reihenfolge` setzen. Der Client schickt dabei die
**vollständige** Liste aller IDs, nicht „schiebe X um eins" — ein Tausch wären
zwei Anfragen, die sich beim schnellen Tippen verschachteln könnten. Die
archivierten hängen hinten dran, damit die Positionen lückenlos bleiben, falls
eine davon später zurückgeholt wird.

### Kein `status`-Feld

Grün/gelb/offen ergibt sich aus Menge und Ziel (`_lib/tag.js`). Ein zusätzlich
gespeicherter Status könnte davon abweichen, sobald irgendwo nur eins von beiden
geschrieben wird — abgeleitet kann er das nie.

### Bei einer Obergrenze ist die 0 der beste Tag

Sonst gilt: eine Menge von 0 wird nicht gespeichert, sondern gelöscht — „offen"
ist die Abwesenheit eines Eintrags, so kann „nichts gemacht" gar nicht erst von
„nie angefasst" abweichen.

Bei `richtung='hoechstens'` geht das nicht auf. Dort ist 0 kein leerer Tag,
sondern der bestmögliche („keine Instagram-Minute"), und `status()` gibt
deshalb **erledigt** zurück. `log.js` speichert die 0 in diesem einen Fall als
echte Zeile. Zwei Folgen, die man leicht übersieht:

- **„Offen" heißt hier ausschließlich „keine Log-Zeile".** Wer `status()` für
  einen Tag ohne Eintrag mit `menge = 0` aufruft, bekommt fälschlich „erledigt".
  Betroffen war `nochOffen()` in `api/push/pruefen.js` — es fragt jetzt vorher
  auf einen vorhandenen Eintrag ab. `statistik.js` und `erledigtDieseWoche()`
  taten das schon immer.
- **Zurück auf „offen" braucht ein eigenes Signal**, weil die Menge das nicht
  mehr ausdrücken kann: `{ loeschen: true }` im PUT auf
  `/api/gewohnheiten/log`. In der Oberfläche sind das der Haken auf der
  Heute-Karte (zweiter Tipp) und „Eintrag löschen" im Tag-Dialog.

Der Haken auf der Heute-Karte springt bei einer Obergrenze auf **0** statt auf
das Ziel — „geschafft" heißt dort, die Grenze *nicht* ausgereizt zu haben.

**Die Zielmenge darf bei einer Obergrenze 0 sein** („gar keine Zigarette").
Deshalb wird `pruefeRichtung()` in `index.js` **vor** `pruefeFelder()`
aufgerufen: die Richtung entscheidet, ob 0 oder 1 die kleinste gültige
Zielmenge ist. Im Client hängt an derselben Regel das `min` des Eingabefelds
(`setzeRichtungWahl`), und `zielmenge` darf nirgends auf Wahrheitswert geprüft
werden — `!= null`, sonst springt eine 0 beim Bearbeiten still auf 30.

### Ein stiller Tag zählt bei einer Obergrenze

`stillerTagZaehlt()` in `_lib/tag.js`: bei `richtung='hoechstens'` gilt ein Tag
**ohne Eintrag** rückwirkend als erledigt. Wer gar nicht auf Instagram war, hat
die Grenze eingehalten, auch ohne das jeden Abend zu bestätigen — ohne diese
Regel müsste man täglich aktiv eine 0 eintragen, sonst sähen Flamme und
Erfüllungsquote schlechter aus als die Wirklichkeit.

Zwei Schranken, ohne die die Regel Unsinn ergibt:

- **Nur die Vergangenheit.** Heute wird nicht grün, sonst wäre der Tag fertig,
  bevor er vorbei ist — ein Ausrutscher am Abend müsste ihn nachträglich wieder
  rot machen. Heute *ruht* stattdessen, siehe unten.
- **Erst ab `gewohnheiten.created_at`.** Ohne das liefe die Straehne einer
  gestern angelegten Gewohnheit über das volle 730-Tage-Fenster zurück.
  Deshalb steht `created_at` jetzt in jedem SELECT, der Tage bewertet, und als
  `angelegtAm` (nur Datum) in der API-Antwort.

Vier Stellen zählen grüne Tage und müssen dieselbe Regel anwenden — weicht eine
ab, springt die Flamme je nach Endpunkt: `index.js` (Bootstrap), `log.js`
(nach jedem Schreiben), `statistik.js`, `push/pruefen.js`. Die ersten beiden
benutzen `ergaenzeStilleTage()`, die anderen `stillerTagZaehlt()` direkt.
Im Client spiegelt `stillerTagZaehlt()`/`zustandVon()` in `app.js` dasselbe für
Kalender und Wochenfortschritt.

**Sichtbare Folge, die man erwarten sollte:** Der Kalender einer Obergrenze ist
ab dem Anlegetag durchgehend grün — der Tooltip unterscheidet „nichts
eingetragen, also im Rahmen" von einem echten Eintrag.

### Heute ruht eine Obergrenze, bis etwas drinsteht

`ruhtHeute()` in `app.js`: eine Obergrenze **ohne Eintrag am heutigen Tag** ist
weder offen noch erledigt. Sie hat kein Soll, das man erfüllen müsste — „keine
Zigarette" ist der Normalfall, kein Tagwerk. Und ab morgen zählt der Tag
ohnehin von allein als eingehalten (siehe oben); ihn heute als offen zu führen
hieß, jeden Abend zu bestätigen, was die App sich am nächsten Tag selbst gibt.

Die Karte bleibt in der Liste stehen — ein Ausrutscher muss sich eintragen
lassen, und der Haken trägt weiter die 0 ein, wenn man den Tag ausdrücklich
abschließen will. Sie zählt nur nirgends mit:

| Wo | Folge |
| --- | --- |
| Tagesbilanz über der Liste | fällt aus Zähler **und** Nenner |
| Zahl am App-Icon | `offeneGewohnheitenHeute()` überspringt sie |
| Abenderinnerung | `nochOffen()` in `push/pruefen.js` gibt `false` zurück |
| Karte | Zustand `ruht`: grauer Rand, Balken in `--line` statt Gelb |

**Preis, den man kennen muss:** Bei Obergrenzen meldet sich die Erinnerung
nicht mehr. Wer sie will, muss den Tag von Hand abschließen. Hendriks
Entscheidung vom 11.08.2026, gefragt — die Alternativen waren „alles lassen"
(tägliche Bestätigung) und „heute sofort grün".

`ruhtHeute()` gilt **nur für heute**. Der Kalender rechnet für vergangene Tage
unverändert über `stillerTagZaehlt()`, und der heutige Kalendertag bleibt dort
grau — er wird morgen grün.

### Eine Obergrenze verschwindet nie aus „Heute"

`x_pro_woche` blendet eine Gewohnheit sonst aus, sobald das Wochenziel erreicht
ist. Bei einer Obergrenze wäre das falsch: „5 Mal die Woche höchstens 60 Min"
heißt nicht, dass die Grenze ab dem fünften Tag nicht mehr gilt — und ohne
Karte ließe sich ein Ausrutscher am sechsten Tag gar nicht mehr eintragen. Seit
der Regel oben erreichte so eine Gewohnheit ihr Wochenziel sogar von allein und
war spätestens am Wochenende weg.

`istHeuteDran()` (`app.js`) und `nochOffen()` (`push/pruefen.js`) fallen bei
einer Obergrenze deshalb auf die Tagesprüfung durch, genau wie `taeglich`.
Das Wochenziel bleibt die Messlatte für Fortschrittszeile und Strähne — nur
nicht mehr dafür, ob die Karte erscheint.

Die Karte steht damit die ganze Woche da, verlangt aber nichts: seit dem
11.08.2026 ruht eine Obergrenze ohne Eintrag (siehe [Heute ruht eine
Obergrenze](#heute-ruht-eine-obergrenze-bis-etwas-drinsteht)). Vorher kam die
Erinnerung an jedem Tag ohne Eintrag, auch nach dem fünften — das ist weg.

### Die Statistik beginnt beim Anlegen

`statistik.js` schneidet den Zeitraum am `created_at` der Gewohnheit ab. Ohne
das zählten Tage in den Nenner, an denen es die Gewohnheit noch gar nicht gab —
eine vier Tage alte Gewohnheit stünde bei „4 von 30 Tage (13 %)" und könnte die
100 % erst einen Monat später erreichen.

**Ausnahme, die man leicht übersieht:** Nachtragen geht beliebig weit zurück
(`pruefeLogDatum` verbietet nur die Zukunft), Log-Zeilen können also **älter
sein als die Gewohnheit**. Deshalb ist der Beginn `min(created_at, ältester
Eintrag im Fenster)` — sonst verschwände eine nachgetragene Woche aus der
Quote. Für stille Tage (oben) gilt das ausdrücklich NICHT: ein echter Eintrag
zählt rückwirkend, eine Annahme nicht.

Der heutige Tag zählt bewusst mit, obwohl er meist noch offen ist. Er ist keine
Verzerrung, sondern der aktuelle Stand.

**Passt keine volle Woche in den Zeitraum**, zeigt eine `x_pro_woche`-Gewohnheit
statt einer Wochenquote den Stand der laufenden Woche (`laufendeWoche: true` in
der Antwort, Einheit `Tage`). Betrifft vor allem „7 Tage" — dort liegt nie eine
volle Mo-So-Woche —, außerdem frisch angelegte Gewohnheiten in jedem Zeitraum.
Vorher stand da „Noch keine geplanten Wochen in diesem Zeitraum": richtig, aber
für den 7-Tage-Blick unbrauchbar.

### `ziel_damals`

Jeder Log-Eintrag merkt sich das Ziel, das beim Anlegen galt. Hebst du das Ziel
später von 30 auf 60 Min an, bleiben alte grüne Tage grün.

**Ein neues Ziel gilt ab heute.** Der PATCH auf `/api/gewohnheiten` schreibt
`ziel_damals` für alle Logs mit `datum >= heute` mit. Ohne das stünde heute ein
grüner Haken an einem halb vollen Balken: der Status fiele gegen das alte Ziel,
die Anzeige gegen das neue.

Die Oberfläche rechnet **immer** gegen `tag.ziel`, nie gegen
`gewohnheit.zielmenge` — sonst laufen Balken und Haken auseinander.

### Strähnen heilen rückwirkend

Die Strähne wird bei jeder Abfrage live aus den gespeicherten Mengen gerechnet,
nirgends gespeichert. Trägst du einen gelben Tag nachträglich voll, war die Kette
rückwirkend nie unterbrochen — dafür ist keine Extra-Logik nötig.

Gezählt wird von heute rückwärts. Ist **heute** noch nicht grün, beginnt die
Zählung bei gestern: sonst stünde die Strähne jeden Morgen um 0:01 Uhr auf null,
obwohl der Tag gerade erst angefangen hat.

Geladen werden Logs der letzten 730 Tage. Das deckelt zugleich die maximal
darstellbare Strähne und hält die Abfrage klein.

## Datum kommt vom Client

Der Worker läuft in UTC, gelebt wird in UTC+1/+2. Um 0:30 Uhr wäre serverseitig
noch gestern — man hakt etwas ab und es landet auf dem falschen Tag.

Deshalb schickt die App ihr eigenes, **lokal** gebautes Datum mit (`heuteStr()`
in `app.js`, mit lokalen Gettern statt `toISOString()`). Der Server prüft es nur
auf Plausibilität: gültiges Datum, höchstens einen Tag von der Serverzeit
entfernt (`pruefeHeute` in `_lib/tag.js`). Ohne diese Schranke ließen sich
Strähnen in die Zukunft schreiben.

Tage in der Zukunft lassen sich nicht eintragen. Nachtragen geht beliebig weit
zurück — genau das ist der Sinn der Verlaufsansicht.

## Fokus-Timer

**Der Countdown auf dem Bildschirm ist reine Anzeige.** Gerechnet wird immer aus
`gestartet_am`. Nur so überlebt eine Sitzung Reload, Handysperre,
Verbindungsabbruch und Gerätewechsel.

```
verstrichen = jetzt − gestartet_am − pause_gesamt_sek − (laufende Pause)
```

Die Rechnung läuft in **SQL** (`strftime('%s', …)`), nicht in JavaScript.
Grund: SQLite gibt Zeitstempel als `YYYY-MM-DD HH:MM:SS` ohne Zonen-Suffix
zurück, und `new Date("2026-08-07 12:00:00")` liest JavaScript als **lokale**
Zeit, obwohl UTC gemeint ist. Auf einem Worker in UTC fällt das nie auf, beim
Testen in Deutschland wären es zwei Stunden daneben.

Es gibt höchstens **eine** offene Sitzung pro Nutzer — `start.js` beendet eine
ältere sauber, bevor es eine neue anlegt.

**Beim Beenden wird die Dauer bei der geplanten gedeckelt.** Das ist der Grund,
warum es keine Zeitüberschreitungs-Regel braucht: vergisst man eine Sitzung und
meldet sich abends wieder, stehen trotzdem 25 Minuten im Log und nicht fünf
Stunden. Eine 25-Minuten-Sitzung kann keine 300 Fokusminuten hervorbringen.

Nur Arbeitsphasen werden geloggt, keine Pausen-Automatik. Die Wochenstatistik
zählt damit echte Fokusminuten.

**„Schnitt/Woche" beginnt bei der ersten Woche mit Fokusminuten**, nicht am
Anfang des Acht-Wochen-Fensters. Wochen davor gab es die App noch nicht oder es
lief nichts; sie als Nullen mitzumitteln drückte den Schnitt (297 Minuten auf
acht Wochen ergaben 37, obwohl in dreien gar nichts stattfand). Ruhige Wochen
**nach** dem Start zählen weiter mit, die sind echt. Die laufende Woche bleibt
draußen — außer sie ist die einzige, dann steht sie da.

**Stopp fragt nach, sobald mindestens eine Minute gelaufen ist.** Eine geloggte
Sitzung lässt sich nachträglich nicht mehr ändern oder löschen — ein Fehlgriff
neben „Pause" bliebe also für immer in der Wochenstatistik. Unter einer Minute
gibt es nichts zu verlieren, da entfällt die Rückfrage.

### Ausgebaut: „Zählt auf" (Sitzung auf eine Gewohnheit buchen)

Eine Sitzung konnte auf eine Gewohnheit gebucht werden — beim Beenden landeten
die Fokusminuten dort als Menge. **Am 11.08.2026 wieder ausgebaut** (Auswahl im
Timer, `schreibeGutschrift()` in `_lib/fokus.js`, Prüfung und Spalte im INSERT
von `start.js`, `meldeGutschrift()` im Client). Grund: gutgeschrieben wurden
immer Minuten, egal welche Einheit die Gewohnheit trug — bei „8 Gläser Wasser"
wurden aus 25 Minuten 25 Gläser. Sinnvoll war die Buchung damit nur bei
Gewohnheiten, die ohnehin in Zeit zählen.

**Die Spalte `fokus_sitzungen.gewohnheit_id` bleibt stehen** (angelegt durch
`migration-sitzung-gewohnheit.sql`, `ON DELETE SET NULL`, nullable). Sie wird
nicht mehr beschrieben und nicht mehr gelesen; gelöscht wird in dieser
Datenbank grundsätzlich nichts. Wer die Migration nie gefahren hat, braucht sie
jetzt auch nicht mehr — `start.js` nennt die Spalte im INSERT nicht.

Wochen werden **in JavaScript** gebündelt (`montagVon`), nicht per
`strftime('%W')` — die SQL-Wochennummer stolpert über den Jahreswechsel.
Gruppiert wird über `fokus_sitzungen.datum` (das lokale Datum), sonst rutschte
eine Sitzung von 23:30 Uhr in die falsche Woche.

Signal am Sitzungsende auf drei Wegen, weil jeder einzelne ausfallen kann:
Tab-Titel (geht immer), Ton über die Web Audio API (der Start-Klick ist die
Geste, die Browser für Tonausgabe verlangen), Browser-Benachrichtigung — Letztere
nur, wenn der Schalter „Benachrichtigungen" in den Einstellungen an ist (siehe
[Benachrichtigungen](#benachrichtigungen); `benachrichtigungenAn` in `app.js`).

## Benachrichtigungen

Ein Schalter in den Einstellungen für zwei Dinge: das Signal am Sitzungsende
(siehe oben) und eine Zahl auf dem App-Icon (Badge), sobald heute noch
Gewohnheiten offen sind — sobald die App auf dem Handy zum Home-Bildschirm
hinzugefügt wurde. Baugleich zum gleichnamigen Feature der ToDo-Liste, dort
ausführlicher dokumentiert (`ToDo/web/BETRIEB.md`); hier nur, was abweicht.

**„Offen" heißt wie in der Tagesansicht selbst** (`istHeuteDran()` +
Tages-Status in `app.js`, serverseitig gespiegelt in
`functions/api/push/pruefen.js`, da der Cron-Aufruf ohne geladenen
`state` auskommen muss): heute überhaupt dran (`taeglich` immer,
`wochentage` nur an geplanten Tagen, `x_pro_woche` solange das Wochenziel
diese Woche noch nicht erreicht ist) **und** noch nicht erledigt (Status
`offen` oder `teilweise`).

**Ausnahme Obergrenze:** ohne Eintrag am heutigen Tag gilt sie nicht als offen
und löst keine Erinnerung aus — siehe [Heute ruht eine
Obergrenze](#heute-ruht-eine-obergrenze-bis-etwas-drinsteht). `nochOffen()` und
`ruhtHeute()` in `app.js` müssen hier dieselbe Regel anwenden.

**Eigene Tabelle `fokus_push_subscriptions`, nicht ToDo's
`push_subscriptions`.** Ein Push-Endpunkt ist pro Browser-Herkunft eindeutig
(Fokus und ToDo laufen auf verschiedenen Domains) — läge eine
Fokus-Anmeldung in derselben Tabelle wie ToDo's Abos, würde ToDo's Cron-Job
sie mit auswählen (er filtert nur über `user_id`, nicht über die App) und ein
fälliges ToDo würde eine Push-Nachricht an das Fokus-Icon schicken: falscher
Service Worker, falscher Inhalt.

**Endpunkte** unter `/api/push/`:
- `abonnieren` (POST, angemeldet) — Abo speichern/erneuern
- `abbestellen` (POST, angemeldet) — eigenes Abo löschen
- `pruefen` (GET/POST) — KEIN Nutzer-Endpunkt, geteiltes Geheimnis im Header
  `X-Cron-Secret`, siehe `PUSH_CRON_SECRET` oben

**Zeitsteuerung**: derselbe externe Pinger wie bei der ToDo-Liste
([cron-job.org](https://cron-job.org)), aber ein **eigener** Job auf
`https://fokus.it-wolf.org/api/push/pruefen` mit dem Fokus-eigenen
`PUSH_CRON_SECRET`. „Heute" in Europe/Berlin (`heuteBerlin()` in
`pruefen.js`), nicht UTC.

**Bekannter Kompromiss** (identisch zur ToDo-Liste): ohne Push (0 offene
Gewohnheiten) wird die Zahl im Hintergrund NICHT auf 0 gesetzt — eine
„stille" Push-Nachricht ist bei iOS/Chrome nicht zuverlässig erlaubt. Sie
stimmt spätestens beim nächsten Öffnen der App wieder (`aktualisiereBadge()`
in `app.js`, bei jedem Rendern der Tagesansicht neu berechnet). In der Praxis
kein Problem: eine Gewohnheit lässt sich ohnehin nur bei geöffneter App
abhaken, genau dann läuft auch der Vordergrund-Weg.

**Neu: `sw.js`.** Fokus hatte bisher keinen Service Worker — Push-Abos und der
Hintergrund-Handler brauchen zwingend einen (`reg.pushManager.subscribe()`
läuft über die Service-Worker-Registrierung). Als Nebeneffekt cached er auch
die App-Shell für den Offline-Fall (network-first mit Cache-Fallback, wie bei
der ToDo-Liste). **Bei jeder Änderung an einer gecachten Datei
(`index.html`, `style.css`, `app.js`, `manifest.json`, Icons) die Konstante
`CACHE_NAME` in `sw.js` hochzählen** — sonst bleibt ein wiederkehrender
Nutzer auf dem alten Stand hängen.

### Einmalig einrichten

1. `migration-push.sql` einspielen:
   `npx wrangler d1 execute todo --remote --file=migration-push.sql`
2. `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` im Fokus-Pages-Projekt setzen —
   dieselben Werte, die im ToDo-Projekt schon stehen (Cloudflare-Dashboard →
   Pages → todo → Settings → Environment variables, dort ablesen)
3. `PUSH_CRON_SECRET` setzen — ein neuer, zufälliger Wert, nicht der von ToDo
4. Bei cron-job.org einen zweiten Job anlegen: GET oder POST auf
   `https://fokus.it-wolf.org/api/push/pruefen`, Header
   `X-Cron-Secret: <Wert von PUSH_CRON_SECRET>`, gleiche Häufigkeit wie der
   bestehende ToDo-Job

## Offline

Der Service Worker hält nur die Oberfläche vor. Damit die App ohne Netz auch
etwas anzeigen und annehmen kann, liegen zwei Dinge im `localStorage`:

| Schlüssel | Inhalt |
| --- | --- |
| `fokus_stand` | Die letzte erfolgreiche Antwort von `GET /api/gewohnheiten` — kompletter Bootstrap inklusive Historie |
| `fokus_warteschlange` | Noch nicht abgeschickte Tage: `{gewohnheitId, datum, menge, loeschen}` |

**Nur Tage wandern in die Warteschlange.** Gewohnheiten anlegen/ändern,
umsortieren, der Export und der Fokus-Timer brauchen weiter Netz. Beim Timer ist das Absicht: er rechnet
serverseitig aus `gestartet_am`, eine Stunde später nachgereicht wäre die
Sitzung schlicht gelogen.

Drei Punkte, an denen man sonst stolpert:

- **Gemerkt wird nur bei `status === 0`** (Fetch geworfen, kein Netz). Ein
  400/403/500 ist eine Absage des Servers — die bliebe beim nächsten Versuch
  dieselbe und gehört dem Nutzer gesagt, nicht in eine Endlosschleife.
  Beim Nachliefern gilt dieselbe Regel plus 401: 0 und 401 bleiben liegen
  (Netz weg bzw. abgemeldet, beides erledigt sich), alles andere wird
  verworfen.
- **`heute` wird beim Nachliefern frisch gesetzt**, nicht mitgespeichert.
  `pruefeHeute()` lässt nur einen Tag Abstand zur Serverzeit zu — mit dem
  gemerkten „heute" von vorgestern wäre jeder Nachtrag ein 400er. Das `datum`
  bleibt natürlich stehen, der Eintrag läuft dann als Nachtrag durch.
- **Nach jedem Laden muss `legeWarteschlangeUeber()` laufen.** Der Serverstand
  überschreibt `state.logs`, und was noch in der Warteschlange steht, ist
  neuer — ohne das springt eine offline abgehakte Karte beim nächsten Laden
  zurück.

Den Status rechnet die App offline selbst (`statusVon()` in `app.js`) — ein
**Spiegel von `status()` in `_lib/tag.js`**. Ändert sich die Regel dort, muss
sie hier mit. Die Flamme wird bewusst NICHT gespiegelt: sie hängt an der
ganzen Historie samt Rhythmus, steht offline auf ihrem letzten Wert und
stimmt nach dem Nachliefern von selbst wieder.

Beim Abmelden werden beide Schlüssel gelöscht (`vergissStand()`), sonst
blitzte der Bestand des vorherigen Kontos auf, wenn sich an demselben Gerät
jemand anderes anmeldet.

## Lokal testen

```bash
npx wrangler pages dev . --d1 DB=todo --port 8792 --ip 127.0.0.1
```

Bequemer über `.claude/launch.json` im Arbeitsverzeichnis `Documents/Claude-Code`,
Eintrag `fokus`.

Fokus-Zugang kommt jetzt aus der Datenbank, nicht mehr aus einem `--binding` -
nach dem Einspielen von `ToDo/web/schema.sql` (oder alt + den beiden
`migration-*-zugang.sql`, siehe unten) den Testnutzer freischalten. Ohne
`todo_zugang=1` kommt man lokal nicht mal an der ToDo-Seite vorbei, um erst
dort ein Konto zu holen - deshalb hier beide Spalten gleich mit:

```sql
UPDATE users SET fokus_zugang = 1, todo_zugang = 1 WHERE id = 1;
```

### Falle: eigene, leere Datenbank

`wrangler pages dev` legt ein **eigenes** `.wrangler/`-Verzeichnis in `Fokus/web`
an. Die lokale D1 der ToDo-Liste ist damit **nicht** dieselbe — Nutzer,
Sitzungen und Login-Codes fehlen hier komplett, und der erste Aufruf endet in
einem 500er.

Einspielen muss man deshalb **alle**: den Auth-Kern (`users`, `sessions`,
`login_codes` aus `ToDo/web/schema.sql`), `schema-fokus.sql` **und**
`migration-rhythmus.sql` (bei einer ganz frischen lokalen DB reicht das
aktualisierte `schema-fokus.sql` allein, die Migration ist nur für eine lokale
DB noetig, die vor dem Rhythmus-Feature angelegt wurde). Genauso mit
`migration-fokus-zugang.sql` und `migration-todo-zugang.sql` (beide aus
`ToDo/web/`) — nur nötig, wenn die lokale `users`/`waitlist` aus einem
`schema.sql`-Stand vor dem 08.08.2026 stammt; ein frisch eingespieltes
`schema.sql` hat `todo_zugang`/`fokus_zugang`/`quelle` schon direkt drin.

### Falle: `wrangler d1 execute --local` stürzt auf Windows ab

libuv-Assertion. Schema stattdessen per Python direkt in die SQLite schreiben:

```bash
py -c "
import sqlite3, hashlib
pfad = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/ab42fd77e40eec490cd4070d825afea101cebc0abb8d44494b8fb7d7fb9c5be1.sqlite'
db = sqlite3.connect(pfad)
db.executescript(open('schema-fokus.sql', encoding='utf-8').read())
db.commit()
"
```

### Falle: der Dateiname hängt am D1-Namen

`--d1 DB=todo` benutzt `ab42fd77….sqlite`. Jeder andere Name legt kommentarlos
eine **leere** Datenbank unter neuem Hash an. Der Fehler taucht erst tief im
Worker als „no such table" auf und sieht aus wie ein fehlendes Schema.
**Immer `--d1 DB=todo`.**

### Falle: `wrangler pages dev` ohne festes Arbeitsverzeichnis

Aus einem Unterordner gestartet legt es dort ein zweites `.wrangler/` mit leerer
Datenbank an. Deshalb hat der launch.json-Eintrag ein `cwd`.

### Falle: beide Dev-Server teilen sich das Cookie

**Cookies ignorieren den Port.** Laufen ToDo (8790) und Fokus (8792)
gleichzeitig, schreiben beide `todo_session` auf `localhost` — sie überschreiben
sich gegenseitig. Weil die lokalen Datenbanken aber getrennt sind, kennt der
eine Server den Token des anderen nicht: man fliegt scheinbar grundlos raus.

Zwei Auswege: entweder nur einen Server laufen lassen, oder in **beiden**
lokalen Datenbanken denselben Sitzungs-Token anlegen.

In Produktion ist genau dieses Verhalten der Sinn der Sache — dort kennen beide
Apps dieselbe `sessions`-Tabelle.

### Angemeldet reinkommen ohne Mailversand

Ohne `RESEND_KEY` entsteht lokal gar kein Anmeldelink. Test-Sitzung von Hand
anlegen (Server vorher stoppen):

```bash
py -c "
import sqlite3, hashlib
pfad = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/ab42fd77e40eec490cd4070d825afea101cebc0abb8d44494b8fb7d7fb9c5be1.sqlite'
db = sqlite3.connect(pfad)
db.execute('INSERT OR REPLACE INTO sessions (token_hash,user_id,expires_at) VALUES (?,1,?)',
           (hashlib.sha256(b'test-fokus').hexdigest(), '2126-01-01 00:00:00'))
db.commit()
"
```

Im Browser `document.cookie = "todo_session=test-fokus; path=/"` setzen und neu
laden. HttpOnly stört nicht — der Server prüft nur den Wert.

## Endpunkte

| Route | Was |
| --- | --- |
| `POST /api/auth/request-code` | Code + Anmeldelink per Mail. 404 ohne Konto (Frontend wechselt zur Warteliste); mit Konto aber ohne `fokus_zugang` wird die Spalte still mitgesetzt, keine Absage mehr. |
| `POST /api/auth/verify-code` | Code einlösen, Sitzung anlegen. 403, falls `fokus_zugang` zwischen Codeversand und Einlösen entzogen wurde (defensiv, selten). |
| `GET /api/auth/link?t=` | Anmeldelink einlösen, 302 statt JSON. Setzt `fokus_zugang` genau wie request-code.js still mit. |
| `POST /api/auth/todo-zugang` | Sich selbst `todo_zugang=1` geben (angemeldet + `fokus_zugang` vorausgesetzt) |
| `POST /api/auth/zugang-aufgeben` | Eigenen `fokus_zugang` auf 0 setzen, Daten bleiben |
| `POST /api/auth/logout` | Sitzung serverseitig löschen (gilt für beide Apps) |
| `GET /api/auth/status` | `{angemeldet}` — immer 200, wird im Sekundentakt gepollt |
| `POST /api/waitlist` | Eintragen für Fokus-Zugang (`quelle='fokus'`). Existiert das Konto schon, wird `fokus_zugang` direkt gesetzt statt auf `todo.it-wolf.org/admin` zu verweisen. |
| `GET /api/gewohnheiten?heute=` | Bootstrap: Gewohnheiten, volle Log-Historie (`historieAb` bis `heute`), Strähnen |
| `POST/PATCH/DELETE /api/gewohnheiten` | Anlegen, ändern/archivieren, endgültig löschen |
| `PUT /api/gewohnheiten/log` | Einen Tag setzen — der einzige Schreibweg für Tage. `loeschen: true` stellt ihn wieder auf „offen" (nur bei einer Obergrenze nötig, siehe oben). |
| `PUT /api/gewohnheiten/reihenfolge` | `{ids: [...]}` — die vollständige Liste in der gewünschten Reihenfolge, schreibt `position` |
| `GET /api/fokus?heute=` | Laufende Sitzung, Einstellungen, Wochenstatistik |
| `POST /api/fokus/start` \| `/pause` \| `/stop` | Sitzung steuern (`pause` ist ein Umschalter). `start` nimmt `heute` und optional `geplanteMin`. |
| `PUT /api/fokus/einstellungen` | Standarddauer |
| `GET /api/export` | Alle eigenen Daten als JSON-Datei zum Herunterladen. Kein Gegenstück zum Zurückspielen. |
| `POST /api/push/abonnieren` \| `/abbestellen` | Push-Abo speichern/löschen (angemeldet) |
| `GET/POST /api/push/pruefen` | Cron-Ziel, kein Nutzer-Endpunkt — siehe [Benachrichtigungen](#benachrichtigungen) |

Typ und Ziel-Art einer Gewohnheit lassen sich nur ändern, **solange kein Tag
erfasst ist** — der PATCH antwortet sonst mit 409. Danach würde ein Wechsel die
ganze Historie neu bewerten: aus jedem Häkchen würde „Menge 1" gegen ein Ziel
von 30, und aus einem erreichten Ziel eine überschrittene Grenze. Wer später
wechseln will, legt eine neue Gewohnheit an.

## Bereitstellen

Kein Build. Push auf `main` → Cloudflare Pages deployt automatisch.

Beim erstmaligen Aufsetzen:

1. Pages-Projekt an das Repo binden — Framework „Keine", Build-Befehl leer,
   Ausgabe im Wurzelverzeichnis
2. Custom Domain `fokus.it-wolf.org`
3. D1-Bindung `DB` → `todo`
4. `RESEND_KEY` setzen (optional `ADMIN_MAIL`)
5. `schema-fokus.sql` in der D1-Konsole ausführen
6. Fokus-Zugang für den ersten Nutzer setzen — unter `todo.it-wolf.org/admin`
   („Fokus-Zugang geben") oder direkt per SQL: `UPDATE users SET
   fokus_zugang = 1 WHERE email = '...'`. Ohne diesen Schritt kommt niemand
   rein, auch nicht mit einem bestehenden ToDo-Konto.
