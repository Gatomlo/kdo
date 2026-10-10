// Cercle familial : membres, profils sans compte et leurs gestionnaires, invitations.
// Une instance = une famille. L'administrateur invite ; tout membre peut creer un profil
// sans compte (il en devient gestionnaire).
const { db, tx } = require('./db');
const { httpError, str } = require('./util');
const { sha256, newToken } = require('./auth');
const { managedProfileIds } = require('./access');

const INVITE_TTL = 14 * 24 * 3600 * 1000;
const PALETTE = ['#d9405a', '#5b4bb7', '#2a8a66', '#d8922a', '#2f7fb8', '#b84a9a', '#7a8a2a', '#c4612d'];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function members(viewer) {
  const rows = db.prepare('SELECT id, name, email, color, is_admin, birth_date, birthday_lead_days FROM members WHERE guest_list_id IS NULL ORDER BY name COLLATE NOCASE').all();
  const mgr = db.prepare('SELECT profile_id, manager_id FROM profile_managers').all();
  const mine = new Set(managedProfileIds(viewer.id));
  return rows.map((m) => ({
    id: m.id,
    name: m.name,
    color: m.color,
    hasAccount: !!m.email,
    isAdmin: !!m.is_admin,
    // Adresses visibles de l'administrateur seulement (et de soi-meme).
    email: viewer.isAdmin || m.id === viewer.id ? m.email : undefined,
    managers: mgr.filter((x) => x.profile_id === m.id).map((x) => x.manager_id),
    iManage: mine.has(m.id),
    me: m.id === viewer.id,
    birthDate: m.birth_date, birthdayLeadDays: m.birthday_lead_days,
    canEditBirthday: m.id === viewer.id || viewer.isAdmin || mine.has(m.id),
  }));
}

// Invites externes (liens de partage), pour l'administrateur.
// Sans ceux d'une liste surprise preparee pour lui.
function guests(viewer) {
  return db.prepare(`SELECT m.id, m.name, m.color, m.guest_email AS email, l.id AS list_id, l.title AS list_title FROM members m
    JOIN lists l ON l.id = m.guest_list_id WHERE NOT (l.surprise = 1 AND l.owner_id = ?) ORDER BY l.title, m.name COLLATE NOCASE`).all(viewer.id)
    .map((g) => ({ id: g.id, name: g.name, color: g.color, email: g.email, listId: g.list_id, listTitle: g.list_title }));
}

// Profil sans compte (et pas un invite externe).
function getProfile(id) {
  const m = getMember(id);
  if (m.email || m.guest_list_id) throw httpError(400, 'Ce membre n’est pas un profil sans compte.');
  return m;
}

const getMember = (id) => {
  const m = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!m) throw httpError(404, 'Membre introuvable.');
  return m;
};

function canManageProfile(user, profileId) {
  return user.isAdmin || managedProfileIds(user.id).includes(profileId);
}

