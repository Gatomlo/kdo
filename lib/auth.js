// Authentification (meme socle que Le Cabas) : e-mail + mot de passe ; lien de
// connexion par e-mail en option (si l'envoi est configure) ; session de 90 jours
// gardee en base. Un profil sans compte (email NULL) ne peut jamais se connecter.
const crypto = require('crypto');
const { promisify } = require('util');
const { db, getSetting } = require('./db');
const { httpError, limiter } = require('./util');

const COOKIE = 'hotte_session';
const SESSION_TTL = 90 * 24 * 3600 * 1000;
const LOGIN_TTL = 15 * 60 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

// Chemin de montage de l'app (/hotte dans la passerelle, '' seule).
function rootPath(req) {
  const m = req.app && req.app.mountpath;
  return typeof m === 'string' && m !== '/' ? m : '';
}

// Adresse publique de l'app pour les liens (invitations, partage, e-mails) : variable
// HOTTE_PUBLIC_URL, sinon reglage de l'administrateur (ex. https://exemple.be/hotte), sinon
// deduite de la requete (l'en-tete Host pouvant etre falsifie, a fixer en production).
function publicUrl(req) {
  const fixed = String(process.env.HOTTE_PUBLIC_URL || getSetting('public_url') || '').replace(/\/+$/, '');
  if (fixed) return fixed;
  const proto = String(req.get('x-forwarded-proto') || req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}${rootPath(req)}`;
}

function readCookie(req) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

// Cookie limite a l'app (pas aux autres outils de la passerelle, meme domaine).
function setCookie(req, res, value, maxAge) {
  const secure = req.secure || String(req.get('x-forwarded-proto') || '').startsWith('https');
  const parts = [`${COOKIE}=${value}`, `Path=${rootPath(req)}/`, `Max-Age=${Math.floor(maxAge / 1000)}`, 'HttpOnly', 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function createSession(req, res, memberId) {
  const token = newToken();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, member_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), memberId, Date.now() + SESSION_TTL);
  setCookie(req, res, token, SESSION_TTL);
}

function destroySession(req, res) {
  const token = readCookie(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  setCookie(req, res, '', 0);
}

// Renseigne req.user si la session est valide (prolongee au plus une fois par jour).
// Invite externe (guestListId) : session valable tant que le partage de sa liste est actif.
function loadUser(req, res, next) {
  const token = readCookie(req);
  if (token) {
    const row = db.prepare(`SELECT m.id, m.email, m.name, m.color, m.is_admin, m.guest_list_id, s.expires_at FROM sessions s
      JOIN members m ON m.id = s.member_id LEFT JOIN lists l ON l.id = m.guest_list_id
      WHERE s.token_hash = ? AND (m.email IS NOT NULL OR (m.guest_list_id IS NOT NULL AND l.share_token IS NOT NULL))`).get(sha256(token));
    if (row && row.expires_at > Date.now()) {
      req.user = { id: row.id, email: row.email, name: row.name, color: row.color, isAdmin: !!row.is_admin, guestListId: row.guest_list_id || null };
      if (row.expires_at - Date.now() < SESSION_TTL - 24 * 3600 * 1000) {
        db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_TTL, sha256(token));
        setCookie(req, res, token, SESSION_TTL);
      }
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(httpError(401, 'Connexion requise.'));
  next();
}

function admin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return next(httpError(403, 'Réservé à l’administrateur du cercle.'));
  next();
}

// ---------- Liens de connexion par e-mail ----------
// Limites : 5 demandes par adresse et par heure, 100 au total (anti-abus d'envoi).
const requests = limiter(3600 * 1000);
function createLoginToken(email) {
  const key = email.toLowerCase();
  if (requests.count(key) >= 5 || requests.count('*') >= 100) throw httpError(429, 'Trop de demandes, réessaie plus tard.');
  requests.hit(key); requests.hit('*');
  const token = newToken();
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(Date.now() - 24 * 3600 * 1000);
  db.prepare('INSERT INTO login_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)').run(sha256(token), email, Date.now() + LOGIN_TTL);
  return token;
}

// Consomme un lien : renvoie l'adresse e-mail, ou une erreur 400.
function consumeLoginToken(token) {
  const row = db.prepare('SELECT email, expires_at, used_at FROM login_tokens WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!row || row.used_at || row.expires_at < Date.now()) throw httpError(400, 'Lien de connexion expiré ou déjà utilisé. Demandes-en un nouveau.');
  db.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(String(token)));
  return row.email;
}

// ---------- Mots de passe ----------
// scrypt : calcul volontairement couteux, asynchrone. Format : scrypt$<sel hex>$<empreinte hex>.
const scrypt = promisify(crypto.scrypt);
const MIN_PASSWORD = 8;

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) throw httpError(400, `Mot de passe trop court (${MIN_PASSWORD} caractères minimum).`);
  if (p.length > 200) throw httpError(400, 'Mot de passe trop long.');
}
async function hashPassword(p) {
  checkPassword(p);
  return hashSecret(p);
}
// Empreinte sans regle de longueur (mot de passe d'une liste partagee).
async function hashSecret(p) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(p, salt, 64)).toString('hex')}`;
}
// Compte inconnu ou sans mot de passe : meme calcul sur une empreinte factice (le temps
// de reponse ne revele pas si l'adresse existe).
const DUMMY = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;
async function verifyPassword(p, stored) {
  const [, salt, hash] = String(stored || DUMMY).split('$');
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(String(p || ''), Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual) && !!stored;
}

// Echecs de connexion : blocage 15 min apres 8 echecs pour une adresse ; au-dela de 40
// echecs au total, reponses ralenties (l'IP n'est pas fiable derriere le proxy).
const failures = limiter(15 * 60 * 1000);
const tooManyFailures = (email) => failures.count('u:' + email) >= 8;
const recordFailure = (email) => { failures.hit('u:' + email); failures.hit('*'); };
const failureDelay = () => (failures.count('*') >= 40 ? 3000 : 600);

// Lien de reinitialisation (cree par l'administrateur, transmis a la main) : 48 h.
function createResetToken(memberId) {
  const token = newToken();
  db.prepare('DELETE FROM reset_tokens WHERE expires_at < ? OR member_id = ?').run(Date.now(), memberId);
  db.prepare('INSERT INTO reset_tokens (token_hash, member_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), memberId, Date.now() + 48 * 3600 * 1000);
  return token;
}
function consumeResetToken(token) {
  const row = db.prepare('SELECT member_id, expires_at, used_at FROM reset_tokens WHERE token_hash = ?').get(sha256(String(token || '')));
  if (!row || row.used_at || row.expires_at < Date.now()) throw httpError(400, 'Lien expiré ou déjà utilisé. Demandes-en un nouveau à l’administrateur du cercle.');
  db.prepare('UPDATE reset_tokens SET used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(String(token)));
  return row.member_id;
}

module.exports = {
  sha256, newToken, rootPath, publicUrl, createSession, destroySession, loadUser, requireAuth, admin,
  createLoginToken, consumeLoginToken, requests,
  hashPassword, hashSecret, verifyPassword, checkPassword, tooManyFailures, recordFailure, failureDelay, failures, createResetToken, consumeResetToken,
};
