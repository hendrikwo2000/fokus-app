"use strict";

/**
 * Fokus-Tracker - Gewohnheiten und Pomodoro.
 *
 * Kein Framework, kein Build. Der Ablauf ist derselbe wie in der ToDo-Liste:
 * beim Start einmal alles laden, danach nur noch einzelne Aenderungen
 * schicken. Bei 401 geht die Anmeldemaske auf, bei 403 der Gesperrt-Kasten.
 */

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

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

let snackTimer = null;
function melde(text) {
  const bar = $("snackbar");
  $("snackbarText").textContent = text;
  bar.classList.add("show");
  clearTimeout(snackTimer);
  snackTimer = setTimeout(() => bar.classList.remove("show"), 3200);
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
            // fehlt nur noch der Name. Ein Konto ohne fokus_zugang (403)
            // bleibt dagegen auf dem Login-Schritt - Eintragen wuerde daran
            // nichts aendern, das entscheidet die Verwaltung.
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
      setzeMeldung(
        grund === "abgelaufen" ? "Der Link ist abgelaufen oder wurde schon benutzt. Fordere einen neuen an."
        : grund === "gesperrt" ? "Diese Adresse ist für den Fokus-Tracker nicht freigeschaltet."
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
  location.reload();
};

/* ---------------------------------------------------------------- Laden */

async function ladeGewohnheiten() {
  state.heute = heuteStr();
  const antwort = await api(`/api/gewohnheiten?heute=${state.heute}`);
  if (antwort.status === 401) return "anmelden";
  if (antwort.status === 403) return antwort.daten.error || "gesperrt";
  if (!antwort.ok) { melde(antwort.daten.error || "Laden fehlgeschlagen"); return null; }

  const d = antwort.daten;
  state.gewohnheiten = d.gewohnheiten;
  state.logs = d.logs;
  state.straehnen = d.straehnen;
  state.historieAb = d.historieAb;
  state.email = d.email;
  state.name = d.name;
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
}

/* --------------------------------------------------------- Tagesansicht */

// Status eines Tages aus dem geladenen Bestand. Ohne Eintrag: offen.
function tagVon(gewohnheitId, datum) {
  return (state.logs[gewohnheitId] || {})[datum] || null;
}

// Ob ein Datum zum Rhythmus einer Gewohnheit gehoert. Bei 'taeglich' und
// 'x_pro_woche' ist jeder Tag geplant - der Unterschied zwischen den beiden
// zeigt sich erst im Wochenziel, nicht am einzelnen Tag.
function istGeplant(gewohnheit, datum) {
  if (gewohnheit.rhythmus !== "wochentage") return true;
  return (gewohnheit.wochentageMaske & (1 << wochentagIndex(datum))) !== 0;
}

// Zahl der in der laufenden Woche (Montag-Sonntag) bereits erledigten Tage -
// fuer den Wochenfortschritt bei 'x_pro_woche' und dessen Straehne.
function erledigtDieseWoche(gewohnheit) {
  const start = montagVon(state.heute);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const tag = tagVon(gewohnheit.id, tagPlus(start, i));
    if (tag && tag.status === "erledigt") n++;
  }
  return n;
}

// Ob eine Gewohnheit heute ueberhaupt in der Liste erscheint. 'wochentage':
// nur an geplanten Tagen. 'x_pro_woche': nur solange das Wochenziel noch
// nicht erreicht ist - danach verschwindet sie fuer den Rest der Woche.
function istHeuteDran(gewohnheit) {
  if (gewohnheit.rhythmus === "wochentage") return istGeplant(gewohnheit, state.heute);
  if (gewohnheit.rhythmus === "x_pro_woche") return erledigtDieseWoche(gewohnheit) < gewohnheit.wochenziel;
  return true;
}

