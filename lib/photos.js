// Photos des articles deposees depuis le telephone ou l'ordinateur. L'image est reduite
// par le navigateur (JPEG ~1200 px) puis envoyee telle quelle (corps binaire). Fichiers
// dans data/photos/<32 hex>.<ext> : nom impossible a deviner, servis sans connexion
// (les invites externes d'une liste doivent les voir). Un fichier qu'aucun article ne
// (ni idee) ne reference plus depuis 24 h est supprime (nettoyage apres chaque depot).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, DATA_DIR } = require('./db');
const { httpError } = require('./util');

const DIR = path.join(DATA_DIR, 'photos');
fs.mkdirSync(DIR, { recursive: true });
const MAX_BYTES = 3 * 1024 * 1024;
const LOCAL = /^photos\/[0-9a-f]{32}\.(jpg|png|webp)$/;

// Type reel d'apres les premiers octets (on ne se fie pas a l'en-tete annonce).
function kind(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function save(buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw httpError(400, 'Image manquante.');
  if (buf.length > MAX_BYTES) throw httpError(413, 'Image trop lourde (3 Mo maximum).');
  const ext = kind(buf);
  if (!ext) throw httpError(415, 'Format d’image non reconnu (JPEG, PNG ou WebP).');
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(DIR, name), buf);
  cleanup();
  return `photos/${name}`;
}

const isLocal = (v) => typeof v === 'string' && LOCAL.test(v);

function cleanup(maxAgeMs = 24 * 3600 * 1000) {
  const used = new Set(db.prepare("SELECT image FROM items WHERE image LIKE 'photos/%' UNION SELECT image FROM ideas WHERE image LIKE 'photos/%'").all().map((r) => r.image.slice(7)));
  for (const f of fs.readdirSync(DIR)) {
    if (used.has(f)) continue;
    const file = path.join(DIR, f);
    try { if (Date.now() - fs.statSync(file).mtimeMs > maxAgeMs) fs.rmSync(file); } catch { /* deja supprime */ }
  }
}

module.exports = { save, isLocal, cleanup, DIR };
