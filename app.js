"use strict";

/**
 * Fokus-Tracker - Gewohnheiten und Pomodoro.
 *
 * Kein Framework, kein Build. Der Ablauf ist derselbe wie in der ToDo-Liste:
 * beim Start einmal alles laden, danach nur noch einzelne Aenderungen
 * schicken. Bei 401 geht die Anmeldemaske auf, bei 403 der Gesperrt-Kasten.
 */

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

// Spiegel von MAX_MENGE in functions/_lib/tag.js. Hier nur, damit die Felder
// gar nicht erst mehr annehmen - verbindlich prueft der Server.
const MAX_MENGE = 99999;

const state = {
  gewohnheiten: [],
  logs: {},        // { gewohnheitId: { "2026-08-07": {menge, ziel, status} } }
  straehnen: {},
  historieAb: "", heute: "",
  email: "", name: "",
};

// Welche Gewohnheit und welcher Monat im Kalender-Verlauf gerade zu sehen
// sind. gewohnheitId faellt in renderVerlauf() auf die erste aktive
// Gewohnheit zurueck, sobald sie leer ist oder ins Archiv/Nirwana zeigt.
const verlauf = { gewohnheitId: null, monat: "" };

// Zeitraum der Statistik-Ansicht, in Tagen (7/30/90).
const statistik = { tage: 30 };

const fokus = {
  arbeitMin: 25,
  offen: null,     // { id, geplanteMin, verstrichenSek, pausiert }
  // Zeitpunkt, zu dem `verstrichenSek` vom Server kam. Der Countdown rechnet
  // von hier aus weiter, statt selbst mitzuzaehlen - so driftet er nicht und
  // stimmt nach jedem Reload wieder.
  anker: 0,
  wochen: [], dieseWoche: 0, heuteMin: 0, schnitt: 0,
  gemeldet: false, // Signal fuer diese Sitzung schon gegeben?
};

let aktiveAnsicht = "heute";
const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- Datum */

