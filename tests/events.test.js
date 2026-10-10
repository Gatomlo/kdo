// Evenements, « qui a deja de quoi », Secret Santa (secret des attributions), rappels.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, family, outbox } = require('./helpers');
const N = require('../lib/notify');

let server, f, ev;
before(async () => {
  server = await start();
  f = await family();
  ev = (await f.thomas.post('/api/events', { title: 'Noël chez Mamy', date: '2099-12-24', participants: [f.ids.thomas, f.ids.lea, f.ids.marc, f.ids.leon] })).data.id;
});
after(() => server.close());

test('événement : listes rattachées, « qui a déjà de quoi » sans soi-même', async () => {
  const lid = (await f.lea.post('/api/lists', { title: 'Léa', eventId: ev })).data.id;
  const iid = (await f.lea.post(`/api/lists/${lid}/items`, { title: 'Écharpe' })).data.id;
  await f.marc.post(`/api/items/${iid}/reserve`, {});
  const asThomas = (await f.thomas.get(`/api/events/${ev}`)).data;
  assert.equal(asThomas.coverage.find((c) => c.id === f.ids.lea).gifts, 1);
  const asLea = (await f.lea.get(`/api/events/${ev}`)).data;
  assert.ok(!asLea.coverage.some((c) => c.id === f.ids.lea), 'pas de compteur pour soi');
  assert.equal(asLea.lists.find((l) => l.id === lid).gifts, null);
  assert.equal(asLea.isOrganizer, false);
  assert.equal((await f.lea.patch(`/api/events/${ev}`, { title: 'x' })).status, 403);
});

test('Secret Santa : réservé à l’organisateur ; 3 participants minimum', async () => {
  assert.equal((await f.lea.post(`/api/events/${ev}/santa`)).status, 403);
  assert.equal((await f.thomas.post(`/api/events/${ev}/santa`)).status, 201);
  assert.equal((await f.lea.get(`/api/events/${ev}/santa`)).status, 403);
  await f.thomas.post(`/api/events/${ev}/santa/exclusions`, { a: f.ids.lea, b: f.ids.marc });
  const s = (await f.thomas.get(`/api/events/${ev}/santa`)).data;
  assert.equal(s.exclusions[0].label, 'Léa ↔ Marc');
});

