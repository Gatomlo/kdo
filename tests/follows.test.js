// Abonnement aux listes : notification groupee quand des articles sont ajoutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, family } = require('./helpers');
const push = require('../lib/push');
const { db } = require('../lib/db');

test('abonnement a une liste', async () => {
  const server = await start();
  const f = await family();
  const sub = (id) => ({ endpoint: `https://push.exemple.be/${id}`, keys: { p256dh: 'BPk', auth: 'xyz' } });
  await f.thomas.post('/api/push/subscribe', { subscription: sub('t') });
  const lid = (await f.lea.post('/api/lists', { title: 'Noël Léa' })).data.id;

  // Le destinataire ne peut pas s'abonner à sa propre liste.
  assert.equal((await f.lea.put(`/api/lists/${lid}/follow`, { on: true })).status, 400);
  assert.equal((await f.thomas.put(`/api/lists/${lid}/follow`, { on: true })).data.following, true);
  assert.equal((await f.thomas.get(`/api/lists/${lid}`)).data.following, true);

  // 1er ajout : envoyé tout de suite ; 2e : en attente (fenêtre de 10 min).
  const before = push.outbox.length;
  await f.lea.post(`/api/lists/${lid}/items`, { title: 'Casque' });
  await f.lea.post(`/api/lists/${lid}/items`, { title: 'Livre' });
  const sent = push.outbox.slice(before).filter((m) => m.memberId === f.ids.thomas);
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Casque/);
  assert.equal(db.prepare('SELECT pending FROM list_follows WHERE list_id = ?').get(lid).pending, 1);

  // Fenêtre écoulée : le lot en attente part au fil d'une requête suivante.
  db.prepare('UPDATE list_follows SET last_sent = 0').run();
  await f.thomas.get('/api/me');
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(push.outbox.slice(before).filter((m) => m.memberId === f.ids.thomas).length, 2);

  // Cadeau pris : les abonnés sont prévenus, pas celui qui le prend ; jamais le destinataire.
  await f.thomas.put(`/api/lists/${lid}/follow`, { on: true });
  await f.marc.put(`/api/lists/${lid}/follow`, { on: true });
  await f.marc.post('/api/push/subscribe', { subscription: sub('m') });
  await f.lea.post('/api/push/subscribe', { subscription: sub('l') });
  const itemId = (await f.lea.post(`/api/lists/${lid}/items`, { title: 'Écharpe' })).data.id;
  const b2 = push.outbox.length;
  assert.equal((await f.marc.post(`/api/items/${itemId}/reserve`, {})).status, 201);
  const taken = push.outbox.slice(b2);
  assert.deepEqual(taken.map((m) => m.memberId), [f.ids.thomas]);
  assert.match(taken[0].title, /Marc a pris/);
  assert.equal(taken.some((m) => m.memberId === f.ids.lea), false);

  // Article supprimé : l'abonné (non offrant) est prévenu, l'offrant (Marc) une seule fois.
  const b3 = push.outbox.length;
  assert.equal((await f.lea.del(`/api/items/${itemId}`)).status, 200);
  const gone = push.outbox.slice(b3);
  assert.equal(gone.filter((m) => m.memberId === f.ids.thomas && /retiré/.test(m.title)).length, 1);
  assert.equal(gone.filter((m) => m.memberId === f.ids.marc).length, 1);
  assert.equal(gone.some((m) => m.memberId === f.ids.lea), false);

  // Un autre abonné ne reçoit rien tant qu'il ne s'abonne pas ; se désabonner arrête tout.
  assert.equal((await f.thomas.put(`/api/lists/${lid}/follow`, { on: false })).data.following, false);
  await f.marc.put(`/api/lists/${lid}/follow`, { on: false });
  db.prepare('UPDATE list_follows SET last_sent = 0').run();
  const n = push.outbox.length;
  await f.lea.post(`/api/lists/${lid}/items`, { title: 'Plante' });
  assert.equal(push.outbox.length, n);
  server.close();
});
