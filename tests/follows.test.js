// Abonnement aux listes : notification groupee quand des articles sont ajoutes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { start, family } = require('./helpers');
const push = require('../lib/push');
const { db } = require('../lib/db');

let ctx; // le serveur et la famille sont partages par les deux tests du fichier
test('abonnement a une liste', async () => {
  const server = await start();
  const f = await family();
  ctx = { server, f };
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
});

test('choix des evenements, suivi d\'une personne, recap et mes abonnements', async () => {
  const { server, f } = ctx;
  const from = push.outbox.length;
  const sub = (id) => ({ endpoint: `https://push.exemple.be/x${id}`, keys: { p256dh: 'BPk', auth: 'xyz' } });
  await f.thomas.post('/api/push/subscribe', { subscription: sub('t2') });
  await f.marc.post('/api/push/subscribe', { subscription: sub('m') });
  const mine = (id) => push.outbox.slice(from).filter((m) => m.memberId === id);
  const lid = (await f.lea.post('/api/lists', { title: 'Anniv' })).data.id;
  const add = async (title) => (await f.lea.post(`/api/lists/${lid}/items`, { title })).data.id;
  const reset = () => db.prepare('UPDATE list_follows SET last_sent = 0').run();

  // « Cadeaux pris » seulement : un ajout ne dit rien, une réservation oui.
  assert.equal((await f.thomas.put(`/api/lists/${lid}/follow`, { events: 'taken' })).data.follow.events, 'taken');
  const first = await add('Montre');
  assert.equal(mine(f.ids.thomas).length, 0);
  await f.marc.post(`/api/items/${first}/reserve`, {});
  assert.equal(mine(f.ids.thomas).length, 1);
  // « Nouveaux cadeaux » seulement : l'inverse.
  await f.thomas.put(`/api/lists/${lid}/follow`, { events: 'add' });
  await add('Sac');
  assert.equal(mine(f.ids.thomas).length, 2);
  const second = await add('Gants'); // 2e ajout dans la fenêtre : en attente
  reset();
  await f.marc.post(`/api/items/${second}/reserve`, {});
  await new Promise((r) => setTimeout(r, 50));
  const got = mine(f.ids.thomas); // seul le lot « Gants » est parti, pas d'avis de réservation
  assert.equal(got.length, 3);
  assert.equal(got.some((m) => /a pris/.test(m.title) && /Gants/.test(m.title)), false);

  // Suivre la personne : toutes ses listes, y compris une liste créée ensuite ; exclusion possible.
  await f.thomas.put(`/api/lists/${lid}/follow`, { events: 'off' });
  assert.equal((await f.thomas.put(`/api/members/${f.ids.lea}/follow`, { events: 'both' })).status, 200);
  assert.equal((await f.thomas.put(`/api/members/${f.ids.thomas}/follow`, { events: 'both' })).status, 400);
  const lid2 = (await f.lea.post('/api/lists', { title: 'Noël' })).data.id;
  const n = mine(f.ids.thomas).length;
  await f.lea.post(`/api/lists/${lid2}/items`, { title: 'Livre' });
  assert.equal(mine(f.ids.thomas).length, n + 1);
  const view = (await f.thomas.get(`/api/lists/${lid2}`)).data;
  assert.equal(view.follow.scope, 'person');
  assert.equal(view.ownerFollow, 'both');
  await f.thomas.put(`/api/lists/${lid2}/follow`, { events: 'off' }); // exclue
  reset();
  await f.lea.post(`/api/lists/${lid2}/items`, { title: 'Stylo' });
  assert.equal(mine(f.ids.thomas).length, n + 1);

  // Mes abonnements, puis récap quotidien : tout est mis en file, envoyé en un message.
  const abo = (await f.thomas.get('/api/follows')).data;
  assert.deepEqual(abo.people.map((p) => p.name), ['Léa']);
  assert.equal(abo.lists.some((l) => l.id === lid2), false);
  await f.thomas.put(`/api/lists/${lid2}/follow`, { events: 'both' });
  assert.equal((await f.thomas.put('/api/follows/digest', { mode: 'daily' })).status, 200);
  reset();
  const before = mine(f.ids.thomas).length;
  await f.lea.post(`/api/lists/${lid2}/items`, { title: 'Carnet' });
  await f.lea.post(`/api/lists/${lid2}/items`, { title: 'Bougie' });
  assert.equal(mine(f.ids.thomas).length, before, 'rien tant que le récap n’est pas dû');
  db.prepare('UPDATE members SET follow_digest_at = 0 WHERE id = ?').run(f.ids.thomas);
  await f.thomas.get('/api/me');
  await new Promise((r) => setTimeout(r, 50));
  const recap = mine(f.ids.thomas).slice(before);
  assert.equal(recap.length, 1);
  assert.match(recap[0].title, /Récap/);
  assert.match(recap[0].body, /Carnet/);

  // La suppression part toujours tout de suite, même en mode récap.
  const gift = await add('Cravate');
  const b = mine(f.ids.thomas).length;
  await f.lea.del(`/api/items/${gift}`);
  assert.equal(mine(f.ids.thomas).slice(b).filter((m) => /retiré/.test(m.title)).length, 1);

  // Tout désabonner.
  assert.equal((await f.thomas.del('/api/follows')).status, 200);
  const none = (await f.thomas.get('/api/follows')).data;
  assert.deepEqual([none.lists.length, none.people.length], [0, 0]);
  server.close();
});
