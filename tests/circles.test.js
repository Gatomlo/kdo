// Plusieurs cercles independants dans la meme base : creation par l'administrateur de la
// plateforme, etancheite complete (membres, listes, evenements, recherche, journal, export).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, family, PASSWORD, tokenOf } = require('./helpers');

let server, f, zoe, zoeId, circle2, inviteUrl;
before(async () => {
  server = await start();
  f = await family(); // cercle n°1 ; thomas = administrateur de la plateforme
});
after(() => server.close());

test('seul l’administrateur de la plateforme crée un cercle', async () => {
  assert.equal((await f.lea.get('/api/platform/circles')).status, 403);
  assert.equal((await f.lea.post('/api/platform/circles', { name: 'Intrus' })).status, 403);
  assert.equal((await f.thomas.post('/api/platform/circles', {})).status, 400, 'nom requis');
  const r = await f.thomas.post('/api/platform/circles', { name: 'Famille Dupont' });
  assert.equal(r.status, 201);
  circle2 = r.data.id;
  inviteUrl = r.data.url;
  const list = (await f.thomas.get('/api/platform/circles')).data;
  assert.equal(list.length, 2);
  assert.ok(list.find((c) => c.id === circle2).pendingAdmin);
});

test('le premier administrateur du nouveau cercle arrive par lien et reste isolé', async () => {
  zoe = client();
  const r = await zoe.post('/api/auth/register', { invite: tokenOf(inviteUrl, 'invite'), name: 'Zoé', email: 'zoe@exemple.be', password: PASSWORD });
  assert.equal(r.status, 201);
  zoeId = r.data.id;
  const me = (await zoe.get('/api/me')).data;
  assert.equal(me.isAdmin, true);
  assert.equal(me.isSuper, false);
  assert.equal(me.circle, 'Famille Dupont');
  const circle = (await zoe.get('/api/circle')).data;
  assert.deepEqual(circle.members.map((m) => m.name), ['Zoé'], 'ne voit pas la famille n°1');
  assert.equal((await zoe.get('/api/platform/circles')).status, 403);
  assert.equal((await zoe.get('/api/settings')).status, 403, 'réglages de la plateforme réservés');
});

test('listes, événements et membres d’un autre cercle sont introuvables', async () => {
  const lid = (await f.lea.post('/api/lists', { title: 'Léa', defaultCategories: true })).data.id;
  const item = (await f.lea.post(`/api/lists/${lid}/items`, { title: 'Casque audio' })).data.id;
  const ev = (await f.thomas.post('/api/events', { title: 'Noël', participants: [f.ids.lea, f.ids.marc] })).data.id;
  await f.thomas.post(`/api/ideas/${f.ids.lea}`, { title: 'Écharpe rouge' });
  assert.equal((await zoe.get(`/api/lists/${lid}`)).status, 404);
  assert.equal((await zoe.post(`/api/items/${item}/reserve`, {})).status, 404);
  assert.equal((await zoe.get(`/api/events/${ev}`)).status, 404);
  assert.equal((await zoe.get(`/api/fiches/${f.ids.lea}`)).status, 404);
  assert.equal((await zoe.get(`/api/ideas/${f.ids.lea}`)).status, 404);
  assert.equal((await zoe.get('/api/lists')).data.length, 0);
  assert.equal((await zoe.get('/api/events')).data.upcoming.length, 0);
  const s = (await zoe.get('/api/search?q=casque')).data;
  assert.equal(s.items.length + s.lists.length, 0);
  assert.equal((await zoe.get('/api/search?q=écharpe')).data.ideas.length, 0);
  // Pas d’action sur un membre ou une liste de l’autre cercle.
  assert.equal((await zoe.post('/api/lists', { title: 'Piège', ownerId: f.ids.lea, surprise: true })).status, 404);
  assert.equal((await zoe.post('/api/events', { title: 'X', participants: [f.ids.lea] })).data.id > 0, true);
  assert.equal((await zoe.del(`/api/circle/members/${f.ids.lea}`)).status, 404);
  assert.equal((await zoe.post(`/api/circle/members/${f.ids.lea}/reset-link`)).status, 404);
  assert.equal((await zoe.patch(`/api/circle/members/${f.ids.marc}`, { isAdmin: true })).status, 404);
});

