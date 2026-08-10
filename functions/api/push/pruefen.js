/**
 * Ziel eines externen, zeitgesteuerten Anpingens (z. B. cron-job.org) - KEIN
 * Nutzer-Endpunkt, deshalb keine Sitzung, sondern ein geteiltes Geheimnis im
 * Header. Cloudflare Pages kennt selbst keine Cron Triggers (die gibt es nur
 * fuer eigenstaendige Worker, siehe BETRIEB.md); ein kostenloser externer
 * Anpinger passt ohne zweites Cloudflare-Projekt in den bestehenden
 * Git-Push-Workflow. Exaktes Gegenstueck zu ToDo's gleichnamigem Endpunkt.
 *
 * Prueft je Nutzer MIT mindestens einem Push-Abo, wie viele seiner aktiven
 * (nicht archivierten) Gewohnheiten heute noch offen sind - "offen" heisst
 * hier wie in der App selbst (istHeuteDran()/status() in app.js bzw.
 * _lib/tag.js): heute ueberhaupt dran (taeglich immer, "wochentage" nur an
 * geplanten Tagen, "x_pro_woche" solange das Wochenziel noch nicht erreicht
 * ist) UND noch nicht erledigt. Bei > 0 geht eine Push-Nachricht an alle
 * Geraete des Nutzers, mit der Zahl im Payload - der Service Worker setzt
 * daraus direkt das App-Icon-Badge (siehe sw.js), auch ohne dass die App
 * geoeffnet wird.
 *
 * Ungueltige Abos (Geraet abgemeldet, Browser-Push widerrufen: 404/410 vom
 * Push-Dienst) werden dabei gleich aus der Datenbank entfernt.
 */

import { json } from "../../_lib/antwort.js";
import { sendeWebPush } from "../../_lib/webpush.js";
import { status, montagVon, tagPlus, stillerTagZaehlt, istObergrenze } from "../../_lib/tag.js";

// "Heute" bewusst in der Zeitzone Europe/Berlin, nicht UTC - sonst faellt der
// Tageswechsel je nach Sommer-/Winterzeit bis zu zwei Stunden falsch.
function heuteBerlin() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
}

// Wochentag-Index eines Datums, 0=Mo .. 6=So - wie wochentagIndex() in
// _lib/tag.js (dort nicht exportiert, deshalb hier dupliziert statt die
// gemeinsame Datei fuer eine einzelne Zeile anzufassen).
function wochentagIndex(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  return (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7;
}

function istGeplant(gewohnheit, datum) {
  if (gewohnheit.rhythmus !== "wochentage") return true;
  return (gewohnheit.wochentage_maske & (1 << wochentagIndex(datum))) !== 0;
}

// Zahl der in dieser Woche (Montag bis heute) bereits erledigten Tage einer
// Gewohnheit - fuer den Wochenfortschritt bei 'x_pro_woche'. Spiegelt
// erledigtDieseWoche() in app.js, nur aus rohen DB-Zeilen statt state.logs.
function erledigtDieseWoche(gewohnheit, tageDerGewohnheit, heute) {
  const start = montagVon(heute);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const tag = tagPlus(start, i);
    if (tag > heute) break;
    const eintrag = tageDerGewohnheit[tag];
    if (!eintrag) {
      // Ohne Eintrag zaehlt der Tag nur bei einer Obergrenze mit.
      if (stillerTagZaehlt(gewohnheit, tag, heute)) n++;
      continue;
    }
    if (status(gewohnheit.typ, eintrag.menge, eintrag.ziel, gewohnheit.richtung) === "erledigt") n++;
  }
  return n;
}

// Ob eine Gewohnheit heute noch offen ist: heute ueberhaupt dran (istHeuteDran
// in app.js) UND noch nicht erledigt.
function nochOffen(gewohnheit, tageDerGewohnheit, heute) {
  if (gewohnheit.rhythmus === "wochentage" && !istGeplant(gewohnheit, heute)) return false;
  // Eine Obergrenze ist mit dem erreichten Wochenziel NICHT erledigt: eine
  // Grenze gilt an jedem Tag der Woche, auch am sechsten. Deshalb faellt sie
  // hier durch auf die Tagespruefung unten, genau wie 'taeglich'.
  if (gewohnheit.rhythmus === "x_pro_woche" && !istObergrenze(gewohnheit)) {
    return erledigtDieseWoche(gewohnheit, tageDerGewohnheit, heute) < gewohnheit.wochenziel;
  }
  const heutiger = tageDerGewohnheit[heute];
  // Kein Eintrag heisst offen - und zwar ohne status() zu fragen: bei einer
  // Obergrenze waere die 0 dort "erledigt" (siehe _lib/tag.js), ein noch gar
  // nicht angefasster Tag wuerde also faelschlich als geschafft gelten.
  if (!heutiger) return true;
  const st = status(gewohnheit.typ, heutiger.menge, heutiger.ziel, gewohnheit.richtung);
  return st === "offen" || st === "teilweise";
}

