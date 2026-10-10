// Partage d'une liste hors du cercle (parrain, tonton, grand-mere sans compte) :
//  - un lien secret par liste (lists.share_token, NULL = desactive), cree ou renouvele
//    par le destinataire, un co-proprietaire ou un gestionnaire ;
//  - un mot de passe facultatif (lists.share_password_hash) : sans lui, le lien seul ne
//    suffit pas. Le changer ou le retirer deconnecte les invites deja entres ;
//  - l'invite donne son prenom (+ e-mail facultatif, pour les notifications) : il devient
//    un membre « invite » rattache a cette seule liste (members.guest_list_id), en vue
//    offrant. Revenir avec le meme prenom = meme invite (ses reservations).
// Desactiver le partage coupe l'acces de tous les invites (voir auth.loadUser).
const { db, tx } = require('./db');
const { httpError, str, limiter } = require('./util');
const auth = require('./auth');
const A = require('./access');
const { PALETTE } = require('./circle');

const MAX_GUESTS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function shareInfo(user, listId, base) {
  const { list } = A.requireEdit(listId, user.id);
  const guests = db.prepare('SELECT id, name, color, guest_email FROM members WHERE guest_list_id = ? ORDER BY name COLLATE NOCASE').all(list.id);
  return {
    enabled: !!list.share_token,
    url: list.share_token ? `${base}/?partage=${list.share_token}` : null,
    hasPassword: !!list.share_password_hash,
    guests: guests.map((g) => ({ id: g.id, name: g.name, color: g.color, email: g.guest_email })),
  };
}

// Active (ou renouvelle : l'ancien lien ne fonctionne plus pour entrer).
function enable(user, listId, renew) {
  const { list } = A.requireEdit(listId, user.id);
  if (!list.share_token || renew) db.prepare('UPDATE lists SET share_token = ? WHERE id = ?').run(auth.newToken(), list.id);
}

function disable(user, listId) {
  const { list } = A.requireEdit(listId, user.id);
  db.prepare('UPDATE lists SET share_token = NULL WHERE id = ?').run(list.id);
}

const dropGuestSessions = (listId) => db.prepare('DELETE FROM sessions WHERE member_id IN (SELECT id FROM members WHERE guest_list_id = ?)').run(listId);

async function setPassword(user, listId, password) {
  const { list } = A.requireEdit(listId, user.id);
  const p = password == null ? '' : String(password);
  if (p && p.length < 4) throw httpError(400, 'Mot de passe trop court (4 caractères minimum).');
  if (p.length > 100) throw httpError(400, 'Mot de passe trop long.');
  const hash = p ? await auth.hashSecret(p) : null;
  tx(() => {
    db.prepare('UPDATE lists SET share_password_hash = ? WHERE id = ?').run(hash, list.id);
    dropGuestSessions(list.id); // les invites devront saisir le nouveau mot de passe
  });
}

// Retire un invite : ses reservations, messages et cadeaux hors liste partent avec lui.
function removeGuest(user, listId, guestId) {
  const { list } = A.requireEdit(listId, user.id);
  const g = db.prepare('SELECT id FROM members WHERE id = ? AND guest_list_id = ?').get(guestId, list.id);
  if (!g) throw httpError(404, 'Invité introuvable.');
  db.prepare('DELETE FROM members WHERE id = ?').run(g.id);
}

function byToken(token) {
  const list = token ? db.prepare('SELECT * FROM lists WHERE share_token = ?').get(String(token)) : null;
  if (!list) throw httpError(404, 'Ce lien de partage n’existe pas ou a été désactivé.');
  return list;
}

// Ce que voit la page d'accueil d'un invite (avant le mot de passe : titre et prenom seuls).
function publicInfo(token) {
  const list = byToken(token);
  const owner = db.prepare('SELECT name FROM members WHERE id = ?').get(list.owner_id);
  return { listId: list.id, title: list.title, cover: list.cover, ownerName: owner.name, needsPassword: !!list.share_password_hash };
}

// Essais de mot de passe : 10 echecs par lien et par quart d'heure, puis blocage.
const failures = limiter(15 * 60 * 1000);

async function join(req, res, token, b) {
  const list = byToken(token);
  if (list.share_password_hash) {
    if (failures.count(list.id) >= 10) throw httpError(429, 'Trop d’essais : réessaie dans 15 minutes.');
    if (!(await auth.verifyPassword(b.password, list.share_password_hash))) {
      failures.hit(list.id);
      await new Promise((r) => setTimeout(r, 500));
      throw httpError(401, 'Mot de passe incorrect.');
    }
  }
  const name = str(b.name, 40);
  if (!name) throw httpError(400, 'Indique ton prénom.');
  const email = str(b.email, 120).toLowerCase() || null;
  if (email && !EMAIL.test(email)) throw httpError(400, 'Adresse e-mail invalide.');
  // Meme prenom sur cette liste = meme invite (il retrouve ses reservations).
  let g = db.prepare('SELECT id FROM members WHERE guest_list_id = ? AND name = ? COLLATE NOCASE').get(list.id, name);
  if (g) {
    if (email) db.prepare('UPDATE members SET guest_email = ? WHERE id = ?').run(email, g.id);
  } else {
    const n = db.prepare('SELECT COUNT(*) AS n FROM members WHERE guest_list_id = ?').get(list.id).n;
    if (n >= MAX_GUESTS) throw httpError(409, 'Trop d’invités sur cette liste.');
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    g = { id: Number(db.prepare('INSERT INTO members (name, color, guest_list_id, guest_email, created_at) VALUES (?, ?, ?, ?, ?)').run(name, color, list.id, email, Date.now()).lastInsertRowid) };
  }
  auth.createSession(req, res, g.id);
  return { listId: list.id };
}

// Routes permises a un invite : sa liste, et les actions d'offrant sur ses articles.
function guestAllowed(req) {
  const lid = req.user.guestListId;
  const m = (re) => req.path.match(re);
  const itemList = (id) => (db.prepare('SELECT list_id FROM items WHERE id = ?').get(id) || {}).list_id;
  let x;
  if (req.method === 'GET' && req.path === '/me') return true;
  if ((x = m(/^\/lists\/(\d+)$/)) && req.method === 'GET') return Number(x[1]) === lid;
  if ((x = m(/^\/lists\/(\d+)\/off-list$/)) && req.method === 'POST') return Number(x[1]) === lid;
  if ((x = m(/^\/items\/(\d+)\/(reserve|participate|comments)$/)) && req.method === 'POST') return itemList(Number(x[1])) === lid;
  if ((x = m(/^\/reservations\/(\d+)$/)) && ['PATCH', 'DELETE'].includes(req.method)) {
    const r = db.prepare('SELECT item_id FROM reservations WHERE id = ?').get(Number(x[1]));
    return !!r && itemList(r.item_id) === lid;
  }
  if ((x = m(/^\/off-list\/(\d+)$/)) && req.method === 'DELETE') {
    const o = db.prepare('SELECT list_id FROM off_list_gifts WHERE id = ?').get(Number(x[1]));
    return !!o && o.list_id === lid;
  }
  return false;
}

module.exports = { shareInfo, enable, disable, setPassword, removeGuest, publicInfo, join, guestAllowed, failures };
