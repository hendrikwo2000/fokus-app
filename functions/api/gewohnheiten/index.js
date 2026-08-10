/**
 * Gewohnheiten anlegen, aendern, archivieren, loeschen - und der Bootstrap
 * fuer die App (GET).
 *
 * GET liefert alles auf einmal: Gewohnheiten, die volle Log-Historie (fuer
 * Straehnen UND den Kalender-Verlauf, siehe historieAb) und die Straehnen.
 * Eine Anfrage beim Start, danach schreibt die App nur noch einzelne Tage
 * (siehe log.js).
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import {
  pruefeHeute, istDatum, tagPlus, status, straehneFuer, ergaenzeStilleTage, MAX_MENGE,
} from "../../_lib/tag.js";

// Genug fuer ein Eigennutz-Werkzeug und ein Deckel gegen versehentliche
// Massenanlage. Keine Zahl, die jemals im Weg stehen sollte.
const MAX_GEWOHNHEITEN = 30;
const MAX_NAME = 60;
const MAX_EINHEIT = 12;

// Wie weit zurueck Logs geladen werden. Deckelt zugleich die maximal
// darstellbare Straehne und wie weit der Kalender-Verlauf zurueckblaettern
// kann - zwei Jahre am Stueck sind mehr, als dieses Werkzeug je beweisen muss,
// und die Abfrage bleibt klein.
const LOG_TAGE = 730;

const RHYTHMEN = ["taeglich", "wochentage", "x_pro_woche"];
const RICHTUNGEN = ["mindestens", "hoechstens"];

// Ein Datensatz, wie ihn die App erwartet.
function alsGewohnheit(z) {
  return {
    id: z.id,
    name: z.name,
    typ: z.typ,
    zielmenge: z.zielmenge,
    einheit: z.einheit,
    richtung: z.richtung,
    rhythmus: z.rhythmus,
    wochentageMaske: z.wochentage_maske,
    wochenziel: z.wochenziel,
    position: z.position,
    archiviert: z.archiviert === 1,
    // Nur das Datum, die Uhrzeit interessiert niemanden. Die App braucht es,
    // um stille Tage einer Obergrenze nicht vor dem Anlegen mitzuzaehlen -
    // dieselbe Schranke wie stillerTagZaehlt() in _lib/tag.js.
    angelegtAm: String(z.created_at || "").slice(0, 10),
  };
}

/**
 * Name/Ziel/Einheit aus dem Anfragekoerper pruefen.
 * Gibt entweder { werte } oder { meldung } zurueck.
 */
function pruefeFelder(body, typ, richtung) {
  const name = String(body?.name || "").trim();
  if (!name) return { meldung: "Die Gewohnheit braucht einen Namen." };
  if (name.length > MAX_NAME) return { meldung: `Der Name darf höchstens ${MAX_NAME} Zeichen haben.` };

  if (typ === "binaer") return { werte: { name, zielmenge: null, einheit: null } };

  // Ganze Zahlen, bewusst kein Komma: Minuten, Seiten und Wiederholungen
  // decken praktisch alles ab, und Komma-vs-Punkt in Eingabefeldern ist eine
  // verlaessliche Fehlerquelle.
  // Bei einer Obergrenze ist 0 ein sinnvolles Ziel ("gar keine Zigarette") -
  // bei einem Soll waere es immer erfuellt und damit keins.
  const kleinstes = richtung === "hoechstens" ? 0 : 1;
  const ziel = Number(body?.zielmenge);
  if (!Number.isInteger(ziel) || ziel < kleinstes) {
    return { meldung: `Die Zielmenge muss eine ganze Zahl ab ${kleinstes} sein.` };
  }
  // Nach oben derselbe Deckel wie fuer einen Tageseintrag (log.js) - ein Ziel,
  // das keine Menge je erreichen kann, waere keins.
  if (ziel > MAX_MENGE) {
    return { meldung: `Die Zielmenge darf höchstens ${MAX_MENGE} sein.` };
  }
  // Einheit ist optional - nicht jede Zielmenge braucht eine Beschriftung.
  const einheit = String(body?.einheit || "").trim().slice(0, MAX_EINHEIT) || null;
  return { werte: { name, zielmenge: ziel, einheit } };
}

/**
 * Rhythmus aus dem Anfragekoerper pruefen: taeglich, feste Wochentage, oder
 * X Mal die Woche. Orthogonal zu typ (binaer/menge) - unabhaengig geprueft.
 */
