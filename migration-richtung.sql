-- Nachtraeglich: Richtung je Mengen-Gewohnheit ('mindestens' das bisherige
-- Verhalten, 'hoechstens' fuer eine Obergrenze wie "Instagram-Minuten").
-- Additiv gegen die bereits produktiv laufende `gewohnheiten`-Tabelle - der
-- Default haelt alle bestehenden Zeilen automatisch bei 'mindestens'.
--
-- Einspielen: Cloudflare-Dashboard -> D1 -> todo -> Konsole, oder
--   npx wrangler d1 execute todo --remote --file=migration-richtung.sql

ALTER TABLE gewohnheiten ADD COLUMN richtung TEXT NOT NULL DEFAULT 'mindestens'
  CHECK (richtung IN ('mindestens', 'hoechstens'));