// Lokales Datum als "YYYY-MM-DD". Bewusst mit den lokalen Gettern und NICHT
// mit toISOString(): sonst waere zwischen Mitternacht und 2 Uhr noch gestern.
function heuteStr() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Kalendertage verschieben. Rechnung in UTC, damit die Sommerzeit-Umstellung
// keinen Tag verschluckt oder doppelt.
function tagPlus(datum, n) {
  const [j, m, t] = datum.split("-").map(Number);
  const d = new Date(Date.UTC(j, m - 1, t) + n * 86400000);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function formatDatum(iso) {
  const [j, m, t] = iso.split("-");
  return `${t}.${m}.${j}`;
}

/**
 * Zahl mit passender Einheit.
 *
 * Zwei Faelle, die im Deutschen auseinandergehen: "🔥 2 Tage" steht fuer sich
 * (Nominativ), "5 von 14 Tagen" steht hinter "von" (Dativ). Ohne die
 * Unterscheidung liest sich das eine oder das andere falsch.
 * Der Schluessel ist die Mehrzahl, weil statistik.js sie so schickt.
 */
const EINHEIT_FORMEN = {
  Tage: { eins: "Tag", viele: "Tage", vieleDativ: "Tagen" },
  Wochen: { eins: "Woche", viele: "Wochen", vieleDativ: "Wochen" },
};
function mitEinheit(zahl, schluessel, dativ = false) {
  const form = EINHEIT_FORMEN[schluessel];
  if (!form) return `${zahl} ${schluessel}`;
  return `${zahl} ${zahl === 1 ? form.eins : (dativ ? form.vieleDativ : form.viele)}`;
}

function wochentagVon(iso) {
  const [j, m, t] = iso.split("-").map(Number);
  return WOCHENTAGE[(new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7];
}

// Wochentag-Index eines Datums, 0=Mo .. 6=So - Bit i (1<<i) dieses Index ist
// die Position in gewohnheit.wochentageMaske. Serverseitiges Gegenstueck in
// functions/_lib/tag.js.
function wochentagIndex(datum) {
  const [j, m, t] = datum.split("-").map(Number);
  return (new Date(Date.UTC(j, m - 1, t)).getUTCDay() + 6) % 7;
}

function montagVon(datum) {
  return tagPlus(datum, -wochentagIndex(datum));
}

// Monat um n verschieben, als "YYYY-MM". Eigene Rechnung statt tagPlus():
// Monate sind unterschiedlich lang, eine Tages-Verschiebung wuerde das nicht
// sauber treffen.
function monatPlus(jahrMonat, n) {
  const [j, m] = jahrMonat.split("-").map(Number);
  const gesamt = j * 12 + (m - 1) + n;
  const neuesJahr = Math.floor(gesamt / 12);
  const neuerMonat = (gesamt % 12) + 1;
  return `${neuesJahr}-${String(neuerMonat).padStart(2, "0")}`;
}

// 42 Tage (6 Wochen) fuer ein festes Kalenderraster, vom Montag vor/am
// Monatsersten an. Feste Zellenzahl statt dynamisch 5-6 Zeilen haelt die
// Monatshoehe beim Blaettern konstant.
function monatsRaster(jahrMonat) {
  const start = montagVon(`${jahrMonat}-01`);
  const tage = [];
  for (let i = 0; i < 42; i++) tage.push(tagPlus(start, i));
  return tage;
}

/* ----------------------------------------------------------------- Netz */

/**
 * Eine API-Anfrage. Gibt { ok, status, daten } zurueck und wirft nie -
 * jeder Aufrufer entscheidet selbst, was ein Fehlschlag bedeutet.
 */
async function api(pfad, optionen = {}) {
  try {
    const res = await fetch(pfad, {
      cache: "no-store",
      headers: optionen.body ? { "Content-Type": "application/json" } : undefined,
      ...optionen,
    });
    let daten = {};
    try { daten = await res.json(); } catch (e) { /* 302 oder leere Antwort */ }
    return { ok: res.ok, status: res.status, daten };
  } catch (e) {
    return { ok: false, status: 0, daten: { error: "Keine Verbindung" } };
  }
}

/* ------------------------------------------------- Offline-Warteschlange */

/**
 * Ohne Verbindung gehen Abhaken und Mengen nicht verloren: sie landen in einer
 * Warteschlange im localStorage und werden nachgeliefert, sobald wieder Netz
 * da ist. Die Karte springt sofort um, als waere es durchgegangen.
 *
 * Bewusst NUR fuer Tage - der einzige Schreibweg, der unterwegs passiert.
 * Gewohnheiten anlegen/aendern und der Fokus-Timer brauchen weiter Netz. Beim
 * Timer ist das Absicht: er rechnet serverseitig aus dem Startzeitpunkt, eine
 * Stunde spaeter nachgereicht waere die Sitzung schlicht gelogen.
 *
 * Was die Warteschlange NICHT kann: die Flamme mitrechnen. Die haengt an der
 * ganzen Historie samt Rhythmus - sie bleibt offline auf ihrem letzten Wert
 * stehen und stimmt nach dem Nachliefern von selbst wieder.
 */
const WARTE_SCHLUESSEL = "fokus_warteschlange";
const STAND_SCHLUESSEL = "fokus_stand";

function liesWarteschlange() {
  try { return JSON.parse(localStorage.getItem(WARTE_SCHLUESSEL)) || []; }
  catch (e) { return []; }
}

let warteschlange = liesWarteschlange();

function speichereWarteschlange() {
  try {
    if (warteschlange.length) localStorage.setItem(WARTE_SCHLUESSEL, JSON.stringify(warteschlange));
    else localStorage.removeItem(WARTE_SCHLUESSEL);
  } catch (e) { /* voller Speicher: lieber nichts merken als abstuerzen */ }
}

// Ein Tag, ein Eintrag: zehnmal auf "+" zu tippen hinterlaesst nicht zehn
// Anfragen, sondern den letzten Stand. Der Server kennt ohnehin nur "setzen".
function merkeOffline(gewohnheitId, datum, menge, loeschen) {
  warteschlange = warteschlange.filter(e => !(e.gewohnheitId === gewohnheitId && e.datum === datum));
  warteschlange.push({ gewohnheitId, datum, menge, loeschen });
  speichereWarteschlange();
}

function wartetNoch(gewohnheitId, datum) {
  return warteschlange.some(e => e.gewohnheitId === gewohnheitId && e.datum === datum);
}

/**
 * Status eines Tages im Client rechnen - Spiegel von status() in
 * functions/_lib/tag.js. Sonst kommt der Status immer vom Server; offline
 * gibt es niemanden, der ihn liefert. Aendert sich die Regel dort, muss sie
 * hier mitgezogen werden.
 */
function statusVon(gewohnheit, menge, ziel) {
  const m = Number(menge) || 0;
  if (gewohnheit.typ === "binaer") return m >= 1 ? "erledigt" : "offen";
  const z = Number(ziel) || 0;
  if (istObergrenze(gewohnheit)) {
    // Eine Grenze von 0 ist erlaubt und ab der ersten Einheit ueberschritten.
    return m > z ? "ueberschritten" : "erledigt";
  }
  if (z > 0 && m >= z) return "erledigt";
  return m > 0 ? "teilweise" : "offen";
}

// Einen Tag im geladenen Bestand setzen, ohne Server - dieselbe Rechnung, die
// log.js sonst macht: vorhandene Tage behalten ihr damaliges Ziel, "offen"
// heisst kein Eintrag.
function setzeTagOertlich(gewohnheit, datum, menge, loeschen) {
  const eimer = state.logs[gewohnheit.id] || (state.logs[gewohnheit.id] = {});
  const alt = eimer[datum];
  const ziel = alt ? alt.ziel : gewohnheit.zielmenge;
  const wert = gewohnheit.typ === "binaer" ? (menge >= 1 ? 1 : 0) : menge;
  const zustand = loeschen ? "offen" : statusVon(gewohnheit, wert, ziel);
  if (zustand === "offen") delete eimer[datum];
  else eimer[datum] = { menge: wert, ziel, status: zustand };
}

// Nach jedem Laden vom Server: was noch in der Warteschlange steht, ist neuer
// als der Serverstand und gehoert wieder obendrauf - sonst spraenge eine
// offline abgehakte Karte beim naechsten Laden zurueck.
function legeWarteschlangeUeber() {
  for (const e of warteschlange) {
    const g = state.gewohnheiten.find(x => x.id === e.gewohnheitId);
    if (g) setzeTagOertlich(g, e.datum, e.menge, e.loeschen);
  }
}

let liefertNach = false;

/**
 * Die Warteschlange abarbeiten. Laeuft beim Start, beim Zurueckkehren zur App
 * und sobald der Browser wieder online meldet.
 */
async function liefereNach() {
  if (liefertNach || !warteschlange.length) return;
  liefertNach = true;

  const rest = [];
  let erfolg = 0;
  for (const e of warteschlange) {
    const antwort = await api("/api/gewohnheiten/log", {
      method: "PUT",
      body: JSON.stringify({
        gewohnheitId: e.gewohnheitId, datum: e.datum, menge: e.menge, loeschen: e.loeschen,
        // "heute" IMMER frisch: der Server laesst nur einen Tag Abstand zu
        // seiner eigenen Zeit zu (pruefeHeute in _lib/tag.js). Mit dem
        // gemerkten "heute" von vorgestern waere jeder Nachtrag ein 400er.
        heute: heuteStr(),
      }),
    });
    // Weiter kein Netz (0) oder abgemeldet (401): aufheben, das erledigt sich
    // von selbst. Alles andere ist eine echte Absage des Servers - die bliebe
    // beim naechsten Versuch dieselbe, also weg damit statt endlos zu klopfen.
    if (antwort.status === 0 || antwort.status === 401) rest.push(e);
    else if (antwort.ok) erfolg++;
  }

  const verworfen = warteschlange.length - rest.length - erfolg;
  warteschlange = rest;
  speichereWarteschlange();
  liefertNach = false;

  if (erfolg) await neuLaden();
  if (verworfen) {
    melde(verworfen === 1
      ? "1 Eintrag ließ sich nicht nachtragen"
      : `${verworfen} Einträge ließen sich nicht nachtragen`);
  } else if (erfolg) {
    melde(erfolg === 1 ? "1 Eintrag nachgetragen" : `${erfolg} Einträge nachgetragen`);
  }
}

window.addEventListener("online", liefereNach);

/* --------------------------------------------------- Letzter Stand lokal */

/**
 * Der zuletzt geladene Bestand im localStorage. Ohne ihn staende die App beim
 * Oeffnen ohne Netz vor einer leeren Liste - und ohne Liste laesst sich auch
 * nichts abhaken, das die Warteschlange nachtragen koennte. Genau der Fall
 * (App unterwegs neu oeffnen) ist der haeufigste Offline-Moment.
 */
function merkeStand(daten) {
  try { localStorage.setItem(STAND_SCHLUESSEL, JSON.stringify(daten)); }
  catch (e) { /* zu gross oder gesperrt: dann eben ohne */ }
}

function liesStand() {
  try { return JSON.parse(localStorage.getItem(STAND_SCHLUESSEL)); }
  catch (e) { return null; }
}

// Beim Abmelden weg: sonst blitzte der Bestand des vorherigen Kontos auf,
// wenn sich danach jemand anderes an demselben Geraet anmeldet.
function vergissStand() {
  try {
    localStorage.removeItem(STAND_SCHLUESSEL);
    localStorage.removeItem(WARTE_SCHLUESSEL);
  } catch (e) { /* egal */ }
  warteschlange = [];
}

/**
 * Kurzmeldung unten. `aktion` haengt einen Knopf daran ({ text, fn }) - dafuer
 * bleibt sie laenger stehen, weil man sie erst lesen und dann treffen muss.
 */
let snackTimer = null;
function melde(text, aktion) {
  const bar = $("snackbar");
  const knopf = $("snackbarAktion");
  $("snackbarText").textContent = text;
  knopf.hidden = !aktion;
  knopf.textContent = aktion ? aktion.text : "";
  knopf.onclick = aktion
    ? () => { clearTimeout(snackTimer); bar.classList.remove("show"); aktion.fn(); }
    : null;
  bar.classList.add("show");
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => bar.classList.remove("show"), aktion ? 6000 : 3200);
}

/* ------------------------------------------------------------ Anmeldung */

// Wird bei 401 aufgerufen und loest auf, sobald eine Sitzung besteht.
function anmelden() {
  return new Promise(resolve => {
    const overlay = $("lock");
    const form = $("lockForm");
    const name = $("lockName");
    const email = $("lockEmail");
    const code = $("lockCode");
    const msg = $("lockMsg");
    const umschalt = $("lockSwitch");
    const erfolg = $("lockErfolg");
    const knopf = form.querySelector("button[type=submit]");
    let schritt = "email";
    let adresse = "";
    let warte = null;

    const setzeMeldung = (text, gut) => {
      msg.textContent = text;
      msg.classList.toggle("ok", !!gut);
    };

    const hoerAuf = () => { clearInterval(warte); warte = null; };

    // Waehrend die Maske auf den Anmeldelink wartet, regelmaessig nachsehen.
    // Wer den Link im selben Browser oeffnet, ist danach in einem zweiten Tab
    // angemeldet - ohne diese Abfrage bliebe dieser hier vor dem Codefeld
    // stehen, obwohl er laengst reinkaeme.
    const warteAufLink = () => {
      hoerAuf();
      warte = setInterval(async () => {
        const { daten } = await api("/api/auth/status");
        if (!daten.angemeldet) return;
        hoerAuf();
        overlay.classList.add("hidden");
        resolve();
      }, 3000);
    };

    const zeigeEmail = () => {
      schritt = "email";
      hoerAuf();
      erfolg.hidden = true;
      form.hidden = false;
      $("lockHint").textContent = "Mit deiner E-Mail-Adresse anmelden.";
      name.hidden = true;
      email.hidden = false;
      code.hidden = true;
      knopf.textContent = "Anmeldelink anfordern";
      umschalt.hidden = false;
      umschalt.textContent = "Noch keinen Zugang? Eintragen";
      setzeMeldung("");
      overlay.classList.remove("hidden");
      email.focus();
    };

    // Dritter Schritt: Warteliste. Kein eigener Bildschirm, sondern dieselbe
    // Maske mit einem zusaetzlichen Namensfeld - wer hier landet, kam gerade
    // von "kein Konto" und soll nicht erst woandershin navigieren muessen.
    const zeigeWarteliste = () => {
      schritt = "warteliste";
      hoerAuf();
      erfolg.hidden = true;
      form.hidden = false;
      $("lockHint").textContent =
        "Trag dich ein — du bekommst eine Mail, sobald du freigeschaltet bist.";
      name.hidden = false;
      email.hidden = false;
      code.hidden = true;
      knopf.textContent = "Eintragen";
      umschalt.hidden = false;
      umschalt.textContent = "Zurück zur Anmeldung";
      setzeMeldung("");
      name.focus();
    };

    const zeigeCode = () => {
      schritt = "code";
      // Der Hinweis auf die Wartezeit ist wichtiger, als er aussieht: die
      // Zustellung haengt an Gmail und dauert gern eine halbe Minute. Ohne ihn
      // wirkt das wie ein Fehler, und man fordert unnoetig einen zweiten Code an.
      $("lockHint").textContent =
        `Mail an ${adresse} geschickt — kann eine halbe Minute dauern. ` +
        `Klick dort auf „Jetzt anmelden“, dann geht es hier von selbst weiter.`;
      warteAufLink();
      name.hidden = true;
      email.hidden = true;
      code.hidden = false;
      code.value = "";
      knopf.textContent = "Anmelden";
      // Auf dem Code-Schritt waere der Umschalter nur verwirrend - hier geht es
      // nicht mehr um die Frage, ob man einen Zugang hat.
      umschalt.hidden = true;
      setzeMeldung("");
      code.focus();
    };

    umschalt.onclick = () => {
      if (schritt === "warteliste") zeigeEmail();
      else zeigeWarteliste();
    };

    $("lockErfolgZurueck").onclick = zeigeEmail;

    form.onsubmit = async (e) => {
      e.preventDefault();
      setzeMeldung("");
      knopf.disabled = true;
      const beschriftung = knopf.textContent;
      knopf.textContent = schritt === "code" ? "Prüfe …" : "Moment …";
      try {
        if (schritt === "email") {
          adresse = email.value.trim();
          if (!adresse) return;
          const { ok, status, daten } = await api("/api/auth/request-code", {
            method: "POST",
            body: JSON.stringify({ email: adresse }),
          });
          if (!ok) {
            // Kein Konto: direkt in den Wartelisten-Modus wechseln, statt es
            // als Sackgasse zu praesentieren. Die Adresse bleibt stehen, es
            // fehlt nur noch der Name. Ein Konto ohne fokus_zugang schaltet
            // sich hier still selbst frei (siehe request-code.js) - der
            // else-Zweig unten sieht also nur noch echte Fehler wie 429/500.
            if (status === 404) {
              zeigeWarteliste();
              setzeMeldung((daten.error || "") + " Trag dich ein, dann schalte ich dich frei.");
            } else {
              setzeMeldung(daten.error || "Code konnte nicht verschickt werden.");
              email.focus();
            }
            return;
          }
          zeigeCode();
        } else if (schritt === "warteliste") {
          const wunschName = name.value.trim();
          const wunschEmail = email.value.trim();
          if (!wunschName || !wunschEmail) {
            setzeMeldung("Bitte Name und Adresse ausfüllen.");
            return;
          }
          const { ok, daten } = await api("/api/waitlist", {
            method: "POST",
            body: JSON.stringify({ name: wunschName, email: wunschEmail }),
          });
          if (!ok) {
            setzeMeldung(daten.error || "Eintragen hat nicht geklappt.");
            return;
          }
          // Formular weg, Bestaetigung her - fuer den Abschluss eines
          // Vorgangs reicht eine kleine gruene Zeile darunter nicht.
          $("lockErfolgText").textContent =
            daten.message ||
            `Wir haben deine Anfrage für ${wunschEmail} bekommen. ` +
            `Sobald du freigeschaltet bist, kommt eine Mail.`;
          form.hidden = true;
          erfolg.hidden = false;
          name.value = "";
        } else {
          const eingabe = code.value.trim();
          if (!/^\d{6}$/.test(eingabe)) { setzeMeldung("Sechsstelligen Code eingeben."); return; }
          const { ok, daten } = await api("/api/auth/verify-code", {
            method: "POST",
            body: JSON.stringify({ email: adresse, code: eingabe }),
          });
          if (!ok) {
            setzeMeldung(daten.error || "Falscher oder abgelaufener Code.");
            code.value = "";
            code.focus();
            return;
          }
          hoerAuf();
          overlay.classList.add("hidden");
          resolve();
        }
      } finally {
        knopf.disabled = false;
        if (knopf.textContent === "Moment …" || knopf.textContent === "Prüfe …") {
          knopf.textContent = beschriftung;
        }
      }
    };

    zeigeEmail();

    // /api/auth/link leitet bei einem abgelaufenen Link hierher zurueck. Ohne
    // Hinweis staende man wieder vor der Maske und wuesste nicht, warum.
    const grund = new URLSearchParams(location.search).get("login");
    if (grund) {
      setzeMeldung(grund === "abgelaufen"
        ? "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an."
        : "Die Anmeldung über den Link hat nicht geklappt.");
      history.replaceState(null, "", location.pathname);
    }
  });
}

// Angemeldet, aber nicht freigeschaltet. Hier hilft kein zweiter Versuch,
// deshalb ein eigener Kasten statt einer Zeile in der Anmeldemaske.
function zeigeGesperrt(text) {
  $("lockForm").hidden = true;
  $("lockGesperrt").hidden = false;
  $("lockGesperrtText").textContent = text || "Dieses Konto ist für den Fokus-Tracker nicht freigeschaltet.";
  $("lock").classList.remove("hidden");
}

$("lockAbmelden").onclick = async () => {
  await api("/api/auth/logout", { method: "POST" });
  vergissStand();
  location.reload();
};

/* ---------------------------------------------------------------- Laden */

function uebernimmStand(d) {
  if (!d || !d.gewohnheiten) return false;
  state.gewohnheiten = d.gewohnheiten;
  state.logs = d.logs;
  state.straehnen = d.straehnen;
  state.historieAb = d.historieAb;
  state.email = d.email;
  state.name = d.name;
  state.todoZugang = d.todoZugang;
  return true;
}

async function ladeGewohnheiten() {
  state.heute = heuteStr();
  const antwort = await api(`/api/gewohnheiten?heute=${state.heute}`);
  if (antwort.status === 401) return "anmelden";
  if (antwort.status === 403) return antwort.daten.error || "gesperrt";

  // Kein Netz: mit dem zuletzt gesehenen Stand weiterarbeiten. Nur bei
  // Status 0 - ein 500er ist eine Antwort des Servers, da waere ein
  // stillschweigend alter Bestand irrefuehrend.
  if (antwort.status === 0) {
    if (!uebernimmStand(liesStand())) { melde("Keine Verbindung"); return null; }
    legeWarteschlangeUeber();
    melde("Offline — letzter bekannter Stand");
    return null;
  }
  if (!antwort.ok) { melde(antwort.daten.error || "Laden fehlgeschlagen"); return null; }

  uebernimmStand(antwort.daten);
  merkeStand(antwort.daten);
  // Was noch nicht beim Server war, gehoert wieder obendrauf.
  legeWarteschlangeUeber();
  return null;
}

async function ladeFokus() {
  const antwort = await api(`/api/fokus?heute=${heuteStr()}`);
  if (!antwort.ok) return;
  const d = antwort.daten;
  fokus.arbeitMin = d.einstellungen.arbeitMin;
  uebernimmSitzung(d.offen);
  fokus.wochen = d.wochen;
  fokus.dieseWoche = d.dieseWoche;
  fokus.heuteMin = d.heuteMin;
  fokus.schnitt = d.schnitt;
}

// Serverstand uebernehmen und den Ankerpunkt neu setzen, von dem aus der
// Countdown weiterrechnet.
function uebernimmSitzung(offen) {
  fokus.offen = offen;
  fokus.anker = Date.now();
  if (!offen) fokus.gemeldet = false;
}

async function start() {
  const wo = await ladeGewohnheiten();
  if (wo === "anmelden") {
    await anmelden();
    return start();
  }
  if (wo) { zeigeGesperrt(wo); return; }

  await ladeFokus();
  $("lock").classList.add("hidden");
  $("reiter").hidden = false;
  $("einstellungenBtn").hidden = false;
  zeigeAnsicht(aktiveAnsicht);
  // Was beim letzten Mal ohne Netz liegen geblieben ist, geht jetzt raus.
  liefereNach();
}

/* --------------------------------------------------------- Tagesansicht */

// Status eines Tages aus dem geladenen Bestand. Ohne Eintrag: offen.
function tagVon(gewohnheitId, datum) {
  return (state.logs[gewohnheitId] || {})[datum] || null;
}

// Eine Gewohnheit mit Obergrenze statt Soll - Gegenstueck zu istObergrenze()
// in functions/_lib/tag.js.
function istObergrenze(gewohnheit) {
  return gewohnheit.typ === "menge" && gewohnheit.richtung === "hoechstens";
}

/**
 * Menge und Ziel als Text.
 *
 * Bei einer Obergrenze ausdruecklich anders formuliert: "45 / 30 Min" und
 * "50 / 60" sahen gleich aus, obwohl das eine ein erreichtes Ziel und das
 * andere eine gerissene Grenze ist. Unterschieden hat sie nur die Randfarbe -
 * zu wenig, wenn beide Karten untereinander stehen.
 */
function mengeText(gewohnheit, menge, ziel) {
  const einheit = gewohnheit.einheit ? ` ${gewohnheit.einheit}` : "";
  return istObergrenze(gewohnheit)
    ? `${menge} von höchstens ${ziel}${einheit}`
    : `${menge} / ${ziel}${einheit}`;
}

// Ob ein Datum zum Rhythmus einer Gewohnheit gehoert. Bei 'taeglich' und
// 'x_pro_woche' ist jeder Tag geplant - der Unterschied zwischen den beiden
// zeigt sich erst im Wochenziel, nicht am einzelnen Tag.
function istGeplant(gewohnheit, datum) {
  if (gewohnheit.rhythmus !== "wochentage") return true;
  return (gewohnheit.wochentageMaske & (1 << wochentagIndex(datum))) !== 0;
}

/**
 * Zaehlt ein Tag OHNE Eintrag als erledigt? Nur bei einer Obergrenze, nur in
 * der Vergangenheit, nur ab dem Anlegen der Gewohnheit - Spiegel von
 * stillerTagZaehlt() in functions/_lib/tag.js. Aendert sich die Regel dort,
 * muss sie hier mit.
 */
function stillerTagZaehlt(gewohnheit, datum) {
  if (!istObergrenze(gewohnheit)) return false;
  if (datum >= state.heute) return false;
  return !gewohnheit.angelegtAm || datum >= gewohnheit.angelegtAm;
}

/**
 * Verlangt diese Gewohnheit heute gar nichts?
 *
 * Nur eine Obergrenze, und nur solange nichts eingetragen ist. Sie hat kein
 * Soll, das man erfuellen muesste - "keine Zigarette" ist der Normalfall, kein
 * Tagwerk. Ab morgen zaehlt der Tag ohnehin von allein als eingehalten
 * (stillerTagZaehlt), ihn heute als offen zu fuehren hiess, jeden Abend zu
 * bestaetigen, dass nichts war.
 *
 * Die Karte bleibt trotzdem stehen: ein Ausrutscher muss sich eintragen
 * lassen. Sie zaehlt nur nicht mehr mit - nicht in der Tagesbilanz, nicht in
 * der Zahl am App-Icon und nicht in der Erinnerung (dort gespiegelt in
 * nochOffen() in functions/api/push/pruefen.js).
 *
 * Hendriks Entscheidung vom 10.08.2026, gefragt: die Alternativen waren
 * "alles lassen" und "heute sofort gruen".
 */
function ruhtHeute(gewohnheit) {
  return istObergrenze(gewohnheit) && !tagVon(gewohnheit.id, state.heute);
}

// Status eines Tages fuer die Anzeige: der Eintrag, wenn es einen gibt, sonst
// "erledigt" bei einer stillen Obergrenze und ansonsten "offen".
function zustandVon(gewohnheit, datum) {
  const tag = tagVon(gewohnheit.id, datum);
  if (tag) return tag.status;
  return stillerTagZaehlt(gewohnheit, datum) ? "erledigt" : "offen";
}

// Zahl der in der laufenden Woche (Montag-Sonntag) bereits erledigten Tage -
// fuer den Wochenfortschritt bei 'x_pro_woche' und dessen Straehne.
function erledigtDieseWoche(gewohnheit) {
  const start = montagVon(state.heute);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    if (zustandVon(gewohnheit, tagPlus(start, i)) === "erledigt") n++;
  }
  return n;
}

