// Corbeille : suppression d'un article / d'une liste, restauration, vidage, droits.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, family } = require('./helpers');
const { db } = require('../lib/db');
const trash = require('../lib/trash');

let server, f;
before(async () => { server = await start(); f = await family(); });
after(() => server.close());

test('article supprimé : restauré à l’identique avec sa réservation', async () => {
  const l = (await f.thomas.post('/api/lists', { title: 'Corbeille' })).data;
  const it = (await f.thomas.post(`/api/lists/${l.id}/items`, { title: 'Robot', price: '16.60' })).data;
  const before = db.prepare('SELECT * FROM items WHERE id = ?').get(it.id);
  db.prepare("INSERT INTO reservations (item_id, giver_id, quantity, status, created_at) VALUES (?, ?, 1, 'reserved', 5)").run(it.id, f.ids.marc);
  assert.equal((await f.thomas.del(`/api/items/${it.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM items WHERE id = ?').get(it.id).c, 0);
  const t = (await f.thomas.get('/api/admin/trash')).data;
  assert.equal(t.length, 1);
  assert.equal(t[0].label, 'Robot');
  assert.equal((await f.marc.get('/api/admin/trash')).status, 403);
  assert.equal((await f.thomas.post(`/api/admin/trash/${t[0].id}/restore`)).status, 200);
  assert.deepEqual(db.prepare('SELECT * FROM items WHERE id = ?').get(it.id), before);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM reservations WHERE item_id = ?').get(it.id).c, 1);
  assert.equal((await f.thomas.get('/api/admin/trash')).data.length, 0);
});

test('liste supprimée : restaurée avec catégories, articles et réservations', async () => {
  const l = (await f.thomas.post('/api/lists', { title: 'À perdre' })).data;
  const a = (await f.thomas.post(`/api/lists/${l.id}/items`, { title: 'A' })).data;
  await f.thomas.post(`/api/lists/${l.id}/items`, { title: 'B' });
  db.prepare("INSERT INTO reservations (item_id, giver_id, quantity, status, created_at) VALUES (?, ?, 1, 'bought', 5)").run(a.id, f.ids.marc);
  assert.equal((await f.thomas.del(`/api/lists/${l.id}`)).status, 200);
  const t = (await f.thomas.get('/api/admin/trash')).data;
  assert.equal(t[0].kind, 'list');
  assert.equal((await f.thomas.post(`/api/admin/trash/${t[0].id}/restore`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM items WHERE list_id = ?').get(l.id).c, 2);
  assert.equal(db.prepare("SELECT status FROM reservations WHERE item_id = ?").get(a.id).status, 'bought');
});

test('purge après 7 jours et vidage manuel', async () => {
  const l = (await f.thomas.post('/api/lists', { title: 'Purge' })).data;
  const a = (await f.thomas.post(`/api/lists/${l.id}/items`, { title: 'Vieux' })).data;
  const b = (await f.thomas.post(`/api/lists/${l.id}/items`, { title: 'Récent' })).data;
  await f.thomas.del(`/api/items/${a.id}`);
  db.prepare('UPDATE trash SET deleted_at = ?').run(Date.now() - 8 * 24 * 3600 * 1000);
  await f.thomas.del(`/api/items/${b.id}`);
  assert.deepEqual((await f.thomas.get('/api/admin/trash')).data.map((x) => x.label), ['Récent']);
  assert.equal((await f.marc.del('/api/admin/trash')).status, 403);
  assert.equal((await f.thomas.del('/api/admin/trash')).status, 200);
  assert.equal(trash.list().length, 0);
});
