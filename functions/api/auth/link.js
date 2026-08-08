/**
 * Anmeldelink aus der Mail einloesen.
 *
 * Ein Klick, Sitzung, fertig - kein Code abtippen. Der Code in derselben Mail
 * bleibt als Ausweg fuer den Geraetewechsel; beide Wege zeigen auf denselben
 * Datenbankeintrag, was zuerst benutzt wird, verbraucht beide.
 *
 * Antwortet mit einer Weiterleitung statt JSON: der Aufruf kommt aus einem
 * Mailprogramm, nicht aus der App.
 *
 * login_codes ist mit der ToDo-Liste geteilt - ein dort angeforderter oder
 * per Willkommensmail verschickter Link kann also auch hier landen (z. B. ein
 * reines ToDo-Konto, dessen Willkommensmail ueber die ToDo-Liste verschickt
 * wurde). Genau wie beim Anfordern eines Codes (request-code.js) gilt: ein
 * gueltiger Link IST der Login-Versuch, der fokus_zugang gleich mit setzt -
 * kein separater "gesperrt"-Fall mehr noetig.
 */

import { hashHex, neuesToken, setzeSessionCookies, mitCookies, SESSION_ABLAUF_SQL } from "../../_lib/session.js";

function weiter(ziel, cookies = []) {
  return new Response(null, {
    status: 302,
    headers: mitCookies({ Location: ziel, "Cache-Control": "no-store" }, cookies),
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!env.DB) return weiter("/?login=fehler");

  const token = url.searchParams.get("t") || "";
  if (!token) return weiter("/?login=fehler");

  try {
    const eintrag = await env.DB.prepare(
      `SELECT id, email FROM login_codes
        WHERE token_hash = ? AND expires_at > datetime('now')`
    ).bind(await hashHex(token)).first();
    // Abgelaufen oder schon benutzt: zurueck zur Anmeldung mit Hinweis, statt
    // einer nackten Fehlerseite.
    if (!eintrag) return weiter("/?login=abgelaufen");

    const nutzer = await env.DB.prepare("SELECT id, fokus_zugang FROM users WHERE email = ?")
      .bind(eintrag.email).first();
    if (!nutzer) return weiter("/?login=fehler");
    if (!nutzer.fokus_zugang) {
      await env.DB.prepare("UPDATE users SET fokus_zugang = 1 WHERE id = ?").bind(nutzer.id).run();
    }

    const sitzung = neuesToken();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM login_codes WHERE id = ?").bind(eintrag.id),
      env.DB.prepare(
        `INSERT INTO sessions (token_hash, user_id, expires_at)
         VALUES (?, ?, ${SESSION_ABLAUF_SQL})`
      ).bind(await hashHex(sitzung), nutzer.id),
    ]);

    return weiter("/", setzeSessionCookies(request, sitzung));
  } catch (e) {
    return weiter("/?login=fehler");
  }
}
