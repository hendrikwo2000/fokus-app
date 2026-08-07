-- Nachtraeglich: Wiederholungs-Rhythmus je Gewohnheit (taeglich / feste
-- Wochentage / X Mal die Woche). Additiv gegen die bereits produktiv
-- laufende `gewohnheiten`-Tabelle - der Default haelt alle bestehenden
-- Zeilen automatisch bei 'taeglich', ohne dass ein Backfill noetig waere.
--
-- Einspielen: Cloudflare-Dashboard -> D1 -> todo -> Konsole, oder
--   npx wrangler d1 execute todo --remote --file=migration-rhythmus.sql

ALTER TABLE gewohnheiten ADD COLUMN rhythmus TEXT NOT NULL DEFAULT 'taeglich'
  CHECK (rhythmus IN ('taeglich', 'wochentage', 'x_pro_woche'));

-- Bitmaske, Bit i = Wochentag i aus ["Mo","Di","Mi","Do","Fr","Sa","So"]
-- (Mo=1, Di=2, Mi=4, Do=8, Fr=16, Sa=32, So=64). Nur gesetzt bei
-- rhythmus='wochentage'. Dieselbe Wochentag-Indizierung wie montagVon().
ALTER TABLE gewohnheiten ADD COLUMN wochentage_maske INTEGER;

-- Tage pro Woche (1-7). Nur gesetzt bei rhythmus='x_pro_woche'.
ALTER TABLE gewohnheiten ADD COLUMN wochenziel INTEGER;
