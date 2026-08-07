/**
 * Gewohnheiten anlegen, aendern, archivieren, loeschen - und der Bootstrap
 * fuer die App (GET).
 *
 * GET liefert alles auf einmal: Gewohnheiten, die Logs des angezeigten
 * Zeitraums und die Straehnen. Eine Anfrage beim Start, danach schreibt die App
 * nur noch einzelne Tage (siehe log.js).
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { pruefeHeute, istDatum, tagPlus, montagVon, status, straehne } from "../../_lib/tag.js";

// Genug fuer ein Eigennutz-Werkzeug und ein Deckel gegen versehentliche
// Massenanlage. Keine Zahl, die jemals im Weg stehen sollte.
const MAX_GEWOHNHEITEN = 30;
const MAX_NAME = 60;
const MAX_EINHEIT = 12;

// Wie weit zurueck Logs geladen werden. Deckelt zugleich die maximal
// darstellbare Straehne - zwei Jahre am Stueck sind mehr, als dieses Werkzeug
// je beweisen muss, und die Abfrage bleibt klein.
const LOG_TAGE = 730;

// Ein Datensatz, wie ihn die App erwartet.
function alsGewohnheit(z) {
  return {
    id: z.id,
    name: z.name,
    typ: z.typ,
    zielmenge: z.zielmenge,
    einheit: z.einheit,
    position: z.position,
    archiviert: z.archiviert === 1,
  };
}

/**
 * Name/Ziel/Einheit aus dem Anfragekoerper pruefen.
 * Gibt entweder { werte } oder { meldung } zurueck.
 */
function pruefeFelder(body, typ) {
  const name = String(body?.name || "").trim();
  if (!name) return { meldung: "Die Gewohnheit braucht einen Namen." };
  if (name.length > MAX_NAME) return { meldung: `Der Name darf höchstens ${MAX_NAME} Zeichen haben.` };

  if (typ === "binaer") return { werte: { name, zielmenge: null, einheit: null } };

  // Ganze Zahlen, bewusst kein Komma: Minuten, Seiten und Wiederholungen
  // decken praktisch alles ab, und Komma-vs-Punkt in Eingabefeldern ist eine
  // verlaessliche Fehlerquelle.
  const ziel = Number(body?.zielmenge);
  if (!Number.isInteger(ziel) || ziel < 1) {
    return { meldung: "Die Zielmenge muss eine ganze Zahl ab 1 sein." };
  }
  const einheit = String(body?.einheit || "").trim().slice(0, MAX_EINHEIT);
  if (!einheit) return { meldung: "Die Einheit fehlt (zum Beispiel „Min“ oder „Seiten“)." };
  return { werte: { name, zielmenge: ziel, einheit } };
}

