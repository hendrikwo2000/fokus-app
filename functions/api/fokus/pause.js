/**
 * Pause und Weiter - ein Umschalter, kein zweiter Endpunkt.
 *
 * Beim Pausieren wird nur der Zeitpunkt vermerkt. Beim Weitermachen wandert die
 * abgelaufene Pausenzeit nach `pause_gesamt_sek` und der Vermerk faellt weg.
 * Die verstrichene Fokuszeit ergibt sich damit weiter aus dem Startzeitpunkt -
 * es laeuft nirgends ein Zaehler mit, der einen Reload nicht ueberstehen wuerde.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { offeneSitzung, alsOffeneSitzung } from "../../_lib/fokus.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    const sitzung = await offeneSitzung(env, nutzerId);
    if (!sitzung) return json({ error: "Gerade läuft keine Sitzung." }, 404);

    if (sitzung.pausiert_seit) {
      await env.DB.prepare(
        `UPDATE fokus_sitzungen
            SET pause_gesamt_sek = pause_gesamt_sek + ?, pausiert_seit = NULL
          WHERE id = ?`
      ).bind(sitzung.pause_laufend_sek, sitzung.id).run();
    } else {
      await env.DB.prepare(
        "UPDATE fokus_sitzungen SET pausiert_seit = datetime('now') WHERE id = ?"
      ).bind(sitzung.id).run();
    }

    const neu = await offeneSitzung(env, nutzerId);
    return json({ ok: true, offen: neu ? alsOffeneSitzung(neu) : null });
  } catch (e) {
    return json({ error: "Datenbankfehler" }, 500);
  }
}
