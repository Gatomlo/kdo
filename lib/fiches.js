// Fiche « tailles et preferences » de chaque personne : tailles (haut, bas, chaussures,
// bague), couleurs, ce qu'elle aime, n'aime pas / allergies, ce qu'elle a deja. Visible de
// toute la famille (et des invites de ses listes partagees) ; modifiee par la personne,
// le gestionnaire d'un profil sans compte, ou l'administrateur.
const { db } = require('./db');
const { httpError, str } = require('./util');
const A = require('./access');

const FIELDS = ['top', 'bottom', 'shoes', 'ring', 'colors', 'likes', 'dislikes', 'has'];
const LONG = new Set(['colors', 'likes', 'dislikes', 'has']); // textes libres ; les autres sont des tailles

function get(memberId) {
  const row = db.prepare('SELECT data, updated_at FROM member_fiches WHERE member_id = ?').get(memberId);
  if (!row) return null;
  let data = {};
  try { data = JSON.parse(row.data); } catch { /* fiche illisible : vide */ }
  return { ...Object.fromEntries(FIELDS.map((k) => [k, data[k] || ''])), updatedAt: row.updated_at };
}

const canEdit = (user, memberId) => user.id === memberId || user.isAdmin || A.managedProfileIds(user.id).includes(memberId);

function view(user, memberId) {
  const m = db.prepare('SELECT id, name, color, email, guest_list_id FROM members WHERE id = ?').get(memberId);
  if (!m || m.guest_list_id) throw httpError(404, 'Membre introuvable.');
  return { member: { id: m.id, name: m.name, color: m.color, me: m.id === user.id }, fiche: get(m.id), canEdit: canEdit(user, m.id) };
}

function set(user, memberId, b) {
  const m = db.prepare('SELECT id, guest_list_id FROM members WHERE id = ?').get(memberId);
  if (!m || m.guest_list_id) throw httpError(404, 'Membre introuvable.');
  if (!canEdit(user, memberId)) throw httpError(403, 'Tu ne peux pas modifier la fiche de cette personne.');
  const data = Object.fromEntries(FIELDS.map((k) => [k, str(b[k], LONG.has(k) ? 500 : 60)]));
  if (FIELDS.every((k) => !data[k])) db.prepare('DELETE FROM member_fiches WHERE member_id = ?').run(memberId);
  else db.prepare('INSERT INTO member_fiches (member_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(member_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(memberId, JSON.stringify(data), Date.now());
}

module.exports = { get, view, set, FIELDS };
