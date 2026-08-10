"use strict";

/* ====================================================================
   Service Worker - cached nur die App-Shell (statische Dateien), damit
   die Seite auch ohne Internet ueberhaupt laedt. /api/* wird bewusst NICHT
   angefasst.

   Strategie: network-first mit Cache-Fallback, nicht cache-first. Ein Push
   auf main deployt sofort live (kein Build-Schritt, keine gehashten
   Dateinamen) - so sieht "online" immer die neueste Version, "offline" die
   zuletzt gecachte.

   WICHTIG: Bei jeder Aenderung an einer der unten aufgelisteten Dateien
   diese Versionsnummer hochzaehlen, sonst bleibt ein wiederkehrender Nutzer
   auf dem alten Stand haengen (activate() raeumt den alten Cache nur auf,
   wenn sich der Name aendert). Siehe BETRIEB.md.
   ==================================================================== */
const CACHE_NAME = "fokus-shell-v8";

const SHELL_FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((namen) => Promise.all(
        namen.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

/* ====================================================================
   Push-Benachrichtigungen. Payload kommt von functions/api/push/pruefen.js:
   { title, body, badge (Zahl heute offener Gewohnheiten), url }.

   setAppBadge() im selben Event wie showNotification() gesetzt - so
   aktualisiert sich die Zahl auf dem Home-Bildschirm-Icon (iOS 16.4+/
   Android) auch dann, wenn die App gerade gar nicht offen ist. showNotification()
   ist Pflicht: ohne sie zeigen Chrome/Safari sonst selbst eine generische
   Meldung ("Seite wurde aktualisiert"), das waere schlechter als die echte.
   ==================================================================== */
self.addEventListener("push", (event) => {
  let daten = {};
  try { daten = event.data ? event.data.json() : {}; } catch (e) { /* leer bleibt */ }

  const titel = daten.title || "Fokus-Tracker";
  const optionen = {
    body: daten.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: daten.url || "/" },
  };

  event.waitUntil((async () => {
    await self.registration.showNotification(titel, optionen);
    if (typeof daten.badge === "number" && "setAppBadge" in self.registration) {
      await self.registration.setAppBadge(daten.badge).catch(() => {});
    }
  })());
});

// Klick auf die Benachrichtigung: vorhandenes Fenster fokussieren statt
// immer ein neues zu oeffnen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const ziel = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clientsList) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) return c.focus();
    }
    return self.clients.openWindow(ziel);
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Nur eigene, statische GETs behandeln - /api/* und fremde Origins normal
  // durchlassen, damit app.js deren Fehlerbehandlung unveraendert greift.
  if (event.request.method !== "GET") return;
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((antwort) => {
        const kopie = antwort.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, kopie));
        return antwort;
      })
      .catch(() => caches.match(event.request)
        .then((gecacht) => gecacht || caches.match("/index.html")))
  );
});