// Ob eine Gewohnheit heute ueberhaupt in der Liste erscheint. 'wochentage':
// nur an geplanten Tagen. 'x_pro_woche': nur solange das Wochenziel noch
// nicht erreicht ist - danach verschwindet sie fuer den Rest der Woche.
//
// AUSNAHME Obergrenze: die bleibt die ganze Woche stehen. "5 Mal die Woche
// hoechstens 60 Min" heisst nicht, dass die Grenze ab dem fuenften Tag nicht
// mehr gilt - waere die Karte weg, liesse sich ein Ausrutscher am sechsten Tag
// gar nicht mehr eintragen. Das Wochenziel bleibt trotzdem die Messlatte fuer
// Fortschrittszeile und Straehne.
function istHeuteDran(gewohnheit) {
  if (gewohnheit.rhythmus === "wochentage") return istGeplant(gewohnheit, state.heute);
  if (gewohnheit.rhythmus === "x_pro_woche" && !istObergrenze(gewohnheit)) {
    return erledigtDieseWoche(gewohnheit) < gewohnheit.wochenziel;
  }
  return true;
}

// ---------- App-Icon-Badge (installierte PWA) ----------
// Heute dran UND noch nicht erledigt/teilweise - dieselbe Definition von
// "offen", die die Karten in renderHeute() gelb bzw. ungefaerbt zeigen.
function offeneGewohnheitenHeute() {
  let n = 0;
  for (const g of state.gewohnheiten.filter(x => !x.archiviert)) {
    if (!istHeuteDran(g) || ruhtHeute(g)) continue;
    const tag = tagVon(g.id, state.heute);
    const st = tag ? tag.status : "offen";
    if (st === "offen" || st === "teilweise") n++;
  }
  return n;
}

// Laeuft die App gerade offen mit (im Vordergrund), aktualisiert sich die
// Zahl sofort bei jedem renderHeute() - z. B. wenn man eine Gewohnheit
// abhakt. Im Hintergrund uebernimmt der Push aus pruefen.js/sw.js dieselbe
// Zahl; ohne Push (0 offen) wird sie dort NICHT aktiv auf 0 gesetzt (siehe
// BETRIEB.md) - dieser Weg hier holt das beim naechsten Oeffnen nach.
let letzteBadgeZahl = null;
function aktualisiereBadge() {
  if (!("setAppBadge" in navigator)) return;
  const n = offeneGewohnheitenHeute();
  if (n === letzteBadgeZahl) return;
  letzteBadgeZahl = n;
  if (n > 0) navigator.setAppBadge(n).catch(() => {});
  else navigator.clearAppBadge().catch(() => {});
}

/**
 * Die beiden Zeilen um die Liste herum: oben, wie weit der Tag ist, unten,
 * was diese Woche schon steht und deshalb gar nicht mehr auftaucht.
 *
 * Beide werden auch dann gesetzt, wenn die Liste leer ist - genau dann ist die
 * untere am wichtigsten, weil "Heute ist keine Gewohnheit dran" sonst der
 * einzige Hinweis waere.
 */
function renderTagesbilanz(aktive) {
  const bilanz = $("tagesBilanz");
  // Ruhende Obergrenzen zaehlen weder oben noch unten mit - sonst stuende hier
  // "5 von 8", obwohl drei davon nichts von einem wollen.
  const zaehlend = aktive.filter(g => !ruhtHeute(g));
  const erledigt = zaehlend.filter(g => zustandVon(g, state.heute) === "erledigt").length;
  const fertig = zaehlend.length > 0 && erledigt === zaehlend.length;

  bilanz.hidden = !zaehlend.length;
  bilanz.classList.toggle("fertig", fertig);
  $("tagesBilanzText").textContent = fertig
    ? "Alles erledigt"
    : `${erledigt} von ${zaehlend.length} erledigt`;
  $("tagesBilanzBalken").style.width =
    zaehlend.length ? `${Math.round(erledigt / zaehlend.length * 100)}%` : "0%";
}

function renderWochenFertig(alleAktiven) {
  const zeile = $("wochenFertig");
  // Nur der eine Grund, aus dem eine Gewohnheit heute lautlos fehlt: das
  // Wochenziel steht schon. Alles andere (falscher Wochentag, archiviert) ist
  // entweder erwartbar oder hat seinen eigenen Ort.
  const fertig = alleAktiven.filter(g =>
    g.rhythmus === "x_pro_woche" && !istObergrenze(g) && !istHeuteDran(g));
  zeile.hidden = !fertig.length;
  if (fertig.length) {
    zeile.textContent = `Diese Woche schon geschafft: ${fertig.map(g => g.name).join(", ")}`;
  }
}

/**
 * Der Stift-Knopf, der eine Gewohnheit zum Bearbeiten oeffnet.
 *
 * Frueher lag das Bearbeiten auf einem Doppelklick auf die Karte. Das ging an
 * beiden Enden schief: am PC markierte der erste Klick den Namen, bevor der
 * Dialog aufging, und auf dem Handy fing der Browser den Doppeltipp als Zoom
 * ab, sodass es dort ueberhaupt keinen Weg zum Dialog gab. Ein sichtbarer
 * Knopf braucht ausserdem keinen Hinweistext, der erklaert, dass es ihn gibt.
 *
 * Dieselbe Form in der Heute-Liste und im Verlauf - es ist dieselbe Handlung.
 */
function stiftKnopf(gewohnheit) {
  const knopf = document.createElement("button");
  knopf.type = "button";
  knopf.className = "stift";
  knopf.textContent = "✎";
  knopf.title = "Bearbeiten";
  knopf.setAttribute("aria-label", `${gewohnheit.name} bearbeiten`);
  knopf.onclick = () => oeffneGewohnheitDialog(gewohnheit);
  return knopf;
}

