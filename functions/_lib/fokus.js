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
 */

// Erlaubte Sitzungsdauer. Untergrenze 1 Minute (zum Ausprobieren), Obergrenze
// 3 Stunden - laenger ist keine Fokus-Sitzung mehr, und die Deckelung in
// beendeSitzung soll ein Versehen auffangen koennen.
export const MIN_DAUER = 1;
export const MAX_DAUER = 180;

// Verstrichene Fokuszeit = seit dem Start vergangen, minus abgeschlossene
// Pausen, minus die gerade laufende Pause.
const SITZUNG_SPALTEN = `
  id, geplante_min, datum, pause_gesamt_sek, pausiert_seit, gewohnheit_id,
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
    gewohnheitId: zeile.gewohnheit_id || null,
  };
}

/**
 * Die Fokusminuten einer beendeten Sitzung bei ihrer Gewohnheit gutschreiben.
 *
 * Gebucht wird auf `sitzung.datum` - das lokale Datum vom START der Sitzung.
 * Eine Sitzung, die ueber Mitternacht laeuft, zaehlt also fuer den Tag, an dem
 * sie begonnen hat; alles andere waere nicht zu erklaeren.
 *
 * Addiert wird auf den vorhandenen Stand, nicht gesetzt: zwei Sitzungen am
 * selben Tag ergeben zusammen 50 Minuten, und was vorher von Hand eingetragen
 * wurde, bleibt stehen. Bei einer Abhaken-Gewohnheit gibt es nichts zu
 * addieren, dort setzt eine Sitzung schlicht das Haekchen.
 *
 * Eine Obergrenze kommt hier nicht an (start.js laesst sie gar nicht erst zu):
 * Fokusminuten auf ein Limit zu buchen hiesse, sich fuer konzentriertes
 * Arbeiten einen schlechteren Tag einzutragen.
 */
async function schreibeGutschrift(env, sitzung, echteMin) {
  if (!sitzung.gewohnheit_id || echteMin <= 0) return null;

  const gewohnheit = await env.DB.prepare(
    "SELECT id, name, typ, zielmenge, einheit, richtung FROM gewohnheiten WHERE id = ?"
  ).bind(sitzung.gewohnheit_id).first();
  // Weg oder inzwischen zur Obergrenze umgebaut: still nichts tun. Die Sitzung
  // selbst ist da schon abgeschlossen, sie soll daran nicht scheitern.
  if (!gewohnheit || (gewohnheit.typ === "menge" && gewohnheit.richtung === "hoechstens")) {
    return null;
  }

  const vorher = await env.DB.prepare(
    "SELECT menge FROM gewohnheit_logs WHERE gewohnheit_id = ? AND datum = ?"
  ).bind(gewohnheit.id, sitzung.datum).first();

  const neu = gewohnheit.typ === "binaer" ? 1 : (vorher ? vorher.menge : 0) + echteMin;

  // Dasselbe UPSERT wie in api/gewohnheiten/log.js, inklusive der Regel, dass
  // ziel_damals nur beim Anlegen gesetzt wird.
  await env.DB.prepare(
    `INSERT INTO gewohnheit_logs (gewohnheit_id, datum, menge, ziel_damals)
          VALUES (?, ?, ?, ?)
     ON CONFLICT(gewohnheit_id, datum)
     DO UPDATE SET menge = excluded.menge, updated_at = datetime('now')`
  ).bind(gewohnheit.id, sitzung.datum, neu, gewohnheit.zielmenge).run();

  return {
    id: gewohnheit.id,
    name: gewohnheit.name,
    typ: gewohnheit.typ,
    einheit: gewohnheit.einheit,
    menge: neu,
    gutgeschrieben: gewohnheit.typ === "binaer" ? null : echteMin,
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

  // Auch bei einer abgebrochenen Sitzung: 18 gearbeitete Minuten sind 18
  // Minuten, egal ob 25 geplant waren. Dieselbe Lesart wie in der
  // Wochenstatistik, die abgebrochene Sitzungen ebenfalls mitzaehlt.
  const gutschrift = await schreibeGutschrift(env, zeile, echteMin);

  return {
    id: zeile.id,
    echteMin,
    vollstaendig: vollstaendig === 1,
    geplanteMin: zeile.geplante_min,
    gutschrift,
  };
}

// Standarddauer des Nutzers. Ohne eigene Zeile die 25 Minuten aus dem Schema -
// so muss niemand erst etwas einstellen, bevor er zum ersten Mal startet.
export async function arbeitMinVon(env, nutzerId) {
  const zeile = await env.DB.prepare(
    "SELECT arbeit_min FROM fokus_einstellungen WHERE user_id = ?"
  ).bind(nutzerId).first();
  return zeile ? zeile.arbeit_min : 25;
}
