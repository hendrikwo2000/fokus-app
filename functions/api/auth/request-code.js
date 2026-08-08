/**
 * Schritt 1 des Logins: Code per Mail verschicken.
 *
 * Gespiegelt aus der ToDo-Liste, mit einem Unterschied: hier muss die Adresse
 * zusaetzlich fokus_zugang=1 haben (eigene Berechtigung, unabhaengig vom
 * ToDo-Konto - siehe schema.sql). Die Pruefung sitzt VOR dem Versand, damit an
 * fremde oder nicht freigeschaltete Adressen gar keine Mail rausgeht.
 *
 * Zwei verschiedene Absagen, bewusst unterschieden: 404 "kein Konto" (die
 * Adresse taucht ueberhaupt nicht in users auf - das Frontend wechselt dann in
 * den Wartelisten-Schritt, genau wie in der ToDo-Liste) gegen 403 "nicht
 * freigeschaltet" (ein Konto existiert, hat aber kein fokus_zugang - dafuer
 * hilft kein erneutes Eintragen, sondern nur die Freischaltung im Dashboard).
 *
 * Kein Turnstile hier, anders als bei der ToDo-Warteliste - dieselbe
 * Abwaegung wie dort am Anfang: das Ein-Eintrag-pro-Minute-Limit reicht als
 * erste Bremse, ein Widget kann bei Bedarf spaeter dazukommen.
 */

import { hashHex, neuesToken } from "../../_lib/session.js";
import { sendeMail, huelle, absatz, kasten, knopf, fussnote } from "../../_lib/mail.js";
import { json, liesJson } from "../../_lib/antwort.js";

const GUELTIG_MINUTEN = 10;

function neuerCode() {
  // Modulo-Bias bei 2^32 / 10^6 ist verschwindend klein - fuer einen
  // 10-Minuten-Code ohne praktische Bedeutung.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}

// Der Code steht bewusst NICHT im Betreff: der taucht sonst in
// Push-Benachrichtigungen auf dem Sperrbildschirm und in jeder
// Postfach-Uebersicht auf.
function mailHtml(code, link) {
  return huelle("Anmelden",
    knopf("Jetzt anmelden", link) +
    absatz(`Der Link gilt ${GUELTIG_MINUTEN} Minuten und funktioniert einmal.`) +
    absatz(`<span style="color:#8b8e96;font-size:13px;">Anderes Gerät? Code eingeben:</span>`) +
    kasten(code, true) +
    fussnote("Du hast das nicht angefordert? Dann ignoriere diese Mail einfach — ohne Link und Code passiert nichts.")
  );
}

function mailText(code, link) {
  return `Zum Anmelden diesen Link oeffnen:

${link}

Gueltig ${GUELTIG_MINUTEN} Minuten, funktioniert einmal.

Anderes Geraet? Dann stattdessen diesen Code eingeben: ${code}

Du hast das nicht angefordert? Dann ignoriere diese Mail einfach.`;
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  const { body, fehler } = await liesJson(request);
  if (fehler) return fehler;

  const email = String(body?.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Das sieht nicht nach einer E-Mail-Adresse aus." }, 400);
  }

  let nutzer, kuerzlich;
  try {
    nutzer = await env.DB.prepare("SELECT id, fokus_zugang FROM users WHERE email = ?").bind(email).first();
    if (!nutzer) {
      return json({ error: "Für diese Adresse gibt es noch kein Konto." }, 404);
    }
    if (!nutzer.fokus_zugang) {
      return json({ error: "Diese Adresse ist für den Fokus-Tracker nicht freigeschaltet." }, 403);
    }
    // Mindestabstand zwischen zwei Anforderungen fuer dieselbe Adresse -
    // verhindert, dass ein Postfach mit Code-Mails geflutet wird. Die Tabelle
    // ist mit der ToDo-Liste geteilt, die Bremse gilt also app-uebergreifend.
    kuerzlich = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > datetime('now', '-60 seconds')"
    ).bind(email).first();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  // Erst NACH der Zugangspruefung: eine gesperrte oder unbekannte Adresse soll
  // ihre Absage auch dann bekommen, wenn der Mailversand gar nicht eingerichtet
  // ist. Andersherum antwortet lokal (ohne RESEND_KEY) jede Adresse mit 500,
  // und der Zugangsweg liesse sich nicht testen.
  if (!env.RESEND_KEY) return json({ error: "RESEND_KEY fehlt im Pages-Projekt" }, 500);

  if (kuerzlich.n > 0) {
    return json({ error: "Bitte kurz warten, bevor du einen neuen Code anforderst." }, 429);
  }

  const code = neuerCode();
  const linkToken = neuesToken();
  const link = `${new URL(request.url).origin}/api/auth/link?t=${linkToken}`;

  // Erst verschicken, DANACH speichern: schlaegt der Mailversand fehl, darf
  // kein gueltiger, aber nie zugestellter Code liegen bleiben - der wuerde
  // sonst die Ratenbegrenzung oben blockieren und einen sofortigen zweiten
  // Versuch verhindern, obwohl noch gar keine Mail unterwegs war.
  const versand = await sendeMail(env, {
    to: email,
    subject: "Anmelden beim Fokus-Tracker",
    html: mailHtml(code, link),
    text: mailText(code, link),
  });
  if (!versand.ok) return json({ error: versand.grund }, 502);

  try {
    await env.DB.prepare(
      `INSERT INTO login_codes (email, code_hash, token_hash, expires_at)
       VALUES (?, ?, ?, datetime('now', '+${GUELTIG_MINUTEN} minutes'))`
    ).bind(email, await hashHex(code), await hashHex(linkToken)).run();
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  return json({ ok: true });
}