function renderHeute() {
  const liste = $("heuteListe");
  liste.replaceChildren();

  const alleAktiven = state.gewohnheiten.filter(g => !g.archiviert);
  const aktive = alleAktiven.filter(istHeuteDran);
  renderTagesbilanz(aktive);
  renderWochenFertig(alleAktiven);

  if (!aktive.length) {
    const p = document.createElement("p");
    p.className = "leer-hinweis";
    p.textContent = alleAktiven.length
      ? "Heute ist keine Gewohnheit dran."
      : "Noch keine Gewohnheit. Leg unten deine erste an.";
    liste.appendChild(p);
    aktualisiereBadge();
    return;
  }

  for (const g of aktive) {
    const tag = tagVon(g.id, state.heute);
    const menge = tag ? tag.menge : 0;
    // "ruht": eine Obergrenze, in die heute noch nichts eingetragen ist -
    // weder offen noch erledigt, siehe ruhtHeute().
    const zustand = tag ? tag.status : (ruhtHeute(g) ? "ruht" : "offen");
    // Immer das Ziel DIESES Tages, nie das aktuelle der Gewohnheit. Sonst
    // koennten Balken und Haken auseinanderlaufen, sobald jemand das Ziel
    // aendert - der Status faellt serverseitig ebenfalls gegen ziel_damals.
    const ziel = tag ? tag.ziel : g.zielmenge;
    // Obergrenze statt Soll: dreht die Bedeutung von "geschafft" um und damit
    // auch die des Balkens und des Hakens (beide weiter unten).
    const obergrenze = istObergrenze(g);

    const karte = document.createElement("div");
    // mit-menge steuert den Umbruch auf schmalen Bildschirmen (style.css):
    // nur diese Karten tragen Minus/Zahl/Plus und brauchen die zweite Zeile.
    karte.className = `gew ${zustand}` + (g.typ === "menge" ? " mit-menge" : "");

    const haupt = document.createElement("div");
    haupt.className = "gew-haupt";

    // Der Stift sitzt direkt hinter dem Namen und nicht am rechten Kartenrand:
    // dort waere er der Nachbar des Hakens, und der wird jeden Tag getroffen.
    const name = document.createElement("div");
    name.className = "gew-name";
    const nameText = document.createElement("span");
    nameText.textContent = g.name;
    name.appendChild(nameText);
    name.appendChild(stiftKnopf(g));
    haupt.appendChild(name);

    const zeile = document.createElement("div");
    zeile.className = "gew-zeile";

    if (g.typ === "menge") {
      const text = document.createElement("span");
      text.textContent = mengeText(g, menge, ziel);
      zeile.appendChild(text);
    }

    if (g.rhythmus === "x_pro_woche") {
      const fortschritt = document.createElement("span");
      fortschritt.textContent = `${erledigtDieseWoche(g)} von ${g.wochenziel} diese Woche`;
      zeile.appendChild(fortschritt);
    }

    const straehne = state.straehnen[g.id] || 0;
    const st = document.createElement("span");
    st.className = "straehne" + (straehne > 0 ? " aktiv" : "");
    // Bei 'x_pro_woche' zaehlt straehneXProWoche() in functions/_lib/tag.js
    // ganze WOCHEN, nicht Tage - die Zahl braucht deshalb die passende
    // Einheit, sonst steht bei einer Woche "1 Tage" auf der Karte.
    st.textContent = straehne > 0
      ? `🔥 ${mitEinheit(straehne, g.rhythmus === "x_pro_woche" ? "Wochen" : "Tage")}`
      : "keine Flamme";
    zeile.appendChild(st);

    // Offline abgehakt und noch nicht beim Server. Die Karte zeigt trotzdem
    // schon den neuen Stand - ohne diesen Hinweis saehe sie aus, als waere
    // alles im Kasten.
    if (wartetNoch(g.id, state.heute)) {
      const wartet = document.createElement("span");
      wartet.className = "wartet";
      wartet.textContent = "↻ nicht gespeichert";
      zeile.appendChild(wartet);
    }

    haupt.appendChild(zeile);

    if (g.typ === "menge") {
      const balken = document.createElement("div");
      balken.className = "balken";
      const fuellung = document.createElement("i");
      // Bei einer Obergrenze zeigt der Balken, was noch UEBRIG ist, nicht was
      // verbraucht wurde. Sonst hiesse "voll" bei einem Soll gut und bei einer
      // Grenze schlecht - derselbe Balken mit zwei Bedeutungen. Ueber der
      // Grenze laeuft er wieder voll, dann rot: ein leerer roter Balken waere
      // gar nicht zu sehen.
      // Bei einer Grenze von 0 ("gar keine") gibt es kein Budget zum Teilen -
      // der Balken ist voll, gruen oder rot entscheidet der Zustand.
      const anteil = obergrenze
        ? (zustand === "ueberschritten" || ziel <= 0 ? 100 : 100 - menge / ziel * 100)
        : menge / ziel * 100;
      fuellung.style.width = `${Math.max(0, Math.min(100, Math.round(anteil)))}%`;
      balken.appendChild(fuellung);
      haupt.appendChild(balken);
    }

    karte.appendChild(haupt);

    if (g.typ === "menge") {
      const feld = document.createElement("div");
      feld.className = "menge-feld";
      const eingabe = document.createElement("input");
      eingabe.type = "number";
      eingabe.min = "0";
      eingabe.max = String(MAX_MENGE);
      eingabe.step = "1";
      eingabe.value = String(menge);
      eingabe.setAttribute("aria-label", `${g.name}: Menge für heute`);
      // change statt input: sonst schiesst jeder Tastendruck eine Anfrage ab.
      eingabe.onchange = () => setzeTag(g, state.heute, Number(eingabe.value));

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "menge-minus";
      minus.textContent = "−";
      minus.title = "Um 1 verringern";
      minus.setAttribute("aria-label", `${g.name}: Menge um 1 verringern`);
      // Bei 0 gar nicht erst schicken: bei einer Obergrenze wuerde die 0 sonst
      // einen erledigten Tag anlegen, obwohl man nur "nichts" verringert hat.
      minus.onclick = () => { if (menge > 0) setzeTag(g, state.heute, menge - 1); };
      feld.appendChild(minus);

      feld.appendChild(eingabe);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "menge-plus";
      plus.textContent = "+";
      plus.title = "Um 1 erhöhen";
      plus.setAttribute("aria-label", `${g.name}: Menge um 1 erhöhen`);
      plus.onclick = () => setzeTag(g, state.heute, menge + 1);
      feld.appendChild(plus);

      karte.appendChild(feld);
    }

    // Ein Tipp = Ziel erreicht (oder wieder auf null). Der haeufigste Fall
    // soll ohne Zahleneingabe gehen.
    //
    // Bei einer Obergrenze ist "geschafft" das GEGENTEIL: nicht die Grenze
    // ausreizen, sondern gar nichts davon gemacht zu haben. Der Haken springt
    // deshalb auf 0 statt auf das Ziel - und weil die 0 dort selbst schon
    // gruen ist, braucht das Wiederoeffnen das ausdrueckliche Loeschen.
    const haken = document.createElement("button");
    haken.className = "haken" + (zustand === "erledigt" ? " an" : "");
    haken.textContent = "✓";
    haken.title = zustand === "erledigt" ? "Wieder öffnen"
      : obergrenze ? "Heute nichts davon"
      : "Als erledigt markieren";
    haken.onclick = async () => {
      if (zustand !== "erledigt") {
        setzeTag(g, state.heute, g.typ !== "menge" ? 1 : (obergrenze ? 0 : ziel));
        return;
      }
      // Der einzige Tipp in der App, der etwas wegnimmt: aus "50 von 60" wird
      // eine 0, und die 50 sind ohne Rueckfrage weg. Statt eines Dialogs, der
      // den haeufigen Fall (versehentlich abgehakt) mit einem zweiten Tipp
      // belastet, gibt es den Weg zurueck hinterher.
      const vorher = tag;
      if (!await setzeTag(g, state.heute, 0, obergrenze)) return;
      if (!vorher) return;
      melde(`„${g.name}“ wieder offen`, {
        text: "Rückgängig",
        fn: () => setzeTag(g, state.heute, vorher.menge),
      });
    };
    karte.appendChild(haken);

    liste.appendChild(karte);
  }
  aktualisiereBadge();
}

/**
 * Einen Tag speichern - der einzige Schreibweg fuer Gewohnheiten.
 * Heute und Vergangenheit laufen ueber dieselbe Funktion; genau das macht das
 * Nachtragen aus.
 *
 * `loeschen` stellt einen Tag ausdruecklich wieder auf "offen". Noetig nur bei
 * einer Obergrenze, wo die 0 selbst schon ein erledigter Tag ist (siehe
 * status() in functions/_lib/tag.js).
 */
async function setzeTag(gewohnheit, datum, menge, loeschen = false) {
  const antwort = await api("/api/gewohnheiten/log", {
    method: "PUT",
    body: JSON.stringify({
      gewohnheitId: gewohnheit.id, datum, menge, loeschen, heute: state.heute,
    }),
  });

  // Kein Netz: merken und die Karte trotzdem umspringen lassen. Nur bei
  // Status 0 - ein 400/403/500 ist eine Absage, die beim naechsten Versuch
  // genauso ausfiele; die gehoert dem Nutzer gesagt, nicht in eine Schlange.
  if (antwort.status === 0) {
    merkeOffline(gewohnheit.id, datum, menge, loeschen);
    setzeTagOertlich(gewohnheit, datum, menge, loeschen);
    renderHeute();
    renderVerlauf();
    melde("Ohne Verbindung gemerkt — wird nachgetragen");
    return true;
  }
  if (!antwort.ok) { melde(antwort.daten.error || "Speichern fehlgeschlagen"); return false; }

  const d = antwort.daten;
  const eimer = state.logs[gewohnheit.id] || (state.logs[gewohnheit.id] = {});
  // Nicht mehr an der Menge festmachen: bei einer Obergrenze ist die
  // gespeicherte 0 ein gruener Tag. "Offen" gibt es nur ohne Eintrag.
  if (d.status === "offen") delete eimer[datum];
  else eimer[datum] = { menge: d.menge, ziel: d.ziel, status: d.status };

  const vorher = state.straehnen[gewohnheit.id] || 0;
  state.straehnen[gewohnheit.id] = d.straehne;

  renderHeute();
  renderVerlauf();

  // Nur melden, wenn die Straehne durch einen NACHGETRAGENEN Tag gewachsen
  // ist - beim normalen Abhaken von heute sieht man die Zahl ohnehin.
  if (datum !== state.heute && d.straehne > vorher) {
    const einheit = gewohnheit.rhythmus === "x_pro_woche" ? "Wochen" : "Tage";
    melde(`${formatDatum(datum)} nachgetragen — Flamme jetzt ${mitEinheit(d.straehne, einheit)}`);
  }
  return true;
}

/* ------------------------------------------------------------- Verlauf */
/* Ein Monatskalender pro Gewohnheit, umschaltbar ueber kalWahl. Ersetzt das
   fruehere Raster (eine Zeile pro Gewohnheit, alle gleichzeitig) - bei mehr
   als ein, zwei Gewohnheiten wurden die Zellen darin zu klein zum Treffen.

   Es gab hier zeitweise eine zweite Blickrichtung ("Nach Tag": ein Tag, alle
   Gewohnheiten) mit einem Umschalter darueber. Die ist wieder raus - der
   Umschalter stand ueber jedem Kalenderaufruf, fuer eine Ansicht, die kaum
   benutzt wurde. Nachtragen laeuft ueber die Kalenderzellen. */

function renderVerlauf() {
  const aktive = state.gewohnheiten.filter(g => !g.archiviert);
  if (!aktive.length) {
    verlauf.gewohnheitId = null;
    $("kalWahl").replaceChildren();
    $("kalMonat").textContent = "";
    $("kalZurueck").disabled = true;
    $("kalVor").disabled = true;
    $("kalLegendeGeplant").hidden = true;
    $("kalLegendeUeberschritten").hidden = true;
    const kal = $("kalender");
    kal.replaceChildren();
    const p = document.createElement("p");
    p.className = "leer-hinweis";
    p.textContent = "Noch keine Gewohnheit angelegt.";
    kal.appendChild(p);
    return;
  }

  // Faellt auf die erste aktive Gewohnheit zurueck, wenn noch keine gewaehlt
  // ist oder die gewaehlte gerade archiviert/geloescht wurde.
  if (!verlauf.gewohnheitId || !aktive.some(g => g.id === verlauf.gewohnheitId)) {
    verlauf.gewohnheitId = aktive[0].id;
  }
  if (!verlauf.monat) verlauf.monat = state.heute.slice(0, 7);

  renderKalWahl();
  renderKalender();
}

function renderKalWahl() {
  const wahl = $("kalWahl");
  wahl.replaceChildren();
  for (const g of state.gewohnheiten.filter(x => !x.archiviert)) {
    const knopf = document.createElement("button");
    knopf.type = "button";
    knopf.textContent = g.name;
    const gewaehlt = g.id === verlauf.gewohnheitId;
    knopf.setAttribute("aria-selected", String(gewaehlt));
    knopf.onclick = () => {
      verlauf.gewohnheitId = g.id;
      renderKalWahl();
      renderKalender();
    };
    wahl.appendChild(knopf);
    // Der Stift gehoert zur gewaehlten Gewohnheit und steht deshalb direkt
    // neben ihr, nicht irgendwo am Rand. Und er muss hier sein: Gewohnheiten,
    // die heute nicht dran sind, tauchen in "Heute" gar nicht auf - ohne
    // diesen Knopf waeren sie nicht mehr bearbeit- oder archivierbar.
    if (gewaehlt) wahl.appendChild(stiftKnopf(g));
  }
}

