-- Fokus-Tracker: Tabellen fuer Gewohnheiten und Fokus-Sitzungen.
--
-- Kommt in DIESELBE D1-Datenbank wie die ToDo-Liste (`todo`). Grund: der
-- Login ist geteilt, das Sitzungs-Cookie muss ohnehin gegen `sessions` geprueft
-- werden - eine zweite Datenbank braeuchte ein zweites Binding, koennte aber
-- keinen Fremdschluessel auf `users` haben. Verwaiste Daten nach einer
-- Kontoloeschung muesste dann jemand von Hand aufraeumen.
--
-- REIN ADDITIV: nur CREATE, kein DROP, kein Tabellen-Neuaufbau. Der laufende
-- ToDo-Code liest diese Tabellen nicht, es gibt also kein Zeitfenster, in dem
-- etwas bricht. (Anders als seinerzeit migration-boards.sql - dort hat ein
-- DROP ueber ON DELETE CASCADE Daten mitgerissen.)
--
-- Einspielen: Cloudflare-Dashboard -> D1 -> todo -> Konsole, oder
--   npx wrangler d1 execute todo --remote --file=schema-fokus.sql
--
-- Fuer eine bereits laufende Installation (diese Datei wurde schon einmal
-- ausgefuehrt) reicht das hier nicht: neue Spalten kommen als eigene
-- ALTER-TABLE-Datei (z. B. migration-rhythmus.sql), CREATE TABLE IF NOT
-- EXISTS ruehrt eine bestehende Tabelle nicht an.

-- Eine Gewohnheit. Zwei Typen:
--   'binaer' - erledigt oder nicht, kein Ziel
--   'menge'  - Zielmenge mit frei getippter Einheit ("30 Min", "20 Seiten")
--
-- Rhythmus orthogonal zum Typ - 'taeglich' | 'wochentage' | 'x_pro_woche'.
-- Anders als der Typ ist der Rhythmus nach dem Anlegen aenderbar: es gibt
-- bewusst keine Versionierung wie bei ziel_damals, eine Aenderung gilt sofort
-- fuer Anzeige und Straehne (siehe migration-rhythmus.sql fuer die Begruendung
-- bei bereits bestehenden Installationen).
CREATE TABLE IF NOT EXISTS gewohnheiten (
  id                TEXT PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  typ               TEXT NOT NULL DEFAULT 'binaer' CHECK (typ IN ('binaer', 'menge')),
  zielmenge         INTEGER,
  einheit           TEXT,
  -- Nur bei typ='menge' relevant: 'mindestens' (Ziel erreichen, bisheriges
  -- Verhalten) oder 'hoechstens' (Obergrenze, z.B. "Instagram-Minuten").
  -- Siehe migration-richtung.sql fuer die Begruendung bei bestehenden
  -- Installationen und _lib/tag.js status() fuer die Statuslogik.
  richtung          TEXT NOT NULL DEFAULT 'mindestens'
                      CHECK (richtung IN ('mindestens', 'hoechstens')),
  rhythmus          TEXT NOT NULL DEFAULT 'taeglich'
                      CHECK (rhythmus IN ('taeglich', 'wochentage', 'x_pro_woche')),
  -- Bitmaske, Bit i = Wochentag i aus ["Mo","Di","Mi","Do","Fr","Sa","So"]
  -- (Mo=1, Di=2, Mi=4, Do=8, Fr=16, Sa=32, So=64). Nur bei rhythmus='wochentage'.
  wochentage_maske  INTEGER,
  -- Tage pro Woche (1-7). Nur bei rhythmus='x_pro_woche'.
  wochenziel        INTEGER,
  position          INTEGER NOT NULL DEFAULT 0,
  -- Archiviert heisst: raus aus der Tagesansicht, Historie bleibt. Endgueltig
  -- loeschen geht nur aus dem Archiv - die Zahlen sind bei einem Habit-Tracker
  -- das Wertvolle, ein Fehlklick soll sie nicht kosten.
  archiviert        INTEGER NOT NULL DEFAULT 0 CHECK (archiviert IN (0, 1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Ein Tag einer Gewohnheit. Kein eigener Schluessel: (Gewohnheit, Datum) ist
-- von Natur aus eindeutig, und ein UPSERT darauf ist genau das, was das
-- Nachtragen braucht.
--
-- Kein `status`-Feld - siehe _lib/tag.js. `ziel_damals` haelt fest, welches
-- Ziel beim Loggen galt, damit ein spaeter angehobenes Ziel alte gruene Tage
-- nicht nachtraeglich gelb faerbt.
CREATE TABLE IF NOT EXISTS gewohnheit_logs (
  gewohnheit_id TEXT NOT NULL REFERENCES gewohnheiten(id) ON DELETE CASCADE,
  datum         TEXT NOT NULL,
  menge         INTEGER NOT NULL DEFAULT 0,
  ziel_damals   INTEGER,
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (gewohnheit_id, datum)
);

-- Eine Fokus-Sitzung. `echte_min` und `vollstaendig` sind NULL, solange sie
-- laeuft - daran erkennt die App beim naechsten Oeffnen, dass da noch etwas
-- offen ist.
--
-- Gerechnet wird immer aus `gestartet_am`, nie aus einem mitlaufenden Zaehler
-- im Browser. Nur so ueberlebt eine Sitzung Reload, Handysperre und
-- Geraetewechsel.
CREATE TABLE IF NOT EXISTS fokus_sitzungen (
  id                TEXT PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gestartet_am      TEXT NOT NULL,        -- UTC, 'YYYY-MM-DD HH:MM:SS'
  datum             TEXT NOT NULL,        -- lokales Datum des Clients
  geplante_min      INTEGER NOT NULL,
  pausiert_seit     TEXT,                 -- gesetzt = laeuft gerade nicht
  pause_gesamt_sek  INTEGER NOT NULL DEFAULT 0,
  echte_min         INTEGER,
  vollstaendig      INTEGER,
  -- Optional: auf diese Gewohnheit werden die Fokusminuten beim Beenden
  -- gebucht (siehe migration-sitzung-gewohnheit.sql). SET NULL statt CASCADE -
  -- eine geloeschte Gewohnheit soll die Sitzung nicht mitnehmen, die Minuten
  -- sind unabhaengig davon gelaufen.
  gewohnheit_id     TEXT REFERENCES gewohnheiten(id) ON DELETE SET NULL
);

-- Standarddauer, damit man im Alltag nur "Start" druecken muss - und die
-- Zaehlweise der Flamme (siehe migration-flammen-modus.sql).
CREATE TABLE IF NOT EXISTS fokus_einstellungen (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  arbeit_min    INTEGER NOT NULL DEFAULT 25,
  flammen_modus TEXT NOT NULL DEFAULT 'absolut'
                CHECK (flammen_modus IN ('absolut', 'reihe'))
);

CREATE INDEX IF NOT EXISTS idx_gew_user   ON gewohnheiten(user_id, archiviert, position);
CREATE INDEX IF NOT EXISTS idx_logs_datum ON gewohnheit_logs(gewohnheit_id, datum);
CREATE INDEX IF NOT EXISTS idx_fokus_user ON fokus_sitzungen(user_id, datum);
