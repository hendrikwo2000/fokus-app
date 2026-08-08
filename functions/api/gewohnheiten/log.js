/**
 * Einen einzelnen Tag setzen - der meistbenutzte Endpunkt der App.
 *
 * Derselbe Weg fuer heute und fuer jeden Tag davor. Genau das ist der Kern des
 * Nachtragens: ein gelber Montag wird gruen, indem man ihn auf die volle Menge
 * setzt. Es gibt keinen Uebertrag von heute auf gestern - jeder Tag steht fuer
 * sich, und die Zahl im Verlauf ist die, die an dem Tag wirklich zusammenkam.
 *
 * Antwortet mit der neu berechneten Straehne, damit die App nicht alles neu
 * laden muss, um eine Zahl zu aktualisieren.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { pruefeHeute, pruefeLogDatum, tagPlus, status, straehneFuer } from "../../_lib/tag.js";

const LOG_TAGE = 730;

export async function onRequestPut({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const heute = String(body?.heute || "");
  let meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  const datum = String(body?.datum || "");
  meldung = pruefeLogDatum(datum, heute);
  if (meldung) return json({ error: meldung }, 400);

  const id = String(body?.gewohnheitId || "");
  if (!id) return json({ error: "Keine Gewohnheit angegeben" }, 400);

  const menge = Number(body?.menge);
  if (!Number.isInteger(menge) || menge < 0) {
    return json({ error: "Die Menge muss eine ganze Zahl ab 0 sein." }, 400);
  }

  try {
    const gewohnheit = await env.DB.prepare(
      `SELECT id, typ, zielmenge, richtung, rhythmus, wochentage_maske, wochenziel
         FROM gewohnheiten WHERE id = ? AND user_id = ?`
    ).bind(id, nutzerId).first();
    if (!gewohnheit) return json({ error: "Gewohnheit nicht gefunden" }, 404);

    // Binaer kennt nur 0 und 1 - alles andere waere eine Menge ohne Bedeutung.
    const wert = gewohnheit.typ === "binaer" ? (menge >= 1 ? 1 : 0) : menge;

    if (wert === 0) {
      // Null wird nicht gespeichert, sondern geloescht. "Offen" ist die
      // Abwesenheit eines Eintrags - so bleibt der Unterschied zwischen
      // "nichts gemacht" und "nie angefasst" gar nicht erst entstehen.
      await env.DB.prepare(
        "DELETE FROM gewohnheit_logs WHERE gewohnheit_id = ? AND datum = ?"
      ).bind(id, datum).run();
    } else {
      // ziel_damals wird beim Anlegen gesetzt und danach NICHT mehr angefasst
      // (kein ziel_damals in DO UPDATE). Traegst du einen alten Tag nach,
      // zaehlt das Ziel, das an dem Tag galt - nicht das von heute.
      await env.DB.prepare(
        `INSERT INTO gewohnheit_logs (gewohnheit_id, datum, menge, ziel_damals)
              VALUES (?, ?, ?, ?)
         ON CONFLICT(gewohnheit_id, datum)
         DO UPDATE SET menge = excluded.menge, updated_at = datetime('now')`
      ).bind(id, datum, wert, gewohnheit.zielmenge).run();
    }

    // Straehne frisch rechnen. Ein eigener Aufruf, weil sich durch einen
    // nachgetragenen Tag mitten in der Kette weit mehr aendern kann als nur
    // der eine Tag - genau das ist ja der Sinn des rueckwirkenden Heilens.
    const alle = (await env.DB.prepare(
      `SELECT datum, menge, ziel_damals FROM gewohnheit_logs
        WHERE gewohnheit_id = ? AND datum >= ?`
    ).bind(id, tagPlus(heute, -LOG_TAGE)).all()).results;

    const gruene = new Set();
    let neuerStatus = "offen";
    let zielDesTages = gewohnheit.zielmenge;
    for (const l of alle) {
      const ziel = l.ziel_damals != null ? l.ziel_damals : gewohnheit.zielmenge;
      const st = status(gewohnheit.typ, l.menge, ziel, gewohnheit.richtung);
      if (st === "erledigt") gruene.add(l.datum);
      if (l.datum === datum) {
        neuerStatus = st;
        zielDesTages = ziel;
      }
    }

    return json({
      ok: true,
      datum,
      menge: wert,
      ziel: zielDesTages,
      status: neuerStatus,
      straehne: straehneFuer(gewohnheit, gruene, heute),
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}
