/**
 * Sich selbst Zugang zur ToDo-Liste holen.
 *
 * Setzt todo_zugang=1 fuer das eigene, bereits angemeldete Konto - kein
 * Admin noetig. Gespiegelt aus ToDo/web/functions/api/auth/fokus-zugang.js,
 * dort steht die ausfuehrliche Begruendung.
 *
 * Kein Mailversand hier noetig: die Sitzung gilt schon fuer beide Apps
 * (geteiltes Cookie), ein Klick auf todo.it-wolf.org reicht danach sofort.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    await env.DB.prepare("UPDATE users SET todo_zugang = 1 WHERE id = ?").bind(nutzerId).run();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
  return json({ ok: true });
}