function renderKalender() {
  const gewohnheit = state.gewohnheiten.find(g => g.id === verlauf.gewohnheitId);
  const kal = $("kalender");
  kal.replaceChildren();
  if (!gewohnheit) return;

  const heuteMonat = state.heute.slice(0, 7);
  const fruehestesMonat = state.historieAb.slice(0, 7);
  $("kalZurueck").disabled = verlauf.monat <= fruehestesMonat;
  $("kalVor").disabled = verlauf.monat >= heuteMonat;

  // "teilweise" gibt es nur bei mindestens-Gewohnheiten, "ueberschritten"
  // nur bei hoechstens-Gewohnheiten - binaere Gewohnheiten kennen keins von
  // beiden (siehe status() in _lib/tag.js).
  $("kalLegendeTeilweise").hidden = !(gewohnheit.typ === "menge" && gewohnheit.richtung !== "hoechstens");
  $("kalLegendeUeberschritten").hidden = !(gewohnheit.typ === "menge" && gewohnheit.richtung === "hoechstens");

  const [jahr, monat] = verlauf.monat.split("-").map(Number);
  $("kalMonat").textContent = new Date(Date.UTC(jahr, monat - 1, 1))
    .toLocaleDateString("de-DE", { month: "long", year: "numeric", timeZone: "UTC" });

  for (const name of WOCHENTAGE) {
    const kopf = document.createElement("div");
    kopf.className = "kal-tage-kopf-zelle";
    kopf.textContent = name;
    kal.appendChild(kopf);
  }

  let irgendeinNichtGeplant = false;
  for (const d of monatsRaster(verlauf.monat)) {
    const imMonat = d.slice(0, 7) === verlauf.monat;
    if (!imMonat) {
      const leer = document.createElement("div");
      leer.className = "kal-zelle leer";
      kal.appendChild(leer);
      continue;
    }

    const zukunft = d > state.heute;
    const geplant = istGeplant(gewohnheit, d);
    const tag = tagVon(gewohnheit.id, d);
    if (!geplant) irgendeinNichtGeplant = true;
    // Tage, an denen es die Gewohnheit noch gar nicht gab. Ohne diese
    // Unterscheidung sahen sie aus wie verpasste Tage, obwohl die Statistik
    // sie ausdruecklich nicht mitzaehlt. Ein nachgetragener Eintrag hebt das
    // auf - der ist echt und soll auch so aussehen.
    const vorAnlegen = !tag && !!gewohnheit.angelegtAm && d < gewohnheit.angelegtAm;

    const zelle = document.createElement("button");
    zelle.type = "button";
    // zustandVon() statt tag.status: bei einer Obergrenze ist auch ein Tag
    // ohne Eintrag gruen. Ein grauer Kalender unter einer laufenden Flamme
    // saehe aus, als stimme eins von beidem nicht.
    zelle.className = "kal-zelle "
      + (!geplant ? "nicht-geplant" : vorAnlegen ? "vor-anlegen" : zustandVon(gewohnheit, d))
      + (d === state.heute ? " heute" : "")
      + (zukunft ? " zukunft" : "");
    const tagZahl = document.createElement("span");
    tagZahl.className = "kal-tag";
    tagZahl.textContent = String(Number(d.slice(8, 10)));
    zelle.appendChild(tagZahl);

    // Menge/Ziel direkt in der Zelle, nicht nur im Tooltip - das damalige
    // Ziel (tag.ziel), nicht das aktuelle, siehe ziel_damals in tag.js.
    // Nicht in der Zukunft und nicht vor dem Anlegen: dort waere "0/60" keine
    // Aussage, sondern nur eine Null, die nach Versaeumnis aussieht.
    if (geplant && gewohnheit.typ === "menge" && !zukunft && !vorAnlegen) {
      const menge = document.createElement("span");
      menge.className = "kal-menge";
      const ziel = tag ? tag.ziel : gewohnheit.zielmenge;
      menge.textContent = `${tag ? tag.menge : 0}/${ziel}`;
      zelle.appendChild(menge);
    }

    zelle.title = `${wochentagVon(d)}, ${formatDatum(d)}`
      + (!geplant ? " — nicht geplant"
        : vorAnlegen ? " — davor gab es die Gewohnheit noch nicht"
        : tag ? `: ${tag.menge}${gewohnheit.typ === "menge" ? " / " + tag.ziel + (gewohnheit.einheit ? " " + gewohnheit.einheit : "") : ""}`
        // Angenommen, nicht bestaetigt - der Unterschied soll erkennbar sein.
        : stillerTagZaehlt(gewohnheit, d) ? " — nichts eingetragen, also im Rahmen"
        : "");

    if (zukunft || !geplant) zelle.disabled = true;
    // Nach einer Wischgeste kommt noch ein click auf der Zelle unter dem
    // Finger - der soll den Tag-Dialog nicht aufreissen.
    else zelle.onclick = () => { if (!gewischt) oeffneTagDialog(gewohnheit, d); };

    kal.appendChild(zelle);
  }

  $("kalLegendeGeplant").hidden = !irgendeinNichtGeplant;
}

/**
 * Einen Monat weiter oder zurueck - der eine Weg, den Knoepfe wie Wischgeste
 * benutzen. Die Grenzen stehen hier und nicht nur als `disabled` an den
 * Knoepfen: eine Wischgeste kann nicht deaktiviert werden.
 */
function blaettereMonat(schritte) {
  const ziel = monatPlus(verlauf.monat, schritte);
  if (ziel > state.heute.slice(0, 7)) return;
  if (ziel < state.historieAb.slice(0, 7)) return;
  verlauf.monat = ziel;
  renderKalender();
}

$("kalZurueck").onclick = () => blaettereMonat(-1);
$("kalVor").onclick = () => blaettereMonat(1);

/**
 * Wischen wechselt den Monat.
 *
 * Auf dem Handy ist das der natuerliche Griff, und die beiden Pfeile sitzen
 * oben in der Mitte - weit weg vom Daumen, der gerade noch einen Tag
 * angetippt hat.
 *
 * Zwei Dinge, die sonst schieflaufen: Ein Wisch endet mit einem `click` auf
 * der Zelle, unter der der Finger zufaellig losgelaufen ist - deshalb merkt
 * `gewischt` das kurz und der Zellen-Handler steigt aus. Und ein senkrechter
 * Wisch ist das Scrollen der Seite, kein Blaettern: er muss deutlich
 * waagerechter sein als hoch, sonst bleibt er unbeachtet.
 */
const WISCH_MINDEST = 50;   // px, darunter ist es ein Tipp mit unruhiger Hand
let wischStart = null;
let gewischt = false;

$("kalender").addEventListener("touchstart", (e) => {
  wischStart = e.touches.length === 1
    ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
    : null;
}, { passive: true });

$("kalender").addEventListener("touchend", (e) => {
  if (!wischStart) return;
  const ende = e.changedTouches[0];
  const dx = ende.clientX - wischStart.x;
  const dy = ende.clientY - wischStart.y;
  wischStart = null;
  if (Math.abs(dx) < WISCH_MINDEST || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  gewischt = true;
  setTimeout(() => { gewischt = false; }, 400);
  // Nach links wischen heisst vorwaerts, wie beim Blaettern in allem anderen.
  blaettereMonat(dx < 0 ? 1 : -1);
}, { passive: true });

/* ------------------------------------------------------------ Statistik */

// Erfuellungsquote je Gewohnheit ueber den gewaehlten Zeitraum - anders als
// die Straehne (nur der aktuelle Lauf) ein festes Fenster, siehe
// functions/api/gewohnheiten/statistik.js.
async function renderStatistik() {
  const liste = $("statistikListe");
  const antwort = await api(`/api/gewohnheiten/statistik?heute=${state.heute}&tage=${statistik.tage}`);
  liste.replaceChildren();
  if (!antwort.ok) {
    const p = document.createElement("p");
    p.className = "leer-hinweis";
    p.textContent = "Statistik konnte nicht geladen werden.";
    liste.appendChild(p);
    return;
  }

  const eintraege = antwort.daten.gewohnheiten || [];
  if (!eintraege.length) {
    const p = document.createElement("p");
    p.className = "leer-hinweis";
    p.textContent = "Noch keine Gewohnheit für eine Statistik.";
    liste.appendChild(p);
    return;
  }

  for (const g of eintraege) {
    const karte = document.createElement("div");
    karte.className = "gew";

    const haupt = document.createElement("div");
    haupt.className = "gew-haupt";

    const name = document.createElement("div");
    name.className = "gew-name";
    name.textContent = g.name;
    haupt.appendChild(name);

    const zeile = document.createElement("div");
    zeile.className = "gew-zeile";
    const text = document.createElement("span");

    if (g.geplant === 0) {
      // z.B. "x pro Woche" ohne eine einzige vollstaendige Woche im
      // gewaehlten Zeitraum - kommt bei "7 Tage" leicht vor.
      text.textContent = `Noch keine geplanten ${g.einheit} in diesem Zeitraum`;
      zeile.appendChild(text);
      haupt.appendChild(zeile);
      karte.appendChild(haupt);
      liste.appendChild(karte);
      continue;
    }

    const quote = Math.round((g.erledigt / g.geplant) * 100);
    // Die Einheit gehoert zum Nenner und steht hinter "von", also im Dativ:
    // "0 von 1 Tag", "5 von 14 Tagen", "1 von 1 Woche".
    // laufendeWoche: statt einer Quote ueber volle Wochen der Stand der
    // angebrochenen - passiert bei "7 Tage", wo keine volle Woche hineinpasst.
    text.textContent = `${g.erledigt} von ${mitEinheit(g.geplant, g.einheit, true)}`
      + (g.laufendeWoche ? " diese Woche" : "") + ` (${quote} %)`;
    zeile.appendChild(text);
    haupt.appendChild(zeile);

    const balken = document.createElement("div");
    balken.className = "balken";
    const fuellung = document.createElement("i");
    fuellung.style.width = `${Math.min(100, quote)}%`;
    fuellung.style.background = quote >= 80 ? "var(--green)" : quote >= 40 ? "var(--yellow)" : "var(--leer)";
    balken.appendChild(fuellung);
    haupt.appendChild(balken);

    karte.appendChild(haupt);
    liste.appendChild(karte);
  }
}

for (const knopf of $("statZeitraum").querySelectorAll("button")) {
  knopf.onclick = () => {
    statistik.tage = Number(knopf.dataset.tage);
    for (const b of $("statZeitraum").querySelectorAll("button")) {
      b.setAttribute("aria-selected", String(b === knopf));
    }
    renderStatistik();
  };
}

/* --------------------------------------------------------------- Timer */

// Verstrichene Sekunden inklusive der Zeit seit dem letzten Serverstand.
function verstrichen() {
  if (!fokus.offen) return 0;
  if (fokus.offen.pausiert) return fokus.offen.verstrichenSek;
  return fokus.offen.verstrichenSek + Math.floor((Date.now() - fokus.anker) / 1000);
}

function alsUhr(sekunden) {
  const s = Math.max(0, Math.round(sekunden));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function renderFokus() {
  const laeuft = !!fokus.offen;

  const geplantSek = (laeuft ? fokus.offen.geplanteMin : fokus.arbeitMin) * 60;
  const rest = laeuft ? geplantSek - verstrichen() : geplantSek;

  $("timerZeit").textContent = alsUhr(rest);
  $("timerZeit").classList.toggle("pausiert", laeuft && fokus.offen.pausiert);
  $("timerRing").style.width = laeuft
    ? `${Math.min(100, Math.max(0, (1 - rest / geplantSek) * 100))}%` : "0%";

  $("timerInfo").textContent = !laeuft
    ? `Standarddauer ${fokus.arbeitMin} Min.`
    : fokus.offen.pausiert
      ? "Pausiert"
      : rest <= 0 ? "Fertig — beenden nicht vergessen" : `${fokus.offen.geplanteMin} Min. Fokus`;

  $("startBtn").hidden = laeuft;
  $("pauseBtn").hidden = !laeuft;
  $("stopBtn").hidden = !laeuft;
  $("pauseBtn").textContent = laeuft && fokus.offen.pausiert ? "Weiter" : "Pause";

  $("statHeute").textContent = fokus.heuteMin;
  $("statWoche").textContent = fokus.dieseWoche;
  $("statSchnitt").textContent = fokus.schnitt;

  const diagramm = $("diagramm");
  const namen = $("diagrammNamen");
  diagramm.replaceChildren();
  namen.replaceChildren();
  const hoechst = Math.max(1, ...fokus.wochen.map(w => w.minuten));
  fokus.wochen.forEach((w, i) => {
    const spalte = document.createElement("div");
    spalte.className = "balken-spalte" + (i === fokus.wochen.length - 1 ? " jetzt" : "");
    const wert = document.createElement("div");
    wert.className = "balken-wert";
    wert.textContent = w.minuten || "";
    const saeule = document.createElement("div");
    saeule.className = "balken-saeule";
    // Prozent der hoechsten Woche, nicht absolut: sonst waere bei einer
    // ruhigen Woche gar nichts zu sehen.
    saeule.style.height = `${Math.round(w.minuten / hoechst * 100)}%`;
    saeule.title = `Woche ab ${formatDatum(w.start)}: ${w.minuten} Min.`;
    spalte.append(wert, saeule);
    diagramm.appendChild(spalte);

    const beschriftung = document.createElement("span");
    beschriftung.textContent = w.start.slice(8) + "." + w.start.slice(5, 7) + ".";
    namen.appendChild(beschriftung);
  });
}

/**
 * Signal am Sitzungsende.
 *
 * Drei Wege, weil jeder einzelne ausfallen kann: der Tab-Titel geht immer, der
 * Ton nur wenn der Browser Audio erlaubt (dafuer reicht der Start-Klick als
 * Geste), die Benachrichtigung nur mit Erlaubnis.
 */
let audioKontext = null;
function piep() {
  try {
    audioKontext = audioKontext || new (window.AudioContext || window.webkitAudioContext)();
    if (audioKontext.state === "suspended") audioKontext.resume();
    // Zwei kurze Toene: ein einzelner geht im Alltagslaerm unter, ein langer
    // erschrickt.
    [0, 0.28].forEach((versatz, i) => {
      const ton = audioKontext.createOscillator();
      const lautstaerke = audioKontext.createGain();
      ton.frequency.value = i === 0 ? 660 : 880;
      ton.connect(lautstaerke).connect(audioKontext.destination);
      const start = audioKontext.currentTime + versatz;
      lautstaerke.gain.setValueAtTime(0.0001, start);
      lautstaerke.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      lautstaerke.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      ton.start(start);
      ton.stop(start + 0.24);
    });
  } catch (e) { /* Audio blockiert - Titel und Benachrichtigung bleiben */ }
}

function meldeFertig(minuten) {
  // Der Titel ist der Weg zu jemandem, der gerade woanders ist. Wer die App
  // vor sich hat, sieht ohnehin Snackbar und Timer - dort waere er nur eine
  // Markierung, die bis zum naechsten Tabwechsel stehen bleibt, weil sie nur
  // in visibilitychange zurueckgesetzt wird.
  if (document.hidden) document.title = "✓ Fertig — Fokus";
  piep();
  // benachrichtigungenAn ist der App-eigene An/Aus-Zustand (siehe
  // aktualisierePushSchalter()) - Notification.permission allein reicht
  // nicht, denn die bleibt "granted", auch wenn der Schalter in den
  // Einstellungen auf Aus steht (der Browser laesst sich eine einmal erteilte
  // Erlaubnis nicht per JS wieder entziehen).
  if (benachrichtigungenAn && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Fokus-Sitzung fertig", { body: `${minuten} Minuten geschafft.`, icon: "icon-192.png" });
    } catch (e) { /* manche Browser erlauben das nur aus einem Service Worker */ }
  }
  melde(`Sitzung fertig — ${minuten} Minuten`);
}

/**
 * Ist inzwischen ein neuer Tag angebrochen? Dann alles neu holen.
 *
 * `state.heute` wird beim Laden einmal gesetzt und steckt danach in jedem
 * Schreibvorgang (setzeTag). Bleibt die App ueber Mitternacht offen - am
 * Rechner der Normalfall, dort feuert kein visibilitychange -, zeigt die
 * Tagesansicht weiter den Rhythmus von gestern, und ein Haken landet auf dem
 * gestrigen Datum. Der Server nimmt das sogar an: pruefeHeute() laesst einen
 * Tag Spielraum, damit jede Zeitzone durchgeht.
 *
 * Der Vergleich kostet nichts und laeuft deshalb im Sekundentakt mit, statt
 * einen eigenen Wecker auf Mitternacht zu stellen (der bei Standby oder
 * Zeitumstellung ohnehin danebenlaege).
 */
let tageswechselLaeuft = false;
async function pruefeTageswechsel() {
  if (tageswechselLaeuft || heuteStr() === state.heute) return;
  tageswechselLaeuft = true;
  try {
    await ladeGewohnheiten();
    renderHeute();
    renderVerlauf();
    if (aktiveAnsicht === "statistik") renderStatistik();
  } finally {
    tageswechselLaeuft = false;
  }
}

// Ein Takt pro Sekunde. Er zeichnet nur; gerechnet wird aus dem Startzeitpunkt.
setInterval(() => {
  // Vor dem Ausstieg unten: der Tageswechsel betrifft jede Ansicht, nicht nur
  // die des Timers.
  pruefeTageswechsel();
  if (aktiveAnsicht !== "fokus" && !fokus.offen) return;
  if (fokus.offen && !fokus.offen.pausiert && !fokus.gemeldet) {
    if (verstrichen() >= fokus.offen.geplanteMin * 60) {
      fokus.gemeldet = true;   // vor dem await, sonst feuert der naechste Takt nochmal
      beendeSitzung(true);
      return;
    }
  }
  if (aktiveAnsicht === "fokus") renderFokus();
}, 1000);

$("startBtn").onclick = async () => {
  // Eine neue Sitzung raeumt den Fertig-Hinweis der vorigen aus dem Titel.
  document.title = "Fokus";
  // AudioContext hier anlegen: der Klick ist die Geste, die Browser fuer
  // Tonausgabe verlangen. Spaeter, beim Ablauf des Timers, gibt es keine mehr.
  try {
    audioKontext = audioKontext || new (window.AudioContext || window.webkitAudioContext)();
    if (audioKontext.state === "suspended") audioKontext.resume();
  } catch (e) { /* kein Ton, kein Beinbruch */ }

  const antwort = await api("/api/fokus/start", {
    method: "POST",
    body: JSON.stringify({ heute: heuteStr() }),
  });
  if (!antwort.ok) { melde(antwort.daten.error || "Start fehlgeschlagen"); return; }
  if (antwort.daten.vorherBeendet) {
    melde(`Vorherige Sitzung mit ${antwort.daten.vorherBeendet.echteMin} Min. abgeschlossen`);
  }
  uebernimmSitzung(antwort.daten.offen);
  renderFokus();
};

$("pauseBtn").onclick = async () => {
  const antwort = await api("/api/fokus/pause", { method: "POST" });
  if (!antwort.ok) { melde(antwort.daten.error || "Hat nicht geklappt"); return; }
  uebernimmSitzung(antwort.daten.offen);
  renderFokus();
};

// Stopp sitzt direkt neben Pause, und eine geloggte Sitzung laesst sich
// nachtraeglich nicht mehr korrigieren - ein Fehlgriff bliebe fuer immer in der
// Wochenstatistik. Unter einer Minute ist nichts zu verlieren, da faellt die
// Rueckfrage weg: sie soll den Alltag nicht mit einem zweiten Tipp belasten.
$("stopBtn").onclick = async () => {
  const sek = verstrichen();
  if (sek >= 60) {
    // Dieselbe Deckelung wie in beendeSitzung() (functions/_lib/fokus.js):
    // eine 45-Minuten-Sitzung kann keine 70 Minuten ins Log schreiben. Ohne
    // sie nannte die Rueckfrage eine Zahl, die so nie irgendwo auftaucht.
    const min = Math.min(Math.round(sek / 60), fokus.offen.geplanteMin);
    const ok = await frage("Sitzung beenden?",
      `${min} von ${fokus.offen.geplanteMin} Minuten sind gelaufen. `
      + "Sie landen so im Log und lassen sich danach nicht mehr ändern. "
      + "Zum Unterbrechen gibt es „Pause“.",
      "Beenden");
    if (!ok) return;
  }
  beendeSitzung(false);
};

async function beendeSitzung(durchgelaufen) {
  const antwort = await api("/api/fokus/stop", { method: "POST" });
  if (!antwort.ok) { melde(antwort.daten.error || "Beenden fehlgeschlagen"); return; }
  const s = antwort.daten.sitzung;
  uebernimmSitzung(null);
  await ladeFokus();     // Statistik nachziehen
  renderFokus();
  if (!s) return;
  if (durchgelaufen) meldeFertig(s.echteMin);
  else melde(`Abgebrochen nach ${s.echteMin} von ${s.geplanteMin} Minuten`);
}

// Zurueck aus dem Hintergrund: Serverstand holen. Ein schlafender Tab bekommt
// keine Takte, der Countdown waere sonst stehengeblieben.
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) return;
  document.title = "Fokus";
  // Zurueck in der App ist der wahrscheinlichste Moment, in dem wieder Netz
  // da ist - das "online"-Ereignis kommt nicht in jedem Browser zuverlaessig.
  await liefereNach();
  await pruefeTageswechsel();
  await ladeFokus();
  renderFokus();
});

