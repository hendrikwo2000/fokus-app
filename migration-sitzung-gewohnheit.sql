-- Nachtraeglich: eine Fokus-Sitzung kann auf eine Gewohnheit gebucht werden.
-- Beim Beenden landen die Fokusminuten dann direkt bei ihr ("60 Min lesen"),
-- statt dass man sie von Hand nachtippt.
--
-- ON DELETE SET NULL, nicht CASCADE: loescht man die Gewohnheit, soll die
-- Sitzung erhalten bleiben - die Fokusminuten sind unabhaengig davon gelaufen
-- und stehen in der Wochenstatistik.
--
-- Additiv gegen die bereits produktiv laufende Tabelle. Bestehende Zeilen
-- bekommen NULL, also "auf nichts gebucht" - das bisherige Verhalten.
--
-- Einspielen: Cloudflare-Dashboard -> D1 -> todo -> Konsole, oder
--   npx wrangler d1 execute todo --remote --file=migration-sitzung-gewohnheit.sql

ALTER TABLE fokus_sitzungen ADD COLUMN gewohnheit_id TEXT
  REFERENCES gewohnheiten(id) ON DELETE SET NULL;
