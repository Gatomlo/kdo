// Listes, categories, articles, reservations, participations communes, discussions entre
// offrants et cadeaux hors liste. Toute lecture de donnees de cadeaux passe par
// listAccess / requireGiver (access.js) : rien n'est renvoye au destinataire.
const { db, tx, inList } = require('./db');
const { httpError, str, optStr, cents, isoDate, webUrl, intOrNull } = require('./util');
const A = require('./access');
const notify = require('./notify');
const photos = require('./photos');

const DEFAULT_CATEGORIES = ['Livres', 'Jeux', 'Vêtements', 'Maison', 'Expériences'];
const COVERS = ['🎁', '🎄', '🎂', '👶', '💍', '🎓', '🏡', '🌟', '🧸', '📚'];

// ---------- Etat d'un article ----------
// Unites « prises » : reservations classiques + 1 si un cadeau commun est entame.
function usage(item, rs) {
  const classic = rs.filter((r) => r.amount == null);
  const parts = rs.filter((r) => r.amount != null);
  const taken = classic.reduce((s, r) => s + r.quantity, 0) + (parts.length ? 1 : 0);
  const bought = classic.filter((r) => r.status === 'bought').reduce((s, r) => s + r.quantity, 0) + (parts.some((r) => r.status === 'bought') ? 1 : 0);
  const status = bought >= item.quantity ? 'bought' : taken >= item.quantity ? 'reserved' : 'free';
  return { taken, bought, available: Math.max(0, item.quantity - taken), funded: parts.reduce((s, r) => s + r.amount, 0), status };
}

const reservationsOf = (itemId) => db.prepare('SELECT * FROM reservations WHERE item_id = ?').all(itemId);

const itemOut = (i) => ({
  id: i.id, categoryId: i.category_id, title: i.title, url: i.url, url2: i.url2, price: i.price, image: i.image,
  description: i.description, priority: i.priority, quantity: i.quantity, groupGift: !!i.group_gift, position: i.position,
});

// ---------- Resume des listes (tableau de bord, evenement) ----------
// gifts = null pour ses propres listes (regle anti-spoiler 4).
function summaries(user, { archived = false, eventId } = {}) {
  const ls = eventId != null
    ? db.prepare(`SELECT l.*, m.name AS owner_name, m.color AS owner_color FROM lists l JOIN members m ON m.id = l.owner_id
        WHERE l.event_id = ? ORDER BY m.name COLLATE NOCASE, l.title`).all(eventId)
    : db.prepare(`SELECT l.*, m.name AS owner_name, m.color AS owner_color FROM lists l JOIN members m ON m.id = l.owner_id
        WHERE l.archived = ? ORDER BY m.name COLLATE NOCASE, l.title`).all(archived ? 1 : 0);
  const hidden = A.hiddenListIds(user.id);
  const its = db.prepare(`SELECT * FROM items WHERE list_id IN (${inList(ls.map((l) => l.id))})`).all();
  const rs = db.prepare(`SELECT * FROM reservations WHERE item_id IN (${inList(its.map((i) => i.id))})`).all();
  return ls.map((l) => {
    const li = its.filter((i) => i.list_id === l.id);
    let gifts = null;
    if (!hidden.has(l.id)) {
      gifts = {
        total: li.reduce((s, i) => s + i.quantity, 0),
        taken: li.reduce((s, i) => s + Math.min(i.quantity, usage(i, rs.filter((r) => r.item_id === i.id)).taken), 0),
      };
    }
    return {
      id: l.id, title: l.title, cover: l.cover, date: l.date, occasion: l.occasion, eventId: l.event_id, archived: !!l.archived,
      owner: { id: l.owner_id, name: l.owner_name, color: l.owner_color },
      itemCount: li.length, role: A.roleOn(l, user.id), gifts,
    };
  });
}