test('journal, export et corbeille restent propres à chaque cercle', async () => {
  const j1 = (await f.thomas.get('/api/admin/journal')).data;
  const j2 = (await zoe.get('/api/admin/journal')).data;
  assert.ok(j1.activity.length > 0);
  assert.ok(j1.activity.every((a) => !/Zoé|Dupont/.test(a.text) || /Dupont/.test(a.text)), 'journal n°1');
  assert.ok(!j2.activity.some((a) => /Léa|Marc/.test(a.text)));
  assert.equal(j2.counts.members, 1);
  const exp = (await zoe.get('/api/export')).data;
  assert.deepEqual(exp.members.map((m) => m.name), ['Zoé']);
  assert.equal(exp.lists.length, 0);
  const lid = (await zoe.post('/api/lists', { title: 'Zoé' })).data.id;
  await zoe.del(`/api/lists/${lid}`);
  assert.equal((await zoe.get('/api/admin/trash')).data.length, 1);
  assert.equal((await f.thomas.get('/api/admin/trash')).data.length, 0);
  const t = (await zoe.get('/api/admin/trash')).data[0];
  assert.equal((await f.thomas.post(`/api/admin/trash/${t.id}/restore`)).status, 404);
});

test('une invitation du cercle n°1 ne donne pas accès au cercle n°2 (et inversement)', async () => {
  const inv = await f.thomas.post('/api/circle/invitations', { email: 'nina@exemple.be' });
  const nina = client();
  await nina.post('/api/auth/register', { invite: tokenOf(inv.data.url, 'invite'), name: 'Nina', email: 'nina@exemple.be', password: PASSWORD });
  assert.deepEqual((await nina.get('/api/circle')).data.members.map((m) => m.name).includes('Zoé'), false);
  assert.ok((await zoe.get('/api/circle')).data.members.every((m) => m.name !== 'Nina'));
  // L’adresse e-mail reste unique sur la plateforme.
  const dup = await zoe.post('/api/circle/invitations', { email: 'nina@exemple.be' });
  assert.equal(dup.status, 409);
});

test('un lien de partage fonctionne dans son cercle seulement', async () => {
  const lid = (await zoe.post('/api/lists', { title: 'Cadeaux Zoé' })).data.id;
  await zoe.post(`/api/lists/${lid}/items`, { title: 'Livre' });
  const token = (await zoe.post(`/api/lists/${lid}/share`, {})).data.url.split('partage=').pop();
  const guest = client();
  const j = await guest.post(`/api/share/${token}/join`, { name: 'Tonton' });
  assert.equal(j.status, 200);
  assert.equal((await guest.get(`/api/lists/${lid}`)).status, 200);
  // Le journal du cercle n°2 le mentionne, pas celui du n°1.
  assert.ok((await zoe.get('/api/admin/journal')).data.activity.some((a) => a.text.includes('Tonton')));
  assert.ok(!(await f.thomas.get('/api/admin/journal')).data.activity.some((a) => a.text.includes('Tonton')));
});

test('supprimer un cercle efface ses données, pas le cercle de l’administrateur', async () => {
  assert.equal((await f.thomas.del(`/api/platform/circles/1`)).status, 400, 'pas son propre cercle');
  const link = await f.thomas.post(`/api/platform/circles/${circle2}/admin-link`);
  assert.equal(link.status, 200);
  assert.equal((await f.thomas.patch(`/api/platform/circles/${circle2}`, { name: 'Dupont-Martin' })).status, 200);
  assert.equal((await f.thomas.del(`/api/platform/circles/${circle2}`)).status, 200);
  assert.equal((await zoe.get('/api/me')).status, 401, 'session supprimée avec le cercle');
  assert.equal((await f.thomas.get('/api/platform/circles')).data.length, 1);
  assert.equal((await f.lea.get('/api/lists')).status, 200);
  const login = await client().post('/api/auth/login', { email: 'zoe@exemple.be', password: PASSWORD });
  assert.equal(login.status, 401);
  assert.ok(zoeId > 0);
});
