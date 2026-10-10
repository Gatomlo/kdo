// Partage hors cercle (lien, mot de passe, invites), photos, reglages e-mail.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { start, client, family, outbox } = require('./helpers');

let server, f, listId, itemId, url, base;
before(async () => {
  server = await start();
  base = `http://127.0.0.1:${server.address().port}`;
  f = await family();
  listId = (await f.lea.post('/api/lists', { title: 'Anniversaire de Léa' })).data.id;
  itemId = (await f.lea.post(`/api/lists/${listId}/items`, { title: 'Vélo' })).data.id;
});
after(() => server.close());

const token = () => new URL(url).searchParams.get('partage');

test('partage : réservé à ceux qui modifient la liste ; lien créé', async () => {
  assert.equal((await f.thomas.post(`/api/lists/${listId}/share`)).status, 403);
  const r = await f.lea.post(`/api/lists/${listId}/share`);
  assert.equal(r.data.enabled, true);
  url = r.data.url;
  const info = await client().get(`/api/share/${token()}`);
  assert.deepEqual(info.data, { listId, title: 'Anniversaire de Léa', cover: '🎁', ownerName: 'Léa', needsPassword: false });
  assert.equal((await client().get('/api/share/inconnu')).status, 404);
});

test('invité : voit et réserve sur cette liste seulement', async () => {
  const otherList = (await f.marc.post('/api/lists', { title: 'Marc' })).data.id;
  const paul = client();
  assert.equal((await paul.post(`/api/share/${token()}/join`, { name: '' })).status, 400);
  assert.equal((await paul.post(`/api/share/${token()}/join`, { name: 'Parrain Paul', email: 'paul@exemple.be' })).status, 200);
  const me = (await paul.get('/api/me')).data;
  assert.equal(me.guest, true);
  assert.equal(me.listId, listId);
  const v = (await paul.get(`/api/lists/${listId}`)).data;
  assert.equal(v.role, 'viewer');
  assert.equal(v.guest, true);
  assert.equal((await paul.post(`/api/items/${itemId}/reserve`, {})).status, 201);
  for (const [m, u] of [['get', `/api/lists/${otherList}`], ['get', '/api/dashboard'], ['get', '/api/circle'], ['get', '/api/events'], ['get', '/api/lists'], ['post', '/api/lists'], ['get', '/api/export']]) {
    assert.equal((await paul[m](u, m === 'post' ? { title: 'x' } : undefined)).status, 403, u);
  }
  // La famille voit la réservation de l'invité ; la destinataire non.
  assert.equal((await f.thomas.get(`/api/lists/${listId}`)).data.items[0].gifts.reservations[0].giverName, 'Parrain Paul');
  assert.equal((await f.lea.get(`/api/lists/${listId}`)).data.items[0].gifts, undefined);
  // Les invités n'apparaissent pas dans le cercle ; l'admin les voit à part.
  const circle = (await f.thomas.get('/api/circle')).data;
  assert.ok(!circle.members.some((m) => m.name === 'Parrain Paul'));
  assert.equal(circle.guests[0].listTitle, 'Anniversaire de Léa');
});

test('invité qui revient avec le même prénom : il retrouve ses réservations', async () => {
  const again = client();
  await again.post(`/api/share/${token()}/join`, { name: 'parrain paul' });
  const r = (await again.get(`/api/lists/${listId}`)).data.items[0].gifts.reservations[0];
  assert.equal(r.mine, true);
  assert.equal((await again.del(`/api/reservations/${r.id}`)).status, 200);
  await again.post(`/api/items/${itemId}/reserve`, {});
});

test('notification e-mail à l’invité qui a laissé son adresse', async () => {
  const before = outbox.length;
  await f.lea.patch(`/api/items/${itemId}`, { title: 'Vélo rouge' });
  assert.deepEqual(outbox.slice(before).map((m) => m.to), ['paul@exemple.be']);
});

test('mot de passe : exigé, invités déconnectés, essais limités', async () => {
  const paul = client();
  await paul.post(`/api/share/${token()}/join`, { name: 'Parrain Paul' });
  assert.equal((await f.lea.put(`/api/lists/${listId}/share/password`, { password: 'abc' })).status, 400);
  const r = await f.lea.put(`/api/lists/${listId}/share/password`, { password: 'sapin' });
  assert.equal(r.data.hasPassword, true);
  assert.equal((await paul.get('/api/me')).status, 401, 'session coupée');
  assert.equal((await client().get(`/api/share/${token()}`)).data.needsPassword, true);
  const c = client();
  assert.equal((await c.post(`/api/share/${token()}/join`, { name: 'Tonton' })).status, 401);
  assert.equal((await c.post(`/api/share/${token()}/join`, { name: 'Tonton', password: 'faux' })).status, 401);
  assert.equal((await c.post(`/api/share/${token()}/join`, { name: 'Tonton', password: 'sapin' })).status, 200);
  assert.equal((await c.get(`/api/lists/${listId}`)).status, 200);
  require('../lib/share').failures.clear();
});

