/**
 * Wer darf den Fokus-Tracker benutzen?
 *
 * Die Anmeldung teilt sich diese App mit der ToDo-Liste - wer dort ein Konto
 * hat, hat also automatisch eine gueltige Sitzung, sobald er hier vorbeikommt.
 * Das reicht bewusst NICHT: der Fokus-Tracker ist ein Eigennutz-Werkzeug, kein
 * Angebot fuer alle ToDo-Nutzer. Sonst gaebe jede Wartelisten-Freischaltung
 * drueben stillschweigend auch hier Zugang.
 *
 * Erlaubt ist, wer in der GETEILTEN users-Tabelle mit fokus_zugang=1 steht.
 * Frueher eine Umgebungsvariable (FOKUS_ZUGANG) auf diesem Pages-Projekt -
 * jetzt eine Spalte in der Datenbank, damit sich der Zugang aus demselben
 * Dashboard vergeben laesst wie der ToDo-Zugang (todo.it-wolf.org/admin).
 *
 * Fehlt ein Konto oder ist fokus_zugang 0, kommt niemand rein. Lieber
 * ausgesperrt als offen.
 */

import { angemeldeterNutzer } from "./session.js";
import { json } from "./antwort.js";

export async function darfRein(env, email) {
  const adresse = String(email || "").trim().toLowerCase();
  if (!adresse) return false;
  const zeile = await env.DB.prepare(
    "SELECT fokus_zugang FROM users WHERE email = ?"
  ).bind(adresse).first();
  return !!(zeile && zeile.fokus_zugang);
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

  let nutzer, erlaubt;
  try {
    nutzer = await angemeldeterNutzer(request, env);
    if (nutzer) erlaubt = await darfRein(env, nutzer.email);
  } catch (e) {
    return { fehler: json({ error: "Datenbankfehler" }, 500) };
  }
  if (!nutzer) return { fehler: json({ error: "Nicht angemeldet" }, 401) };

  // 403, nicht 401: angemeldet ist die Person ja. Ein 401 wuerde die App in die
  // Anmeldemaske schicken, wo sie sich endlos im Kreis anmelden koennte.
  if (!erlaubt) {
    return { fehler: json({ error: "Dieses Konto ist für den Fokus-Tracker nicht freigeschaltet." }, 403) };
  }
  return { nutzer, nutzerId: nutzer.id };
}