async function pruefeUndSende(env) {
  const heute = heuteBerlin();
  const wocheStart = montagVon(heute);

  const nutzerZeilen = await env.DB.prepare(
    `SELECT DISTINCT u.id AS user_id
       FROM users u
       JOIN fokus_push_subscriptions ps ON ps.user_id = u.id
      WHERE u.fokus_zugang = 1`
  ).all();

  let versendet = 0, fehlgeschlagen = 0, entfernt = 0, nutzerBenachrichtigt = 0;

  for (const zeile of nutzerZeilen.results) {
    const gewohnheiten = (await env.DB.prepare(
      `SELECT id, typ, zielmenge, richtung, rhythmus, wochentage_maske, wochenziel, created_at
         FROM gewohnheiten WHERE user_id = ? AND archiviert = 0`
    ).bind(zeile.user_id).all()).results;
    if (!gewohnheiten.length) continue;

    const logs = (await env.DB.prepare(
      `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals
         FROM gewohnheit_logs l
         JOIN gewohnheiten g ON g.id = l.gewohnheit_id
        WHERE g.user_id = ? AND l.datum >= ? AND l.datum <= ?`
    ).bind(zeile.user_id, wocheStart, heute).all()).results;

    const zielVon = {};
    for (const g of gewohnheiten) zielVon[g.id] = g.zielmenge;

    const tageProGewohnheit = {};
    for (const l of logs) {
      const eimer = tageProGewohnheit[l.gewohnheit_id] || (tageProGewohnheit[l.gewohnheit_id] = {});
      eimer[l.datum] = {
        menge: l.menge,
        ziel: l.ziel_damals != null ? l.ziel_damals : zielVon[l.gewohnheit_id],
      };
    }

    let n = 0;
    for (const g of gewohnheiten) {
      if (nochOffen(g, tageProGewohnheit[g.id] || {}, heute)) n++;
    }
    if (n === 0) continue;
    nutzerBenachrichtigt++;

    const abos = (await env.DB.prepare(
      "SELECT id, endpoint, p256dh, auth FROM fokus_push_subscriptions WHERE user_id = ?"
    ).bind(zeile.user_id).all()).results;

    const payload = {
      title: "Fokus-Tracker",
      body: n === 1
        ? "1 Gewohnheit ist heute noch offen."
        : `${n} Gewohnheiten sind heute noch offen.`,
      badge: n,
      url: "/",
    };

    for (const abo of abos) {
      let ergebnis;
      try {
        ergebnis = await sendeWebPush(env, abo, payload);
      } catch (e) {
        fehlgeschlagen++;
        continue;
      }
      if (ergebnis.ok) {
        versendet++;
      } else if (ergebnis.status === 404 || ergebnis.status === 410) {
        await env.DB.prepare("DELETE FROM fokus_push_subscriptions WHERE id = ?").bind(abo.id).run();
        entfernt++;
      } else {
        fehlgeschlagen++;
      }
    }
  }

  return { nutzerBenachrichtigt, versendet, fehlgeschlagen, entfernt };
}

async function behandeln({ request, env }) {
  if (!env.PUSH_CRON_SECRET) {
    return json({ error: "PUSH_CRON_SECRET fehlt im Pages-Projekt" }, 500);
  }
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return json({ error: "VAPID-Schluessel fehlen im Pages-Projekt" }, 500);
  }
  const geheimnis = request.headers.get("X-Cron-Secret") || new URL(request.url).searchParams.get("geheimnis");
  if (geheimnis !== env.PUSH_CRON_SECRET) {
    return json({ error: "Nicht erlaubt" }, 403);
  }

  try {
    const ergebnis = await pruefeUndSende(env);
    return json({ ok: true, ...ergebnis });
  } catch (e) {
    return json({ error: "Fehler beim Pruefen: " + e.message }, 500);
  }
}

export const onRequestGet = behandeln;
export const onRequestPost = behandeln;