function renderHeute() {
  const liste = $("heuteListe");
  liste.replaceChildren();

  const alleAktiven = state.gewohnheiten.filter(g => !g.archiviert);
  const aktive = alleAktiven.filter(istHeuteDran);
  if (!aktive.length) {
    const p = document.createElement("p");
    p.className = "leer-hinweis";
    p.textContent = alleAktiven.length
      ? "Heute ist keine Gewohnheit dran."
      : "Noch keine Gewohnheit. Leg unten deine erste an.";
    liste.appendChild(p);
    return;
  }

  for (const g of aktive) {
    const tag = tagVon(g.id, state.heute);
    const menge = tag ? tag.menge : 0;
    const zustand = tag ? tag.status : "offen";
    // Immer das Ziel DIESES Tages, nie das aktuelle der Gewohnheit. Sonst
    // koennten Balken und Haken auseinanderlaufen, sobald jemand das Ziel
    // aendert - der Status faellt serverseitig ebenfalls gegen ziel_damals.
    const ziel = tag ? tag.ziel : g.zielmenge;

    const karte = document.createElement("div");
    karte.className = `gew ${zustand}`;

    // Bearbeiten sitzt auf Name+Zeile, nicht auf einem eigenen Knopf - der
    // waere in der Zeile nur ein weiteres Ziel, das man beim Abhaken
    // versehentlich trifft. Zahlenfeld und Haken sind bewusst KEINE Kinder
    // von haupt (siehe unten), ein Doppelklick dort loest normales Verhalten
    // aus (z. B. Text-Selektion), nicht den Dialog.
    const haupt = document.createElement("div");
    haupt.className = "gew-haupt";
    haupt.title = "Doppelklick zum Bearbeiten";
    haupt.ondblclick = () => oeffneGewohnheitDialog(g);

    const name = document.createElement("div");
    name.className = "gew-name";
    name.textContent = g.name;
    haupt.appendChild(name);

    const zeile = document.createElement("div");
    zeile.className = "gew-zeile";

    if (g.typ === "menge") {
      const text = document.createElement("span");
      text.textContent = `${menge} / ${ziel}` + (g.einheit ? ` ${g.einheit}` : "");
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
    st.textContent = straehne > 0 ? `🔥 ${straehne} Tage` : "keine Flamme";
    zeile.appendChild(st);

    haupt.appendChild(zeile);

    if (g.typ === "menge") {
      const balken = document.createElement("div");
      balken.className = "balken";
      const fuellung = document.createElement("i");
      fuellung.style.width = `${Math.min(100, Math.round(menge / ziel * 100))}%`;
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
      minus.onclick = () => setzeTag(g, state.heute, Math.max(0, menge - 1));
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
    const haken = document.createElement("button");
    haken.className = "haken" + (zustand === "erledigt" ? " an" : "");
    haken.textContent = "✓";
    haken.title = zustand === "erledigt" ? "Wieder öffnen" : "Als erledigt markieren";
    haken.onclick = () => {
      const voll = g.typ === "menge" ? ziel : 1;
      setzeTag(g, state.heute, zustand === "erledigt" ? 0 : voll);
    };
    karte.appendChild(haken);

    liste.appendChild(karte);
  }
}

/**
 * Einen Tag speichern - der einzige Schreibweg fuer Gewohnheiten.
 * Heute und Vergangenheit laufen ueber dieselbe Funktion; genau das macht das
 * Nachtragen aus.
 */
async function setzeTag(gewohnheit, datum, menge) {
  const antwort = await api("/api/gewohnheiten/log", {
    method: "PUT",
    body: JSON.stringify({
      gewohnheitId: gewohnheit.id, datum, menge, heute: state.heute,
    }),
  });
  if (!antwort.ok) { melde(antwort.daten.error || "Speichern fehlgeschlagen"); return false; }

  const d = antwort.daten;
  const eimer = state.logs[gewohnheit.id] || (state.logs[gewohnheit.id] = {});
  if (d.menge === 0) delete eimer[datum];
  else eimer[datum] = { menge: d.menge, ziel: d.ziel, status: d.status };

  const vorher = state.straehnen[gewohnheit.id] || 0;
  state.straehnen[gewohnheit.id] = d.straehne;

  renderHeute();
  renderVerlauf();

  // Nur melden, wenn die Straehne durch einen NACHGETRAGENEN Tag gewachsen
  // ist - beim normalen Abhaken von heute sieht man die Zahl ohnehin.
  if (datum !== state.heute && d.straehne > vorher) {
    melde(`${formatDatum(datum)} nachgetragen — Flamme jetzt ${d.straehne} Tage`);
  }
  return true;
}

/* ------------------------------------------------------------- Verlauf */
/* Ein Monatskalender pro Gewohnheit, umschaltbar ueber kalWahl. Ersetzt das
   fruehere Raster (eine Zeile pro Gewohnheit, alle gleichzeitig) - bei mehr
   als ein, zwei Gewohnheiten wurden die Zellen darin zu klein zum Treffen. */

function renderVerlauf() {
  const aktive = state.gewohnheiten.filter(g => !g.archiviert);
  if (!aktive.length) {
    verlauf.gewohnheitId = null;
    $("kalWahl").replaceChildren();
    $("kalMonat").textContent = "";
    $("kalZurueck").disabled = true;
    $("kalVor").disabled = true;
    $("kalLegendeGeplant").hidden = true;
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
    knopf.title = "Doppelklick zum Bearbeiten";
    knopf.setAttribute("aria-selected", String(g.id === verlauf.gewohnheitId));
    knopf.onclick = () => {
      verlauf.gewohnheitId = g.id;
      renderKalWahl();
      renderKalender();
    };
    // Gewohnheiten, die heute/diese Woche nicht dran sind, tauchen nur hier
    // auf (renderHeute() blendet sie aus) - ohne das waeren sie ueberhaupt
    // nicht mehr bearbeit- oder archivierbar.
    knopf.ondblclick = () => oeffneGewohnheitDialog(g);
    wahl.appendChild(knopf);
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

    const zelle = document.createElement("button");
    zelle.type = "button";
    zelle.className = "kal-zelle "
      + (!geplant ? "nicht-geplant" : (tag ? tag.status : "offen"))
      + (d === state.heute ? " heute" : "")
      + (zukunft ? " zukunft" : "");
    zelle.textContent = String(Number(d.slice(8, 10)));
    zelle.title = `${wochentagVon(d)}, ${formatDatum(d)}`
      + (!geplant ? " — nicht geplant"
        : tag ? `: ${tag.menge}${gewohnheit.typ === "menge" ? " / " + tag.ziel + (gewohnheit.einheit ? " " + gewohnheit.einheit : "") : ""}`
        : "");

    if (zukunft || !geplant) zelle.disabled = true;
    else zelle.onclick = () => oeffneTagDialog(gewohnheit, d);

    kal.appendChild(zelle);
  }

  $("kalLegendeGeplant").hidden = !irgendeinNichtGeplant;
}

$("kalZurueck").onclick = () => { verlauf.monat = monatPlus(verlauf.monat, -1); renderKalender(); };
$("kalVor").onclick = () => { verlauf.monat = monatPlus(verlauf.monat, 1); renderKalender(); };

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
  document.title = "✓ Fertig — Fokus";
  piep();
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification("Fokus-Sitzung fertig", { body: `${minuten} Minuten geschafft.`, icon: "icon-192.png" });
    } catch (e) { /* manche Browser erlauben das nur aus einem Service Worker */ }
  }
  melde(`Sitzung fertig — ${minuten} Minuten`);
}

