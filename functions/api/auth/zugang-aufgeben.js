/**
 * Eigenen Fokus-Zugang aufgeben - ohne die Gewohnheiten/Historie zu loeschen.
 *
 * Die Daten bleiben unangetastet, nur der Zugang ist weg. Wer zurueck will,
 * meldet sich einfach erneut an - der naechste Login-Versuch schaltet
 * automatisch wieder frei (siehe request-code.js). Anders als beim
 * ToDo-Zugang (siehe dortiges zugang-aufgeben.js) keine Admin-Sperre noetig:
 * der Fokus-Tracker kennt keine eigene Adminrolle, es gibt hier kein
 * Aussperr-Risiko.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    await env.DB.prepare("UPDATE users SET fokus_zugang = 0 WHERE id = ?").bind(nutzerId).run();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
  return json({ ok: true });
}
