/**
 * Die Heute-Ansicht, fertig gerechnet.
 *
 * Gegenstueck zum Bootstrap (index.js): der liefert Rohdaten und ueberlaesst
 * dem Client die Auswahl "was ist heute dran". Das reicht fuer die eigene App,
 * die ohnehin die volle Historie fuer Kalender und Verlauf braucht - nicht
 * aber fuer die ToDo-Liste, die nur die Tagesliste zeigt und dafuer keine
 * zweite Kopie der Regeln (Rhythmus, Obergrenze, Flamme) tragen soll.
 *
 * Deshalb hier alles vorgekaut: welche Gewohnheiten heute erscheinen, in
 * welchem Zustand, mit welcher Flamme. Wer das aendert, aendert es fuer beide
 * Apps - genau das ist der Zweck.
 *
 * Geschrieben wird hier nichts. Der Weg dafuer bleibt log.js.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import {
  pruefeHeute, tagPlus, status, straehneFuer, ergaenzeStilleTage, istObergrenze,
} from "../../_lib/tag.js";
import { istHeuteDran, ruhtHeute, erledigtDieseWoche } from "../../_lib/heute.js";

// Wie weit zurueck Logs fuer die Straehne geladen werden - dieselbe Spanne wie
// im Bootstrap, sonst faellt die Zahl hier anders aus als dort.
const LOG_TAGE = 730;

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const heute = new URL(request.url).searchParams.get("heute") || "";
  const meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  const historieAb = tagPlus(heute, -LOG_TAGE);

  try {
    const gewohnheiten = (await env.DB.prepare(
      `SELECT id, name, typ, zielmenge, einheit, richtung, rhythmus, wochentage_maske,
              wochenziel, position, created_at
         FROM gewohnheiten
        WHERE user_id = ? AND archiviert = 0
        ORDER BY position, created_at`
    ).bind(nutzerId).all()).results;

    if (!gewohnheiten.length) {
      return json({ heute, gewohnheiten: [], wochenFertig: [], erledigt: 0, gesamt: 0 });
    }

    const logs = (await env.DB.prepare(
      `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals
         FROM gewohnheit_logs l
         JOIN gewohnheiten g ON g.id = l.gewohnheit_id
        WHERE g.user_id = ? AND l.datum >= ?`
    ).bind(nutzerId, historieAb).all()).results;

    // Je Gewohnheit die Tage in der Form, die _lib/heute.js erwartet.
    const zielVon = {};
    for (const g of gewohnheiten) zielVon[g.id] = g.zielmenge;
    const tageVon = {};
    for (const l of logs) {
      const eimer = tageVon[l.gewohnheit_id] || (tageVon[l.gewohnheit_id] = {});
      // Fuer den Status zaehlt das Ziel, das beim Loggen galt - sonst faerbt
      // ein spaeter angehobenes Ziel alte gruene Tage nachtraeglich gelb.
      eimer[l.datum] = {
        menge: l.menge,
        ziel: l.ziel_damals != null ? l.ziel_damals : zielVon[l.gewohnheit_id],
      };
    }

    const liste = [];
    const wochenFertig = [];

    for (const g of gewohnheiten) {
      const tage = tageVon[g.id] || {};

      if (!istHeuteDran(g, tage, heute)) {
        // Der einzige Grund, aus dem eine Gewohnheit heute lautlos fehlt: das
        // Wochenziel steht schon. Ein falscher Wochentag ist erwartbar und
        // braucht keine Zeile.
        if (g.rhythmus === "x_pro_woche" && !istObergrenze(g)) wochenFertig.push(g.name);
        continue;
      }

      const heutiger = tage[heute];
      const ziel = heutiger ? heutiger.ziel : g.zielmenge;
      // "ruht": eine Obergrenze, in die heute noch nichts eingetragen ist -
      // weder offen noch erledigt.
      const zustand = heutiger
        ? status(g.typ, heutiger.menge, heutiger.ziel, g.richtung)
        : (ruhtHeute(g, tage, heute) ? "ruht" : "offen");

      // Straehne aus der vollen Historie, inklusive der stillen Tage einer
      // Obergrenze - dieselbe Rechnung wie im Bootstrap.
      const gruene = new Set();
      for (const [datum, eintrag] of Object.entries(tage)) {
        if (status(g.typ, eintrag.menge, eintrag.ziel, g.richtung) === "erledigt") gruene.add(datum);
      }
      ergaenzeStilleTage(gruene, g, Object.keys(tage), historieAb, heute);

      liste.push({
        id: g.id,
        name: g.name,
        typ: g.typ,
        einheit: g.einheit,
        obergrenze: istObergrenze(g),
        menge: heutiger ? heutiger.menge : 0,
        ziel,
        zustand,
        straehne: straehneFuer(g, gruene, heute),
        // Bei 'x_pro_woche' zaehlt die Straehne ganze WOCHEN, nicht Tage - ohne
        // die Einheit stuende in der Anzeige "1 Tage" fuer eine Woche.
        straehneEinheit: g.rhythmus === "x_pro_woche" ? "Wochen" : "Tage",
        wochenziel: g.rhythmus === "x_pro_woche" ? g.wochenziel : null,
        wochenErledigt: g.rhythmus === "x_pro_woche" ? erledigtDieseWoche(g, tage, heute) : null,
      });
    }

    // Ruhende Obergrenzen zaehlen nicht mit - sonst stuende hier "5 von 8",
    // obwohl drei davon heute nichts von einem wollen.
    const zaehlend = liste.filter(g => g.zustand !== "ruht");
    return json({
      heute,
      gewohnheiten: liste,
      wochenFertig,
      erledigt: zaehlend.filter(g => g.zustand === "erledigt").length,
      gesamt: zaehlend.length,
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Lesen" }, 500);
  }
}
