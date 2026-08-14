/**
 * Tage, Status und die Flammen-Zahl.
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

/**
 * Groesste erlaubte Menge - fuer einen Tageseintrag wie fuer eine Zielmenge.
 *
 * Keine inhaltliche Grenze, sondern ein Deckel gegen Vertipper: 1440 Minuten
 * hat ein ganzer Tag, alles darueber ist ohnehin keine Menge mehr, die an
 * einem Tag zusammenkommt. 99999 laesst reichlich Luft und passt noch ins
 * Zahlenfeld der Tagesansicht, das 56 px breit ist.
 */
export const MAX_MENGE = 99999;

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
 * sonst liessen sich Tage in der Zukunft abhaken. Ein Tag Spielraum in beide
 * Richtungen deckt jede Zeitzone der Welt ab.
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
 * 'offen' | 'teilweise' | 'erledigt' | 'ueberschritten' aus Menge, Ziel und
 * Richtung.
 *
 * Binaere Gewohnheiten haben kein Ziel und kennen kein "teilweise" - dort ist
 * jede Menge ab 1 erledigt.
 *
 * Bei richtung='hoechstens' (Obergrenze, z.B. "Instagram-Minuten") gibt es
 * kein "teilweise" - es gibt kein sinnvolles "auf halbem Weg zum Limit", nur
 * "noch im Rahmen" (erledigt) oder "drüber" (ueberschritten). Auch die Menge 0
 * ist erledigt: bei einer Obergrenze ist sie der BESTE Tag, nicht der leere.
 *
 * ACHTUNG, Aufrufer: "offen" heisst bei 'hoechstens' damit ausschliesslich
 * "es gibt keine Log-Zeile". Fuer einen Tag ohne Eintrag darf status() nicht
 * mit menge=0 aufgerufen werden - der Tag ist dann direkt "offen" (siehe
 * nochOffen() in api/push/pruefen.js). Deshalb speichert log.js bei
 * 'hoechstens' die 0 als echte Zeile, statt sie wie sonst zu loeschen.
 */
export function status(typ, menge, ziel, richtung = "mindestens") {
  const m = Number(menge) || 0;
  if (typ === "binaer") return m >= 1 ? "erledigt" : "offen";
  const z = Number(ziel) || 0;

  if (richtung === "hoechstens") {
    // Kein "z > 0"-Vorbehalt: eine Grenze von 0 ("gar keine Zigarette") ist
    // erlaubt und muss ab der ersten Einheit ueberschritten sein.
    if (m > z) return "ueberschritten";
    return "erledigt";
  }

  if (z > 0 && m >= z) return "erledigt";
  return m > 0 ? "teilweise" : "offen";
}

// Eine Gewohnheit mit Obergrenze statt Soll. An mehreren Regeln beteiligt,
// deshalb an einer Stelle - Gegenstueck: istObergrenze() in app.js.
export function istObergrenze(gewohnheit) {
  return gewohnheit.typ === "menge" && gewohnheit.richtung === "hoechstens";
}

/**
 * Zaehlt ein Tag OHNE Eintrag bei dieser Gewohnheit als erledigt?
 *
 * Nur bei einer Obergrenze - und dort ist es die ehrlichere Lesart: wer gar
 * nicht auf Instagram war, hat die Grenze eingehalten, auch ohne das jeden
 * Abend zu bestaetigen. Bei einem Soll waere dieselbe Annahme geschenkt.
 *
 * Zwei Schranken, ohne die es Unsinn ergibt:
 * - **Nur die Vergangenheit.** Der heutige Tag bleibt offen, sonst waere er
 *   gruen, bevor er vorbei ist - und die Erinnerung (push/pruefen.js) haette
 *   nie etwas zu melden.
 * - **Erst ab dem Anlegen.** Ohne das faerbte der Kalender einer gestern
 *   angelegten Gewohnheit die vollen zwei Jahre davor gruen, und die Statistik
 *   rechnete sie als geschafft mit.
 *
 * Die Flamme sieht diese Schenkung seit dem 14.08.2026 NICHT mehr - sie zaehlt
 * nur Tage mit echtem Eintrag (siehe flammenZahl weiter unten).
 *
 * `angelegtAm` ist `gewohnheiten.created_at` (Datum reicht, Uhrzeit egal).
 */
export function stillerTagZaehlt(gewohnheit, datum, heute) {
  if (!istObergrenze(gewohnheit)) return false;
  if (datum >= heute) return false;
  const angelegt = String(gewohnheit.created_at || "").slice(0, 10);
  return !angelegt || datum >= angelegt;
}

/**
 * Die Zahl hinter der Flamme: an WIE VIELEN Tagen diese Gewohnheit erledigt
 * wurde. Insgesamt, nicht am Stueck.
 *
 * Bis zum 14.08.2026 war das eine Straehne - Tage in Folge, ein einziger
 * Fehltag setzte sie auf null, und jeder Rhythmus brachte seine eigene
 * Zaehlweise mit (nur geplante Tage bei 'wochentage', ganze WOCHEN bei
 * 'x_pro_woche'). Hendriks Entscheidung, gefragt: die Flamme soll nur noch
 * zaehlen, wie oft er es geschafft hat. Damit faellt die
 * Rhythmus-Unterscheidung ersatzlos weg - ein erledigter Tag ist ein
 * erledigter Tag, egal ob er geplant war -, und die Zahl geht nie zurueck,
 * ausser man loescht einen Eintrag.
 *
 * Nirgends gespeichert, bei jeder Abfrage live aus den Mengen gerechnet:
 * ein nachgetragener Tag hebt die Zahl von selbst, ein geloeschter senkt sie.
 *
 * `gruene` enthaelt ausschliesslich Tage mit ECHTEM Eintrag. Die geschenkten
 * Tage einer Obergrenze (stillerTagZaehlt) gehoeren ausdruecklich nicht dazu:
 * wer nichts eintraegt, treibt die Flamme nicht hoch. Fuer Kalenderfarbe,
 * Tagesbilanz und Statistik gilt die Schenkung unveraendert weiter - nur die
 * Flamme sieht sie nicht mehr.
 */
export function flammenZahl(gruene) {
  return gruene ? gruene.size : 0;
}
