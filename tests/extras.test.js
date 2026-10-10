// Idees secretes, notifications du telephone, anniversaires automatiques, « recu » et
// report, duplication, historique et budget.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, family, outbox } = require('./helpers');
const push = require('../lib/push');
const B = require('../lib/birthdays');

let server, f;
before(async () => { server = await start(); f = await family(); });
after(() => server.close());

test('idées secrètes : visibles des autres, jamais de la personne', async () => {
  const r = await f.thomas.post(`/api/ideas/${f.ids.lea}`, { title: 'Cours de poterie', price: '60', note: 'Elle en a parlé à Pâques' });
  assert.equal(r.status, 201);
  assert.equal((await f.lea.get(`/api/ideas/${f.ids.lea}`)).status, 403);
  assert.equal((await f.lea.post(`/api/ideas/${f.ids.lea}`, { title: 'x' })).status, 403);
  assert.equal((await f.lea.post(`/api/idea/${r.data.id}/take`, { take: true })).status, 403);
  assert.equal((await f.lea.get('/api/ideas')).data[f.ids.lea], undefined, 'pas de compteur pour soi');
  assert.equal((await f.marc.get('/api/ideas')).data[f.ids.lea], 1);
  // Marc s'en occupe ; Thomas ne peut plus la prendre.
  assert.equal((await f.marc.post(`/api/idea/${r.data.id}/take`, { take: true })).status, 200);
  assert.equal((await f.thomas.post(`/api/idea/${r.data.id}/take`, { take: true })).status, 409);
  const v = (await f.thomas.get(`/api/ideas/${f.ids.lea}`)).data;
  assert.equal(v.ideas[0].takenBy, 'Marc');
  assert.equal((await f.marc.del(`/api/idea/${r.data.id}`)).status, 403, 'seul l’auteur supprime');
  // Pour un enfant : son gestionnaire voit les idées (il est du côté des offrants).
  await f.lea.post(`/api/ideas/${f.ids.leon}`, { title: 'Draisienne' });
  assert.equal((await f.thomas.get(`/api/ideas/${f.ids.leon}`)).data.ideas.length, 1);
});

test('notifications du téléphone : abonnement et envoi en même temps que l’e-mail', async () => {
  const key = (await f.thomas.get('/api/push')).data.publicKey;
  assert.ok(key.length > 80);
  const sub = { endpoint: 'https://push.exemple.be/abc', keys: { p256dh: 'BPk', auth: 'xyz' } };
  assert.equal((await f.thomas.post('/api/push/subscribe', { subscription: { endpoint: 'http://x' } })).status, 400);
  assert.equal((await f.thomas.post('/api/push/subscribe', { subscription: sub })).data.devices, 1);
  const lid = (await f.lea.post('/api/lists', { title: 'Test push' })).data.id;
  const iid = (await f.lea.post(`/api/lists/${lid}/items`, { title: 'Bougie' })).data.id;
  await f.thomas.post(`/api/items/${iid}/reserve`, {});
  const before = push.outbox.length;
  await f.lea.patch(`/api/items/${iid}`, { title: 'Bougie parfumée' });
  const p = push.outbox.slice(before);
  assert.equal(p.length, 1);
  assert.equal(p[0].memberId, f.ids.thomas);
  assert.equal(p[0].url, `#/listes/${lid}`);
  assert.equal((await f.thomas.post('/api/push/unsubscribe', { endpoint: sub.endpoint })).data.devices, 0);
});

test('anniversaire : prochaine date, 29 février, année inconnue', () => {
  const now = new Date('2026-10-10T08:00:00Z');
  assert.deepEqual(B.nextBirthday('1990-10-12', now), { date: '2026-10-12', year: 2026, days: 2 });
  assert.deepEqual(B.nextBirthday('1990-10-10', now), { date: '2026-10-10', year: 2026, days: 0 });
  assert.equal(B.nextBirthday('1990-03-01', now).date, '2027-03-01');
  assert.equal(B.nextBirthday('2000-02-29', now).date, '2027-02-28');
  assert.equal(B.nextBirthday('2000-02-29', new Date('2028-01-01T00:00:00Z')).date, '2028-02-29');
  assert.equal(B.parseBirthDate('03-14'), '0000-03-14');
  assert.throws(() => B.parseBirthDate('13-40'));
});

