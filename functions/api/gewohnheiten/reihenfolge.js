/**
 * Die Reihenfolge der Gewohnheiten setzen.
 *
 * Die Spalte `position` gab es von Anfang an (ORDER BY archiviert, position,
 * created_at), gesetzt wurde sie aber nur beim Anlegen - die Liste stand also
 * fuer immer in der Reihenfolge, in der man sie angelegt hat.
 *
 * Der Client schickt alle IDs in der gewuenschten Reihenfolge, nicht "schiebe
 * X um eins nach oben". Ein Tausch waere zwei Anfragen und liesse sich beim
 * schnellen Tippen verschachteln; eine vollstaendige Liste ist immer eindeutig.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";

export async function onRequestPut({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const ids = Array.isArray(body?.ids) ? body.ids.map(String) : null;
  if (!ids || !ids.length) return json({ error: "Keine Reihenfolge angegeben" }, 400);
  if (new Set(ids).size !== ids.length) {
    return json({ error: "Dieselbe Gewohnheit steht doppelt in der Reihenfolge." }, 400);
  }

  try {
    // Gegen die eigenen Zeilen pruefen, bevor irgendetwas geschrieben wird.
    // Ohne das koennte jemand per curl die Position einer fremden Gewohnheit
    // setzen - die UPDATEs unten filtern zwar auf user_id, aber dann waere die
    // Antwort ein stilles "ok" ueber eine Aenderung, die nie passiert ist.
    const eigene = new Set((await env.DB.prepare(
      "SELECT id FROM gewohnheiten WHERE user_id = ?"
    ).bind(nutzerId).all()).results.map(z => z.id));

    if (ids.some(id => !eigene.has(id))) {
      return json({ error: "Gewohnheit nicht gefunden" }, 404);
    }

    // batch() laeuft als eine Transaktion - eine halb sortierte Liste kann es
    // also nicht geben.
    await env.DB.batch(ids.map((id, i) => env.DB.prepare(
      "UPDATE gewohnheiten SET position = ? WHERE id = ? AND user_id = ?"
    ).bind(i, id, nutzerId)));

    return json({ ok: true });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Sortieren" }, 500);
  }
}