// ---------- Vue d'une liste ----------
function view(listId, user) {
  const a = A.listAccess(listId, user.id);
  const { list } = a;
  const owner = db.prepare('SELECT id, name, color, email FROM members WHERE id = ?').get(list.owner_id);
  const roles = db.prepare(`SELECT r.member_id AS id, r.role, m.name FROM list_roles r JOIN members m ON m.id = r.member_id
    WHERE r.list_id = ? ORDER BY m.name`).all(list.id);
  const event = list.event_id ? db.prepare('SELECT id, title, date FROM events WHERE id = ?').get(list.event_id) : null;
  const categories = db.prepare('SELECT id, name, position FROM categories WHERE list_id = ? ORDER BY position, id').all(list.id);
  const its = db.prepare('SELECT * FROM items WHERE list_id = ? ORDER BY position, id').all(list.id);

  const out = {
    list: { id: list.id, title: list.title, occasion: list.occasion, date: list.date, cover: list.cover, welcome: list.welcome, eventId: list.event_id, archived: !!list.archived },
    owner: { id: owner.id, name: owner.name, color: owner.color, hasAccount: !!owner.email },
    event,
    role: a.role, canEdit: a.canEdit, canSeeGifts: a.canSeeGifts, canManageGifts: a.canManageGifts,
    roles,
    categories,
    items: its.map(itemOut),
    offList: null,
    actors: [],
  };
  // Vue destinataire : aucune donnee de cadeau ne quitte le serveur.
  if (!a.canSeeGifts) return out;

  const mine = new Set(A.actorIds(user.id));
  const ids = its.map((i) => i.id);
  const rs = db.prepare(`SELECT * FROM reservations WHERE item_id IN (${inList(ids)}) ORDER BY created_at`).all();
  const cs = db.prepare(`SELECT * FROM comments WHERE item_id IN (${inList(ids)}) ORDER BY created_at`).all();
  const off = db.prepare('SELECT * FROM off_list_gifts WHERE list_id = ? ORDER BY created_at').all(list.id);
  const names = A.memberNames([...rs.map((r) => r.giver_id), ...cs.map((c) => c.author_id), ...off.map((o) => o.giver_id), ...mine]);
  const nm = (id) => (names.get(id) || {}).name || '?';

  out.items = its.map((i) => {
    const r = rs.filter((x) => x.item_id === i.id);
    return {
      ...itemOut(i),
      gifts: {
        ...usage(i, r),
        reservations: r.map((x) => ({ id: x.id, giverId: x.giver_id, giverName: nm(x.giver_id), quantity: x.quantity, status: x.status, amount: x.amount, isCarrier: !!x.is_carrier, mine: mine.has(x.giver_id) })),
        comments: cs.filter((c) => c.item_id === i.id).map((c) => ({ id: c.id, author: nm(c.author_id), body: c.body, at: c.created_at })),
      },
    };
  });
  out.offList = off.map((o) => ({ id: o.id, giverName: nm(o.giver_id), description: o.description, mine: mine.has(o.giver_id) }));
  out.actors = [...mine].map((id) => ({ id, name: nm(id) }));
  if (a.canManageGifts) out.members = db.prepare('SELECT id, name FROM members WHERE guest_list_id IS NULL ORDER BY name COLLATE NOCASE').all().filter((m) => m.id !== list.owner_id);
  out.guest = !!user.guestListId;
  return out;
}

// ---------- Listes ----------
function listFields(b, current = {}) {
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);
  const title = has('title') ? str(b.title, 120) : current.title;
  if (!title) throw httpError(400, 'Donne un titre à la liste.');
  const eventId = has('eventId') ? intOrNull(b.eventId) : current.event_id ?? null;
  if (eventId && !db.prepare('SELECT 1 FROM events WHERE id = ?').get(eventId)) throw httpError(400, 'Événement introuvable.');
  return {
    title,
    occasion: has('occasion') ? optStr(b.occasion, 80) : current.occasion ?? null,
    date: has('date') ? isoDate(b.date) : current.date ?? null,
    cover: has('cover') ? (COVERS.includes(b.cover) ? b.cover : '🎁') : current.cover ?? '🎁',
    welcome: has('welcome') ? optStr(b.welcome, 2000) : current.welcome ?? null,
    eventId,
  };
}

