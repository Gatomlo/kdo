// Regles anti-spoiler (cahier des charges §4.6) et reservations : le serveur ne transmet
// jamais les donnees de cadeaux au destinataire ni aux co-proprietaires.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, family, outbox } = require('./helpers');

let server, f, listId, itemId, groupId;
before(async () => {
  server = await start();
  f = await family();
  // Liste de Léa avec Marc en co-propriétaire.
  listId = (await f.lea.post('/api/lists', { title: 'Noël de Léa', defaultCategories: true })).data.id;
  assert.equal((await f.lea.post(`/api/lists/${listId}/roles`, { memberId: f.ids.marc, role: 'co_owner' })).status, 200);
  itemId = (await f.lea.post(`/api/lists/${listId}/items`, { title: 'Livre', price: '20', quantity: 2 })).data.id;
  groupId = (await f.lea.post(`/api/lists/${listId}/items`, { title: 'Vélo', price: '300', groupGift: true })).data.id;
});
after(() => server.close());

const giftKeys = (v) => ({ offList: v.offList, gifts: v.items.map((i) => i.gifts) });

test('un offrant réserve ; quantités « 1 sur 2 »', async () => {
  assert.equal((await f.thomas.post(`/api/items/${itemId}/reserve`, { quantity: 1 })).status, 201);
  const v = (await f.thomas.get(`/api/lists/${listId}`)).data;
  assert.equal(v.role, 'viewer');
  const it = v.items.find((i) => i.id === itemId);
  assert.equal(it.gifts.taken, 1);
  assert.equal(it.gifts.available, 1);
  assert.equal(it.gifts.reservations[0].giverName, 'Thomas');
  assert.equal((await f.thomas.post(`/api/items/${itemId}/reserve`, { quantity: 2 })).status, 409, 'pas plus que disponible');
});

test('le destinataire ne reçoit aucune donnée de cadeau, et ne peut pas en créer', async () => {
  await f.thomas.post(`/api/items/${itemId}/comments`, { body: 'Je prends le tome 1' });
  await f.thomas.post(`/api/lists/${listId}/off-list`, { description: 'Un pull' });
  const v = (await f.lea.get(`/api/lists/${listId}`)).data;
  assert.equal(v.role, 'owner');
  assert.equal(v.canSeeGifts, false);
  assert.deepEqual(giftKeys(v), { offList: null, gifts: [undefined, undefined] });
  const raw = JSON.stringify(v);
  assert.ok(!raw.includes('Thomas') && !raw.includes('pull') && !raw.includes('tome'), 'aucune trace dans la réponse');
  assert.equal((await f.lea.post(`/api/items/${itemId}/reserve`, {})).status, 403);
  assert.equal((await f.lea.post(`/api/items/${itemId}/comments`, { body: 'x' })).status, 403);
  assert.equal((await f.lea.post(`/api/lists/${listId}/off-list`, { description: 'x' })).status, 403);
});

test('le co-propriétaire non plus ; il ne peut pas s’ajouter gestionnaire', async () => {
  const v = (await f.marc.get(`/api/lists/${listId}`)).data;
  assert.equal(v.role, 'co_owner');
  assert.equal(v.canEdit, true);
  assert.deepEqual(giftKeys(v), { offList: null, gifts: [undefined, undefined] });
  assert.equal((await f.marc.del(`/api/lists/${listId}/roles/${f.ids.marc}`)).status, 400);
  assert.equal((await f.marc.post(`/api/lists/${listId}/roles`, { memberId: f.ids.marc, role: 'manager' })).status, 400);
});

test('tableau de bord et liste des listes : pas de compteur sur ses propres listes', async () => {
  const mine = (await f.lea.get('/api/lists')).data.find((l) => l.id === listId);
  assert.equal(mine.gifts, null);
  assert.equal((await f.marc.get('/api/dashboard')).data.lists.find((l) => l.id === listId).gifts, null);
  assert.deepEqual((await f.thomas.get('/api/lists')).data.find((l) => l.id === listId).gifts, { total: 3, taken: 1 });
});

test('export : sans les cadeaux de ses propres listes', async () => {
  const lea = (await f.lea.get('/api/export')).data;
  assert.equal(lea.reservations.length, 0);
  assert.equal(lea.comments.length, 0);
  assert.equal(lea.offListGifts.length, 0);
  const thomas = (await f.thomas.get('/api/export')).data;
  assert.equal(thomas.reservations.length, 1);
});

test('cadeau commun : participations, jauge, porteur, achat', async () => {
  assert.equal((await f.thomas.post(`/api/items/${groupId}/reserve`, {})).status, 400);
  await f.thomas.post(`/api/items/${groupId}/participate`, { amount: '100' });
  // Léon (profil géré par Thomas) participe aussi, au nom du profil.
  await f.thomas.post(`/api/items/${groupId}/participate`, { amount: '50', asId: f.ids.leon });
  assert.equal((await f.lea.post(`/api/items/${groupId}/participate`, { amount: '10' })).status, 403);
  let g = (await f.thomas.get(`/api/lists/${listId}`)).data.items.find((i) => i.id === groupId).gifts;
  assert.equal(g.funded, 15000);
  assert.equal(g.status, 'reserved');
  const carrier = g.reservations.find((r) => r.isCarrier);
  assert.equal(carrier.giverName, 'Thomas', 'premier participant = porteur');
  const leonPart = g.reservations.find((r) => r.giverId === f.ids.leon);
  await f.thomas.patch(`/api/reservations/${carrier.id}`, { status: 'bought' });
  g = (await f.thomas.get(`/api/lists/${listId}`)).data.items.find((i) => i.id === groupId).gifts;
  assert.equal(g.status, 'bought');
  assert.ok(g.reservations.every((r) => r.status === 'bought'));
  assert.ok(leonPart);
});

