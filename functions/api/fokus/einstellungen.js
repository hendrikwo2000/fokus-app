/**
 * Standarddauer aendern.
 *
 * Eine laufende Sitzung bleibt davon unberuehrt - sie hat ihre geplante Dauer
 * beim Start mitbekommen. Waere es anders, wuerde ein Verstellen mitten in der
 * Arbeit den Countdown springen lassen.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { MIN_DAUER, MAX_DAUER } from "../../_lib/fokus.js";

export async function onRequestPut({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const arbeitMin = Number(body?.arbeitMin);
  if (!Number.isInteger(arbeitMin) || arbeitMin < MIN_DAUER || arbeitMin > MAX_DAUER) {
    return json({ error: `Die Dauer muss zwischen ${MIN_DAUER} und ${MAX_DAUER} Minuten liegen.` }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO fokus_einstellungen (user_id, arbeit_min) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET arbeit_min = excluded.arbeit_min`
    ).bind(nutzerId, arbeitMin).run();
    return json({ ok: true, arbeitMin });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}
