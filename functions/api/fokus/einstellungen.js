/**
 * Die persoenlichen Einstellungen aendern: Standarddauer des Timers und
 * Zaehlweise der Flamme. Beide liegen in derselben Zeile, deshalb derselbe
 * Endpunkt - geschickt wird jeweils nur, was sich aendert.
 *
 * Eine laufende Sitzung bleibt von einer neuen Dauer unberuehrt - sie hat ihre
 * geplante Dauer beim Start mitbekommen. Waere es anders, wuerde ein Verstellen
 * mitten in der Arbeit den Countdown springen lassen.
 */

import { json, liesJson } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { MIN_DAUER, MAX_DAUER, einstellungenVon } from "../../_lib/fokus.js";
import { istFlammenModus } from "../../_lib/tag.js";

export async function onRequestPut({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  const { body, fehler: leseFehler } = await liesJson(request);
  if (leseFehler) return leseFehler;

  // Beide Felder optional, aber eins muss kommen - sonst waere der Aufruf ein
  // stiller Leerlauf, der wie ein Erfolg aussieht.
  const willDauer = body?.arbeitMin !== undefined;
  const willModus = body?.flammenModus !== undefined;
  if (!willDauer && !willModus) {
    return json({ error: "Nichts zu ändern" }, 400);
  }

  const arbeitMin = Number(body?.arbeitMin);
  if (willDauer && (!Number.isInteger(arbeitMin) || arbeitMin < MIN_DAUER || arbeitMin > MAX_DAUER)) {
    return json({ error: `Die Dauer muss zwischen ${MIN_DAUER} und ${MAX_DAUER} Minuten liegen.` }, 400);
  }

  const flammenModus = String(body?.flammenModus || "");
  if (willModus && !istFlammenModus(flammenModus)) {
    return json({ error: "Unbekannte Zählweise für die Flamme" }, 400);
  }

  try {
    // Erst die Zeile sicherstellen (mit den bisherigen Werten als Grundlage),
    // dann gezielt ueberschreiben. Ohne den Umweg wuerde ein PUT mit nur einem
    // Feld beim ersten Mal den anderen Wert auf die Schema-Vorgabe setzen.
    const alt = await einstellungenVon(env, nutzerId);
    const neueDauer = willDauer ? arbeitMin : alt.arbeitMin;
    const neuerModus = willModus ? flammenModus : alt.flammenModus;

    await env.DB.prepare(
      `INSERT INTO fokus_einstellungen (user_id, arbeit_min, flammen_modus) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         arbeit_min = excluded.arbeit_min,
         flammen_modus = excluded.flammen_modus`
    ).bind(nutzerId, neueDauer, neuerModus).run();

    return json({ ok: true, arbeitMin: neueDauer, flammenModus: neuerModus });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Speichern" }, 500);
  }
}
