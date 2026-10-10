// Notifications sur le telephone (Web Push), utiles car le serveur de prod n'envoie pas
// d'e-mails. Cles VAPID creees au premier usage et gardees en base (meta « vapid »).
// Chaque appareil s'abonne depuis Mon compte (sur iPhone : app installee, iOS 16.4+).
// Abonnement refuse par le service (404 / 410 : appareil desinscrit) = supprime.
// HOTTE_PUSH=log : rien n'est envoye, messages gardes en memoire (tests).
const webpush = require('web-push');
const { db, getSetting, setSetting } = require('./db');
const { httpError } = require('./util');

const outbox = [];

function keys() {
  let k = getSetting('vapid');
  if (!k) {
    k = webpush.generateVAPIDKeys();
    setSetting('vapid', k);
  }
  return k;
}
const publicKey = () => keys().publicKey;

function subscribe(memberId, sub) {
  const endpoint = String((sub && sub.endpoint) || '');
  const k = (sub && sub.keys) || {};
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000 || !k.p256dh || !k.auth) throw httpError(400, 'Abonnement invalide.');
  db.prepare(`INSERT INTO push_subs (member_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(memberId, endpoint, String(k.p256dh).slice(0, 200), String(k.auth).slice(0, 100), Date.now());
}

function unsubscribe(memberId, endpoint) {
  db.prepare('DELETE FROM push_subs WHERE member_id = ? AND endpoint = ?').run(memberId, String(endpoint || ''));
}

const count = (memberId) => db.prepare('SELECT COUNT(*) AS n FROM push_subs WHERE member_id = ?').get(memberId).n;

// Contact exige par le protocole : adresse de l'administrateur.
function subject() {
  const admin = db.prepare('SELECT email FROM members WHERE is_admin = 1 AND email IS NOT NULL ORDER BY id LIMIT 1').get();
  return `mailto:${admin ? admin.email : 'hotte@localhost'}`;
}

// payload : { title, body, url } (url = '#/...', ouverte dans l'app au toucher).
async function sendTo(memberId, payload) {
  const subs = db.prepare('SELECT * FROM push_subs WHERE member_id = ?').all(memberId);
  if (!subs.length) return;
  if (process.env.HOTTE_PUSH === 'log') { outbox.push({ memberId, ...payload }); return; }
  const k = keys();
  const opts = { TTL: 3 * 24 * 3600, vapidDetails: { subject: subject(), publicKey: k.publicKey, privateKey: k.privateKey } };
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), opts);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare('DELETE FROM push_subs WHERE id = ?').run(s.id);
      else console.error('Notification non envoyée', e.statusCode || e.message);
    }
  }));
}

module.exports = { publicKey, subscribe, unsubscribe, count, sendTo, outbox };