function pruefeRhythmus(body) {
  const rhythmus = RHYTHMEN.includes(body?.rhythmus) ? body.rhythmus : "taeglich";

  if (rhythmus === "wochentage") {
    // Bitmaske: Bit i = Wochentag i (Mo=1 .. So=64), siehe _lib/tag.js.
    // 1-127 deckt "mindestens ein Tag" bis "alle sieben" ab.
    const maske = Number(body?.wochentageMaske);
    if (!Number.isInteger(maske) || maske < 1 || maske > 127) {
      return { meldung: "Mindestens ein Wochentag muss ausgewählt sein." };
    }
    return { werte: { rhythmus, wochentageMaske: maske, wochenziel: null } };
  }

  if (rhythmus === "x_pro_woche") {
    const ziel = Number(body?.wochenziel);
    if (!Number.isInteger(ziel) || ziel < 1 || ziel > 7) {
      return { meldung: "Die Anzahl pro Woche muss zwischen 1 und 7 liegen." };
    }
    return { werte: { rhythmus, wochentageMaske: null, wochenziel: ziel } };
  }

  return { werte: { rhythmus, wochentageMaske: null, wochenziel: null } };
}

/**
 * Richtung aus dem Anfragekoerper pruefen: 'mindestens' (Ziel erreichen,
 * Default) oder 'hoechstens' (Obergrenze). Nur bei typ='menge' relevant -
 * binaere Gewohnheiten kennen keine Richtung, bleiben immer 'mindestens'.
 * Ungueltige/fehlende Werte fallen still auf den Default zurueck, genau wie
 * bei pruefeRhythmus().
 */
function pruefeRichtung(body, typ) {
  if (typ === "binaer") return { werte: { richtung: "mindestens" } };
  const richtung = RICHTUNGEN.includes(body?.richtung) ? body.richtung : "mindestens";
  return { werte: { richtung } };
}