test('anniversaire : délai par personne, liste + événement créés une seule fois', async () => {
  const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(5, 10); // dans 20 jours
  // Délai de 10 jours : pas encore.
  assert.equal((await f.marc.put(`/api/circle/members/${f.ids.marc}/birthday`, { birthDate: `1985-${soon}`, leadDays: 10 })).status, 200);
  assert.ok(!(await f.marc.get('/api/lists')).data.some((l) => l.title.startsWith('Anniversaire de Marc')));
  // Léa ne peut pas régler l'anniversaire de Marc ; Thomas règle celui de Léon (profil géré).
  assert.equal((await f.lea.put(`/api/circle/members/${f.ids.marc}/birthday`, { birthDate: '1985-01-01', leadDays: 10 })).status, 403);
  assert.equal((await f.thomas.put(`/api/circle/members/${f.ids.leon}/birthday`, { birthDate: `0000-${soon}`, leadDays: 30 })).status, 200);
  assert.equal((await f.marc.put(`/api/circle/members/${f.ids.marc}/birthday`, { birthDate: `1985-${soon}`, leadDays: 999 })).status, 400);
  // Délai de 30 jours : créée tout de suite.
  const before = outbox.length;
  await f.marc.put(`/api/circle/members/${f.ids.marc}/birthday`, { birthDate: `1985-${soon}`, leadDays: 30 });
  const lists = (await f.marc.get('/api/lists')).data.filter((l) => l.title.startsWith('Anniversaire de Marc'));
  assert.equal(lists.length, 1);
  assert.match(lists[0].title, /\(\d+ ans\)/);
  assert.equal(lists[0].role, 'owner');
  const ev = (await f.lea.get(`/api/events/${lists[0].eventId}`)).data;
  assert.equal(ev.event.title, 'Anniversaire de Marc');
  assert.ok(ev.participants.some((p) => p.id === f.ids.lea));
  const mails = outbox.slice(before);
  assert.ok(mails.some((m) => m.to === 'marc@exemple.be' && /Ta liste/.test(m.subject)));
  assert.ok(mails.some((m) => m.to === 'lea@exemple.be' && /Anniversaire de Marc/.test(m.subject)));
  // Pas de doublon.
  assert.equal(await B.run('http://test'), 0);
  // Léon (profil) : liste à son nom, gérée par Thomas.
  const leon = (await f.thomas.get('/api/lists')).data.find((l) => l.title === 'Anniversaire de Léon');
  assert.equal(leon.role, 'manager');
  // Le cercle expose la date et le délai.
  const marc = (await f.lea.get('/api/circle')).data.members.find((m) => m.id === f.ids.marc);
  assert.equal(marc.birthdayLeadDays, 30);
  assert.equal(marc.canEditBirthday, false);
});

test('après la fête : reçu, report des articles non reçus, archivage', async () => {
  const lid = (await f.lea.post('/api/lists', { title: 'Noël 2026', defaultCategories: true })).data.id;
  const cats = (await f.lea.get(`/api/lists/${lid}`)).data.categories;
  const a = (await f.lea.post(`/api/lists/${lid}/items`, { title: 'Livre', categoryId: cats[0].id })).data.id;
  await f.lea.post(`/api/lists/${lid}/items`, { title: 'Gants', categoryId: cats[2].id });
  await f.thomas.post(`/api/items/${a}/reserve`, {});
  assert.equal((await f.thomas.patch(`/api/items/${a}/received`, { received: true })).status, 403, 'un offrant ne marque pas reçu');
  assert.equal((await f.lea.patch(`/api/items/${a}/received`, { received: true })).status, 200);
  assert.equal((await f.lea.get(`/api/lists/${lid}`)).data.items.find((i) => i.id === a).received, true);
  const r = await f.lea.post(`/api/lists/${lid}/carry`, { title: 'Mes envies 2027' });
  assert.equal(r.data.moved, 1);
  const next = (await f.lea.get(`/api/lists/${r.data.id}`)).data;
  assert.deepEqual(next.items.map((i) => i.title), ['Gants']);
  assert.equal(next.categories[0].name, cats[2].name, 'catégorie reprise');
  assert.equal((await f.lea.get(`/api/lists/${lid}`)).data.list.archived, true);
  // Vers une liste d'un autre destinataire : refusé.
  const other = (await f.marc.post('/api/lists', { title: 'Marc' })).data.id;
  await f.marc.post(`/api/lists/${other}/roles`, { memberId: f.ids.lea, role: 'co_owner' });
  assert.equal((await f.lea.post(`/api/lists/${lid}/carry`, { targetId: other })).status, 400);
});

test('dupliquer une liste : articles et catégories, sans réservations', async () => {
  const lid = (await f.lea.post('/api/lists', { title: 'Base', defaultCategories: true })).data.id;
  const it = (await f.lea.post(`/api/lists/${lid}/items`, { title: 'Puzzle', price: '20' })).data.id;
  await f.thomas.post(`/api/items/${it}/reserve`, {});
  const d = await f.lea.post(`/api/lists/${lid}/duplicate`, {});
  const v = (await f.thomas.get(`/api/lists/${d.data.id}`)).data;
  assert.equal(v.list.title, 'Base (copie)');
  assert.equal(v.categories.length, 5);
  assert.equal(v.items[0].gifts.taken, 0);
  assert.equal((await f.thomas.post(`/api/lists/${lid}/duplicate`, {})).status, 403);
});

test('mes cadeaux : historique et budget, pour soi et les profils gérés', async () => {
  const lid = (await f.marc.post('/api/lists', { title: 'Fête des pères', date: '2026-06-21' })).data.id;
  const i1 = (await f.marc.post(`/api/lists/${lid}/items`, { title: 'Cravate', price: '25', quantity: 2 })).data.id;
  const i2 = (await f.marc.post(`/api/lists/${lid}/items`, { title: 'Barbecue', price: '300', groupGift: true })).data.id;
  await f.thomas.post(`/api/items/${i1}/reserve`, { quantity: 2 });
  await f.thomas.post(`/api/items/${i2}/participate`, { amount: '40', asId: f.ids.leon });
  const g = (await f.thomas.get('/api/my-gifts')).data.filter((x) => x.list.id === lid);
  const cravate = g.find((x) => x.title === 'Cravate');
  assert.equal(cravate.cost, 5000);
  assert.equal(cravate.recipient.name, 'Marc');
  assert.equal(cravate.year, 2026);
  const bbq = g.find((x) => x.title === 'Barbecue');
  assert.equal(bbq.cost, 4000);
  assert.equal(bbq.forName, 'Léon');
  assert.equal((await f.marc.get('/api/my-gifts')).data.filter((x) => x.list.id === lid).length, 0, 'rien sur ses propres listes');
});