function createList(user, b) {
  const ownerId = intOrNull(b.ownerId) || user.id;
  if (!A.actorIds(user.id).includes(ownerId)) throw httpError(403, 'Tu ne peux créer une liste que pour toi ou un profil que tu gères.');
  const f = listFields(b);
  return tx(() => {
    const id = Number(db.prepare('INSERT INTO lists (owner_id, title, occasion, date, cover, welcome, event_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ownerId, f.title, f.occasion, f.date, f.cover, f.welcome, f.eventId, Date.now()).lastInsertRowid);
    if (b.defaultCategories) DEFAULT_CATEGORIES.forEach((n, i) => db.prepare('INSERT INTO categories (list_id, name, position) VALUES (?, ?, ?)').run(id, n, i));
    return id;
  });
}

function updateList(user, listId, b) {
  const { list } = A.requireEdit(listId, user.id);
  const f = listFields(b, list);
  const archived = b.archived == null ? list.archived : b.archived ? 1 : 0;
  db.prepare('UPDATE lists SET title = ?, occasion = ?, date = ?, cover = ?, welcome = ?, event_id = ?, archived = ? WHERE id = ?')
    .run(f.title, f.occasion, f.date, f.cover, f.welcome, f.eventId, archived, list.id);
}

function deleteList(user, listId) {
  const a = A.requireEdit(listId, user.id);
  if (a.role === 'co_owner') throw httpError(403, 'Seul le destinataire ou un gestionnaire peut supprimer la liste.');
  db.prepare('DELETE FROM lists WHERE id = ?').run(listId);
}

// Roles. Personne ne change son propre role (un co-proprietaire qui se ferait
// gestionnaire verrait ses cadeaux) ; seul le proprietaire ou un gestionnaire retire un co-proprietaire.
function addRole(user, listId, memberId, role) {
  const { list } = A.requireEdit(listId, user.id);
  if (!['co_owner', 'manager'].includes(role)) throw httpError(400, 'Rôle inconnu.');
  if (memberId === user.id) throw httpError(400, 'Tu ne peux pas changer ton propre rôle.');
  if (memberId === list.owner_id) throw httpError(400, 'Le destinataire a déjà tous les droits sur sa liste.');
  const m = db.prepare('SELECT id, name, email FROM members WHERE id = ? AND guest_list_id IS NULL').get(memberId);
  if (!m) throw httpError(404, 'Membre introuvable.');
  if (role === 'manager' && !m.email) throw httpError(400, 'Un gestionnaire doit avoir un compte.');
  if (db.prepare('SELECT 1 FROM list_roles WHERE list_id = ? AND member_id = ?').get(list.id, memberId))
    throw httpError(409, `${m.name} a déjà un rôle sur cette liste : retire-le d’abord.`);
  db.prepare('INSERT INTO list_roles (list_id, member_id, role) VALUES (?, ?, ?)').run(list.id, memberId, role);
  return { list, member: m };
}

function removeRole(user, listId, memberId) {
  const { list, role } = A.requireEdit(listId, user.id);
  if (memberId === user.id) throw httpError(400, 'Tu ne peux pas changer ton propre rôle.');
  const r = db.prepare('SELECT role FROM list_roles WHERE list_id = ? AND member_id = ?').get(list.id, memberId);
  if (r && r.role === 'co_owner' && role === 'co_owner') throw httpError(403, 'Seul le destinataire peut retirer un co-propriétaire.');
  db.prepare('DELETE FROM list_roles WHERE list_id = ? AND member_id = ?').run(list.id, memberId);
}

// ---------- Categories ----------
const nextPosition = (table, listId) => db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM ${table} WHERE list_id = ?`).get(listId).p;

function addCategory(user, listId, name) {
  const { list } = A.requireEdit(listId, user.id);
  const n = str(name, 60);
  if (!n) throw httpError(400, 'Nom de catégorie requis.');
  return Number(db.prepare('INSERT INTO categories (list_id, name, position) VALUES (?, ?, ?)').run(list.id, n, nextPosition('categories', list.id)).lastInsertRowid);
}

function categoryOf(user, catId) {
  const c = db.prepare('SELECT * FROM categories WHERE id = ?').get(catId);
  if (!c) throw httpError(404, 'Catégorie introuvable.');
  A.requireEdit(c.list_id, user.id);
  return c;
}
function renameCategory(user, catId, name) {
  const c = categoryOf(user, catId);
  const n = str(name, 60);
  if (!n) throw httpError(400, 'Nom de catégorie requis.');
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(n, c.id);
}
function deleteCategory(user, catId) {
  db.prepare('DELETE FROM categories WHERE id = ?').run(categoryOf(user, catId).id);
}

// Nouvel ordre (glisser-deposer ou fleches) : ids de la liste, les autres sont ignores.
function reorder(user, listId, table, ids) {
  const { list } = A.requireEdit(listId, user.id);
  if (!Array.isArray(ids)) throw httpError(400, 'Ordre invalide.');
  tx(() => ids.forEach((id, i) => db.prepare(`UPDATE ${table} SET position = ? WHERE id = ? AND list_id = ?`).run(i, Number(id), list.id)));
}

// ---------- Articles ----------
function itemFields(listId, b) {
  const title = str(b.title, 200);
  if (!title) throw httpError(400, 'Le nom de l’article est obligatoire.');
  let categoryId = intOrNull(b.categoryId);
  if (categoryId && !db.prepare('SELECT 1 FROM categories WHERE id = ? AND list_id = ?').get(categoryId, listId)) categoryId = null;
  const groupGift = !!b.groupGift;
  const q = parseInt(b.quantity, 10);
  const p = parseInt(b.priority, 10);
  return {
    title, categoryId, groupGift: groupGift ? 1 : 0,
    url: webUrl(b.url), url2: webUrl(b.url2), image: photos.isLocal(b.image) ? b.image : webUrl(b.image),
    price: cents(b.price), description: optStr(b.description, 2000),
    priority: Number.isFinite(p) ? Math.min(3, Math.max(1, p)) : 2,
    quantity: groupGift ? 1 : Number.isFinite(q) ? Math.min(99, Math.max(1, q)) : 1,
  };
}

function createItem(user, listId, b) {
  const { list } = A.requireEdit(listId, user.id);
  const f = itemFields(list.id, b);
  return Number(db.prepare(`INSERT INTO items (list_id, category_id, title, url, url2, price, image, description, priority, quantity, group_gift, position, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(list.id, f.categoryId, f.title, f.url, f.url2, f.price, f.image, f.description, f.priority, f.quantity, f.groupGift, nextPosition('items', list.id), Date.now()).lastInsertRowid);
}

async function updateItem(user, itemId, b, base) {
  const { item, canEdit } = A.itemAccess(itemId, user.id);
  if (!canEdit) throw httpError(403, 'Tu ne peux pas modifier cet article.');
  const f = itemFields(item.list_id, b);
  db.prepare('UPDATE items SET category_id = ?, title = ?, url = ?, url2 = ?, price = ?, image = ?, description = ?, priority = ?, quantity = ?, group_gift = ? WHERE id = ?')
    .run(f.categoryId, f.title, f.url, f.url2, f.price, f.image, f.description, f.priority, f.quantity, f.groupGift, item.id);
  await notify.itemChanged(item.id, 'modifié', user, null, base);
}

async function deleteItem(user, itemId, base) {
  const { item, canEdit } = A.itemAccess(itemId, user.id);
  if (!canEdit) throw httpError(403, 'Tu ne peux pas supprimer cet article.');
  const snapshot = notify.itemSnapshot(item.id); // avant suppression (les reservations partent avec)
  db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
  await notify.itemChanged(item.id, 'supprimé', user, snapshot, base);
}

// ---------- Reservations ----------
function giverFrom(user, asId) {
  const id = intOrNull(asId) || user.id;
  if (!A.actorIds(user.id).includes(id)) throw httpError(403, 'Tu ne peux pas offrir au nom de ce profil.');
  return id;
}

function reserve(user, itemId, b) {
  const { item, list } = A.requireGiver(itemId, user.id);
  if (item.group_gift) throw httpError(400, 'Ce cadeau est commun : choisis un montant de participation.');
  const giverId = giverFrom(user, b.asId);
  if (giverId === list.owner_id) throw httpError(400, 'On ne s’offre pas son propre cadeau.');
  const qty = Math.max(1, parseInt(b.quantity, 10) || 1);
  return tx(() => {
    const { available } = usage(item, reservationsOf(item.id));
    if (qty > available) throw httpError(409, available ? `Il ne reste que ${available} exemplaire(s).` : 'Déjà réservé par quelqu’un d’autre.');
    const mine = db.prepare("SELECT id, quantity FROM reservations WHERE item_id = ? AND giver_id = ? AND amount IS NULL AND status = 'reserved'").get(item.id, giverId);
    if (mine) db.prepare('UPDATE reservations SET quantity = ? WHERE id = ?').run(mine.quantity + qty, mine.id);
    else db.prepare('INSERT INTO reservations (item_id, giver_id, quantity, created_at) VALUES (?, ?, ?, ?)').run(item.id, giverId, qty, Date.now());
  });
}

// Participation a un cadeau commun : une par participant (montant modifiable). Le premier
// participant est le porteur (celui qui achete), changeable ensuite.
function participate(user, itemId, b) {
  const { item, list } = A.requireGiver(itemId, user.id);
  if (!item.group_gift) throw httpError(400, 'Ce cadeau n’est pas un cadeau commun.');
  const giverId = giverFrom(user, b.asId);
  if (giverId === list.owner_id) throw httpError(400, 'On ne s’offre pas son propre cadeau.');
  const amount = cents(b.amount);
  if (!amount) throw httpError(400, 'Indique un montant.');
  tx(() => {
    const rs = reservationsOf(item.id);
    if (rs.some((r) => r.status === 'bought')) throw httpError(409, 'Ce cadeau est déjà acheté.');
    const mine = rs.find((r) => r.giver_id === giverId && r.amount != null);
    if (mine) db.prepare('UPDATE reservations SET amount = ? WHERE id = ?').run(amount, mine.id);
    else db.prepare('INSERT INTO reservations (item_id, giver_id, amount, is_carrier, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(item.id, giverId, amount, rs.some((r) => r.is_carrier) ? 0 : 1, Date.now());
  });
}

// Reservation + droits : la sienne (ou celle d'un profil gere), ou gestionnaire de la liste.
function reservationFor(user, id) {
  const res = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!res) throw httpError(404, 'Réservation introuvable.');
  const a = A.requireGiver(res.item_id, user.id);
  const own = A.actorIds(user.id).includes(res.giver_id);
  if (!own && !a.canManageGifts) throw httpError(403, 'Ce n’est pas ta réservation.');
  return { res, ...a, own };
}

function updateReservation(user, id, b) {
  const { res, canManageGifts, list } = reservationFor(user, id);
  tx(() => {
    if (b.status != null) {
      const status = b.status === 'bought' ? 'bought' : 'reserved';
      if (res.amount != null) {
        if (!res.is_carrier && !canManageGifts) throw httpError(403, 'C’est le porteur qui marque le cadeau commun comme acheté.');
        db.prepare('UPDATE reservations SET status = ? WHERE item_id = ? AND amount IS NOT NULL').run(status, res.item_id);
      } else db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, res.id);
    }
    if (b.carrier) {
      if (res.amount == null) throw httpError(400, 'Seul un participant peut porter l’achat.');
      db.prepare('UPDATE reservations SET is_carrier = 0 WHERE item_id = ? AND amount IS NOT NULL').run(res.item_id);
      db.prepare('UPDATE reservations SET is_carrier = 1 WHERE id = ?').run(res.id);
    }
    if (b.giverId != null) {
      if (!canManageGifts) throw httpError(403, 'Réservé au gestionnaire de la liste.');
      const giverId = intOrNull(b.giverId);
      if (!giverId || !db.prepare('SELECT 1 FROM members WHERE id = ? AND guest_list_id IS NULL').get(giverId)) throw httpError(400, 'Membre introuvable.');
      if (giverId === list.owner_id) throw httpError(400, 'Le destinataire ne peut pas s’offrir son propre cadeau.');
      db.prepare('UPDATE reservations SET giver_id = ? WHERE id = ?').run(giverId, res.id);
    }
  });
}

