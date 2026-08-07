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

    // Eine noch offene Sitzung sauber abschliessen, statt sie liegen zu lassen.
    // Sonst haetten wir zwei offene, und "die eine laufende Sitzung" waere eine
    // Luege - beendeSitzung deckelt sie ohnehin auf ihre geplante Dauer.
    const alt = await offeneSitzung(env, nutzerId);
    let beendet = null;
    if (alt) beendet = await beendeSitzung(env, alt);

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO fokus_sitzungen (id, user_id, gestartet_am, datum, geplante_min)
       VALUES (?, ?, datetime('now'), ?, ?)`
    ).bind(id, nutzerId, heute, geplant).run();

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