// ---------- Comptes ----------
function createAccount({ name, email, passwordHash, isAdmin = false }) {
  const n = str(name, 60), e = str(email, 120).toLowerCase();
  if (!n) throw httpError(400, 'Ton prénom est requis.');
  if (!EMAIL.test(e)) throw httpError(400, 'Adresse e-mail invalide.');
  if (db.prepare('SELECT 1 FROM members WHERE email = ?').get(e)) throw httpError(409, 'Un compte existe déjà avec cette adresse : connecte-toi.');
  return Number(db.prepare('INSERT INTO members (name, email, password_hash, color, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(n, e, passwordHash, isAdmin ? PALETTE[0] : randomColor(), isAdmin ? 1 : 0, Date.now()).lastInsertRowid);
}

function setAdmin(user, id, isAdmin) {
  const m = getMember(id);
  if (!m.email) throw httpError(400, 'Seul un membre avec compte peut être administrateur.');
  if (!isAdmin && m.is_admin && db.prepare('SELECT COUNT(*) AS n FROM members WHERE is_admin = 1').get().n <= 1)
    throw httpError(409, 'Il faut au moins un administrateur dans le cercle.');
  db.prepare('UPDATE members SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, id);
}

function removeMember(user, id) {
  const m = getMember(id);
  if (id === user.id) throw httpError(400, 'Tu ne peux pas te retirer toi-même.');
  if (m.email ? !user.isAdmin : !canManageProfile(user, id)) throw httpError(403, 'Tu ne peux pas retirer ce membre.');
  if (m.is_admin && db.prepare('SELECT COUNT(*) AS n FROM members WHERE is_admin = 1').get().n <= 1)
    throw httpError(409, 'Il faut au moins un administrateur dans le cercle.');
  db.prepare('DELETE FROM members WHERE id = ?').run(id);
}

// ---------- Profils sans compte ----------
function createProfile(user, name) {
  const n = str(name, 60);
  if (!n) throw httpError(400, 'Indique un prénom.');
  return tx(() => {
    const id = Number(db.prepare('INSERT INTO members (name, color, created_at) VALUES (?, ?, ?)').run(n, randomColor(), Date.now()).lastInsertRowid);
    db.prepare('INSERT INTO profile_managers (profile_id, manager_id) VALUES (?, ?)').run(id, user.id);
    return id;
  });
}

function renameProfile(user, id, name) {
  getProfile(id);
  if (!canManageProfile(user, id)) throw httpError(403, 'Tu ne gères pas ce profil.');
  const n = str(name, 60);
  if (!n) throw httpError(400, 'Indique un prénom.');
  db.prepare('UPDATE members SET name = ? WHERE id = ?').run(n, id);
}

function addManager(user, profileId, managerId) {
  getProfile(profileId);
  if (!canManageProfile(user, profileId)) throw httpError(403, 'Tu ne gères pas ce profil.');
  if (!getMember(managerId).email) throw httpError(400, 'Le gestionnaire doit avoir un compte.');
  db.prepare('INSERT OR IGNORE INTO profile_managers (profile_id, manager_id) VALUES (?, ?)').run(profileId, managerId);
}

function removeManager(user, profileId, managerId) {
  if (!canManageProfile(user, profileId)) throw httpError(403, 'Tu ne gères pas ce profil.');
  const n = db.prepare('SELECT COUNT(*) AS n FROM profile_managers WHERE profile_id = ?').get(profileId).n;
  if (n <= 1) throw httpError(409, 'Un profil sans compte doit garder au moins un gestionnaire.');
  db.prepare('DELETE FROM profile_managers WHERE profile_id = ? AND manager_id = ?').run(profileId, managerId);
}

// ---------- Invitations ----------
// memberId : profil sans compte qui recoit son propre compte (il garde ses listes).
// multi : lien familial reutilisable pendant 48 h (sans e-mail ni droits d'admin).
const MULTI_TTL = 48 * 3600 * 1000;
function createInvitation(user, { email, isAdmin, memberId, multi }) {
  if (multi && (email || memberId)) throw httpError(400, 'Le lien familial ne vise personne en particulier.');
  const e = email ? str(email, 120).toLowerCase() : null;
  if (e && !EMAIL.test(e)) throw httpError(400, 'Adresse e-mail invalide.');
  if (e && db.prepare('SELECT 1 FROM members WHERE email = ?').get(e)) throw httpError(409, 'Cette adresse fait déjà partie du cercle.');
  if (memberId) {
    getProfile(memberId);
    if (!canManageProfile(user, memberId)) throw httpError(403, 'Tu ne gères pas ce profil.');
  } else if (!user.isAdmin) throw httpError(403, 'Seul l’administrateur invite de nouveaux membres.');
  const token = newToken();
  db.prepare('DELETE FROM invitations WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO invitations (token_hash, email, member_id, is_admin, invited_by, expires_at, multi) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(sha256(token), e, memberId || null, user.isAdmin && isAdmin && !multi ? 1 : 0, user.id, Date.now() + (multi ? MULTI_TTL : INVITE_TTL), multi ? 1 : 0);
  return token;
}

function findInvitation(token) {
  const inv = db.prepare(`SELECT i.*, u.name AS inviter, p.name AS profile_name FROM invitations i
    LEFT JOIN members u ON u.id = i.invited_by LEFT JOIN members p ON p.id = i.member_id
    WHERE i.token_hash = ?`).get(sha256(String(token || '')));
  if (!inv || (inv.used_at && !inv.multi) || inv.expires_at < Date.now()) throw httpError(404, 'Invitation expirée ou déjà utilisée.');
  return inv;
}

// Cree le compte de l'invitation (ou donne un compte au profil vise). Renvoie l'id.
function acceptInvitation(token, { name, email, passwordHash }) {
  const inv = findInvitation(token);
  return tx(() => {
    db.prepare('UPDATE invitations SET used_at = ? WHERE token_hash = ?').run(Date.now(), sha256(String(token))); // multi : reste valable
    if (!inv.member_id) return createAccount({ name, email, passwordHash, isAdmin: !!inv.is_admin });
    const e = str(email, 120).toLowerCase();
    if (!EMAIL.test(e)) throw httpError(400, 'Adresse e-mail invalide.');
    if (db.prepare('SELECT 1 FROM members WHERE email = ?').get(e)) throw httpError(409, 'Un compte existe déjà avec cette adresse.');
    const p = getMember(inv.member_id);
    if (p.email) throw httpError(409, 'Ce profil a déjà un compte.');
    db.prepare('UPDATE members SET email = ?, password_hash = ?, name = ? WHERE id = ?').run(e, passwordHash, str(name, 60) || p.name, p.id);
    // Devenu autonome : ses anciens gestionnaires redeviennent de simples offrants.
    db.prepare('DELETE FROM profile_managers WHERE profile_id = ?').run(p.id);
    return p.id;
  });
}

module.exports = {
  members, guests, getMember, createAccount, setAdmin, removeMember, createProfile, renameProfile, addManager, removeManager,
  createInvitation, findInvitation, acceptInvitation, PALETTE, EMAIL,
};
