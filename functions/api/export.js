/**
 * Alle eigenen Daten als eine JSON-Datei zum Herunterladen.
 *
 * Gewohnheiten, Historie und Sitzungen liegen sonst nur in der einen
 * D1-Datenbank. Das hier ist die Sicherung, die man sich selbst ziehen kann -
 * bewusst nur in diese Richtung: ein Import zurueck muesste entscheiden, was
 * bei bereits vorhandenen Tagen passiert, und das ist ein eigenes Vorhaben.
 *
 * Ausgegeben werden die ROHEN Spalten, nicht die aufbereitete Form der App
 * (alsGewohnheit in gewohnheiten/index.js). Eine Sicherung soll das abbilden,
 * was in der Datenbank steht, auch die Felder, die die Oberflaeche gerade
 * nicht anzeigt.
 *
 * Keine Begrenzung auf die letzten 730 Tage wie im Bootstrap: hier gilt
 * ausdruecklich alles.
 */

import { nutzerOderFehler } from "../_lib/zugang.js";
import { mitCookies } from "../_lib/session.js";

export async function onRequestGet({ request, env }) {
  const { nutzer, nutzerId, fehler } = await nutzerOderFehler(request, env);
  if (fehler) return fehler;

  try {
    const [gewohnheiten, logs, sitzungen, einstellungen] = await Promise.all([
      env.DB.prepare(
        `SELECT id, name, typ, zielmenge, einheit, richtung, rhythmus, wochentage_maske,
                wochenziel, position, archiviert, created_at
           FROM gewohnheiten WHERE user_id = ? ORDER BY position, created_at`
      ).bind(nutzerId).all(),
      env.DB.prepare(
        `SELECT l.gewohnheit_id, l.datum, l.menge, l.ziel_damals, l.updated_at
           FROM gewohnheit_logs l JOIN gewohnheiten g ON g.id = l.gewohnheit_id
          WHERE g.user_id = ? ORDER BY l.gewohnheit_id, l.datum`
      ).bind(nutzerId).all(),
      env.DB.prepare(
        `SELECT id, gestartet_am, datum, geplante_min, pause_gesamt_sek, echte_min, vollstaendig
           FROM fokus_sitzungen WHERE user_id = ? ORDER BY gestartet_am`
      ).bind(nutzerId).all(),
      env.DB.prepare(
        "SELECT arbeit_min FROM fokus_einstellungen WHERE user_id = ?"
      ).bind(nutzerId).first(),
    ]);

    const jetzt = new Date().toISOString().slice(0, 10);
    const daten = {
      app: "fokus.it-wolf.org",
      // Falls das Format sich je aendert, weiss ein spaeteres Werkzeug, was es
      // vor sich hat.
      version: 1,
      exportiertAm: new Date().toISOString(),
      konto: { name: nutzer.name, email: nutzer.email },
      gewohnheiten: gewohnheiten.results,
      logs: logs.results,
      fokusSitzungen: sitzungen.results,
      fokusEinstellungen: einstellungen || { arbeit_min: 25 },
    };

    return new Response(JSON.stringify(daten, null, 2), {
      headers: mitCookies({
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="fokus-export-${jetzt}.json"`,
        "Cache-Control": "no-store",
      }, []),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Datenbankfehler beim Export" }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}
