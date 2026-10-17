/**
 * fokus.it-wolf.org ist seit Oktober 2026 nur noch eine Weiterleitung.
 *
 * Die Fokus-App (Gewohnheiten + Pomodoro) ist in der ToDo-App aufgegangen -
 * Hendriks Auftrag: "Fusion aus ToDo App und Focus, damit die Focus App weg
 * kann". Gewohnheiten, Verlauf und Sitzungen lagen schon immer in derselben
 * D1-Datenbank, dort sind sie weiter.
 *
 * Bewusst eine Function und keine _redirects-Datei: Pages wendet _redirects
 * nicht auf Function-Routen an, laesst Query-Strings nicht gezielt durch und
 * kennt keine Ausnahmen je Pfad. Hier braucht es drei Faelle:
 *
 *   /sw.js            ein Service Worker, der den alten abbaut (siehe unten)
 *   /api/auth/link    alte Anmeldelinks aus Mails - samt ?t=..., denn
 *                     login_codes ist dieselbe Tabelle, der Link loest drueben
 *                     genauso ein
 *   /api/*            410 mit Hinweis statt Weiterleitung: ein noch offener
 *                     alter Tab bekaeme sonst eine fremde Seite als JSON und
 *                     zeigte nur "Keine Verbindung"
 *   alles andere      302 auf die Startseite der ToDo-App
 *
 * 302 statt 301: Browser merken sich ein 301 dauerhaft. Soll die Adresse je
 * wieder etwas anderes zeigen, waere sie sonst bei jedem frueheren Besucher
 * verbaut.
 */

const ZIEL = "https://todo.it-wolf.org";

/**
 * Ersetzt den Service Worker der frueheren Fokus-App, sobald ein Browser nach
 * einer neuen Fassung fragt: loescht dessen Offline-Speicher, meldet sich ab
 * und schickt offene Fenster zur ToDo-App. Ohne ihn bliebe auf einem Handy mit
 * installierter Fokus-App der alte Zwischenspeicher liegen. Weiterleiten
 * wuerde der alte Worker ohnehin (network-first) - das hier ist nur das
 * Aufraeumen.
 */
const AUFRAEUM_SW = `"use strict";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen.map((n) => caches.delete(n)));
    await self.registration.unregister();
    const fenster = await self.clients.matchAll({ type: "window" });
    for (const f of fenster) {
      try { await f.navigate("${ZIEL}/"); } catch (e) { /* dann eben beim naechsten Oeffnen */ }
    }
  })());
});
`;

export async function onRequest({ request }) {
  const url = new URL(request.url);

  if (url.pathname === "/sw.js") {
    return new Response(AUFRAEUM_SW, {
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  if (url.pathname === "/api/auth/link") {
    return Response.redirect(`${ZIEL}/api/auth/link${url.search}`, 302);
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({
      error: "Die Fokus-App ist in die ToDo-Liste umgezogen: todo.it-wolf.org",
    }), {
      status: 410,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return Response.redirect(`${ZIEL}/`, 302);
}
