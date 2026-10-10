// Idees de cadeaux pour quelqu'un, notees par les autres et invisibles de cette personne :
// utile pour ceux qui ne font pas de liste, ou pour ne pas oublier une idee entendue a table.
// « Je m'en occupe » (taken_by) evite que deux personnes achetent la meme idee.
// Le destinataire ne peut ni les lire ni les compter (meme regle que les reservations).
const { db } = require('./db');
const { httpError, str, optStr, cents, webUrl } = require('./util');
const A = require('./access');
const photos = require('./photos');

function recipient(user, id) {
  const m = db.prepare('SELECT id, name, color, guest_list_id FROM members WHERE id = ?').get(id);
  if (!m || m.guest_list_id) throw httpError(404, 'Membre introuvable.');
  if (m.id === user.id) throw httpError(403, 'Ce sont des idées pour toi : surprise !');
  return m;
}

const out = (i, user, names) => ({
  id: i.id, title: i.title, url: i.url, price: i.price, note: i.note, shop: i.shop, image: i.image,
  author: (names.get(i.author_id) || {}).name || '?', mine: i.author_id === user.id,
  takenBy: i.taken_by ? (names.get(i.taken_by) || {}).name || '?' : null, takenByMe: i.taken_by === user.id,
  canEdit: i.author_id === user.id || user.isAdmin,
});

function forRecipient(user, recipientId) {
  const r = recipient(user, recipientId);
  const ideas = db.prepare('SELECT * FROM ideas WHERE recipient_id = ? ORDER BY taken_by IS NOT NULL, created_at DESC').all(r.id);
  const names = A.memberNames(ideas.flatMap((i) => [i.author_id, i.taken_by]).filter(Boolean));
  return { recipient: { id: r.id, name: r.name, color: r.color }, ideas: ideas.map((i) => out(i, user, names)) };
}

// Nombre d'idees par personne (jamais pour soi).
function counts(user) {
  return Object.fromEntries(db.prepare('SELECT recipient_id AS id, COUNT(*) AS n FROM ideas WHERE recipient_id <> ? GROUP BY recipient_id').all(user.id).map((r) => [r.id, r.n]));
}

function fields(b) {
  const title = str(b.title, 200);
  if (!title) throw httpError(400, 'Décris l’idée.');
  return { title, url: webUrl(b.url), price: cents(b.price), note: optStr(b.note, 1000), shop: optStr(b.shop, 120), image: photos.isLocal(b.image) ? b.image : webUrl(b.image) };
}

function add(user, recipientId, b) {
  const r = recipient(user, recipientId);
  const f = fields(b);
  return Number(db.prepare('INSERT INTO ideas (recipient_id, author_id, title, url, price, note, shop, image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, user.id, f.title, f.url, f.price, f.note, f.shop, f.image, Date.now()).lastInsertRowid);
}

function getIdea(user, id) {
  const i = db.prepare('SELECT * FROM ideas WHERE id = ?').get(id);
  if (!i) throw httpError(404, 'Idée introuvable.');
  recipient(user, i.recipient_id); // le destinataire n'y a jamais acces
  return i;
}

function update(user, id, b) {
  const i = getIdea(user, id);
  if (i.author_id !== user.id && !user.isAdmin) throw httpError(403, 'Seul l’auteur modifie son idée.');
  const f = fields(b);
  db.prepare('UPDATE ideas SET title = ?, url = ?, price = ?, note = ?, shop = ?, image = ? WHERE id = ?').run(f.title, f.url, f.price, f.note, f.shop, f.image, i.id);
}

function remove(user, id) {
  const i = getIdea(user, id);
  if (i.author_id !== user.id && !user.isAdmin) throw httpError(403, 'Seul l’auteur supprime son idée.');
  db.prepare('DELETE FROM ideas WHERE id = ?').run(i.id);
}

function take(user, id, yes) {
  const i = getIdea(user, id);
  if (yes) {
    if (i.taken_by && i.taken_by !== user.id) throw httpError(409, 'Quelqu’un s’en occupe déjà.');
    db.prepare('UPDATE ideas SET taken_by = ? WHERE id = ?').run(user.id, i.id);
  } else {
    if (i.taken_by && i.taken_by !== user.id && !user.isAdmin) throw httpError(403, 'C’est quelqu’un d’autre qui s’en occupe.');
    db.prepare('UPDATE ideas SET taken_by = NULL WHERE id = ?').run(i.id);
  }
}

module.exports = { forRecipient, counts, add, update, remove, take };
