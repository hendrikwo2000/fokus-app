/**
 * Gemeinsames rund um die Fokus-Sitzungen.
 *
 * WARUM DIE ZEIT IN SQL GERECHNET WIRD
 * SQLite gibt Zeitstempel als 'YYYY-MM-DD HH:MM:SS' ohne Zonen-Suffix zurueck -
 * und `new Date("2026-08-07 12:00:00")` liest JavaScript als LOKALE Zeit,
 * obwohl UTC gemeint ist. Auf einem Worker in UTC faellt das nie auf, beim
 * Testen in Deutschland waeren es zwei Stunden daneben. strftime('%s', ...)
 * umgeht die Falle: die Differenz entsteht dort, wo auch der Zeitstempel
 * entstanden ist.
 *
 * WARUM NICHT IM BROWSER MITGEZAEHLT WIRD
 * Der Countdown auf dem Bildschirm ist reine Anzeige. Gerechnet wird immer aus
 * `gestartet_am`. Nur so ueberlebt eine Sitzung Reload, Handysperre,
 * Verbindungsabbruch und Geraetewechsel - und genau das war die Vorgabe.
 *
 * Hier liegen ausserdem die persoenlichen Einstellungen (einstellungenVon),
 * weil sie in derselben Tabelle stehen - inzwischen auch die Zaehlweise der
 * Flamme, die mit dem Timer nichts zu tun hat.
 */

import { FLAMMEN_MODUS_STANDARD } from "./tag.js";

// Erlaubte Sitzungsdauer. Untergrenze 1 Minute (zum Ausprobieren), Obergrenze
// 3 Stunden - laenger ist keine Fokus-Sitzung mehr, und die Deckelung in
// beendeSitzung soll ein Versehen auffangen koennen.
export const MIN_DAUER = 1;
export const MAX_DAUER = 180;

// Verstrichene Fokuszeit = seit dem Start vergangen, minus abgeschlossene
// Pausen, minus die gerade laufende Pause.
const SITZUNG_SPALTEN = `
  id, geplante_min, datum, pause_gesamt_sek, pausiert_seit,
  CAST(strftime('%s','now') - strftime('%s', gestartet_am) AS INTEGER) AS seit_start_sek,
  CASE WHEN pausiert_seit IS NULL THEN 0
       ELSE CAST(strftime('%s','now') - strftime('%s', pausiert_seit) AS INTEGER)
  END AS pause_laufend_sek
`;

// Die eine offene Sitzung des Nutzers, oder null. Es kann hoechstens eine
// geben - start.js beendet eine aeltere, bevor es eine neue anlegt.
export async function offeneSitzung(env, nutzerId) {
  return await env.DB.prepare(
    `SELECT ${SITZUNG_SPALTEN} FROM fokus_sitzungen
      WHERE user_id = ? AND echte_min IS NULL
      ORDER BY gestartet_am DESC LIMIT 1`
  ).bind(nutzerId).first();
}

export function verstricheneSek(zeile) {
  const roh = zeile.seit_start_sek - zeile.pause_gesamt_sek - zeile.pause_laufend_sek;
  return Math.max(0, roh);
}

// Was die App braucht, um den Countdown selbst zu zeichnen.
export function alsOffeneSitzung(zeile) {
  return {
    id: zeile.id,
    geplanteMin: zeile.geplante_min,
    datum: zeile.datum,
    verstrichenSek: verstricheneSek(zeile),
    pausiert: zeile.pausiert_seit !== null,
  };
}

/**
 * Sitzung abschliessen und ins Log schreiben.
 *
 * Die tatsaechliche Dauer wird bei der GEPLANTEN gedeckelt. Das ist der Grund,
 * warum es keine Zeitueberschreitungs-Regel braucht: vergisst man eine Sitzung
 * und meldet sich abends wieder, stehen trotzdem 25 Minuten im Log und nicht
 * fuenf Stunden. Eine 25-Minuten-Sitzung kann nun mal keine 300 Fokusminuten
 * hervorbringen.
 */
export async function beendeSitzung(env, zeile) {
  const sek = verstricheneSek(zeile);
  const geplantSek = zeile.geplante_min * 60;
  const vollstaendig = sek >= geplantSek ? 1 : 0;
  const echteMin = Math.min(Math.round(sek / 60), zeile.geplante_min);

  await env.DB.prepare(
    "UPDATE fokus_sitzungen SET echte_min = ?, vollstaendig = ?, pausiert_seit = NULL WHERE id = ?"
  ).bind(echteMin, vollstaendig, zeile.id).run();

  return {
    id: zeile.id,
    echteMin,
    vollstaendig: vollstaendig === 1,
    geplanteMin: zeile.geplante_min,
  };
}

/**
 * Die persoenlichen Einstellungen. Ohne eigene Zeile die Vorgaben aus dem
 * Schema - so muss niemand erst etwas einstellen, bevor er zum ersten Mal
 * startet.
 *
 * Eine Abfrage fuer beide Werte: `flammen_modus` steckt in derselben Zeile,
 * und die Flammen-Endpunkte brauchen ihn bei jedem Aufruf.
 */
export async function einstellungenVon(env, nutzerId) {
  const zeile = await env.DB.prepare(
    "SELECT arbeit_min, flammen_modus FROM fokus_einstellungen WHERE user_id = ?"
  ).bind(nutzerId).first();
  return {
    arbeitMin: zeile ? zeile.arbeit_min : 25,
    flammenModus: (zeile && zeile.flammen_modus) || FLAMMEN_MODUS_STANDARD,
  };
}

// Standarddauer allein - der haeufigere Fall in den Timer-Pfaden.
export async function arbeitMinVon(env, nutzerId) {
  return (await einstellungenVon(env, nutzerId)).arbeitMin;
}

// Zaehlweise der Flamme allein - fuer die drei Gewohnheiten-Endpunkte.
export async function flammenModusVon(env, nutzerId) {
  return (await einstellungenVon(env, nutzerId)).flammenModus;
}
