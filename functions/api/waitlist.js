/**
 * Oeffentliches Eintragen in die Warteliste - fuer Fokus-Zugang.
 *
 * Gespiegelt aus der ToDo-Liste (functions/api/waitlist.js), mit drei
 * Unterschieden:
 *
 * 1. quelle='fokus' im INSERT - damit die Verwaltung sieht, dass hier
 *    erkennbar Fokus-Zugang gewuenscht ist, nicht nur ein ToDo-Konto. Beim
 *    Freischalten setzt admin/waitlist.js darauf basierend fokus_zugang=1.
 * 2. Freischalten-Link und Verwaltungs-Link zeigen FEST auf todo.it-wolf.org,
 *    nicht auf den eigenen Origin - /admin und /freischalten gibt es nur dort,
 *    die Verwaltung ist bewusst nicht verdoppelt.
 * 3. Kein Turnstile (wie beim ToDo-Formular am Anfang auch nicht) - das
 *    Ein-Eintrag-pro-Minute-Limit ist die Bremse.
 *
 * Wer schon ein Konto hat (ToDo, aber vielleicht ohne fokus_zugang), landet
 * NICHT hier: request-code.js weicht bei einer bekannten Adresse gar nicht
 * erst in die Warteliste aus (siehe dortiger Kommentar), das Frontend zeigt
 * stattdessen direkt "nicht freigeschaltet". Dieser Endpunkt ist also fast
 * immer fuer Adressen ganz ohne Konto - die Pruefung unten bleibt trotzdem,
 * falls jemand die Maske manuell erreicht.
 */

import { sendeMail, huelle, absatz, kasten, knopf, fussnote } from "../_lib/mail.js";
import { hashHex, neuesToken } from "../_lib/session.js";
import { json, liesJson } from "../_lib/antwort.js";

const MAX_NAME = 80;
const MAX_EMAIL = 254;   // RFC-Obergrenze fuer Mailadressen
const TODO_URL = "https://todo.it-wolf.org";

// Gegen HTML-Einschleusung in der Benachrichtigungsmail: Name und Adresse
// stammen von Fremden und landen in einem HTML-Dokument.
function escape(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500);

  const { body, fehler } = await liesJson(request);
  if (fehler) return fehler;

  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();

  if (!name) return json({ error: "Bitte einen Namen angeben." }, 400);
  if (name.length > MAX_NAME) return json({ error: "Der Name ist zu lang." }, 400);
  if (email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: "Das sieht nicht nach einer E-Mail-Adresse aus." }, 400);
  }

  try {
    // Schon ein Konto? Dann gehoert die Person nicht auf die Warteliste - ihr
    // fehlt hoechstens noch fokus_zugang, und das ist eine Sache fuer die
    // Verwaltung, kein neuer Wartelisten-Eintrag (die E-Mail-Spalte ist ohnehin
    // UNIQUE, ein zweiter Eintrag waere gar nicht moeglich).
    const nutzer = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (nutzer) {
      return json({ error: "Diese Adresse hat schon ein Konto. Für Fokus-Zugang melde dich direkt bei mir." }, 409);
    }

    const vorhanden = await env.DB.prepare(
      "SELECT status FROM waitlist WHERE email = ?"
    ).bind(email).first();
    if (vorhanden) {
      // Bewusst dieselbe freundliche Antwort bei 'offen' und 'abgelehnt' -
      // eine Absage muss man niemandem ins Gesicht sagen.
      return json({ ok: true, message: "Diese Adresse war schon eingetragen — wir melden uns." });
    }

    // Grobe Bremse gegen automatisiertes Zumuellen: hoechstens ein Eintrag pro
    // Minute ueber ALLE Adressen, app-uebergreifend (dieselbe Tabelle wie bei
    // der ToDo-Liste).
    const kuerzlich = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM waitlist WHERE created_at > datetime('now', '-60 seconds')"
    ).first();
    if (kuerzlich.n > 0) {
      return json({ error: "Gerade zu viele Anfragen. Bitte kurz warten." }, 429);
    }

    const eingefuegt = await env.DB.prepare(
      "INSERT INTO waitlist (name, email, quelle) VALUES (?, ?, 'fokus')"
    ).bind(name, email).run();

    // Einmal-Link, mit dem die Anfrage direkt aus der Mail freigeschaltet
    // werden kann - loest denselben Endpunkt wie bei der ToDo-Liste ein
    // (admin_tokens/genehmigen.js leben nur dort), deshalb der feste Origin.
    const freiToken = neuesToken();
    await env.DB.prepare(
      `INSERT INTO admin_tokens (zweck, waitlist_id, token_hash, expires_at)
       VALUES ('freischalten', ?, ?, datetime('now', '+7 days'))`
    ).bind(eingefuegt.meta.last_row_id, await hashHex(freiToken)).run();
    const freiLink = `${TODO_URL}/freischalten?t=${freiToken}`;

    // Bestaetigung an den Eintragenden. Ohne sie steht man da und weiss nicht,
    // ob das Formular ueberhaupt etwas getan hat.
    await sendeMail(env, {
      to: email,
      subject: "Du stehst auf der Warteliste",
      html: huelle("Du stehst auf der Warteliste",
        absatz(`Hallo ${escape(name)}, wir haben deine Anfrage für den
                Fokus-Tracker bekommen. Sobald dein Zugang freigeschaltet ist,
                bekommst du noch eine Mail — dann kannst du dich mit dieser
                Adresse anmelden.`) +
        fussnote("Du musst nichts weiter tun. Diese Mail dient nur als Bestätigung.")),
      text: `Hallo ${name},\n\nwir haben deine Anfrage fuer den Fokus-Tracker bekommen. Sobald dein Zugang freigeschaltet ist, bekommst du noch eine Mail - dann kannst du dich mit dieser Adresse anmelden.\n\nDu musst nichts weiter tun.`,
    });

    // Benachrichtigung an die Verwaltung - dieselbe users-Tabelle wie bei der
    // ToDo-Liste, die Abfrage funktioniert von hier aus genauso.
    const empfaenger = env.ADMIN_MAIL
      ? [env.ADMIN_MAIL]
      : (await env.DB.prepare("SELECT email FROM users WHERE role = 'admin'").all())
          .results.map(a => a.email);

    // Fehler hier duerfen die Eintragung nicht kippen - fuer den Eintragenden
    // hat es geklappt, und im Dashboard steht der Eintrag.
    for (const an of empfaenger) {
      await sendeMail(env, {
        to: an,
        subject: `Neue Fokus-Anfrage: ${name}`,
        html: huelle("Neue Fokus-Anfrage",
          kasten(`<strong>${escape(name)}</strong><br>${escape(email)}`) +
          knopf("Freischalten", freiLink) +
          absatz(`<span style="color:#8b8e96;font-size:13px;">Der Link gilt 7 Tage.
                  Ablehnen oder später entscheiden geht in der
                  <a href="${TODO_URL}/admin" style="color:#4f63d2;">Verwaltung</a>.</span>`) +
          fussnote("Diese Mail geht an die hinterlegte Verwaltungsadresse.")),
        text: `Neue Fokus-Anfrage:\n\n${name}\n${email}\n\nFreischalten: ${freiLink}\n(7 Tage gueltig)\n\nVerwaltung: ${TODO_URL}/admin`,
      });
    }
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }

  return json({ ok: true });
}
