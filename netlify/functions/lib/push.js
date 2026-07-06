// netlify/functions/lib/push.js
// Zero-dependency Web Push (VAPID ES256 + RFC 8291 aes128gcm). Node crypto only.
const crypto = require('crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

// DER ECDSA signature -> JOSE r||s (64 bytes)
function derToJose(der) {
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f;
  // parse two INTEGERs
  function readInt(pos) {
    if (der[pos] !== 0x02) throw new Error('bad DER');
    let len = der[pos + 1];
    let start = pos + 2;
    let val = der.slice(start, start + len);
    // strip leading zeros
    while (val.length > 32 && val[0] === 0x00) val = val.slice(1);
    // left pad to 32
    if (val.length < 32) val = Buffer.concat([Buffer.alloc(32 - val.length), val]);
    return { val, next: start + len };
  }
  const r = readInt(offset);
  const s = readInt(r.next);
  return Buffer.concat([r.val, s.val]);
}

function vapidJWT(audience, subject, privatePem) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = b64url(JSON.stringify({ aud: audience, exp, sub: subject }));
  const signingInput = header + '.' + payload;
  const signer = crypto.createSign('SHA256');
  signer.update(signingInput);
  const der = signer.sign(privatePem);
  const jose = derToJose(der);
  return signingInput + '.' + b64url(jose);
}

function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  const out = crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([0x01])])).digest();
  return out.slice(0, length);
}

// Encrypt payload per RFC 8291 (aes128gcm)
function encrypt(payload, p256dh, auth) {
  const uaPublic = b64urlToBuf(p256dh);      // 65 bytes
  const authSecret = b64urlToBuf(auth);       // 16 bytes
  const salt = crypto.randomBytes(16);

  const localEcdh = crypto.createECDH('prime256v1');
  localEcdh.generateKeys();
  const asPublic = localEcdh.getPublicKey();  // 65 bytes uncompressed
  const sharedSecret = localEcdh.computeSecret(uaPublic);

  // IKM per RFC 8291
  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    uaPublic,
    asPublic,
  ]);
  const ikm = hkdf(authSecret, sharedSecret, info, 32);

  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  const plain = Buffer.concat([Buffer.from(payload), Buffer.from([0x02])]); // pad delimiter
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096, 0);
  const idlen = Buffer.from([asPublic.length]);
  const body = Buffer.concat([salt, rs, idlen, asPublic, encrypted, tag]);
  return body;
}

async function sendPush(subscription, payloadObj, opts) {
  const { publicKey, privateKey, subject } = opts;
  const url = new URL(subscription.endpoint);
  const audience = url.origin;
  const jwt = vapidJWT(audience, subject, privateKey);

  const body = encrypt(JSON.stringify(payloadObj), subscription.keys.p256dh, subscription.keys.auth);

  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt},k=${publicKey}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body,
  });
  if (res.status === 404 || res.status === 410) return { gone: true };
  return { ok: res.ok, status: res.status };
}

module.exports = { sendPush };
