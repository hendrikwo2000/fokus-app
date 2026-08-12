/**
 * Was verlangt eine Gewohnheit HEUTE?
 *
 * Diese Fragen ("ist sie heute ueberhaupt dran", "ruht sie", "ist sie noch
 * offen") beantwortete der Server bisher nur an einer Stelle: in
 * api/push/pruefen.js, als ausdrueckliche Spiegelung der gleichnamigen
 * Funktionen im Client (app.js). Seit die ToDo-Liste dieselbe Heute-Ansicht
 * zeigt (api/gewohnheiten/heute.js), braeuchte es die Logik ein drittes Mal -
 * deshalb steht sie jetzt hier, und pruefen.js holt sie sich von hier.
 *
 * Die Client-Fassung in app.js bleibt bestehen: sie rechnet auf `state.logs`
 * und muss ohne Netz auskommen. Aendert sich hier eine Regel, gehoert sie
 * dort mitgezogen - die beiden sind bewusst nicht zusammengelegt, weil der
 * Client seine Daten anders haelt als der Server.
 *
 * Datenform `tage` ueberall gleich: { "YYYY-MM-DD": { menge, ziel } } fuer
 * EINE Gewohnheit. Fehlt ein Tag, gibt es dazu keine Zeile in der Datenbank.
 */

import { status, montagVon, tagPlus, stillerTagZaehlt, istObergrenze } from "./tag.js";

// Wochentag-Index eines Datums, 0=Mo .. 6=So - wie wochentagIndex() in
// _lib/tag.js (dort nicht exportiert).
function wochentagIndex(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  return (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7;
}

export function istGeplant(gewohnheit, datum) {
  if (gewohnheit.rhythmus !== "wochentage") return true;
  return (gewohnheit.wochentage_maske & (1 << wochentagIndex(datum))) !== 0;
}

// Status eines Tages: der Eintrag, wenn es einen gibt, sonst "erledigt" bei
// einer stillen Obergrenze und ansonsten "offen".
export function zustandVon(gewohnheit, tage, datum, heute) {
  const eintrag = tage[datum];
  if (eintrag) return status(gewohnheit.typ, eintrag.menge, eintrag.ziel, gewohnheit.richtung);
  return stillerTagZaehlt(gewohnheit, datum, heute) ? "erledigt" : "offen";
}

// Zahl der in dieser Woche (Montag bis heute) bereits erledigten Tage - fuer
// den Wochenfortschritt bei 'x_pro_woche'.
export function erledigtDieseWoche(gewohnheit, tage, heute) {
  const start = montagVon(heute);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const tag = tagPlus(start, i);
    if (tag > heute) break;
    if (zustandVon(gewohnheit, tage, tag, heute) === "erledigt") n++;
  }
  return n;
}

/**
 * Verlangt diese Gewohnheit heute gar nichts?
 *
 * Nur eine Obergrenze, und nur solange nichts eingetragen ist. Sie hat kein
 * Soll, das man erfuellen muesste - "keine Zigarette" ist der Normalfall, kein
 * Tagwerk. Ab morgen zaehlt der Tag ohnehin von allein als eingehalten
 * (stillerTagZaehlt).
 */
export function ruhtHeute(gewohnheit, tage, heute) {
  return istObergrenze(gewohnheit) && !tage[heute];
}

/**
 * Ob eine Gewohnheit heute ueberhaupt in der Liste erscheint. 'wochentage':
 * nur an geplanten Tagen. 'x_pro_woche': nur solange das Wochenziel noch nicht
 * erreicht ist - danach verschwindet sie fuer den Rest der Woche.
 *
 * AUSNAHME Obergrenze: die bleibt die ganze Woche stehen. "5 Mal die Woche
 * hoechstens 60 Min" heisst nicht, dass die Grenze ab dem fuenften Tag nicht
 * mehr gilt - waere die Karte weg, liesse sich ein Ausrutscher am sechsten Tag
 * gar nicht mehr eintragen.
 */
export function istHeuteDran(gewohnheit, tage, heute) {
  if (gewohnheit.rhythmus === "wochentage") return istGeplant(gewohnheit, heute);
  if (gewohnheit.rhythmus === "x_pro_woche" && !istObergrenze(gewohnheit)) {
    return erledigtDieseWoche(gewohnheit, tage, heute) < gewohnheit.wochenziel;
  }
  return true;
}

/**
 * Heute dran UND noch nicht erledigt - die Zaehlweise hinter der Zahl am
 * App-Icon und der Abenderinnerung (api/push/pruefen.js).
 */
export function nochOffen(gewohnheit, tage, heute) {
  if (!istHeuteDran(gewohnheit, tage, heute)) return false;
  if (gewohnheit.rhythmus === "x_pro_woche" && !istObergrenze(gewohnheit)) {
    // istHeuteDran hat das Wochenziel schon geprueft: sie ist dran, also offen.
    return true;
  }
  const heutiger = tage[heute];
  // Kein Eintrag heisst offen - und zwar ohne status() zu fragen: bei einer
  // Obergrenze waere die 0 dort "erledigt" (siehe _lib/tag.js), ein noch gar
  // nicht angefasster Tag wuerde also faelschlich als geschafft gelten.
  //
  // AUSSER bei einer Obergrenze: die ruht, solange nichts eingetragen ist
  // (ruhtHeute) - abends daran zu erinnern hiesse, eine Bestaetigung
  // einzufordern, die die App sich selbst gibt.
  if (!heutiger) return !istObergrenze(gewohnheit);
  const st = status(gewohnheit.typ, heutiger.menge, heutiger.ziel, gewohnheit.richtung);
  return st === "offen" || st === "teilweise";
}
