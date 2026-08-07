/**
 * Wer darf den Fokus-Tracker benutzen?
 *
 * Die Anmeldung teilt sich diese App mit der ToDo-Liste - wer dort ein Konto
 * hat, hat also automatisch eine gueltige Sitzung, sobald er hier vorbeikommt.
 * Das reicht bewusst NICHT: der Fokus-Tracker ist ein Eigennutz-Werkzeug, kein
 * Angebot fuer alle ToDo-Nutzer. Sonst gaebe jede Wartelisten-Freischaltung
 * drueben stillschweigend auch hier Zugang.
 *
 * Erlaubte Adressen stehen in der Umgebungsvariable FOKUS_ZUGANG, kommagetrennt:
 *
 *     FOKUS_ZUGANG = hendrik.wolf.004@gmail.com
 *
 * Adressen statt Nutzer-IDs, weil man sie im Cloudflare-Dashboard aendern kann,
 * ohne vorher in der Datenbank nachzusehen, welche ID zu wem gehoert.
 *
 * Fehlt die Variable, kommt NIEMAND rein. Lieber ausgesperrt als offen: ein
 * vergessener Eintrag faellt beim ersten Anmeldeversuch auf, eine offene App
 * faellt gar nicht auf.
 */

import { angemeldeterNutzer } from "./session.js";
import { json } from "./antwort.js";

export function darfRein(env, email) {
  const liste = String(env.FOKUS_ZUGANG || "")
    .split(",")
    .map(a => a.trim().toLowerCase())
    .filter(Boolean);
  if (!liste.length) return false;
  return liste.includes(String(email || "").trim().toLowerCase());
}

/**
 * Angemeldet UND freigeschaltet - oder eine fertige Fehlerantwort in `fehler`.
 *
 * Die Pruefung sitzt in JEDEM Daten-Endpunkt, nicht nur an der Anmeldemaske.
 * Sonst kaeme jemand mit einer gueltigen ToDo-Sitzung per curl direkt an die
 * API, ohne die Maske je gesehen zu haben.
 */
export async function nutzerOderFehler(request, env) {
  if (!env.DB) return { fehler: json({ error: "D1-Bindung DB fehlt im Pages-Projekt" }, 500) };

  let nutzer;
  try {
    nutzer = await angemeldeterNutzer(request, env);
  } catch (e) {
    return { fehler: json({ error: "Datenbankfehler" }, 500) };
  }
  if (!nutzer) return { fehler: json({ error: "Nicht angemeldet" }, 401) };

  // 403, nicht 401: angemeldet ist die Person ja. Ein 401 wuerde die App in die
  // Anmeldemaske schicken, wo sie sich endlos im Kreis anmelden koennte.
  if (!darfRein(env, nutzer.email)) {
    return { fehler: json({ error: "Dieses Konto ist für den Fokus-Tracker nicht freigeschaltet." }, 403) };
  }
  return { nutzer, nutzerId: nutzer.id };
}
