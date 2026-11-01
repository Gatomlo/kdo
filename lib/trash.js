// Corbeille : un article ou une liste supprime est conserve (instantane JSON, reservations
// comprises) 7 jours. L'administrateur peut le restaurer, ou vider la corbeille avant.
const { db, tx } = require('./db');
const { httpError } = require('./util');

const KEEP_MS = 7 * 24 * 3600 * 1000;
const rows = (sql, ...p) => db.prepare(sql).all(...p);

function insert(table, row) {
  const cols = Object.keys(row);
  db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(row));
}

function purge() {
  db.prepare('DELETE FROM trash WHERE deleted_at < ?').run(Date.now() - KEEP_MS);
}

function itemData(itemId) {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  if (!item) return null;
  return { item, reservations: rows('SELECT * FROM reservations WHERE item_id = ?', itemId) };
}

// A appeler AVANT le DELETE (les reservations partent avec l'article).
function keepItem(itemId, user) {
  const data = itemData(itemId);
  if (!data) return;
  const list = db.prepare('SELECT title FROM lists WHERE id = ?').get(data.item.list_id);
  db.prepare('INSERT INTO trash (kind, label, context, data, deleted_by, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('item', data.item.title, list ? list.title : null, JSON.stringify(data), user.id, Date.now());
  purge();
}

function keepList(listId, user) {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(listId);
  if (!list) return;
  const data = {
    list,
    roles: rows('SELECT * FROM list_roles WHERE list_id = ?', listId),
    categories: rows('SELECT * FROM categories WHERE list_id = ?', listId),
    items: rows('SELECT * FROM items WHERE list_id = ?', listId),
    reservations: rows('SELECT r.* FROM reservations r JOIN items i ON i.id = r.item_id WHERE i.list_id = ?', listId),
  };
  const owner = db.prepare('SELECT name FROM members WHERE id = ?').get(list.owner_id);
  db.prepare('INSERT INTO trash (kind, label, context, data, deleted_by, deleted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('list', list.title, `${owner ? owner.name + ' · ' : ''}${data.items.length} article${data.items.length > 1 ? 's' : ''}`, JSON.stringify(data), user.id, Date.now());
  purge();
}

function list() {
  purge();
  return rows(`SELECT t.id, t.kind, t.label, t.context, t.deleted_at AS deletedAt, m.name AS deletedBy FROM trash t
    LEFT JOIN members m ON m.id = t.deleted_by ORDER BY t.deleted_at DESC`)
    .map((t) => ({ ...t, expiresAt: t.deletedAt + KEEP_MS }));
}

const exists = (table, id) => id != null && !!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);

function restoreReservations(reservations) {
  for (const r of reservations) if (exists('members', r.giver_id)) insert('reservations', r);
}

function restore(id) {
  const t = db.prepare('SELECT * FROM trash WHERE id = ?').get(id);
  if (!t) throw httpError(404, 'Élément introuvable (déjà restauré ou expiré).');
  const d = JSON.parse(t.data);
  tx(() => {
    if (t.kind === 'item') {
      if (!exists('lists', d.item.list_id)) throw httpError(409, 'La liste de cet article n’existe plus : restaure d’abord la liste.');
      const item = { ...d.item };
      if (!exists('categories', item.category_id)) item.category_id = null;
      insert('items', item);
      restoreReservations(d.reservations);
    } else {
      if (exists('lists', d.list.id)) throw httpError(409, 'Une liste portant cet identifiant existe déjà.');
      if (!exists('members', d.list.owner_id)) throw httpError(409, 'Le destinataire de la liste n’existe plus.');
      const list = { ...d.list };
      if (!exists('events', list.event_id)) list.event_id = null;
      insert('lists', list);
      for (const r of d.roles) if (exists('members', r.member_id)) insert('list_roles', r);
      for (const c of d.categories) insert('categories', c);
      for (const i of d.items) insert('items', i);
      restoreReservations(d.reservations);
    }
    db.prepare('DELETE FROM trash WHERE id = ?').run(id);
  });
  return { kind: t.kind, label: t.label };
}

function empty() {
  return db.prepare('DELETE FROM trash').run().changes;
}

// Photos encore referencees par la corbeille (a ne pas effacer du disque).
function images() {
  const out = new Set();
  for (const t of rows("SELECT data FROM trash WHERE data LIKE '%photos/%'")) {
    for (const m of t.data.matchAll(/photos\/[0-9a-f]{32}\.(?:jpg|png|webp)/g)) out.add(m[0].slice(7));
  }
  return out;
}

purge();
module.exports = { keepItem, keepList, list, restore, empty, images, purge };
