/**
 * Tage, Status und Straehnen.
 *
 * WARUM DAS DATUM VOM CLIENT KOMMT
 * Der Worker laeuft in UTC, gelebt wird in UTC+1/+2. Um 0:30 Uhr waere
 * serverseitig noch gestern - man hakt etwas ab und es landet auf dem falschen
 * Tag. Deshalb schickt die App ihr eigenes, lokal gebautes Datum mit; der
 * Server prueft es nur auf Plausibilitaet. Dasselbe Muster wie todayStr() in
 * der ToDo-Liste.
 *
 * WARUM DER STATUS NICHT GESPEICHERT WIRD
 * Gruen/gelb/offen ergibt sich aus Menge und Ziel. Ein zusaetzlich
 * gespeicherter Status koennte davon abweichen, sobald irgendwo nur eins von
 * beiden geschrieben wird - abgeleitet kann er das nie. Damit die Historie
 * trotzdem stabil bleibt, merkt sich jeder Log-Eintrag in `ziel_damals` das
 * Ziel, das beim Loggen galt: hebst du spaeter das Ziel von 30 auf 60 an,
 * bleiben alte gruene Tage gruen.
 */

const DATUM_MUSTER = /^\d{4}-\d{2}-\d{2}$/;

export function istDatum(wert) {
  const s = String(wert || "");
  if (!DATUM_MUSTER.test(s)) return false;
  // Muster allein laesst 2026-02-31 durch. Zurueckformatieren deckt das auf.
  const [j, m, t] = s.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t));
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t;
}

// Datum um n Tage verschieben. Rechnung in UTC, weil hier reine Kalendertage
// gemeint sind - eine Sommerzeit-Umstellung darf daran nichts aendern.
export function tagPlus(datum, n) {
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t) + n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Das "heute" der App auf Plausibilitaet pruefen.
 *
 * Der Client darf das Datum bestimmen (siehe oben), aber nicht frei erfinden -
 * sonst liessen sich Straehnen in die Zukunft schreiben. Ein Tag Spielraum in
 * beide Richtungen deckt jede Zeitzone der Welt ab.
 */
export function pruefeHeute(heute) {
  if (!istDatum(heute)) return "Ungueltiges Datum";
  const jetzt = new Date();
  const p = (x) => String(x).padStart(2, "0");
  const utcHeute = `${jetzt.getUTCFullYear()}-${p(jetzt.getUTCMonth() + 1)}-${p(jetzt.getUTCDate())}`;
  if (heute < tagPlus(utcHeute, -1) || heute > tagPlus(utcHeute, 1)) {
    return "Das Datum passt nicht zur Serverzeit";
  }
  return null;
}

// Ein zu loggender Tag: gueltig und nicht in der Zukunft. Nachtragen geht
// beliebig weit zurueck - genau das ist der Sinn der Verlaufsansicht.
export function pruefeLogDatum(datum, heute) {
  if (!istDatum(datum)) return "Ungueltiges Datum";
  if (datum > heute) return "Tage in der Zukunft lassen sich nicht eintragen";
  return null;
}

// Montag der Woche, in der `datum` liegt. Fuer die Wochenstatistik des
// Fokus-Timers. getUTCDay() zaehlt ab Sonntag (0), deshalb die Verschiebung.
export function montagVon(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  const wochentag = new Date(Date.UTC(j, m - 1, t)).getUTCDay();
  return tagPlus(datum, -((wochentag + 6) % 7));
}

/**
 * 'offen' | 'teilweise' | 'erledigt' aus Menge und Ziel.
 *
 * Binaere Gewohnheiten haben kein Ziel und kennen kein "teilweise" - dort ist
 * jede Menge ab 1 erledigt.
 */
export function status(typ, menge, ziel) {
  const m = Number(menge) || 0;
  if (typ === "binaer") return m >= 1 ? "erledigt" : "offen";
  const z = Number(ziel) || 0;
  if (z > 0 && m >= z) return "erledigt";
  return m > 0 ? "teilweise" : "offen";
}

/**
 * Laenge der aktuellen Straehne, in Tagen.
 *
 * Zaehlt von heute rueckwaerts, solange die Tage gruen sind. Ist HEUTE noch
 * nicht gruen, beginnt die Zaehlung bei gestern - sonst staende die Straehne
 * jeden Morgen um 0:01 Uhr auf null, obwohl der Tag gerade erst angefangen hat.
 *
 * Weil live aus den gespeicherten Mengen gerechnet wird, heilt die Straehne
 * beim Nachtragen von selbst. Genau so gewollt: traegst du einen gelben Tag
 * nachtraeglich voll, war die Kette rueckwirkend nie unterbrochen.
 */
export function straehne(gruene, heute) {
  let tag = gruene.has(heute) ? heute : tagPlus(heute, -1);
  let laenge = 0;
  // Deckel gegen eine Endlosschleife bei kaputten Daten. 10 Jahre am Stueck
  // waeren beachtlich, aber irgendwo muss Schluss sein.
  while (gruene.has(tag) && laenge < 3700) {
    laenge++;
    tag = tagPlus(tag, -1);
  }
  return laenge;
}