function cancelReservation(user, id) {
  const { res } = reservationFor(user, id);
  tx(() => {
    db.prepare('DELETE FROM reservations WHERE id = ?').run(res.id);
    if (res.is_carrier) {
      const next = db.prepare('SELECT id FROM reservations WHERE item_id = ? AND amount IS NOT NULL ORDER BY created_at LIMIT 1').get(res.item_id);
      if (next) db.prepare('UPDATE reservations SET is_carrier = 1 WHERE id = ?').run(next.id);
    }
  });
}

// ---------- Discussion entre offrants, cadeaux hors liste ----------
function addComment(user, itemId, body) {
  const { item } = A.requireGiver(itemId, user.id);
  const text = str(body, 1000);
  if (!text) throw httpError(400, 'Message vide.');
  db.prepare('INSERT INTO comments (item_id, author_id, body, created_at) VALUES (?, ?, ?, ?)').run(item.id, user.id, text, Date.now());
}

function addOffList(user, listId, b) {
  const a = A.listAccess(listId, user.id);
  if (!a.canSeeGifts) throw httpError(403, 'Cette liste te concerne : pas de spoiler !');
  const description = str(b.description, 300);
  if (!description) throw httpError(400, 'Décris le cadeau.');
  db.prepare('INSERT INTO off_list_gifts (list_id, giver_id, description, created_at) VALUES (?, ?, ?, ?)').run(a.list.id, giverFrom(user, b.asId), description, Date.now());
}

