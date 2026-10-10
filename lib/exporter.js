// Export des donnees du cercle (§4.7) en JSON, filtre comme l'interface : les cadeaux
// des listes du demandeur (et de ses co-proprietes) et les attributions Secret Santa
// n'y figurent jamais. Sauvegarde complete : copie de la base (scripts/backup.js).
const { db } = require('./db');
const A = require('./access');

function exportFor(user) {
  const hidden = A.hiddenListIds(user.id);
  const surprises = A.surpriseListIds(user.id); // absentes de l'export, comme de l'interface
  const lists = db.prepare('SELECT * FROM lists ORDER BY id').all().filter((l) => !surprises.has(l.id));
  const items = db.prepare('SELECT * FROM items ORDER BY list_id, position').all().filter((i) => !surprises.has(i.list_id));
  const visible = new Set(lists.filter((l) => !hidden.has(l.id)).map((l) => l.id));
  const giftItems = new Set(items.filter((i) => visible.has(i.list_id)).map((i) => i.id));
  return {
    app: 'Kdo',
    exportedAt: new Date().toISOString(),
    exportedBy: user.name,
    members: db.prepare('SELECT id, name, email IS NOT NULL AS has_account FROM members ORDER BY name').all(),
    events: db.prepare('SELECT id, title, date, place, budget FROM events ORDER BY date').all(),
    eventParticipants: db.prepare('SELECT event_id, member_id FROM event_participants').all(),
    lists,
    listRoles: db.prepare('SELECT * FROM list_roles').all().filter((r) => !surprises.has(r.list_id)),
    categories: db.prepare('SELECT * FROM categories ORDER BY list_id, position').all().filter((c) => !surprises.has(c.list_id)),
    items,
    reservations: db.prepare('SELECT * FROM reservations').all().filter((r) => giftItems.has(r.item_id)),
    comments: db.prepare('SELECT * FROM comments').all().filter((c) => giftItems.has(c.item_id)),
    offListGifts: db.prepare('SELECT * FROM off_list_gifts').all().filter((o) => visible.has(o.list_id)),
  };
}

module.exports = { exportFor };
