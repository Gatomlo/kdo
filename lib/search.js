// Recherche dans les listes actives (titre et precisions des articles), les titres de
// listes, les idees secretes (sauf celles pour soi) et les fiches. Sans accents ni
// majuscules. Ne renvoie aucune donnee de reservation : on ouvre ensuite la liste.
const { db } = require('./db');

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function search(user, q) {
  const words = norm(q).split(/\s+/).filter((w) => w.length >= 2);
  if (!words.length) return { items: [], lists: [], ideas: [], fiches: [] };
  const hit = (...texts) => { const t = norm(texts.join(' ')); return words.every((w) => t.includes(w)); };

  const lists = db.prepare(`SELECT l.id, l.title, l.cover, l.owner_id, m.name AS owner_name FROM lists l JOIN members m ON m.id = l.owner_id
    WHERE l.archived = 0`).all();
  const byId = new Map(lists.map((l) => [l.id, l]));
  const items = db.prepare('SELECT id, list_id, title, description, price FROM items').all()
    .filter((i) => byId.has(i.list_id) && hit(i.title, i.description))
    .slice(0, 40)
    .map((i) => { const l = byId.get(i.list_id); return { id: i.id, title: i.title, price: i.price, listId: l.id, listTitle: l.title, ownerName: l.owner_name }; });
  const ideas = db.prepare(`SELECT i.id, i.title, i.note, i.recipient_id, m.name FROM ideas i JOIN members m ON m.id = i.recipient_id WHERE i.recipient_id <> ?`).all(user.id)
    .filter((i) => hit(i.title, i.note)).slice(0, 20)
    .map((i) => ({ id: i.id, title: i.title, recipientId: i.recipient_id, recipientName: i.name }));
  const fiches = db.prepare(`SELECT f.member_id, f.data, m.name FROM member_fiches f JOIN members m ON m.id = f.member_id`).all()
    .filter((f) => hit(f.name, Object.values(JSON.parse(f.data)).join(' '))).slice(0, 10)
    .map((f) => ({ memberId: f.member_id, name: f.name }));
  return {
    items, ideas, fiches,
    lists: lists.filter((l) => hit(l.title, l.owner_name)).slice(0, 20).map((l) => ({ id: l.id, title: l.title, cover: l.cover, ownerName: l.owner_name })),
  };
}

module.exports = { search, norm };
