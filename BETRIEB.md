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
der Umgebungsvariable **`FOKUS_ZUGANG`** (kommagetrennte Adressen):

```
FOKUS_ZUGANG = hendrik.wolf.004@gmail.com
```

Ohne die Variable kommt **niemand** rein. Lieber ausgesperrt als offen: ein
vergessener Eintrag fällt beim ersten Anmeldeversuch auf, eine offene App fällt
gar nicht auf.

Sonst gäbe jede Wartelisten-Freischaltung in der ToDo-Liste stillschweigend
auch hier Zugang. Adressen statt Nutzer-IDs, weil man sie im Dashboard ändern
kann, ohne vorher in der Datenbank nachzusehen.

Geprüft wird an drei Stellen: beim Anfordern des Codes (damit an fremde
Adressen gar keine Mail rausgeht), beim Einlösen — und **in jedem
Daten-Endpunkt**. Ohne den letzten Punkt käme jemand mit einer gültigen
ToDo-Sitzung per `curl` direkt an die API. Ein gesperrtes Konto bekommt **403**,
nicht 401: es ist ja angemeldet, ein 401 würde die App in eine Anmeldeschleife
schicken.

## Variablen

Cloudflare-Dashboard → Pages → fokus → Settings → Environment variables.

| Variable | Zweck |
| --- | --- |
| `FOKUS_ZUGANG` | Erlaubte Adressen, kommagetrennt. Fehlt sie, kommt niemand rein. |
| `RESEND_KEY` | Resend-API-Key mit Sendezugriff auf `mail.it-wolf.org`. Derselbe wie bei der ToDo-Liste. Ohne ihn schlägt jeder Login fehl. |

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
| `gewohnheiten` | Name, Typ (`binaer`/`menge`), Zielmenge, Einheit, archiviert |
| `gewohnheit_logs` | Ein Tag: `(gewohnheit_id, datum)` als Schlüssel, Menge, `ziel_damals` |
| `fokus_sitzungen` | Start, geplante/echte Dauer, Pausen, vollständig |
| `fokus_einstellungen` | Standarddauer pro Nutzer |

Fremdschlüssel auf `users(id)` mit `ON DELETE CASCADE` — löschst du dein Konto
in der ToDo-Liste, räumt die Datenbank die Fokus-Daten selbst mit weg. Genau
dafür liegen die Tabellen in derselben Datenbank.

### Kein `status`-Feld

Grün/gelb/offen ergibt sich aus Menge und Ziel (`_lib/tag.js`). Ein zusätzlich
gespeicherter Status könnte davon abweichen, sobald irgendwo nur eins von beiden
geschrieben wird — abgeleitet kann er das nie.

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

Wochen werden **in JavaScript** gebündelt (`montagVon`), nicht per
`strftime('%W')` — die SQL-Wochennummer stolpert über den Jahreswechsel.
Gruppiert wird über `fokus_sitzungen.datum` (das lokale Datum), sonst rutschte
eine Sitzung von 23:30 Uhr in die falsche Woche.

Signal am Sitzungsende auf drei Wegen, weil jeder einzelne ausfallen kann:
Tab-Titel (geht immer), Ton über die Web Audio API (der Start-Klick ist die
Geste, die Browser für Tonausgabe verlangen), Benachrichtigung (nur mit
Erlaubnis).

## Lokal testen

```bash
npx wrangler pages dev . --d1 DB=todo --binding FOKUS_ZUGANG=hendrik.wolf.004@gmail.com --port 8792 --ip 127.0.0.1
```

Bequemer über `.claude/launch.json` im Arbeitsverzeichnis `Documents/Claude-Code`,
Eintrag `fokus`.

### Falle: eigene, leere Datenbank

`wrangler pages dev` legt ein **eigenes** `.wrangler/`-Verzeichnis in `Fokus/web`
an. Die lokale D1 der ToDo-Liste ist damit **nicht** dieselbe — Nutzer,
Sitzungen und Login-Codes fehlen hier komplett, und der erste Aufruf endet in
einem 500er.

Einspielen muss man deshalb **beides**: den Auth-Kern (`users`, `sessions`,
`login_codes` aus `ToDo/web/schema.sql`) **und** `schema-fokus.sql`.

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
| `POST /api/auth/request-code` | Code + Anmeldelink per Mail. Prüft `FOKUS_ZUGANG` vor dem Versand. |
| `POST /api/auth/verify-code` | Code einlösen, Sitzung anlegen |
| `GET /api/auth/link?t=` | Anmeldelink einlösen, 302 statt JSON |
| `POST /api/auth/logout` | Sitzung serverseitig löschen (gilt für beide Apps) |
| `GET /api/auth/status` | `{angemeldet}` — immer 200, wird im Sekundentakt gepollt |
| `GET /api/gewohnheiten?heute=&wochen=` | Bootstrap: Gewohnheiten, Logs, Strähnen |
| `POST/PATCH/DELETE /api/gewohnheiten` | Anlegen, ändern/archivieren, endgültig löschen |
| `PUT /api/gewohnheiten/log` | Einen Tag setzen — der einzige Schreibweg für Tage |
| `GET /api/fokus?heute=` | Laufende Sitzung, Einstellungen, Wochenstatistik |
| `POST /api/fokus/start` \| `/pause` \| `/stop` | Sitzung steuern (`pause` ist ein Umschalter) |
| `PUT /api/fokus/einstellungen` | Standarddauer |

Der Typ einer Gewohnheit lässt sich **nicht** ändern. Aus binär „mit Zielmenge"
zu machen würde die ganze Historie neu bewerten — aus jedem Häkchen würde
„Menge 1" gegen ein Ziel von 30. Wer den Typ wechseln will, legt eine neue an.

## Bereitstellen

Kein Build. Push auf `main` → Cloudflare Pages deployt automatisch.

Beim erstmaligen Aufsetzen:

1. Pages-Projekt an das Repo binden — Framework „Keine", Build-Befehl leer,
   Ausgabe im Wurzelverzeichnis
2. Custom Domain `fokus.it-wolf.org`
3. D1-Bindung `DB` → `todo`
4. `FOKUS_ZUGANG` und `RESEND_KEY` setzen
5. `schema-fokus.sql` in der D1-Konsole ausführen
