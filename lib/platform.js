// Plateforme : l'administrateur global (members.is_super) cree et gere les cercles. Chaque
// cercle est etanche (voir ctx.js) ; son premier administrateur arrive par un lien
// d'invitation a transmettre. Aucune donnee de cadeau n'est lue ici : seulement des comptages.
const { db, tx } = require('./db');
const { httpError, str } = require('./util');
const { sha256, newToken } = require('./auth');

const INVITE_TTL = 14 * 24 * 3600 * 1000;

const getCircle = (id) => {
  const c = db.prepare('SELECT * FROM circles WHERE id = ?').get(id);
  if (!c) throw httpError(404, 'Cercle introuvable.');
  return c;
};

function name(v) {
  const n = str(v, 60);
  if (!n) throw httpError(400, 'Donne un nom au cercle.');
  return n;
}

function list(user) {
  return db.prepare(`SELECT c.id, c.name, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM members m WHERE m.circle_id = c.id AND m.email IS NOT NULL) AS members,
      (SELECT COUNT(*) FROM members m WHERE m.circle_id = c.id AND m.email IS NULL AND m.guest_list_id IS NULL) AS profiles,
      (SELECT GROUP_CONCAT(m.name, ', ') FROM members m WHERE m.circle_id = c.id AND m.is_admin = 1) AS admins
    FROM circles c ORDER BY c.id`).all()
    .map((c) => ({ ...c, mine: c.id === user.circleId, pendingAdmin: !!db.prepare('SELECT 1 FROM invitations WHERE circle_id = ? AND is_admin = 1 AND used_at IS NULL AND expires_at > ?').get(c.id, Date.now()) }));
}

// Lien d'invitation d'un administrateur pour ce cercle. Renvoie le jeton.
function adminInvitation(user, circleId) {
  getCircle(circleId);
  const token = newToken();
  db.prepare('DELETE FROM invitations WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO invitations (token_hash, is_admin, invited_by, expires_at, circle_id) VALUES (?, 1, ?, ?, ?)')
    .run(sha256(token), user.id, Date.now() + INVITE_TTL, circleId);
  return token;
}

function create(user, b) {
  return tx(() => {
    const id = Number(db.prepare('INSERT INTO circles (name, created_at) VALUES (?, ?)').run(name(b.name), Date.now()).lastInsertRowid);
    return { id, token: adminInvitation(user, id) };
  });
}

function rename(id, b) {
  getCircle(id);
  db.prepare('UPDATE circles SET name = ? WHERE id = ?').run(name(b.name), id);
}

// Supprime le cercle et tout ce qu'il contient (cascade sur les membres, listes, evenements).
function remove(user, id) {
  const c = getCircle(id);
  if (id === user.circleId) throw httpError(400, 'Tu ne peux pas supprimer ton propre cercle.');
  db.prepare('DELETE FROM circles WHERE id = ?').run(id);
  return c;
}

module.exports = { list, create, rename, remove, adminInvitation, getCircle };