/* ------------------------------------------------------------- Dialoge */

let bearbeiteteGewohnheit = null;
let gewaehlterTyp = "binaer";
let gewaehlteRichtung = "mindestens";
let gewaehlterRhythmus = "taeglich";
let gewaehlteWochentage = new Set(); // Indizes 0=Mo..6=So, siehe WOCHENTAGE

function setzeTypWahl(typ) {
  gewaehlterTyp = typ;
  for (const knopf of $("gewTyp").querySelectorAll("button")) {
    knopf.setAttribute("aria-pressed", String(knopf.dataset.typ === typ));
  }
  $("gewZielFeld").hidden = typ !== "menge";
  $("gewRichtungFeld").hidden = typ !== "menge";
}

function setzeRichtungWahl(richtung) {
  gewaehlteRichtung = richtung;
  for (const knopf of $("gewRichtung").querySelectorAll("button")) {
    knopf.setAttribute("aria-pressed", String(knopf.dataset.richtung === richtung));
  }
  // 0 ist nur als Obergrenze sinnvoll ("gar keine Zigarette") - als Soll waere
  // es immer erfuellt. Der Server prueft dasselbe nochmal.
  const obergrenze = richtung === "hoechstens";
  $("gewZiel").min = obergrenze ? "0" : "1";
  $("gewZielLabel").textContent = obergrenze ? "Höchstens pro Tag" : "Ziel pro Tag";
  if (!obergrenze && Number($("gewZiel").value) < 1) $("gewZiel").value = "1";
}

function setzeRhythmusWahl(rhythmus) {
  gewaehlterRhythmus = rhythmus;
  for (const knopf of $("gewRhythmus").querySelectorAll("button")) {
    knopf.setAttribute("aria-pressed", String(knopf.dataset.rhythmus === rhythmus));
  }
  $("gewWochentageFeld").hidden = rhythmus !== "wochentage";
  $("gewWochenzielFeld").hidden = rhythmus !== "x_pro_woche";
}

function setzeWochentagWahl(index, gewaehlt) {
  if (gewaehlt) gewaehlteWochentage.add(index);
  else gewaehlteWochentage.delete(index);
  const knopf = $("gewWochentage").querySelector(`button[data-tag="${index}"]`);
  if (knopf) knopf.setAttribute("aria-pressed", String(gewaehlteWochentage.has(index)));
}

function oeffneGewohnheitDialog(gewohnheit) {
  bearbeiteteGewohnheit = gewohnheit || null;
  $("gewTitel").textContent = gewohnheit ? "Gewohnheit bearbeiten" : "Neue Gewohnheit";
  $("gewIcon").textContent = gewohnheit ? "✏️" : "✨";
  $("gewName").value = gewohnheit ? gewohnheit.name : "";
  // != null, nicht truthy: bei einer Obergrenze ist 0 eine gueltige Zielmenge
  // und wuerde sonst beim Bearbeiten kommentarlos auf 30 springen.
  $("gewZiel").value = gewohnheit && gewohnheit.zielmenge != null ? gewohnheit.zielmenge : 30;
  $("gewEinheit").value = (gewohnheit && gewohnheit.einheit) || "";
  $("gewMsg").textContent = "";
  $("gewArchivieren").hidden = !gewohnheit;
  setzeTypWahl(gewohnheit ? gewohnheit.typ : "binaer");
  if (gewohnheit) $("gewZielFeld").hidden = gewohnheit.typ !== "menge";

  // Die Art laesst sich nur wechseln, solange kein Tag erfasst ist - sonst
  // wuerde sich die Historie nicht mehr eindeutig deuten lassen (aus jedem
  // Haekchen wuerde kommentarlos "Menge 1"). Der Server prueft das nochmal
  // verbindlich; hier nur die Anzeige.
  const hatHistorie = !!(gewohnheit && state.logs[gewohnheit.id]
    && Object.keys(state.logs[gewohnheit.id]).length);
  for (const knopf of $("gewTyp").querySelectorAll("button")) knopf.disabled = hatHistorie;
  $("gewTypHinweis").hidden = !hatHistorie;

  // Dieselbe Sperre gilt fuer die Richtung: eine Umkehr wuerde die Historie
  // rueckwirkend umbewerten, genau wie ein Typwechsel.
  setzeRichtungWahl((gewohnheit && gewohnheit.richtung) || "mindestens");
  for (const knopf of $("gewRichtung").querySelectorAll("button")) knopf.disabled = hatHistorie;
  $("gewRichtungHinweis").hidden = !hatHistorie;

  // Rhythmus ist - anders als der Typ - auch beim Bearbeiten frei wechselbar.
  gewaehlteWochentage = new Set();
  const maske = (gewohnheit && gewohnheit.wochentageMaske) || 0;
  for (const knopf of $("gewWochentage").querySelectorAll("button")) {
    const i = Number(knopf.dataset.tag);
    const gewaehlt = (maske & (1 << i)) !== 0;
    if (gewaehlt) gewaehlteWochentage.add(i);
    knopf.setAttribute("aria-pressed", String(gewaehlt));
  }
  $("gewWochenziel").value = (gewohnheit && gewohnheit.wochenziel) || 3;
  setzeRhythmusWahl(gewohnheit ? gewohnheit.rhythmus : "taeglich");

  $("gewPopup").hidden = false;
  // Nur beim Anlegen: dort ist das Feld leer und der naechste Schritt ist
  // sicher das Tippen. Beim Bearbeiten steht der Name schon da - der Fokus
  // wuerde auf dem Handy nur die Tastatur ueber den halben Dialog schieben.
  if (!gewohnheit) $("gewName").focus();
}

