#!/usr/bin/env node
// convert-vapid-key.js
// Converts THIS app's VAPID private key (the original PEM) into a single base64 line
// that is safe to paste into Netlify (no newlines to lose, so the DECODER error
// "error:1E08010C:DECODER routines::unsupported" can't happen).
//
// The private key never leaves your machine. Run it locally, not on a server.
//
// USAGE (either one):
//   1) Save your current VAPID_PRIVATE_KEY (the multi-line PEM, the same value that is
//      in Netlify now) to a file, e.g. vapid_private.pem, then run:
//         node convert-vapid-key.js vapid_private.pem
//
//   2) Or pipe it in:
//         cat vapid_private.pem | node convert-vapid-key.js
//
// It prints:
//   - a sanity check that the key is a valid EC (P-256) key
//   - the ONE-LINE base64 value to paste into Netlify as VAPID_PRIVATE_KEY
//
// IMPORTANT: use THIS app's own key. Do not reuse another app's key.

const fs = require('fs');
const crypto = require('crypto');

function readInput() {
  const fileArg = process.argv[2];
  if (fileArg) return fs.readFileSync(fileArg, 'utf8');
  // read from stdin
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

let pem = (readInput() || '').trim();
if (!pem) {
  console.error('No input. Pass a PEM file path or pipe the PEM in. See the header of this file.');
  process.exit(1);
}

// If someone already handed us a \n-escaped or base64 blob, normalize to real PEM first.
if (!pem.includes('BEGIN')) {
  try {
    const decoded = Buffer.from(pem.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    if (decoded.includes('BEGIN')) pem = decoded;
  } catch (_) { /* ignore */ }
}
pem = pem.replace(/\\n/g, '\n').trim();

// sanity check: must be an EC key
let keyType = null;
try {
  keyType = crypto.createPrivateKey(pem).asymmetricKeyType;
} catch (e) {
  console.error('This does not load as a private key:', e.message);
  console.error('Make sure you passed the full PEM including the BEGIN/END lines.');
  process.exit(1);
}
if (keyType !== 'ec') {
  console.error(`Loaded, but asymmetricKeyType is "${keyType}", not "ec". This is not a VAPID EC key.`);
  process.exit(1);
}

const oneLine = Buffer.from(pem, 'utf8').toString('base64');

console.log('');
console.log('Key check: OK  (EC / P-256 VAPID private key)');
console.log('');
console.log('Paste this ONE line into Netlify as VAPID_PRIVATE_KEY:');
console.log('------------------------------------------------------------');
console.log(oneLine);
console.log('------------------------------------------------------------');
console.log('');
console.log('Then Trigger deploy in Netlify (env changes need a redeploy), and use');
console.log('"Send test push" in the app to confirm ok:true and a real notification.');