test('un autre offrant ne touche pas à ma réservation', async () => {
  const r = (await f.thomas.get(`/api/lists/${listId}`)).data.items.find((i) => i.id === itemId).gifts.reservations[0];
  assert.equal((await f.marc.del(`/api/reservations/${r.id}`)).status, 403, 'co-propriétaire : 403 (liste qui le concerne)');
  const other = (await f.thomas.get('/api/circle')).data.members.find((m) => m.name === 'Léa');
  assert.ok(other);
});

test('modification d’un article réservé : offrants prévenus, jamais le destinataire', async () => {
  const before = outbox.length;
  await f.lea.patch(`/api/items/${itemId}`, { title: 'Livre (tome 2)', price: '22', quantity: 2 });
  const sent = outbox.slice(before);
  assert.deepEqual(sent.map((m) => m.to), ['thomas@exemple.be']);
  assert.match(sent[0].subject, /modifié/);
});

test('gestionnaire d’un enfant : voit, gère, réattribue ; l’enfant ne se connecte pas', async () => {
  // Liste de Léon (profil géré par Thomas).
  const lid = (await f.thomas.post('/api/lists', { title: 'Liste de Léon', ownerId: f.ids.leon })).data.id;
  const iid = (await f.thomas.post(`/api/lists/${lid}/items`, { title: 'Lego' })).data.id;
  assert.equal((await f.lea.post(`/api/items/${iid}/reserve`, {})).status, 201);
  const v = (await f.thomas.get(`/api/lists/${lid}`)).data;
  assert.equal(v.role, 'manager');
  assert.equal(v.canManageGifts, true);
  const r = v.items[0].gifts.reservations[0];
  assert.equal(r.giverName, 'Léa');
  assert.equal((await f.thomas.patch(`/api/reservations/${r.id}`, { giverId: f.ids.marc })).status, 200);
  assert.equal((await f.thomas.patch(`/api/reservations/${r.id}`, { giverId: f.ids.leon })).status, 400, 'pas au destinataire');
  assert.equal((await f.lea.patch(`/api/reservations/${r.id}`, { giverId: f.ids.lea })).status, 403, 'plus la sienne, pas gestionnaire');
  assert.equal((await f.thomas.del(`/api/reservations/${r.id}`)).status, 200);
  assert.equal((await f.lea.post('/api/lists', { title: 'x', ownerId: f.ids.leon })).status, 403, 'pas gestionnaire de Léon');
});

test('gestionnaire explicite : ne peut pas être le destinataire ; doit avoir un compte', async () => {
  assert.equal((await f.lea.post(`/api/lists/${listId}/roles`, { memberId: f.ids.lea, role: 'manager' })).status, 400);
  assert.equal((await f.lea.post(`/api/lists/${listId}/roles`, { memberId: f.ids.leon, role: 'manager' })).status, 400);
  assert.equal((await f.lea.post(`/api/lists/${listId}/roles`, { memberId: f.ids.thomas, role: 'manager' })).status, 200);
  const v = (await f.thomas.get(`/api/lists/${listId}`)).data;
  assert.equal(v.role, 'manager');
  assert.ok(v.members.every((m) => m.id !== f.ids.lea), 'réattribution : destinataire exclu');
});

test('ordre des articles et catégories', async () => {
  const v = (await f.lea.get(`/api/lists/${listId}`)).data;
  const ids = v.items.map((i) => i.id).reverse();
  assert.equal((await f.lea.put(`/api/lists/${listId}/items/order`, { ids })).status, 200);
  assert.deepEqual((await f.lea.get(`/api/lists/${listId}`)).data.items.map((i) => i.id), ids);
  assert.equal((await f.thomas.put(`/api/lists/${listId}/items/order`, { ids })).status, 200, 'gestionnaire');
  const cats = v.categories.map((c) => c.id).reverse();
  await f.lea.put(`/api/lists/${listId}/categories/order`, { ids: cats });
  assert.deepEqual((await f.lea.get(`/api/lists/${listId}`)).data.categories.map((c) => c.id), cats);
});

test('liens : seuls http(s) sont gardés', async () => {
  const id = (await f.lea.post(`/api/lists/${listId}/items`, { title: 'Piège', url: 'javascript:alert(1)', image: 'data:image/png;base64,xx' })).data.id;
  const it = (await f.lea.get(`/api/lists/${listId}`)).data.items.find((i) => i.id === id);
  assert.equal(it.url, null);
  assert.equal(it.image, null);
});
