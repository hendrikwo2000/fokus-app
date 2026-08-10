/**
 * Fokus-Sitzung starten.
 *
 * Ohne `geplanteMin` gilt die Standarddauer aus den Einstellungen - das ist der
 * Alltagsfall: aufmachen, Start druecken, arbeiten.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { pruefeHeute } from "../../_lib/tag.js";
import {
  offeneSitzung, beendeSitzung, arbeitMinVon, alsOffeneSitzung, MIN_DAUER, MAX_DAUER,
} from "../../_lib/fokus.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const heute = String(body?.heute || "");
  const meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  try {
    let geplant = body?.geplanteMin === undefined || body?.geplanteMin === null
      ? await arbeitMinVon(env, nutzerId)
      : Number(body.geplanteMin);
    if (!Number.isInteger(geplant) || geplant < MIN_DAUER || geplant > MAX_DAUER) {
      return json({ error: `Die Dauer muss zwischen ${MIN_DAUER} und ${MAX_DAUER} Minuten liegen.` }, 400);
    }

    // Optional: auf diese Gewohnheit werden die Minuten beim Beenden gebucht.
    // Eine Obergrenze ist ausgeschlossen - Fokusminuten auf ein Limit zu buchen
    // hiesse, sich fuer konzentriertes Arbeiten einen schlechteren Tag
    // einzutragen. Archivierte genauso wenig: die sind aus dem Alltag raus.
    const gewohnheitId = String(body?.gewohnheitId || "") || null;
    if (gewohnheitId) {
      const g = await env.DB.prepare(
        "SELECT typ, richtung, archiviert FROM gewohnheiten WHERE id = ? AND user_id = ?"
      ).bind(gewohnheitId, nutzerId).first();
      if (!g) return json({ error: "Gewohnheit nicht gefunden" }, 404);
      if (g.archiviert) return json({ error: "Diese Gewohnheit ist archiviert." }, 400);
      if (g.typ === "menge" && g.richtung === "hoechstens") {
        return json({ error: "Auf eine Obergrenze lassen sich keine Fokusminuten buchen." }, 400);
      }
    }

    // Eine noch offene Sitzung sauber abschliessen, statt sie liegen zu lassen.
    // Sonst haetten wir zwei offene, und "die eine laufende Sitzung" waere eine
    // Luege - beendeSitzung deckelt sie ohnehin auf ihre geplante Dauer.
    const alt = await offeneSitzung(env, nutzerId);
    let beendet = null;
    if (alt) beendet = await beendeSitzung(env, alt);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO fokus_sitzungen (id, user_id, gestartet_am, datum, geplante_min, gewohnheit_id)
       VALUES (?, ?, datetime('now'), ?, ?, ?)`
    ).bind(id, nutzerId, heute, geplant, gewohnheitId).run();

    const neu = await offeneSitzung(env, nutzerId);
    return json({
      ok: true,
      offen: neu ? alsOffeneSitzung(neu) : null,
      // Damit die App sagen kann "die alte Sitzung habe ich mit 25 Min
      // abgeschlossen", statt sie kommentarlos verschwinden zu lassen.
      vorherBeendet: beendet,
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Starten" }, 500);
  }
}
