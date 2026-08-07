/**
 * Eine JSON-Antwort, ueberall gleich.
 *
 * `no-store` ist hier nicht Kosmetik: die App fragt dieselben Endpunkte auf
 * mehreren Geraeten ab, und ein zwischengespeicherter Tagesstand waere schlimmer
 * als gar keiner - man haekchen etwas ab und sieht es beim naechsten Laden wieder
 * offen.
 */

import { mitCookies } from "./session.js";

export function json(body, status = 200, cookies = []) {
  return new Response(JSON.stringify(body), {
    status,
    headers: mitCookies({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, cookies),
  });
}

// Anfragekoerper lesen, ohne dass ungueltiges JSON die Function abstuerzen
// laesst (das gaebe einen Cloudflare-Fehler 1101 statt einer lesbaren Meldung).
export async function liesJson(request) {
  try {
    return { body: await request.json() };
  } catch (e) {
    return { fehler: json({ error: "Ungueltiges JSON" }, 400) };
  }
}
