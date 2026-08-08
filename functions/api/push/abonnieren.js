/**
 * Push-Abo eines Geraets speichern (oder erneuern).
 *
 * Body: die PushSubscription des Browsers, roh weitergereicht:
 * { endpoint, keys: { p256dh, auth } }. endpoint ist pro Geraet/Browser
 * eindeutig - meldet sich dasselbe Geraet erneut (z. B. nach Neuinstallation),
 * wird die bestehende Zeile ersetzt statt verdoppelt.
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
  const keys = body && body.keys;
  if (typeof endpoint !== "string" || !endpoint
      || !keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") {
    return json({ error: "Ungueltiges Push-Abo" }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO fokus_push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
    ).bind(nutzerId, endpoint, keys.p256dh, keys.auth).run();
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }

  return json({ ok: true });
}
