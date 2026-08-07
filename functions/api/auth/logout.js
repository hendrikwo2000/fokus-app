/**
 * Abmelden: Sitzung serverseitig loeschen und Cookie entwerten.
 *
 * Wichtig ist der erste Teil. Nur das Cookie zu loeschen wuerde reichen, damit
 * DIESER Browser nicht mehr reinkommt - das Token bliebe aber gueltig, und wer
 * es vorher abgegriffen hat, koennte es weiterbenutzen.
 *
 * Meldet auch aus der ToDo-Liste ab: es ist eine geteilte Sitzung, keine
 * zweite. Das steht so auch in der Rueckfrage, die die App vorher zeigt -
 * ein stilles "hoppla, jetzt bin ich drueben auch raus" waere schlechter.
 */

import { COOKIE_NAME, liesCookie, hashHex, loescheSessionCookies, mitCookies } from "../../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const token = liesCookie(request, COOKIE_NAME);
  if (token && env.DB) {
    try {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
        .bind(await hashHex(token)).run();
    } catch (e) {
      // Cookie trotzdem entwerten - abmelden soll nie an der Datenbank
      // scheitern, sonst haengt jemand in einer Sitzung fest.
    }
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: mitCookies({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    }, loescheSessionCookies(request)),
  });
}