function deleteOffList(user, id) {
  const o = db.prepare('SELECT * FROM off_list_gifts WHERE id = ?').get(id);
  if (!o) throw httpError(404, 'Introuvable.');
  const a = A.listAccess(o.list_id, user.id);
  if (!a.canSeeGifts || (!A.actorIds(user.id).includes(o.giver_id) && !a.canManageGifts)) throw httpError(403, 'Ce n’est pas ton cadeau.');
  db.prepare('DELETE FROM off_list_gifts WHERE id = ?').run(id);
}

// Mes reservations (tableau de bord) : en mon nom ou au nom des profils que je gere.
function myReservations(user) {
  const ids = A.actorIds(user.id);
  return db.prepare(`SELECT r.id, r.quantity, r.status, r.amount, r.is_carrier, r.giver_id, i.title, i.list_id, l.title AS list_title, m.name AS owner_name
    FROM reservations r JOIN items i ON i.id = r.item_id JOIN lists l ON l.id = i.list_id JOIN members m ON m.id = l.owner_id
    WHERE r.giver_id IN (${inList(ids)}) AND l.archived = 0 ORDER BY r.status, m.name, i.title`).all()
    .map((r) => ({ id: r.id, title: r.title, listId: r.list_id, listTitle: r.list_title, ownerName: r.owner_name, quantity: r.quantity, status: r.status, amount: r.amount, isCarrier: !!r.is_carrier, forProfile: r.giver_id !== user.id }));
}

module.exports = {
  usage, summaries, view, createList, updateList, deleteList, addRole, removeRole,
  addCategory, renameCategory, deleteCategory, reorder, createItem, updateItem, deleteItem,
  reserve, participate, updateReservation, cancelReservation, addComment, addOffList, deleteOffList, myReservations,
  DEFAULT_CATEGORIES, COVERS,
};
