/**
 * Schritt 2 des Logins: Code pruefen, Sitzung anlegen.
 *
 * Die Sitzung gilt fuer beide Apps - `sessions` und das Cookie sind geteilt.
 * Wer sich hier anmeldet, ist danach auch in der ToDo-Liste drin, und
 * umgekehrt. Das ist gewollt: es ist EIN Konto.
 *
 * Die Zugangspruefung steht trotzdem hier, obwohl sie nichts abschottet, was
 * die Daten-Endpunkte nicht ohnehin pruefen. Sie sorgt nur fuer eine ehrliche
 * Meldung: lieber "nicht freigeschaltet" an der Maske als eine erfolgreiche
 * Anmeldung, die gleich danach an jeder Ansicht abprallt.
 */

import { hashHex, zeitgleich, neuesToken, setzeSessionCookies, SESSION_ABLAUF_SQL } from "../../_lib/session.js";
import { json, liesJson } from "../../_lib/antwort.js";

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  const { body, fehler } = await liesJson(request);
  if (fehler) return fehler;

  const email = String(body?.email || "").trim().toLowerCase();
  const code = String(body?.code || "").trim();
  if (!email || !/^\d{6}$/.test(code)) return json({ error: "Ungueltige Eingabe" }, 400);

  try {
    const nutzer = await env.DB.prepare("SELECT id, fokus_zugang FROM users WHERE email = ?").bind(email).first();
    // Ab hier bleibt die Meldung generisch: wer schon einen Code eintippt,
    // kennt die Adresse ohnehin. Was er nicht erfahren soll, ist WARUM es
    // nicht klappt - das hilft beim Durchraten von Codes.
    if (!nutzer) return json({ error: "Falscher oder abgelaufener Code" }, 401);
    // fokus_zugang kann zwischen Codeversand und Einloesen entzogen worden
    // sein (selten, aber die Pruefung ist billig) - lieber hier noch einmal
    // ehrlich absagen als eine Sitzung fuer ein gesperrtes Konto anzulegen.
    if (!nutzer.fokus_zugang) {
      return json({ error: "Diese Adresse ist für den Fokus-Tracker nicht freigeschaltet." }, 403);
    }

    const eintrag = await env.DB.prepare(
      `SELECT id, code_hash, attempts FROM login_codes
        WHERE email = ? AND expires_at > datetime('now')
        ORDER BY created_at DESC LIMIT 1`
    ).bind(email).first();
    if (!eintrag) return json({ error: "Falscher oder abgelaufener Code" }, 401);
    if (eintrag.attempts >= 5) {
      return json({ error: "Zu viele Versuche - fordere einen neuen Code an" }, 401);
    }

    const hash = await hashHex(code);
    if (!zeitgleich(hash, eintrag.code_hash)) {
      await env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?")
        .bind(eintrag.id).run();
      return json({ error: "Falscher oder abgelaufener Code" }, 401);
    }

    // Verbraucht - loeschen, damit derselbe Code nicht zweimal funktioniert.
    await env.DB.prepare("DELETE FROM login_codes WHERE id = ?").bind(eintrag.id).run();

    const token = neuesToken();
    await env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, expires_at)
       VALUES (?, ?, ${SESSION_ABLAUF_SQL})`
    ).bind(await hashHex(token), nutzer.id).run();

    return json({ ok: true }, 200, setzeSessionCookies(request, token));
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
}