test('désactiver puis renouveler : l’ancien lien ne marche plus', async () => {
  const c = client();
  await c.post(`/api/share/${token()}/join`, { name: 'Mamie Jeanne', password: 'sapin' });
  await f.lea.del(`/api/lists/${listId}/share`);
  assert.equal((await c.get(`/api/lists/${listId}`)).status, 401, 'partage coupé = accès coupé');
  const old = token();
  url = (await f.lea.post(`/api/lists/${listId}/share`, { renew: true })).data.url;
  assert.notEqual(token(), old);
  assert.equal((await client().get(`/api/share/${old}`)).status, 404);
  const guests = (await f.lea.get(`/api/lists/${listId}/share`)).data.guests;
  const jeanne = guests.find((g) => g.name === 'Mamie Jeanne');
  assert.equal((await f.lea.del(`/api/lists/${listId}/share/guests/${jeanne.id}`)).status, 200);
});

// JPEG minimal valide (en-tete suffisant pour la verification du type).
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const upload = (c, body, type = 'image/jpeg') => fetch(`${base}/api/photos`, { method: 'POST', headers: { 'content-type': type, cookie: c.cookie() }, body });

test('photo : dépôt, type vérifié, lien sur l’article, servie', async () => {
  assert.equal((await upload(client(), JPEG)).status, 401);
  assert.equal((await upload(f.lea, Buffer.from('<script>alert(1)</script>'))).status, 415);
  assert.equal((await upload(f.lea, JPEG, 'text/plain')).status, 415, 'non JSON et pas une image');
  const r = await upload(f.lea, JPEG);
  assert.equal(r.status, 201);
  const { url: photo } = await r.json();
  assert.match(photo, /^photos\/[0-9a-f]{32}\.jpg$/);
  await f.lea.patch(`/api/items/${itemId}`, { title: 'Vélo rouge', image: photo });
  assert.equal((await f.lea.get(`/api/lists/${listId}`)).data.items[0].image, photo);
  const served = await fetch(`${base}/${photo}`);
  assert.equal(served.status, 200);
  assert.equal(Buffer.from(await served.arrayBuffer()).length, JPEG.length);
  // Chemin local détourné : refusé.
  await f.lea.patch(`/api/items/${itemId}`, { title: 'Vélo rouge', image: 'photos/../hotte.db' });
  assert.equal((await f.lea.get(`/api/lists/${listId}`)).data.items[0].image, null);
});

test('photos orphelines supprimées après 24 h', async () => {
  const photos = require('../lib/photos');
  const r = await (await upload(f.lea, JPEG)).json();
  const file = path.join(photos.DIR, r.url.slice(7));
  assert.ok(fs.existsSync(file));
  photos.cleanup(0);
  assert.ok(!fs.existsSync(file), 'non référencée : supprimée');
});

test('réglages e-mail : admin seulement, mot de passe jamais renvoyé', async () => {
  assert.equal((await f.lea.get('/api/settings')).status, 403);
  const r = await f.thomas.put('/api/settings', { smtp: { host: 'mail.exemple.be', port: 465, secure: true, user: 'hotte@exemple.be', pass: 'secret', from: 'hotte@exemple.be' }, publicUrl: 'https://exemple.be/hotte/' });
  assert.equal(r.status, 200);
  assert.equal(r.data.host, 'mail.exemple.be');
  assert.equal(r.data.hasPass, true);
  assert.ok(!JSON.stringify(r.data).includes('secret'));
  assert.equal(r.data.publicUrl, 'https://exemple.be/hotte');
  // Mot de passe vide = garde l'ancien.
  await f.thomas.put('/api/settings', { smtp: { host: 'mail.exemple.be', port: 465, secure: true, user: 'hotte@exemple.be', pass: '' } });
  assert.equal(require('../lib/db').getSetting('smtp').pass, 'secret');
  // Les liens utilisent l'adresse publique.
  const inv = await f.thomas.post('/api/circle/invitations', {});
  assert.match(inv.data.url, /^https:\/\/exemple\.be\/hotte\/\?invite=/);
  assert.equal((await f.thomas.put('/api/settings', { publicUrl: 'javascript:alert(1)' })).status, 400);
  await f.thomas.put('/api/settings', { smtp: { host: '' }, publicUrl: '' });
});