// Ein Takt pro Sekunde. Er zeichnet nur; gerechnet wird aus dem Startzeitpunkt.
setInterval(() => {
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
    const v = antwort.daten.vorherBeendet;
    melde(`Vorherige Sitzung mit ${v.echteMin} Min. abgeschlossen`);
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

$("stopBtn").onclick = () => beendeSitzung(false);

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
  if (heuteStr() !== state.heute) { await ladeGewohnheiten(); renderHeute(); renderVerlauf(); }
  await ladeFokus();
  renderFokus();
});

/* ------------------------------------------------------------- Dialoge */

let bearbeiteteGewohnheit = null;
let gewaehlterTyp = "binaer";
let gewaehlterRhythmus = "taeglich";
let gewaehlteWochentage = new Set(); // Indizes 0=Mo..6=So, siehe WOCHENTAGE

function setzeTypWahl(typ) {
  gewaehlterTyp = typ;
  for (const knopf of $("gewTyp").querySelectorAll("button")) {
    knopf.setAttribute("aria-pressed", String(knopf.dataset.typ === typ));
  }
  $("gewZielFeld").hidden = typ !== "menge";
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
  $("gewZiel").value = gewohnheit && gewohnheit.zielmenge ? gewohnheit.zielmenge : 30;
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
  $("gewName").focus();
}