for (const knopf of $("gewTyp").querySelectorAll("button")) {
  knopf.onclick = () => setzeTypWahl(knopf.dataset.typ);
}
for (const knopf of $("gewRichtung").querySelectorAll("button")) {
  knopf.onclick = () => setzeRichtungWahl(knopf.dataset.richtung);
}
for (const knopf of $("gewRhythmus").querySelectorAll("button")) {
  knopf.onclick = () => setzeRhythmusWahl(knopf.dataset.rhythmus);
}
for (const knopf of $("gewWochentage").querySelectorAll("button")) {
  const i = Number(knopf.dataset.tag);
  knopf.onclick = () => setzeWochentagWahl(i, !gewaehlteWochentage.has(i));
}
$("gewAbbrechen").onclick = () => { $("gewPopup").hidden = true; };
$("neueGewohnheitBtn").onclick = () => oeffneGewohnheitDialog(null);

$("gewSpeichern").onclick = async () => {
  if (gewaehlterRhythmus === "wochentage" && !gewaehlteWochentage.size) {
    $("gewMsg").textContent = "Mindestens ein Wochentag muss ausgewählt sein.";
    return;
  }
  let wochentageMaske = 0;
  for (const i of gewaehlteWochentage) wochentageMaske |= (1 << i);

  const koerper = {
    name: $("gewName").value.trim(),
    // Ohne Historie darf gewaehlterTyp vom bisherigen Typ abweichen (Knoepfe
    // sind dann nicht disabled) - mit Historie sind die Knoepfe gesperrt,
    // gewaehlterTyp bleibt also zwangslaeufig der alte. Der Server prueft das
    // sicherheitshalber nochmal selbst.
    typ: gewaehlterTyp,
    zielmenge: Number($("gewZiel").value),
    einheit: $("gewEinheit").value.trim(),
    richtung: gewaehlteRichtung,
    rhythmus: gewaehlterRhythmus,
    wochentageMaske,
    wochenziel: Number($("gewWochenziel").value),
    // Damit der Server weiss, ab welchem Tag ein geaendertes Ziel gilt.
    heute: state.heute,
  };
  if (bearbeiteteGewohnheit) koerper.id = bearbeiteteGewohnheit.id;

  const antwort = await api("/api/gewohnheiten", {
    method: bearbeiteteGewohnheit ? "PATCH" : "POST",
    body: JSON.stringify(koerper),
  });
  if (!antwort.ok) { $("gewMsg").textContent = antwort.daten.error || "Speichern fehlgeschlagen"; return; }
  $("gewPopup").hidden = true;
  await neuLaden();
  melde(bearbeiteteGewohnheit ? "Gespeichert" : "Gewohnheit angelegt");
};

$("gewArchivieren").onclick = async () => {
  if (!bearbeiteteGewohnheit) return;
  const antwort = await api("/api/gewohnheiten", {
    method: "PATCH",
    body: JSON.stringify({ id: bearbeiteteGewohnheit.id, archiviert: true }),
  });
  if (!antwort.ok) { $("gewMsg").textContent = antwort.daten.error || "Hat nicht geklappt"; return; }
  $("gewPopup").hidden = true;
  await neuLaden();
  melde("Archiviert — im Einstellungsmenü zu finden");
};

// --- Ein einzelner Tag (aus dem Verlaufsraster) ---
let tagGewohnheit = null;
let tagDatum = null;

function oeffneTagDialog(gewohnheit, datum) {
  tagGewohnheit = gewohnheit;
  tagDatum = datum;
  const tag = tagVon(gewohnheit.id, datum);
  // Das Ziel dieses Tages, nicht das aktuelle: an einem Tag von vor drei
  // Wochen zaehlt, was damals galt.
  const ziel = tag ? tag.ziel : gewohnheit.zielmenge;
  $("tagTitel").textContent = gewohnheit.name;
  $("tagDatum").textContent = `${wochentagVon(datum)}, ${formatDatum(datum)}`;
  $("tagMsg").textContent = "";

  const istMenge = gewohnheit.typ === "menge";
  const zielWort = gewohnheit.richtung === "hoechstens" ? "Höchstens" : "Ziel";
  $("tagLabel").textContent = istMenge
    ? (gewohnheit.einheit ? `Menge in ${gewohnheit.einheit} (${zielWort} ${ziel})` : `Menge (${zielWort} ${ziel})`)
    : "Status";
  const wert = tag ? tag.menge : 0;
  $("tagMenge").value = String(wert);
  $("tagMengeFeld").hidden = !istMenge;
  $("tagStatus").hidden = istMenge;
  // Bei einer Obergrenze ist die 0 ein erledigter Tag - zurueck auf "offen"
  // kommt man dort nur ueber diesen Weg, und nur wenn es etwas zu loeschen gibt.
  $("tagLoeschen").hidden = !(istMenge && gewohnheit.richtung === "hoechstens" && tag);

  $("tagPopup").hidden = false;

  // Auf das Zahlenfeld kommt bewusst KEIN focus(): auf dem Handy schoebe sich
  // die Tastatur ueber den halben Dialog, obwohl -/+ direkt daneben stehen.
  // Gleiche Ueberlegung wie im Bearbeiten-Dialog.
  if (!istMenge) {
    // Abhaken statt Zahl eintippen: die Wahl spiegelt den aktuellen Stand,
    // ein Klick auf die andere Seite reicht zum Umschalten. Der Fokus stoert
    // hier nicht - es sind Knoepfe, keine Tastatur.
    const erledigt = wert >= 1 ? "1" : "0";
    for (const knopf of $("tagStatus").querySelectorAll("button")) {
      knopf.setAttribute("aria-pressed", String(knopf.dataset.wert === erledigt));
    }
    $("tagStatus").querySelector(`button[data-wert="${erledigt}"]`).focus();
  }
}

for (const knopf of $("tagStatus").querySelectorAll("button")) {
  knopf.onclick = () => {
    $("tagMenge").value = knopf.dataset.wert;
    for (const b of $("tagStatus").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b === knopf));
    }
  };
}

$("tagMinus").onclick = () => {
  $("tagMenge").value = String(Math.max(0, Number($("tagMenge").value) - 1));
};
$("tagPlus").onclick = () => {
  $("tagMenge").value = String(Number($("tagMenge").value) + 1);
};
$("tagAbbrechen").onclick = () => { $("tagPopup").hidden = true; };
$("tagSpeichern").onclick = async () => {
  const menge = Number($("tagMenge").value);
  if (!Number.isInteger(menge) || menge < 0) {
    $("tagMsg").textContent = "Ganze Zahl ab 0 eingeben.";
    return;
  }
  if (menge > MAX_MENGE) {
    $("tagMsg").textContent = `Höchstens ${MAX_MENGE} eingeben.`;
    return;
  }
  if (await setzeTag(tagGewohnheit, tagDatum, menge)) $("tagPopup").hidden = true;
  else $("tagMsg").textContent = "Speichern fehlgeschlagen";
};
$("tagLoeschen").onclick = async () => {
  if (await setzeTag(tagGewohnheit, tagDatum, 0, true)) $("tagPopup").hidden = true;
  else $("tagMsg").textContent = "Löschen fehlgeschlagen";
};

// --- Ja/Nein-Rueckfrage ---
let frageAntwort = null;
function frage(titel, text, jaText = "Löschen") {
  return new Promise(resolve => {
    $("frageTitel").textContent = titel;
    $("frageText").textContent = text;
    $("frageJa").textContent = jaText;
    $("fragePopup").hidden = false;
    frageAntwort = resolve;
  });
}
$("frageJa").onclick = () => { $("fragePopup").hidden = true; frageAntwort?.(true); };
$("frageNein").onclick = () => { $("fragePopup").hidden = true; frageAntwort?.(false); };

/* -------------------------------------------------------- Einstellungen */

// Akkordeon wie in der ToDo-Liste: je Oeffnen klappen die anderen Abschnitte
// zu - einmalige Verdrahtung auf das native "toggle"-Event reicht, da die
// <details> nie neu gerendert werden.
document.querySelectorAll("#einPopup details.ein-abschnitt").forEach(det => {
  det.addEventListener("toggle", () => {
    if (det.open) {
      document.querySelectorAll("#einPopup details.ein-abschnitt").forEach(other => {
        if (other !== det) other.open = false;
      });
    }
  });
});

// Bei jedem Oeffnen auf denselben Abschnitt zurueck - "Fokus-Timer" ist der
// haeufigste Grund fuers Zahnrad (Dauer anpassen), der Rest faengt zu.
function resetAkkordeon() {
  document.querySelectorAll("#einPopup details.ein-abschnitt").forEach(det => {
    det.open = det.dataset.abschnitt === "timer";
  });
}

// ToDo-Liste-Zeile: Status-Text und "aktiv"-Farbe. Eigene Funktion statt Teil
// von aktualisiereEinSubtexte(), weil sie auch direkt nach dem Freischalten
// (ohne die anderen Subtexte) aufgerufen wird.
function aktualisiereTodoLink() {
  $("subTodo").textContent = state.todoZugang ? "aktiv" : "nicht aktiv";
  $("todoLink").classList.toggle("aktiv", state.todoZugang);
}

// Kurztext in jeder Kopfzeile, auch zugeklappt sichtbar.
function aktualisiereEinSubtexte() {
  $("subTimer").textContent = `${fokus.arbeitMin} Min`;
  $("subKonto").textContent = state.email;

  const archiviert = state.gewohnheiten.filter(g => g.archiviert).length;
  $("subArchiv").textContent = archiviert ? `${archiviert} archiviert` : "";

  const aktive = state.gewohnheiten.filter(g => !g.archiviert).length;
  $("subReihenfolge").textContent = aktive === 1 ? "1 Gewohnheit" : `${aktive} Gewohnheiten`;

  aktualisiereTodoLink();
}

/**
 * Reihenfolge der Tagesansicht. Hoch/Runter statt Ziehen: Ziehen braucht auf
 * dem Handy eigene Pointer-Behandlung und kollidiert mit dem Scrollen des
 * Dialogs - zwei Pfeile treffen immer.
 *
 * Geschickt wird die vollstaendige Liste, nicht "tausche zwei" (siehe
 * functions/api/gewohnheiten/reihenfolge.js). Die archivierten haengen hinten
 * dran, damit die Positionen luecken- und kollisionsfrei bleiben, falls eine
 * davon spaeter zurueckgeholt wird.
 */
function renderReihenfolge() {
  const liste = $("reihenfolgeListe");
  liste.replaceChildren();
  const aktive = state.gewohnheiten.filter(g => !g.archiviert);
  $("reihenfolgeLeer").hidden = aktive.length > 0;

  aktive.forEach((g, i) => {
    const zeile = document.createElement("div");
    zeile.className = "archiv-zeile";

    const name = document.createElement("span");
    name.textContent = g.name;
    zeile.appendChild(name);

    for (const [richtung, zeichen, titel] of [[-1, "↑", "nach oben"], [1, "↓", "nach unten"]]) {
      const knopf = document.createElement("button");
      knopf.className = "btn klein";
      knopf.textContent = zeichen;
      knopf.title = `${g.name} ${titel}`;
      knopf.setAttribute("aria-label", `${g.name} ${titel}`);
      knopf.disabled = richtung < 0 ? i === 0 : i === aktive.length - 1;
      knopf.onclick = () => verschiebeGewohnheit(i, i + richtung);
      zeile.appendChild(knopf);
    }

    liste.appendChild(zeile);
  });
  aktualisiereEinSubtexte();
}

/**
 * Die neue Reihenfolge zum Server schicken - immer die vollstaendige Liste
 * (siehe functions/api/gewohnheiten/reihenfolge.js).
 *
 * Immer nur eine Anfrage unterwegs, und waehrenddessen wird nur der zuletzt
 * gewuenschte Stand gemerkt: wer viermal schnell auf den Pfeil tippt, soll
 * nicht vier Anfragen ausloesen, die sich womoeglich in falscher Reihenfolge
 * ueberholen und die Liste hinterher anders sortieren als auf dem Schirm.
 */
