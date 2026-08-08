/**
 * Web Push von Hand, nur mit WebCrypto (keine Bibliothek - das Projekt hat
 * bewusst kein package.json/Build-Schritt, siehe BETRIEB.md).
 *
 * Zwei Standards, beide iOS 16.4+ (Safari) und Chrome/FCM gleichermassen:
 *   RFC 8291 - Verschluesselung der Nachricht ("aes128gcm")
 *   RFC 8292 - VAPID: Absender-Identitaet per signiertem JWT
 *
 * Apple nutzt fuer installierte PWAs denselben Standard-Push-Dienst wie jeder
 * andere Browser (web.push.apple.com) - kein eigenes APNs-Zertifikat noetig.
 *
 * Identisch zur gleichnamigen Datei in der ToDo-Liste - reiner
 * Protokoll-Code, keine App-spezifische Logik.
 */

const b64urlEncode = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const te = new TextEncoder();

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, dataBytes));
}

function concatBytes(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// HKDF-Expand, ein Block reicht hier immer (wir brauchen nie mehr als 32 Byte).
async function hkdfExpand(prk, info, length) {
  const block = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return block.slice(0, length);
}

/**
 * Signiertes VAPID-JWT (ES256) fuer den Authorization-Header.
 *
 * Der private Schluessel liegt als roher 32-Byte-Skalar vor (so wie ihn
 * erzeugeVapidSchluessel() liefert); fuer crypto.subtle.sign muss er als JWK
 * importiert werden - x/y kommen aus dem oeffentlichen Schluessel (Punkt
 * 0x04 || X || Y), d aus dem privaten Skalar selbst.
 */
async function vapidJwt(audience, subjectMailto, publicKeyRaw, privateKeyRaw) {
  const jwk = {
    kty: "EC", crv: "P-256", ext: true,
    x: b64urlEncode(publicKeyRaw.slice(1, 33)),
    y: b64urlEncode(publicKeyRaw.slice(33, 65)),
    d: b64urlEncode(privateKeyRaw),
  };
  const key = await crypto.subtle.importKey(
    "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subjectMailto,
  };
  const signingInput = `${b64urlEncode(te.encode(JSON.stringify(header)))}.${b64urlEncode(te.encode(JSON.stringify(payload)))}`;
  // WebCrypto liefert bei ECDSA das rohe (r||s)-Format, 64 Byte - genau das
  // Format, das JWS fuer ES256 erwartet (kein DER).
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, te.encode(signingInput)));
  return `${signingInput}.${b64urlEncode(sig)}`;
}

/**
 * Payload nach RFC 8291 verschluesseln ("aes128gcm"-Content-Encoding).
 * Gibt den fertigen Binaerkoerper fuer den POST an den Push-Dienst zurueck.
 */
async function verschluesselePayload(payloadBytes, p256dhB64, authB64) {
  const clientPublicKeyRaw = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);

  const clientPublicKey = await crypto.subtle.importKey(
    "raw", clientPublicKeyRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);

  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublicKeyRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKeyPair.publicKey));

  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey }, serverKeyPair.privateKey, 256));

  // ecdh_secret -> ikm (RFC 8291 §3.3/3.4): PRK mit dem auth-Secret als Salt,
  // dann Expand mit einer Info, die beide oeffentlichen Schluessel bindet.
  const authInfo = concatBytes(
    te.encode("WebPush: info\0"), clientPublicKeyRaw, serverPublicKeyRaw);
  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const ikm = await hkdfExpand(prkKey, authInfo, 32);

  // RFC 8188 (aes128gcm-Framing): eigener Salt, CEK und Nonce aus IKM+Salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = await hkdfExpand(prk, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, te.encode("Content-Encoding: nonce\0"), 12);

  // Ein einziger Record reicht fuer unsere kurzen Nachrichten: Delimiter 0x02
  // (= letzter/einziger Record), keine zusaetzliche Polsterung noetig.
  const plain = concatBytes(payloadBytes, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, cekKey, plain));

  // Header: Salt(16) || RecordSize(4, big-endian) || KeyIdLaenge(1) || KeyId
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const header = concatBytes(
    salt, rs, new Uint8Array([serverPublicKeyRaw.length]), serverPublicKeyRaw);

  return concatBytes(header, ciphertext);
}

/**
 * Eine Push-Nachricht an eine Subscription schicken.
 *
 * Gibt { ok, status } zurueck statt zu werfen - der Aufrufer (pruefen.js)
 * soll bei 404/410 (Geraet/Abo existiert nicht mehr) die Zeile in der
 * Datenbank loeschen koennen, statt in einem try/catch zu enden.
 */
export async function sendeWebPush(env, subscription, payloadObjekt) {
  const payloadBytes = te.encode(JSON.stringify(payloadObjekt));
  const body = await verschluesselePayload(payloadBytes, subscription.p256dh, subscription.auth);

  const publicKeyRaw = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const privateKeyRaw = b64urlDecode(env.VAPID_PRIVATE_KEY);
  const audience = new URL(subscription.endpoint).origin;
  const jwt = await vapidJwt(audience, "mailto:hendrik.wolf.004@gmail.com", publicKeyRaw, privateKeyRaw);

  const antwort = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
      "Authorization": `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });
  return { ok: antwort.ok, status: antwort.status };
}
