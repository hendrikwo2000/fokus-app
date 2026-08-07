/**
 * Mailversand ueber Resend, plus die Optik der Anmeldemail.
 *
 * Gespiegelt aus der ToDo-Liste (ToDo/web/functions/_lib/mail.js), damit beide
 * Apps gleich aussehen. Hier gibt es nur EINE Mail - den Anmeldecode; die
 * Wartelisten- und Willkommensmails der ToDo-Liste fallen weg, weil sich hier
 * niemand registrieren kann.
 *
 * Absenderdomain bleibt mail.it-wolf.org: dort liegen SPF/DKIM/DMARC, getrennt
 * von den Zoho-MX der Hauptdomain. Eine eigene Sendedomain waere neue
 * DNS-Arbeit ohne Gegenwert.
 */

const ABSENDER = "Fokus <login@mail.it-wolf.org>";

/**
 * Rahmen fuer alle Mails. Tabellen-Layout und Inline-Styles, weil
 * Mailprogramme kein modernes CSS koennen (Outlook rendert mit Word).
 * `inhalt` sind fertige <tr>-Zeilen.
 */
export function huelle(ueberschrift, inhalt, akzent = "#4f63d2") {
  return `<!doctype html>
<html lang="de">
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:420px;background:#ffffff;border-radius:14px;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:28px 28px 0;">
          <div style="font-size:13px;font-weight:600;color:${akzent};letter-spacing:.4px;">FOKUS</div>
          <h1 style="margin:14px 0 0;font-size:20px;line-height:1.3;color:#1c1d21;font-weight:700;">
            ${ueberschrift}
          </h1>
        </td></tr>
        ${inhalt}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Absatz in der Mail-Huelle.
export function absatz(text) {
  return `<tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.55;color:#5b5e66;">
    ${text}
  </td></tr>`;
}

// Hervorgehobener Kasten (hier: der Anmeldecode).
export function kasten(inhalt, gross = false) {
  const schrift = gross
    ? "font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:30px;font-weight:700;letter-spacing:7px;"
    : "font-size:14px;line-height:1.6;";
  return `<tr><td style="padding:22px 28px 0;">
    <div style="background:#f4f5f7;border-radius:10px;padding:18px;text-align:center;
                ${schrift}color:#1c1d21;">${inhalt}</div>
  </td></tr>`;
}

// Blauer Knopf. Als Tabelle, weil Outlook auf gestylten <a> nicht zuverlaessig
// einen klickbaren Block rendert.
export function knopf(text, url) {
  return `<tr><td style="padding:22px 28px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr><td align="center" bgcolor="#4f63d2" style="border-radius:10px;">
        <a href="${url}" style="display:inline-block;padding:12px 22px;font-size:14px;
           font-weight:600;color:#ffffff;text-decoration:none;">${text}</a>
      </td></tr>
    </table>
  </td></tr>`;
}

// Abschliessende Kleingedruckt-Zeile mit Trennlinie.
export function fussnote(text) {
  return `<tr><td style="padding:20px 28px 28px;">
    <div style="border-top:1px solid #e6e7ea;padding-top:16px;font-size:12.5px;
                line-height:1.5;color:#8b8e96;">${text}</div>
  </td></tr>`;
}

/**
 * Verschickt eine Mail. Wirft nie - Aufrufer entscheiden anhand von .ok, ob
 * ein fehlgeschlagener Versand die Anfrage kippen soll.
 */
export async function sendeMail(env, { to, subject, html, text }) {
  if (!env.RESEND_KEY) return { ok: false, grund: "RESEND_KEY fehlt im Pages-Projekt" };
  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: ABSENDER, to: [to], subject, html, text }),
    });
  } catch (e) {
    // fetch wirft, wenn Resend gar nicht erreichbar ist.
    return { ok: false, grund: "Mailversand nicht erreichbar" };
  }
  return res.ok ? { ok: true } : { ok: false, grund: "Mail konnte nicht verschickt werden" };
}
