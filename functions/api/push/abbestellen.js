/**
 * Push-Abo eines Geraets loeschen (Schalter in den Einstellungen ausschalten).
 *
 * Loescht nur, wenn der Endpunkt wirklich dem angemeldeten Nutzer gehoert -
 * sonst koennte jemand fremde Abos erraten und stillegen.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "Ungueltiges JSON" }, 400);
  }

  const endpoint = body && body.endpoint;
  if (typeof endpoint !== "string" || !endpoint) {
    return json({ error: "Kein Endpunkt angegeben" }, 400);
  }

  try {
    await env.DB.prepare(
      "DELETE FROM fokus_push_subscriptions WHERE endpoint = ? AND user_id = ?"
    ).bind(endpoint, nutzerId).run();
  } catch (e) {
    return json({ error: "Datenbankfehler beim Loeschen" }, 500);
  }

  return json({ ok: true });
}