export async function onRequestGet({ request, env }) {
  const { nutzer, nutzerId, todoZugang, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const url = new URL(request.url);
  const heute = url.searchParams.get("heute") || "";
  const meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  const historieAb = tagPlus(heute, -LOG_TAGE);

  try {
    const gewohnheiten = (await env.DB.prepare(
      `SELECT id, name, typ, zielmenge, einheit, richtung, rhythmus, wochentage_maske, wochenziel,
              position, archiviert, created_at
         FROM gewohnheiten
        WHERE user_id = ?
        ORDER BY archiviert, position, created_at`
    ).bind(nutzerId).all()).results;

    // Alle Logs des Nutzers in EINER Abfrage, volle 730 Tage - sowohl fuer die
    // Straehne als auch fuer den Kalender-Verlauf, der beliebig weit in diese
    // Historie zurueckblaettern kann.
    const logs = (await env.DB.prepare(
      `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals
         FROM gewohnheit_logs l
         JOIN gewohnheiten g ON g.id = l.gewohnheit_id
        WHERE g.user_id = ? AND l.datum >= ?
        ORDER BY l.datum`
    ).bind(nutzerId, historieAb).all()).results;

    const infoVon = {};
    for (const g of gewohnheiten) infoVon[g.id] = g;

    // Zwei Ableitungen aus denselben Zeilen: die volle Historie fuer den
    // Client und die Menge der gruenen Tage je Gewohnheit, aus der die
    // Straehne faellt.
    const sichtbar = {};
    const gruene = {};
    for (const l of logs) {
      const info = infoVon[l.gewohnheit_id];
      if (!info) continue;
      // Fuer den Status zaehlt das Ziel, das beim Loggen galt - sonst faerbt
      // ein spaeter angehobenes Ziel alte gruene Tage nachtraeglich gelb.
      const ziel = l.ziel_damals != null ? l.ziel_damals : info.zielmenge;
      const st = status(info.typ, l.menge, ziel, info.richtung);

      if (st === "erledigt") {
        (gruene[l.gewohnheit_id] || (gruene[l.gewohnheit_id] = new Set())).add(l.datum);
      }
      const eimer = sichtbar[l.gewohnheit_id] || (sichtbar[l.gewohnheit_id] = {});
      eimer[l.datum] = { menge: l.menge, ziel, status: st };
    }

    const straehnen = {};
    for (const g of gewohnheiten) {
      const gruen = gruene[g.id] || (gruene[g.id] = new Set());
      // Bei einer Obergrenze zaehlen auch die Tage mit, an denen gar nichts
      // eingetragen wurde (siehe stillerTagZaehlt in _lib/tag.js). Die Daten
      // mit Zeile stehen schon in `sichtbar`.
      ergaenzeStilleTage(gruen, g, Object.keys(sichtbar[g.id] || {}), historieAb, heute);
      straehnen[g.id] = straehneFuer(g, gruen, heute);
    }

    return json({
      email: nutzer.email,
      name: nutzer.name,
      // Fuer den Abschnitt "ToDo-Liste" in den Einstellungen - ob die andere
      // App schon freigeschaltet ist oder sich der Nutzer den Zugang erst
      // noch selbst holen kann.
      todoZugang,
      historieAb,
      heute,
      gewohnheiten: gewohnheiten.map(alsGewohnheit),
      logs: sichtbar,
      straehnen,
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Lesen" }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const typ = body?.typ === "menge" ? "menge" : "binaer";
  // Richtung zuerst: sie entscheidet mit, welche Zielmenge gueltig ist.
  const { werte: richtungWerte } = pruefeRichtung(body, typ);

  const { werte, meldung } = pruefeFelder(body, typ, richtungWerte.richtung);
  if (meldung) return json({ error: meldung }, 400);

  const { werte: rhythmusWerte, meldung: rhythmusMeldung } = pruefeRhythmus(body);
  if (rhythmusMeldung) return json({ error: rhythmusMeldung }, 400);

  try {
    const anzahl = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM gewohnheiten WHERE user_id = ? AND archiviert = 0"
    ).bind(nutzerId).first();
    if (anzahl.n >= MAX_GEWOHNHEITEN) {
      return json({ error: `Mehr als ${MAX_GEWOHNHEITEN} aktive Gewohnheiten gehen nicht.` }, 409);
    }

    // Ans Ende sortieren. COALESCE, weil MAX() bei der allerersten Gewohnheit
    // NULL liefert.
    const letzte = await env.DB.prepare(
      "SELECT COALESCE(MAX(position), -1) AS p FROM gewohnheiten WHERE user_id = ?"
    ).bind(nutzerId).first();

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO gewohnheiten
         (id, user_id, name, typ, zielmenge, einheit, richtung, rhythmus, wochentage_maske, wochenziel, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, nutzerId, werte.name, typ, werte.zielmenge, werte.einheit, richtungWerte.richtung,
      rhythmusWerte.rhythmus, rhythmusWerte.wochentageMaske, rhythmusWerte.wochenziel,
      letzte.p + 1
    ).run();

    return json({
      ok: true,
      gewohnheit: {
        id, name: werte.name, typ,
        zielmenge: werte.zielmenge, einheit: werte.einheit, richtung: richtungWerte.richtung,
        rhythmus: rhythmusWerte.rhythmus,
        wochentageMaske: rhythmusWerte.wochentageMaske,
        wochenziel: rhythmusWerte.wochenziel,
        position: letzte.p + 1, archiviert: false,
      },
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Anlegen" }, 500);
  }
}

/**
 * Umbenennen, Ziel/Einheit/Rhythmus aendern, archivieren, reaktivieren.
 *
 * Der TYP laesst sich nur aendern, solange noch KEIN Tag erfasst ist. Aus
 * einer binaeren eine mengenbasierte Gewohnheit zu machen wuerde sonst die
 * gesamte Historie neu bewerten - alle alten Haekchen stuenden ploetzlich als
 * "Menge 1" gegen ein Ziel von 30. Ohne Historie gibt es nichts umzudeuten,
 * dann ist der Wechsel unbedenklich. Mit Historie bleibt es gesperrt (409) -
 * wer dann noch wechseln will, legt eine neue Gewohnheit an.
 *
 * Der RHYTHMUS ist dagegen immer aenderbar: anders als beim Typ gibt es dafuer
 * bewusst keine Versionierung wie bei ziel_damals. Eine Aenderung gilt sofort
 * fuer Anzeige und Straehne, vergangene Log-Eintraege bleiben unangetastet,
 * aber die daraus abgeleitete Straehne wird mit dem AKTUELLEN Rhythmus neu
 * durchgerechnet.
 *
 * Die RICHTUNG ('mindestens'/'hoechstens') ist genauso gesperrt wie der Typ,
 * sobald ein Tag erfasst ist - aus denselben Gruenden: eine Umkehr wuerde die
 * ganze Historie rueckwirkend umbewerten (aus "im Rahmen geblieben" wuerde
 * ploetzlich "Ziel verfehlt" oder umgekehrt).
 */
export async function onRequestPatch({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const id = String(body?.id || "");
  if (!id) return json({ error: "Keine Gewohnheit angegeben" }, 400);

  try {
    const alt = await env.DB.prepare(
      "SELECT id, typ, richtung, archiviert FROM gewohnheiten WHERE id = ? AND user_id = ?"
    ).bind(id, nutzerId).first();
    if (!alt) return json({ error: "Gewohnheit nicht gefunden" }, 404);

    // Nur-Archivieren: kommt ohne Namen, deshalb vor der Feldpruefung.
    if (body?.archiviert !== undefined && body?.name === undefined) {
      const flagge = body.archiviert ? 1 : 0;
      await env.DB.prepare("UPDATE gewohnheiten SET archiviert = ? WHERE id = ?")
        .bind(flagge, id).run();
      return json({ ok: true, archiviert: flagge === 1 });
    }

    let typ = alt.typ;
    const gewuenschterTyp = body?.typ === "menge" ? "menge" : "binaer";
    if (gewuenschterTyp !== alt.typ) {
      const hatHistorie = await env.DB.prepare(
        "SELECT 1 FROM gewohnheit_logs WHERE gewohnheit_id = ? LIMIT 1"
      ).bind(id).first();
      if (hatHistorie) {
        return json({ error: "Der Typ lässt sich nicht mehr ändern, sobald ein Tag erfasst ist." }, 409);
      }
      typ = gewuenschterTyp;
    }

    // Richtung vor den Feldern: sie entscheidet mit, welche Zielmenge gueltig
    // ist (0 nur bei einer Obergrenze).
    const { werte: richtungWerte } = pruefeRichtung(body, typ);

    const { werte, meldung } = pruefeFelder(body, typ, richtungWerte.richtung);
    if (meldung) return json({ error: meldung }, 400);

    const { werte: rhythmusWerte, meldung: rhythmusMeldung } = pruefeRhythmus(body);
    if (rhythmusMeldung) return json({ error: rhythmusMeldung }, 400);

    if (richtungWerte.richtung !== alt.richtung) {
      const hatHistorie = await env.DB.prepare(
        "SELECT 1 FROM gewohnheit_logs WHERE gewohnheit_id = ? LIMIT 1"
      ).bind(id).first();
      if (hatHistorie) {
        return json({ error: "Die Richtung lässt sich nicht mehr ändern, sobald ein Tag erfasst ist." }, 409);
      }
    }

    const flagge = body?.archiviert !== undefined ? (body.archiviert ? 1 : 0) : alt.archiviert;
    await env.DB.prepare(
      `UPDATE gewohnheiten
          SET name = ?, typ = ?, zielmenge = ?, einheit = ?, richtung = ?,
              rhythmus = ?, wochentage_maske = ?, wochenziel = ?,
              archiviert = ?
        WHERE id = ?`
    ).bind(
      werte.name, typ, werte.zielmenge, werte.einheit, richtungWerte.richtung,
      rhythmusWerte.rhythmus, rhythmusWerte.wochentageMaske, rhythmusWerte.wochenziel,
      flagge, id
    ).run();

    // Ein neues Ziel gilt AB HEUTE. Vergangene Tage behalten ihres (dafuer ist
    // ziel_damals da), aber der laufende Tag muss mitziehen - sonst stuende
    // heute ein gruener Haken an einem halb vollen Balken, weil der Status
    // gegen das alte Ziel faellt und die Anzeige gegen das neue.
    const heute = String(body?.heute || "");
    if (werte.zielmenge != null && istDatum(heute)) {
      await env.DB.prepare(
        "UPDATE gewohnheit_logs SET ziel_damals = ? WHERE gewohnheit_id = ? AND datum >= ?"
      ).bind(werte.zielmenge, id, heute).run();
    }

    return json({
      ok: true,
      gewohnheit: {
        id, name: werte.name, typ,
        zielmenge: werte.zielmenge, einheit: werte.einheit, richtung: richtungWerte.richtung,
        rhythmus: rhythmusWerte.rhythmus,
        wochentageMaske: rhythmusWerte.wochentageMaske,
        wochenziel: rhythmusWerte.wochenziel,
        archiviert: flagge === 1,
      },
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}

// Endgueltig loeschen. Die Logs gehen ueber ON DELETE CASCADE mit - deshalb
// nennt die Rueckfrage in der App vorher ihre Anzahl.
export async function onRequestDelete({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  const id = String(body?.id || "");
  if (!id) return json({ error: "Keine Gewohnheit angegeben" }, 400);

  try {
    const ergebnis = await env.DB.prepare(
      "DELETE FROM gewohnheiten WHERE id = ? AND user_id = ?"
    ).bind(id, nutzerId).run();
    if (!ergebnis.meta.changes) return json({ error: "Gewohnheit nicht gefunden" }, 404);
    return json({ ok: true });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Löschen" }, 500);
  }
}