let sortierungLaeuft = false;
let sortierungNachtrag = null;
async function sendeReihenfolge(ids) {
  if (sortierungLaeuft) { sortierungNachtrag = ids; return; }
  sortierungLaeuft = true;
  const antwort = await api("/api/gewohnheiten/reihenfolge", {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
  sortierungLaeuft = false;

  if (!antwort.ok) {
    // Der Server hat die Reihenfolge nicht uebernommen - dann darf sie auf dem
    // Schirm auch nicht stehenbleiben.
    sortierungNachtrag = null;
    melde(antwort.daten.error || "Sortieren fehlgeschlagen");
    await neuLaden();
    renderReihenfolge();
    return;
  }
  if (sortierungNachtrag) {
    const naechste = sortierungNachtrag;
    sortierungNachtrag = null;
    await sendeReihenfolge(naechste);
  }
}

/**
 * Eine Gewohnheit um eine Position verschieben.
 *
 * Die Liste springt sofort um, ohne auf den Server zu warten - vorher hing an
 * jedem Pfeil-Tipp eine Anfrage samt komplettem Neuladen, und eine Gewohnheit
 * von unten nach oben zu holen hiess achtmal warten.
 */
async function verschiebeGewohnheit(von, nach) {
  const aktive = state.gewohnheiten.filter(g => !g.archiviert);
  if (nach < 0 || nach >= aktive.length) return;
  [aktive[von], aktive[nach]] = [aktive[nach], aktive[von]];

  // Die archivierten haengen hinten dran, damit die Positionen lueckenlos
  // bleiben, falls eine davon spaeter zurueckgeholt wird.
  const neu = [...aktive, ...state.gewohnheiten.filter(g => g.archiviert)];
  state.gewohnheiten = neu;
  renderReihenfolge();
  renderHeute();
  renderVerlauf();

  await sendeReihenfolge(neu.map(g => g.id));
}

function renderArchiv() {
  const liste = $("archivListe");
  liste.replaceChildren();
  const archiviert = state.gewohnheiten.filter(g => g.archiviert);
  $("archivLeer").hidden = archiviert.length > 0;

  for (const g of archiviert) {
    const zeile = document.createElement("div");
    zeile.className = "archiv-zeile";

    const name = document.createElement("span");
    name.textContent = g.name;
    zeile.appendChild(name);

    const zurueck = document.createElement("button");
    zurueck.className = "btn klein";
    zurueck.textContent = "Zurückholen";
    zurueck.onclick = async () => {
      await api("/api/gewohnheiten", {
        method: "PATCH",
        body: JSON.stringify({ id: g.id, archiviert: false }),
      });
      await neuLaden();
      renderArchiv();
      renderReihenfolge();   // eine Gewohnheit mehr, die sich sortieren laesst
      melde("Wieder aktiv");
    };
    zeile.appendChild(zurueck);

    const weg = document.createElement("button");
    weg.className = "btn klein gefahr";
    weg.textContent = "Löschen";
    weg.onclick = async () => {
      // Die Zahl der Tage gehoert in die Rueckfrage: sie ist das, was
      // tatsaechlich verloren geht - der Name allein sagt nichts darueber.
      const tage = Object.keys(state.logs[g.id] || {}).length;
      const ok = await frage("Endgültig löschen?",
        `„${g.name}“ und alle eingetragenen Tage werden gelöscht.` +
        (tage ? ` Allein im sichtbaren Zeitraum sind das ${tage} Tage.` : "") +
        " Das lässt sich nicht rückgängig machen.");
      if (!ok) return;
      const antwort = await api("/api/gewohnheiten", {
        method: "DELETE",
        body: JSON.stringify({ id: g.id }),
      });
      if (!antwort.ok) { melde(antwort.daten.error || "Löschen fehlgeschlagen"); return; }
      await neuLaden();
      renderArchiv();
      melde("Gelöscht");
    };
    zeile.appendChild(weg);

    liste.appendChild(zeile);
  }
  aktualisiereEinSubtexte();
}

// Vor der Freischaltung: Klick holt den Zugang (wie frueher der Knopf), der
// Link fuehrt noch nirgends hin. Danach ist es ein ganz normaler Link zur
// anderen App - der Browser uebernimmt, kein weiterer Klick-Handler noetig.
$("todoLink").addEventListener("click", async e => {
  if (state.todoZugang) return;
  e.preventDefault();
  const antwort = await api("/api/auth/todo-zugang", { method: "POST" });
  if (!antwort.ok) { melde(antwort.daten.error || "Hat nicht geklappt."); return; }
  state.todoZugang = true;
  aktualisiereTodoLink();
  melde("Zugang zur ToDo-Liste freigeschaltet.");
});

$("fokusZugangAufgeben").onclick = async () => {
  const ok = await frage("Fokus-Zugang aufgeben?",
    "Deine Gewohnheiten und ihr Verlauf bleiben erhalten. Du kommst " +
    "jederzeit wieder rein — einfach erneut anmelden.",
    "Ja, Zugang aufgeben");
  if (!ok) return;
  await api("/api/auth/zugang-aufgeben", { method: "POST" });
  $("einPopup").hidden = true;
  zeigeGesperrt("Du hast deinen Fokus-Zugang aufgegeben.");
};

function aktualisiereDauerAnzeige() {
  $("einDauerWert").textContent = `${$("einDauer").value} Min`;
}
$("einDauer").oninput = aktualisiereDauerAnzeige;

$("einstellungenBtn").onclick = () => {
  $("einDauer").value = String(fokus.arbeitMin);
  aktualisiereDauerAnzeige();
  $("einKontoName").textContent = state.name || "Konto";
  $("einKontoMail").textContent = state.email;
  renderReihenfolge();
  renderArchiv();
  aktualisierePushSchalter();
  aktualisiereEinSubtexte();
  resetAkkordeon();
  $("einPopup").hidden = false;
};
$("einSchliessen").onclick = () => { $("einPopup").hidden = true; };

$("einDauerSpeichern").onclick = async () => {
  const arbeitMin = Number($("einDauer").value);
  const antwort = await api("/api/fokus/einstellungen", {
    method: "PUT",
    body: JSON.stringify({ arbeitMin }),
  });
  if (!antwort.ok) { melde(antwort.daten.error || "Speichern fehlgeschlagen"); return; }
  fokus.arbeitMin = antwort.daten.arbeitMin;
  renderFokus();
  aktualisiereEinSubtexte();
  melde(`Standarddauer: ${fokus.arbeitMin} Minuten`);
};

$("einAbmelden").onclick = async () => {
  const ok = await frage("Abmelden?",
    "Das meldet dich auch aus der ToDo-Liste ab — beide Apps teilen sich dieselbe Sitzung.",
    "Abmelden");
  if (!ok) return;
  await api("/api/auth/logout", { method: "POST" });
  vergissStand();
  location.reload();
};

/* --------------------------------------------------------------- Rahmen */

async function neuLaden() {
  const wo = await ladeGewohnheiten();
  if (wo === "anmelden") { location.reload(); return; }
  if (wo) { zeigeGesperrt(wo); return; }
  renderHeute();
  renderVerlauf();
}

function zeigeAnsicht(name) {
  aktiveAnsicht = name;
  $("ansichtHeute").hidden = name !== "heute";
  $("ansichtVerlauf").hidden = name !== "verlauf";
  $("ansichtFokus").hidden = name !== "fokus";
  $("ansichtStatistik").hidden = name !== "statistik";
  for (const knopf of $("reiter").querySelectorAll("button")) {
    knopf.setAttribute("aria-selected", String(knopf.dataset.ansicht === name));
  }
  if (name === "heute") renderHeute();
  if (name === "verlauf") renderVerlauf();
  if (name === "fokus") renderFokus();
  if (name === "statistik") renderStatistik();
}

for (const knopf of $("reiter").querySelectorAll("button")) {
  knopf.onclick = () => zeigeAnsicht(knopf.dataset.ansicht);
}

// Hell/Dunkel wie in der ToDo-Liste: gemerkt in localStorage, sonst folgt es
// der Systemeinstellung.
function setzeThema(thema) {
  document.documentElement.setAttribute("data-theme", thema);
  $("themaSwitch").checked = thema === "dark";
  $("themaSwitchLabel").textContent = thema === "dark" ? "Dunkel" : "Hell";
  localStorage.setItem("thema", thema);
}
setzeThema(localStorage.getItem("thema")
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("themaSwitch").onchange = () => {
  setzeThema($("themaSwitch").checked ? "dark" : "light");
};

// Klick auf den Overlay-Hintergrund (nicht auf die Box selbst) schliesst den
// Dialog - wie ein Abbrechen/Nein. Bei fragePopup muss das Promise dabei
// aufgeloest werden, sonst bleibt es haengen.
for (const id of ["gewPopup", "tagPopup", "einPopup", "fragePopup"]) {
  $(id).addEventListener("click", (e) => {
    if (e.target !== $(id)) return;
    $(id).hidden = true;
    if (id === "fragePopup") frageAntwort?.(false);
  });
}

// Escape schliesst den obersten offenen Dialog.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  for (const id of ["fragePopup", "tagPopup", "gewPopup", "einPopup"]) {
    if (!$(id).hidden) {
      $(id).hidden = true;
      if (id === "fragePopup") frageAntwort?.(false);
      return;
    }
  }
});

// Enter in den Dialogfeldern speichert - sonst muesste man jedes Mal zur Maus
// greifen, obwohl der Finger schon auf der Tastatur liegt.
$("gewName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("gewSpeichern").click(); });
$("tagMenge").addEventListener("keydown", (e) => { if (e.key === "Enter") $("tagSpeichern").click(); });

// ---------- Offline: App-Shell-Cache ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// ---------- Push-Benachrichtigungen ----------
// PushManager existiert im Safari-Tab auf dem iPhone gar nicht (erst ab
// iOS 16.4, und nur fuer eine vom Home-Bildschirm gestartete, installierte
// App) - der Schalter in den Einstellungen blendet sich dann aus und zeigt
// stattdessen den Hinweis.

// Oeffentlicher VAPID-Schluessel - unbedenklich im Client-Code, der private
// Gegenpart liegt nur als VAPID_PRIVATE_KEY im Pages-Projekt (siehe
// functions/_lib/webpush.js). Dasselbe Schluesselpaar wie in der ToDo-Liste:
// VAPID identifiziert den absendenden Server gegenueber dem Push-Dienst,
// nicht die Herkunfts-Domain - ein Wiederverwenden ist unbedenklich.
const VAPID_PUBLIC_KEY = "BGDQTQDoRHFvbkqBEc5t_-A_Xa-QyUIzzN56qZigMR5jSCU8wF7HNv1EHOG91lFrQaui2xElzlLLCLkvdKjnypA";

function base64UrlZuBytes(base64url) {
  const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const roh = atob(base64);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
  return bytes;
}

const pushUnterstuetzt = () => "serviceWorker" in navigator && "PushManager" in window;

async function aktuelleSubscription() {
  if (!pushUnterstuetzt()) return null;
  const reg = await navigator.serviceWorker.ready;
  return await reg.pushManager.getSubscription();
}

// Ob Benachrichtigungen an sind - steuert sowohl das Sitzungsende-Signal
// (meldeFertig()) als auch, ob der Hintergrund-Push ueberhaupt greift.
// Ausserhalb von aktualisierePushSchalter()/schaltePushUm() nicht direkt
// setzen.
let benachrichtigungenAn = false;

// Bei jedem Oeffnen der Einstellungen den Schalter auf den echten Stand
// bringen - eine Berechtigung kann sich auch ausserhalb der App aendern
// (z. B. in den iOS-Systemeinstellungen entzogen).
async function aktualisierePushSchalter() {
  const wrap = $("pushSwitchWrap");
  const hinweis = $("pushHinweis");
  if (!pushUnterstuetzt()) {
    wrap.hidden = true;
    hinweis.hidden = false;
    hinweis.textContent = "Auf dem iPhone nur verfügbar, wenn die App vom Home-Bildschirm aus geöffnet ist.";
    benachrichtigungenAn = false;
    return;
  }
  wrap.hidden = false;
  hinweis.hidden = true;
  const sub = await aktuelleSubscription().catch(() => null);
  const an = !!sub && Notification.permission === "granted";
  benachrichtigungenAn = an;
  $("pushSwitch").checked = an;
  $("pushSwitchLabel").textContent = an ? "An" : "Aus";
}

async function schaltePushUm() {
  const schalter = $("pushSwitch");
  if (schalter.checked) {
    try {
      const erlaubnis = await Notification.requestPermission();
      if (erlaubnis !== "granted") { schalter.checked = false; return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlZuBytes(VAPID_PUBLIC_KEY),
      });
      const roh = sub.toJSON();
      const res = await fetch("/api/push/abonnieren", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: roh.endpoint, keys: roh.keys }),
      });
      if (!res.ok) {
        await sub.unsubscribe().catch(() => {});
        schalter.checked = false;
        melde("Anmelden hat nicht geklappt.");
        return;
      }
      benachrichtigungenAn = true;
      $("pushSwitchLabel").textContent = "An";
    } catch (e) {
      schalter.checked = false;
      melde("Benachrichtigungen ließen sich nicht aktivieren.");
    }
  } else {
    try {
      const sub = await aktuelleSubscription();
      if (sub) {
        await fetch("/api/push/abbestellen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } catch (e) { /* Schalter bleibt trotzdem aus */ }
    benachrichtigungenAn = false;
    $("pushSwitchLabel").textContent = "Aus";
  }
}
$("pushSwitch").addEventListener("change", schaltePushUm);

start();
