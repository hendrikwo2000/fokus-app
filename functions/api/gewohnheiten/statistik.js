/**
 * Erfuellungsquote je Gewohnheit ueber einen Zeitraum (7/30/90 Tage).
 *
 * Anders als die Straehne (die nur den aktuellen Lauf zaehlt) rechnet das
 * hier ueber ein festes Fenster: wie viele der GEPLANTEN Tage in diesem
 * Zeitraum waren erledigt. "Geplant" haengt vom Rhythmus ab (siehe
 * istGeplant unten, gespiegelt aus _lib/tag.js, das dieselbe Funktion nur
 * privat haelt).
 *
 * x_pro_woche wird wochenweise statt tageweise gezaehlt (wie schon bei der
 * Straehne in tag.js) - nur vollstaendige Wochen innerhalb des Zeitraums
 * zaehlen mit, sonst wuerde eine angeschnittene erste Woche das Ergebnis
 * verzerren.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { pruefeHeute, tagPlus, status, montagVon, stillerTagZaehlt } from "../../_lib/tag.js";

const ZEITRAEUME = [7, 30, 90];

function istGeplant(datum, maske) {
  const [j, m, t] = datum.split("-").map(Number);
  const wochentag = (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7;
  return (maske & (1 << wochentag)) !== 0;
}

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const url = new URL(request.url);
  const heute = url.searchParams.get("heute") || "";
  const heuteFehler = pruefeHeute(heute);
  if (heuteFehler) return json({ error: heuteFehler }, 400);

  const angefragt = Number(url.searchParams.get("tage"));
  const tage = ZEITRAEUME.includes(angefragt) ? angefragt : 30;
  const von = tagPlus(heute, -(tage - 1));

  try {
    const gewohnheiten = (await env.DB.prepare(
      `SELECT id, name, typ, zielmenge, richtung, rhythmus, wochentage_maske, wochenziel, created_at
         FROM gewohnheiten WHERE user_id = ? AND archiviert = 0
        ORDER BY position, created_at`
    ).bind(nutzerId).all()).results;

    const logs = (await env.DB.prepare(
      `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals
         FROM gewohnheit_logs l JOIN gewohnheiten g ON g.id = l.gewohnheit_id
        WHERE g.user_id = ? AND l.datum >= ? AND l.datum <= ?`
    ).bind(nutzerId, von, heute).all()).results;

    const logsVon = {};
    for (const l of logs) {
      (logsVon[l.gewohnheit_id] || (logsVon[l.gewohnheit_id] = {}))[l.datum] = l;
    }

    function warErledigt(g, datum) {
      const l = (logsVon[g.id] || {})[datum];
      // Kein Eintrag: bei einer Obergrenze zaehlt der Tag trotzdem, sonst
      // nicht (siehe stillerTagZaehlt in _lib/tag.js).
      if (!l) return stillerTagZaehlt(g, datum, heute);
      const ziel = l.ziel_damals != null ? l.ziel_damals : g.zielmenge;
      return status(g.typ, l.menge, ziel, g.richtung) === "erledigt";
    }

    const ergebnis = gewohnheiten.map((g) => {
      if (g.rhythmus === "x_pro_woche") {
        let wocheStart = montagVon(von);
        if (wocheStart < von) wocheStart = tagPlus(wocheStart, 7);
        let wochenGesamt = 0;
        let wochenErfuellt = 0;
        while (tagPlus(wocheStart, 6) <= heute) {
          wochenGesamt++;
          let erledigteTage = 0;
          for (let i = 0; i < 7; i++) {
            if (warErledigt(g, tagPlus(wocheStart, i))) erledigteTage++;
          }
          if (erledigteTage >= (g.wochenziel || 1)) wochenErfuellt++;
          wocheStart = tagPlus(wocheStart, 7);
        }
        return { id: g.id, name: g.name, erledigt: wochenErfuellt, geplant: wochenGesamt, einheit: "Wochen" };
      }

      let geplant = 0;
      let erledigt = 0;
      for (let d = von; d <= heute; d = tagPlus(d, 1)) {
        if (g.rhythmus === "wochentage" && !istGeplant(d, g.wochentage_maske)) continue;
        geplant++;
        if (warErledigt(g, d)) erledigt++;
      }
      return { id: g.id, name: g.name, erledigt, geplant, einheit: "Tage" };
    });

    return json({ tage, von, bis: heute, gewohnheiten: ergebnis });
  } catch (e) {
    return json({ error: "Datenbankfehler bei der Statistik" }, 500);
  }
}
