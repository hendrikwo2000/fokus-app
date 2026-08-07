/**
 * Bootstrap des Fokus-Bereichs: laufende Sitzung, Einstellungen, Statistik.
 *
 * Eine Anfrage beim Oeffnen der Ansicht. Laeuft noch eine Sitzung - weil der
 * Tab zu war, das Handy gesperrt oder ein anderes Geraet sie gestartet hat -
 * kommt sie hier zurueck, und die App setzt den Countdown an der richtigen
 * Stelle fort.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { pruefeHeute, tagPlus, montagVon } from "../../_lib/tag.js";
import { offeneSitzung, alsOffeneSitzung, arbeitMinVon } from "../../_lib/fokus.js";

// Wie viele Wochen die Statistik zeigt.
const WOCHEN = 8;

export async function onRequestGet({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const heute = new URL(request.url).searchParams.get("heute") || "";
  const meldung = pruefeHeute(heute);
  if (meldung) return json({ error: meldung }, 400);

  try {
    const [arbeitMin, offen] = await Promise.all([
      arbeitMinVon(env, nutzerId),
      offeneSitzung(env, nutzerId),
    ]);

    // Tagessummen holen und in JS zu Wochen buendeln, statt per strftime('%W')
    // zu gruppieren: die SQL-Wochennummer stolpert ueber den Jahreswechsel,
    // und "Woche ab Montag" ist mit tagPlus/montagVon eindeutig.
    const ersterMontag = montagVon(tagPlus(heute, -(WOCHEN - 1) * 7));
    const tage = (await env.DB.prepare(
      `SELECT datum, SUM(echte_min) AS min
         FROM fokus_sitzungen
        WHERE user_id = ? AND echte_min IS NOT NULL AND datum >= ?
        GROUP BY datum`
    ).bind(nutzerId, ersterMontag).all()).results;

    // Leere Wochen muessen im Balkendiagramm als Luecke auftauchen, nicht
    // fehlen - sonst sieht eine Pause aus wie durchgearbeitet.
    const wochen = [];
    const nachStart = {};
    for (let i = 0; i < WOCHEN; i++) {
      const start = tagPlus(ersterMontag, i * 7);
      nachStart[start] = { start, minuten: 0 };
      wochen.push(nachStart[start]);
    }
    for (const t of tage) {
      const eimer = nachStart[montagVon(t.datum)];
      if (eimer) eimer.minuten += t.min;
    }

    const dieseWoche = wochen[wochen.length - 1].minuten;
    const heuteMin = tage.find(t => t.datum === heute)?.min || 0;
    // Durchschnitt ueber die abgeschlossenen Wochen - die laufende ist noch
    // nicht fertig und wuerde den Schnitt jeden Montag kuenstlich druecken.
    const fertige = wochen.slice(0, -1);
    const schnitt = fertige.length
      ? Math.round(fertige.reduce((s, w) => s + w.minuten, 0) / fertige.length)
      : 0;

    return json({
      einstellungen: { arbeitMin },
      offen: offen ? alsOffeneSitzung(offen) : null,
      wochen,
      dieseWoche,
      heuteMin,
      schnitt,
    });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Lesen" }, 500);
  }
}