export async function onRequestGet({ request, env }) {
  const { nutzer, nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const url = new URL(request.url);
  const heute = url.searchParams.get("heute") || "";
  const meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  // Wie viele Wochen die Verlaufsansicht zeigt. Die App schickt 5; der Deckel
  // verhindert, dass ein manipulierter Aufruf die halbe Historie zieht.
  const wochen = Math.min(Math.max(parseInt(url.searchParams.get("wochen"), 10) || 5, 1), 26);
  // Auf einen Montag ausrichten und bis zum Sonntag der laufenden Woche gehen.
  // Dadurch stehen im Raster immer dieselben Wochentage untereinander - ohne
  // das waere ein Wochenende nicht auf einen Blick zu erkennen. Die restlichen
  // Tage der laufenden Woche liegen in der Zukunft und werden ausgegraut.
  const von = montagVon(tagPlus(heute, -(wochen - 1) * 7));
  const bis = tagPlus(von, wochen * 7 - 1);

  try {
    const gewohnheiten = (await env.DB.prepare(
      `SELECT id, name, typ, zielmenge, einheit, position, archiviert
         FROM gewohnheiten
        WHERE user_id = ?
        ORDER BY archiviert, position, created_at`
    ).bind(nutzerId).all()).results;

    // Alle Logs des Nutzers in EINER Abfrage. Der Zeitraum ist grosszuegiger
    // als die Anzeige, weil die Straehne weiter zurueckreichen kann als das
    // sichtbare Raster.
    const logs = (await env.DB.prepare(
      `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals
         FROM gewohnheit_logs l
         JOIN gewohnheiten g ON g.id = l.gewohnheit_id
        WHERE g.user_id = ? AND l.datum >= ?
        ORDER BY l.datum`
    ).bind(nutzerId, tagPlus(heute, -LOG_TAGE)).all()).results;

    const typVon = {};
    for (const g of gewohnheiten) typVon[g.id] = { typ: g.typ, ziel: g.zielmenge };

    // Zwei Ableitungen aus denselben Zeilen: das sichtbare Raster und die
    // Menge der gruenen Tage je Gewohnheit, aus der die Straehne faellt.
    const sichtbar = {};
    const gruene = {};
    for (const l of logs) {
      const info = typVon[l.gewohnheit_id];
      if (!info) continue;
      // Fuer den Status zaehlt das Ziel, das beim Loggen galt - sonst faerbt
      // ein spaeter angehobenes Ziel alte gruene Tage nachtraeglich gelb.
      const ziel = l.ziel_damals != null ? l.ziel_damals : info.ziel;
      const st = status(info.typ, l.menge, ziel);

      if (st === "erledigt") {
        (gruene[l.gewohnheit_id] || (gruene[l.gewohnheit_id] = new Set())).add(l.datum);
      }
      if (l.datum >= von) {
        const eimer = sichtbar[l.gewohnheit_id] || (sichtbar[l.gewohnheit_id] = {});
        eimer[l.datum] = { menge: l.menge, ziel, status: st };
      }
    }

    const straehnen = {};
    for (const g of gewohnheiten) {
      straehnen[g.id] = straehne(gruene[g.id] || new Set(), heute);
    }

    return json({
      email: nutzer.email,
      name: nutzer.name,
      von,
      bis,
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
  const { werte, meldung } = pruefeFelder(body, typ);
  if (meldung) return json({ error: meldung }, 400);

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
      `INSERT INTO gewohnheiten (id, user_id, name, typ, zielmenge, einheit, position)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, nutzerId, werte.name, typ, werte.zielmenge, werte.einheit, letzte.p + 1).run();

    return json({
      ok: true,
      gewohnheit: {
        id, name: werte.name, typ,
        zielmenge: werte.zielmenge, einheit: werte.einheit,
        position: letzte.p + 1, archiviert: false,
      },
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Anlegen" }, 500);
  }
}

/**
 * Umbenennen, Ziel aendern, archivieren, reaktivieren.
 *
 * Der TYP laesst sich nicht aendern. Aus einer binaeren eine mengenbasierte
 * Gewohnheit zu machen wuerde die gesamte Historie neu bewerten - alle alten
 * Haekchen stuenden ploetzlich als "Menge 1" gegen ein Ziel von 30. Wer den
 * Typ wechseln will, legt eine neue Gewohnheit an.
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
      "SELECT id, typ, archiviert FROM gewohnheiten WHERE id = ? AND user_id = ?"
    ).bind(id, nutzerId).first();
    if (!alt) return json({ error: "Gewohnheit nicht gefunden" }, 404);

    // Nur-Archivieren: kommt ohne Namen, deshalb vor der Feldpruefung.
    if (body?.archiviert !== undefined && body?.name === undefined) {
      const flagge = body.archiviert ? 1 : 0;
      await env.DB.prepare("UPDATE gewohnheiten SET archiviert = ? WHERE id = ?")
        .bind(flagge, id).run();
      return json({ ok: true, archiviert: flagge === 1 });
    }

    const { werte, meldung } = pruefeFelder(body, alt.typ);
    if (meldung) return json({ error: meldung }, 400);

    const flagge = body?.archiviert !== undefined ? (body.archiviert ? 1 : 0) : alt.archiviert;
    await env.DB.prepare(
      "UPDATE gewohnheiten SET name = ?, zielmenge = ?, einheit = ?, archiviert = ? WHERE id = ?"
    ).bind(werte.name, werte.zielmenge, werte.einheit, flagge, id).run();

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
        id, name: werte.name, typ: alt.typ,
        zielmenge: werte.zielmenge, einheit: werte.einheit,
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
