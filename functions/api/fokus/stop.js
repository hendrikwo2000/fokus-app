/**
 * Sitzung beenden und ins Log schreiben.
 *
 * Derselbe Weg fuer beide Faelle: vorzeitig abgebrochen (dann steht die
 * tatsaechliche Zeit drin und `vollstaendig` ist false) und regulaer
 * durchgelaufen. Die App ruft ihn auch von selbst auf, wenn der Countdown
 * abgelaufen ist - und wenn nicht, holt sie es beim naechsten Oeffnen nach.
 */

import { json } from "../../_lib/antwort.js";
import { nutzerOderFehler } from "../../_lib/zugang.js";
import { offeneSitzung, beendeSitzung } from "../../_lib/fokus.js";

export async function onRequestPost({ request, env }) {
  const { nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    const sitzung = await offeneSitzung(env, nutzerId);
    // Kein Fehler: zwei Tabs koennen gleichzeitig "fertig" melden, und beim
    // zweiten ist schlicht nichts mehr zu tun.
    if (!sitzung) return json({ ok: true, sitzung: null });

    return json({ ok: true, sitzung: await beendeSitzung(env, sitzung) });
  } catch (e) {
    return json({ error: "Datenbankfehler beim Beenden" }, 500);
  }
}
