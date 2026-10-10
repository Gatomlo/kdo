// Droits et regles anti-spoiler (cahier des charges §3 et §4.6).
// Role d'un membre sur une liste : owner (destinataire), co_owner, manager, viewer (offrant).
// Proprietaire et co-proprietaires ne recoivent JAMAIS les donnees de cadeaux
// (reservations, commentaires, cadeaux hors liste) : filtrage ici, cote serveur.
const { db, inList } = require('./db');
const { httpError } = require('./util');

// Profils sans compte geres par ce membre.
function managedProfileIds(memberId) {
  return db.prepare(`SELECT m.id FROM profile_managers pm JOIN members m ON m.id = pm.profile_id
    WHERE pm.manager_id = ? AND m.email IS NULL`).all(memberId).map((r) => r.id);
}

// Le membre lui-meme + les profils qu'il pilote (au nom de qui il peut agir).
const actorIds = (memberId) => [memberId, ...managedProfileIds(memberId)];

// Proprietaire et co-proprietaires sont testes en premier : ils ont toujours la vue
// « proprietaire », quel que soit le chemin d'acces (regle 3).
function roleOn(list, memberId) {
  if (list.owner_id === memberId) return 'owner';
  const r = db.prepare('SELECT role FROM list_roles WHERE list_id = ? AND member_id = ?').get(list.id, memberId);
  if (r && r.role === 'co_owner') return 'co_owner';
  if (r && r.role === 'manager') return 'manager';
  if (managedProfileIds(memberId).includes(list.owner_id)) return 'manager';
  return 'viewer';
}

function listAccess(listId, memberId) {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
  if (!list) throw httpError(404, 'Liste introuvable.');
  const role = roleOn(list, memberId);
  return {
    list,
    role,
    canEdit: role !== 'viewer',
    canSeeGifts: role === 'manager' || role === 'viewer',
    canManageGifts: role === 'manager',
  };
}

function requireEdit(listId, memberId) {
  const a = listAccess(listId, memberId);
  if (!a.canEdit) throw httpError(403, 'Seuls le destinataire, les co-propriétaires et les gestionnaires modifient cette liste.');
  return a;
}

function itemAccess(itemId, memberId) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) throw httpError(404, 'Article introuvable.');
  return { item, ...listAccess(item.list_id, memberId) };
}

// Actions d'offrant : refusees sur une liste qui nous concerne.
function requireGiver(itemId, memberId) {
  const a = itemAccess(itemId, memberId);
  if (!a.canSeeGifts) throw httpError(403, 'Cette liste te concerne : pas de spoiler !');
  return a;
}

// Listes dont ce membre est proprietaire ou co-proprietaire : leurs cadeaux lui sont caches.
function hiddenListIds(memberId) {
  const rows = db.prepare(`SELECT id FROM lists WHERE owner_id = ?
    UNION SELECT list_id FROM list_roles WHERE member_id = ? AND role = 'co_owner'`).all(memberId, memberId);
  return new Set(rows.map((r) => r.id));
}

// Destinataires e-mail pour un membre : lui-meme s'il a un compte, sinon ses gestionnaires.
function mailboxesFor(memberId) {
  const m = db.prepare('SELECT id, name, email FROM members WHERE id = ?').get(memberId);
  if (!m) return [];
  if (m.email) return [m];
  return db.prepare(`SELECT m.id, m.name, m.email FROM profile_managers pm JOIN members m ON m.id = pm.manager_id
    WHERE pm.profile_id = ? AND m.email IS NOT NULL`).all(memberId);
}

// Gestionnaires d'une liste : roles explicites + gestionnaires du profil proprietaire.
function listManagers(list) {
  const explicit = db.prepare(`SELECT m.id, m.name, m.email FROM list_roles r JOIN members m ON m.id = r.member_id
    WHERE r.list_id = ? AND r.role = 'manager' AND m.email IS NOT NULL`).all(list.id);
  const owner = db.prepare('SELECT email FROM members WHERE id = ?').get(list.owner_id);
  const viaProfile = owner && !owner.email ? mailboxesFor(list.owner_id) : [];
  return [...new Map([...explicit, ...viaProfile].map((m) => [m.id, m])).values()];
}

// Co-proprietaires d'une liste (ids).
const coOwnerIds = (listId) => db.prepare("SELECT member_id FROM list_roles WHERE list_id = ? AND role = 'co_owner'").all(listId).map((r) => r.member_id);

const memberNames = (ids) => new Map(db.prepare(`SELECT id, name, color FROM members WHERE id IN (${inList(ids)})`).all().map((m) => [m.id, m]));

module.exports = {
  managedProfileIds, actorIds, roleOn, listAccess, requireEdit, itemAccess, requireGiver,
  hiddenListIds, mailboxesFor, listManagers, coOwnerIds, memberNames,
};