for (const knopf of $("gewTyp").querySelectorAll("button")) {
  knopf.onclick = () => setzeTypWahl(knopf.dataset.typ);
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
  $("tagLabel").textContent = istMenge
    ? (gewohnheit.einheit ? `Menge in ${gewohnheit.einheit} (Ziel ${ziel})` : `Menge (Ziel ${ziel})`)
    : "Status";
  const wert = tag ? tag.menge : 0;
  $("tagMenge").value = String(wert);
  $("tagMengeFeld").hidden = !istMenge;
  $("tagStatus").hidden = istMenge;

  $("tagPopup").hidden = false;
  if (istMenge) {
    $("tagMenge").focus();
    $("tagMenge").select();
  } else {
    // Abhaken statt Zahl eintippen: die Wahl spiegelt den aktuellen Stand,
    // ein Klick auf die andere Seite reicht zum Umschalten.
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
  if (await setzeTag(tagGewohnheit, tagDatum, menge)) $("tagPopup").hidden = true;
  else $("tagMsg").textContent = "Speichern fehlgeschlagen";
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
}

function renderBenachrichtigung() {
  const knopf = $("einBenachrichtigung");
  const text = $("einBenachrichtigungText");
  if (!("Notification" in window)) {
    knopf.hidden = true;
    text.textContent = "Dein Browser kennt keine Benachrichtigungen. Ton und Tab-Titel melden sich trotzdem.";
    return;
  }
  if (Notification.permission === "granted") {
    knopf.hidden = true;
    text.textContent = "Erlaubt — du bekommst am Ende jeder Sitzung eine Benachrichtigung.";
  } else if (Notification.permission === "denied") {
    knopf.hidden = true;
    text.textContent = "Blockiert. Das lässt sich nur in den Browser-Einstellungen ändern; Ton und Tab-Titel melden sich weiterhin.";
  } else {
    knopf.hidden = false;
    text.textContent = "Ohne Erlaubnis meldet sich nur der Ton und der Tab-Titel.";
  }
}

$("einBenachrichtigung").onclick = async () => {
  await Notification.requestPermission();
  renderBenachrichtigung();
};

$("einstellungenBtn").onclick = () => {
  $("einDauer").value = String(fokus.arbeitMin);
  $("einKonto").textContent = `Angemeldet als ${state.email}`;
  renderArchiv();
  renderBenachrichtigung();
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
  melde(`Standarddauer: ${fokus.arbeitMin} Minuten`);
};

$("einAbmelden").onclick = async () => {
  const ok = await frage("Abmelden?",
    "Das meldet dich auch aus der ToDo-Liste ab — beide Apps teilen sich dieselbe Sitzung.",
    "Abmelden");
  if (!ok) return;
  await api("/api/auth/logout", { method: "POST" });
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
  for (const knopf of $("reiter").querySelectorAll("button")) {
    knopf.setAttribute("aria-selected", String(knopf.dataset.ansicht === name));
  }
  if (name === "heute") renderHeute();
  if (name === "verlauf") renderVerlauf();
  if (name === "fokus") renderFokus();
}

for (const knopf of $("reiter").querySelectorAll("button")) {
  knopf.onclick = () => zeigeAnsicht(knopf.dataset.ansicht);
}

// Hell/Dunkel wie in der ToDo-Liste: gemerkt in localStorage, sonst folgt es
// der Systemeinstellung.
function setzeThema(thema) {
  document.documentElement.setAttribute("data-theme", thema);
  $("themaBtn").textContent = thema === "dark" ? "☀ Helles Design" : "☾ Dunkles Design";
  localStorage.setItem("thema", thema);
}
setzeThema(localStorage.getItem("thema")
  || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("themaBtn").onclick = () => {
  setzeThema(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
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

start();