test('tirage : exclusions et profil → gestionnaire respectés ; l’organisateur ne voit rien', async () => {
  const before = outbox.length;
  const r = await f.thomas.post(`/api/events/${ev}/santa/draw`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  // Thomas, Léa, Marc (+ Léon via Thomas) prévenus.
  assert.deepEqual(outbox.slice(before).map((m) => m.to).sort(), ['lea@exemple.be', 'marc@exemple.be', 'thomas@exemple.be']);
  const admin = (await f.thomas.get(`/api/events/${ev}/santa`)).data;
  assert.ok(!JSON.stringify(admin).includes('receiver'), 'aucune attribution côté organisateur');
  assert.equal(admin.opened.length, 4);
  const { db } = require('../lib/db');
  const pairs = db.prepare('SELECT giver_id, receiver_id FROM ss_pairs').all();
  for (const p of pairs) {
    assert.notEqual(p.giver_id, p.receiver_id);
    assert.ok(!(p.giver_id === f.ids.lea && p.receiver_id === f.ids.marc) && !(p.giver_id === f.ids.marc && p.receiver_id === f.ids.lea));
    assert.ok(!(p.giver_id === f.ids.leon && p.receiver_id === f.ids.thomas), 'Léon ne tire pas son gestionnaire');
  }
});

test('enveloppes : fermée = cible cachée ; chacun voit seulement la sienne (+ profils gérés)', async () => {
  const lea = (await f.lea.get(`/api/events/${ev}/envelope`)).data;
  assert.equal(lea.envelopes.length, 1);
  assert.equal(lea.envelopes[0].receiver, null);
  const thomas = (await f.thomas.get(`/api/events/${ev}/envelope`)).data;
  assert.equal(thomas.envelopes.length, 2, 'la sienne + celle de Léon');
  assert.equal(thomas.envelopes.filter((e) => e.forName === 'Léon').length, 1);
  // Ouvrir l'enveloppe d'un autre : interdit.
  assert.equal((await f.marc.post(`/api/santa-pairs/${lea.envelopes[0].pairId}/open`)).status, 403);
  assert.equal((await f.lea.post(`/api/santa-pairs/${lea.envelopes[0].pairId}/open`)).status, 200);
  const opened = (await f.lea.get(`/api/events/${ev}/envelope`)).data.envelopes[0];
  assert.ok(opened.receiver.name);
  assert.ok(['Thomas', 'Léon'].includes(opened.receiver.name), 'Léa ne tire pas Marc');
  const admin = (await f.thomas.get(`/api/events/${ev}/santa`)).data;
  assert.equal(admin.opened.find((o) => o.name === 'Léa').opened, true);
});

test('messages anonymes : la cible lit et répond sans connaître le donateur', async () => {
  const lea = (await f.lea.get(`/api/events/${ev}/envelope`)).data.envelopes[0];
  assert.equal((await f.lea.post(`/api/santa-pairs/${lea.pairId}/messages`, { direction: 'question', body: 'Ta pointure ?' })).status, 201);
  assert.equal((await f.lea.post(`/api/santa-pairs/${lea.pairId}/messages`, { direction: 'reply', body: 'triche' })).status, 403);
  // La cible est Thomas, ou Léon (alors Thomas lit en tant que gestionnaire).
  const recv = (await f.thomas.get(`/api/events/${ev}/envelope`)).data.received.find((r) => r.pairId === lea.pairId);
  assert.ok(recv, 'la cible voit la question');
  assert.deepEqual(Object.keys(recv).sort(), ['forName', 'messages', 'pairId']);
  assert.equal(recv.messages[0].body, 'Ta pointure ?');
  assert.equal((await f.thomas.post(`/api/santa-pairs/${lea.pairId}/messages`, { direction: 'reply', body: '42' })).status, 201);
  assert.equal((await f.lea.get(`/api/events/${ev}/envelope`)).data.envelopes[0].messages[1].body, '42');
  assert.equal((await f.marc.post(`/api/santa-pairs/${lea.pairId}/messages`, { direction: 'question', body: 'x' })).status, 403);
});

test('nouveau tirage après ouverture : confirmation exigée', async () => {
  assert.equal((await f.thomas.post(`/api/events/${ev}/santa/draw`)).status, 409);
  const r = await f.thomas.post(`/api/events/${ev}/santa/draw`, { force: true });
  assert.equal(r.data.redraw, true);
  assert.equal((await f.lea.get(`/api/events/${ev}/envelope`)).data.envelopes[0].opened, false);
});

test('tirage impossible : message clair', async () => {
  const e2 = (await f.thomas.post('/api/events', { title: 'Petit', participants: [f.ids.thomas, f.ids.lea, f.ids.marc] })).data.id;
  await f.thomas.post(`/api/events/${e2}/santa`);
  await f.thomas.patch(`/api/events/${e2}/santa`, { avoidPrevious: false });
  await f.thomas.post(`/api/events/${e2}/santa/exclusions`, { a: f.ids.thomas, b: f.ids.lea });
  await f.thomas.post(`/api/events/${e2}/santa/exclusions`, { a: f.ids.thomas, b: f.ids.marc });
  const r = await f.thomas.post(`/api/events/${e2}/santa/draw`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /impossible/);
});

test('rappel J-7 : offrants dont la réservation n’est pas achetée, une seule fois', async () => {
  const d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const e3 = (await f.thomas.post('/api/events', { title: 'Anniv', date: d, participants: [f.ids.lea] })).data.id;
  const lid = (await f.lea.post('/api/lists', { title: 'Anniv Léa', eventId: e3 })).data.id;
  const iid = (await f.lea.post(`/api/lists/${lid}/items`, { title: 'Parfum' })).data.id;
  await f.marc.post(`/api/items/${iid}/reserve`, {});
  const before = outbox.length;
  await N.reminders('http://test');
  const sent = outbox.slice(before);
  assert.deepEqual(sent.map((m) => m.to), ['marc@exemple.be']);
  assert.match(sent[0].text, /Parfum/);
  await N.reminders('http://test');
  assert.equal(outbox.length, before + 1, 'pas deux fois');
});
