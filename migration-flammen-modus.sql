-- Nachtraeglich: Zaehlweise der Flamme, umschaltbar in den Einstellungen.
-- Additiv gegen die bereits produktiv laufende `fokus_einstellungen`-Tabelle.
--
-- 'absolut' = an wie vielen Tagen die Gewohnheit erledigt wurde (Stand seit
-- dem 14.08.2026, deshalb der Default - bestehende Zeilen behalten damit
-- genau das Verhalten, das sie vorher schon hatten).
-- 'reihe'   = Tage am Stueck, ein Fehltag setzt auf null.
--
-- Einspielen: Cloudflare-Dashboard -> D1 -> todo -> Konsole, oder
--   npx wrangler d1 execute todo --remote --file=migration-flammen-modus.sql

ALTER TABLE fokus_einstellungen ADD COLUMN flammen_modus TEXT NOT NULL
  DEFAULT 'absolut' CHECK (flammen_modus IN ('absolut', 'reihe'));
