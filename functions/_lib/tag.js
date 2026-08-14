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
 * in BEIDEN Modi nur Tage mit echtem Eintrag (siehe flammeFuer weiter unten).
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
 * ZWEI ZAEHLWEISEN FUER DIE FLAMME
 *
 * Seit dem 15.08.2026 entscheidet ein Schalter in den Einstellungen, welche
 * gilt - kontoweit, in `fokus_einstellungen.flammen_modus`:
 *
 * - 'absolut' (Standard): an WIE VIELEN Tagen die Gewohnheit erledigt wurde.
 *   Ein Fehltag kostet nichts, er bringt nur nichts.
 * - 'reihe': Tage am STUECK. Ein Fehltag setzt auf null.
 *
 * Beide rechnen auf derselben Menge `gruene`, und die enthaelt ausschliesslich
 * Tage mit ECHTEM Eintrag. Die geschenkten Tage einer Obergrenze
 * (stillerTagZaehlt) gehoeren in KEINEM Modus dazu - im Reihen-Modus brechen
 * sie die Kette sogar (Hendriks Entscheidung, gefragt: "nur Eintraege
 * zaehlen"). Fuer Kalenderfarbe, Tagesbilanz und Statistik gilt die Schenkung
 * unveraendert weiter, nur die Flamme sieht sie nicht.
 *
 * Nirgends gespeichert, bei jeder Abfrage live aus den Mengen gerechnet: ein
 * nachgetragener Tag hebt die Zahl von selbst, ein geloeschter senkt sie.
 */
export const FLAMMEN_MODI = ["absolut", "reihe"];
export const FLAMMEN_MODUS_STANDARD = "absolut";

export function istFlammenModus(wert) {
  return FLAMMEN_MODI.includes(wert);
}

// 'absolut': schlicht die Anzahl der gruenen Tage.
export function flammenZahl(gruene) {
  return gruene ? gruene.size : 0;
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

// Wochentag-Index eines Datums, 0=Mo .. 6=So - dieselbe Verschiebung wie in
// montagVon(). Bit i (1<<i) dieses Index ist die Position in wochentage_maske.
function wochentagIndex(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  return (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7;
}

function istGeplant(datum, maske) {
  return (maske & (1 << wochentagIndex(datum))) !== 0;
}

/**
 * Straehne fuer den Rhythmus 'wochentage': zaehlt geplante Tage in Folge,
 * nicht-geplante Kalendertage werden beim Rueckwaertslaufen stillschweigend
 * uebersprungen - nur ein geplanter, aber nicht gruener Tag bricht die Kette.
 *
 * Wie bei straehne() zaehlt ein geplanter, aber noch nicht abgehakter
 * heutiger Tag nicht als Bruch - sonst stuende die Straehne jeden Morgen auf
 * null, bevor ueberhaupt Zeit war, ihn zu erledigen.
 */
export function straehneWochentage(gruene, heute, maske) {
  let tag = (istGeplant(heute, maske) && !gruene.has(heute)) ? tagPlus(heute, -1) : heute;

  let laenge = 0;
  // Deckel ueber Kalendertage, nicht ueber geplante Tage: bei nur einem
  // Wochentag pro Woche waeren 3700 geplante Tage ueber 71 Jahre verteilt.
  let kalendertage = 0;
  while (kalendertage < 26000) {
    kalendertage++;
    if (!istGeplant(tag, maske)) { tag = tagPlus(tag, -1); continue; }
    if (!gruene.has(tag)) break;
    laenge++;
    tag = tagPlus(tag, -1);
  }
  return laenge;
}

function grueneInWoche(gruene, wocheStart) {
  let n = 0;
  for (let i = 0; i < 7; i++) if (gruene.has(tagPlus(wocheStart, i))) n++;
  return n;
}

/**
 * Straehne fuer den Rhythmus 'x_pro_woche': zaehlt nicht Tage, sondern ganze
 * Wochen in Folge, in denen mindestens `ziel` Tage gruen waren.
 *
 * Die laufende Woche zaehlt nur mit, wenn ihr Ziel JETZT schon erreicht ist -
 * sonst stuende die Straehne montags frueh auf null, obwohl die Woche gerade
 * erst angefangen hat.
 */
export function straehneXProWoche(gruene, heute, ziel) {
  const zielZahl = Math.max(1, Number(ziel) || 1);
  let wocheStart = montagVon(heute);
  if (grueneInWoche(gruene, wocheStart) < zielZahl) wocheStart = tagPlus(wocheStart, -7);

  let laenge = 0;
  let wochen = 0;
  while (wochen < 3700) {
    wochen++;
    if (grueneInWoche(gruene, wocheStart) < zielZahl) break;
    laenge++;
    wocheStart = tagPlus(wocheStart, -7);
  }
  return laenge;
}

/**
 * Der EINE Einstiegspunkt fuer alle drei Endpunkte (Bootstrap, Tagesliste,
 * Tag-Speichern), damit die Zuordnung Modus/Rhythmus -> Funktion nur an einer
 * Stelle steht. `gewohnheit` braucht `rhythmus`, `wochentage_maske`,
 * `wochenziel` (Rohspalten-Namen wie in der DB).
 */
export function flammeFuer(gewohnheit, gruene, heute, modus) {
  if (modus !== "reihe") return flammenZahl(gruene);
  if (gewohnheit.rhythmus === "wochentage") {
    return straehneWochentage(gruene, heute, gewohnheit.wochentage_maske);
  }
  if (gewohnheit.rhythmus === "x_pro_woche") {
    return straehneXProWoche(gruene, heute, gewohnheit.wochenziel);
  }
  return straehne(gruene, heute);
}

/**
 * Die Einheit hinter der Zahl. Nur EIN Fall weicht ab: 'x_pro_woche' im
 * Reihen-Modus zaehlt ganze WOCHEN (siehe straehneXProWoche), sonst stuende
 * "1 Tage" fuer eine volle Woche auf der Karte.
 *
 * Hendrik kennt diesen einen Ausreisser - er hat "die alte Logik exakt
 * zurueck" gewaehlt, obwohl die Anzeige damit nicht mehr ueberall gleich
 * aussieht. Nicht als Versehen behandeln.
 */
export function flammenEinheit(gewohnheit, modus) {
  return (modus === "reihe" && gewohnheit.rhythmus === "x_pro_woche") ? "Wochen" : "Tage";
}
