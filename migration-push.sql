-- Migration: Push-Benachrichtigungen (offene Gewohnheiten heute)
--
-- Eigene Tabelle statt Mitbenutzung von ToDo's `push_subscriptions`: ein
-- Push-Endpunkt ist pro Browser-Herkunft eindeutig (Fokus und ToDo laufen auf
-- verschiedenen Domains), aber ToDo's Cron-Job (/api/push/pruefen) waehlt
-- Abo-Zeilen allein ueber user_id aus - laege eine Fokus-Anmeldung in
-- derselben Tabelle, koennte ein faelliges ToDo eine Push-Nachricht an das
-- Fokus-Icon schicken (falscher Service Worker, falscher Inhalt).
--
-- Sonst strukturgleich zu ToDo's migration-push.sql: endpoint ist pro
-- Geraet/Browser eindeutig und damit der Primaerschluessel fuer "gleiches
-- Geraet meldet sich erneut an".
--
-- REIN ADDITIV: nur CREATE TABLE / CREATE INDEX. Kein DROP, keine Cascade-
-- Gefahr.
--
-- EINMALIG ausfuehren:
--   npx wrangler d1 execute todo --remote --file=migration-push.sql

CREATE TABLE fokus_push_subscriptions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_fokus_push_subs_user ON fokus_push_subscriptions(user_id);
