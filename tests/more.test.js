// Fiches tailles et preferences, recherche, Secret Santa (idees, duos devoiles),
// journal de l'administrateur.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, family, tokenOf } = require('./helpers');

let server, f;
before(async () => { server = await start(); f = await family(); });
after(() => server.close());

test('fiche : la personne, son gestionnaire ou l’admin la modifient ; tous la lisent', async () => {
  assert.equal((await f.lea.put(`/api/fiches/${f.ids.lea}`, { top: 'M', shoes: '38', colors: 'vert, bleu', dislikes: 'allergie aux noix' })).status, 200);
  assert.equal((await f.marc.put(`/api/fiches/${f.ids.lea}`, { top: 'XXL' })).status, 403);
  assert.equal((await f.thomas.put(`/api/fiches/${f.ids.leon}`, { shoes: '27' })).status, 200, 'gestionnaire');
  assert.equal((await f.lea.put(`/api/fiches/${f.ids.leon}`, { shoes: '30' })).status, 403);
  const v = (await f.marc.get(`/api/fiches/${f.ids.lea}`)).data;
  assert.equal(v.fiche.shoes, '38');
  assert.equal(v.canEdit, false);
  // Affichée avec la liste, y compris pour un invité hors cercle.
  const lid = (await f.lea.post('/api/lists', { title: 'Léa' })).data.id;
  assert.equal((await f.marc.get(`/api/lists/${lid}`)).data.ownerFiche.dislikes, 'allergie aux noix');
  const url = (await f.lea.post(`/api/lists/${lid}/share`)).data.url;
  const guest = client();
  await guest.post(`/api/share/${tokenOf(url, 'partage')}/join`, { name: 'Tonton' });
  assert.equal((await guest.get(`/api/lists/${lid}`)).data.ownerFiche.top, 'M');
  assert.equal((await guest.get(`/api/fiches/${f.ids.lea}`)).status, 403, 'pas les autres fiches');
  assert.equal((await guest.get('/api/search?q=noix')).status, 403);
  // Vider la fiche la supprime.
  await f.thomas.put(`/api/fiches/${f.ids.leon}`, {});
  assert.equal((await f.lea.get(`/api/fiches/${f.ids.leon}`)).data.fiche, null);
});

test('recherche : sans accents, listes actives, jamais ses propres idées', async () => {
  const lid = (await f.marc.post('/api/lists', { title: 'Envies de Marc' })).data.id;
  await f.marc.post(`/api/lists/${lid}/items`, { title: 'Livre de cuisine végétarienne', description: 'Ottolenghi' });
  await f.lea.post(`/api/ideas/${f.ids.marc}`, { title: 'Couteau de cuisine' });
  await f.lea.post(`/api/ideas/${f.ids.thomas}`, { title: 'Tablier de cuisine' });
  const r = (await f.thomas.get(`/api/search?q=${encodeURIComponent('CUISINE vegetarienne')}`)).data;
  assert.deepEqual(r.items.map((i) => i.title), ['Livre de cuisine végétarienne']);
  assert.equal(r.items[0].ownerName, 'Marc');
  const ideas = (await f.thomas.get('/api/search?q=cuisine')).data.ideas.map((i) => i.title);
  assert.deepEqual(ideas, ['Couteau de cuisine'], 'pas le tablier prévu pour Thomas');
  assert.equal((await f.thomas.get('/api/search?q=a')).data.items.length, 0, 'trop court');
  await f.marc.patch(`/api/lists/${lid}`, { archived: true });
  assert.equal((await f.thomas.get('/api/search?q=ottolenghi')).data.items.length, 0, 'archivée');
});

test('Secret Santa : 3 idées pour mon Secret Santa, vues par mon donateur', async () => {
  const ev = (await f.thomas.post('/api/events', { title: 'Noël', date: '2099-12-24', participants: [f.ids.thomas, f.ids.lea, f.ids.marc] })).data.id;
  await f.thomas.post(`/api/events/${ev}/santa`);
  await f.thomas.patch(`/api/events/${ev}/santa`, { avoidPrevious: false });
  assert.equal((await f.lea.put(`/api/events/${ev}/santa/hints/${f.ids.lea}`, { hints: ['Un livre', ' ', 'Du thé', 'Des chaussettes', 'Trop'] })).status, 200);
  assert.equal((await f.lea.put(`/api/events/${ev}/santa/hints/${f.ids.marc}`, { hints: ['x'] })).status, 403);
  assert.equal((await f.thomas.put(`/api/events/${ev}/santa/hints/${f.ids.leon}`, { hints: ['x'] })).status, 403, 'Léon ne participe pas');
  assert.equal((await f.thomas.post(`/api/events/${ev}/santa/draw`)).status, 200);
  assert.deepEqual((await f.lea.get(`/api/events/${ev}/envelope`)).data.myHints[0].hints, ['Un livre', 'Du thé', 'Des chaussettes']);
  // Le donateur de Léa voit ses idées une fois l'enveloppe ouverte.
  for (const c of [f.thomas, f.marc]) {
    const e = (await c.get(`/api/events/${ev}/envelope`)).data.envelopes[0];
    await c.post(`/api/santa-pairs/${e.pairId}/open`);
    const opened = (await c.get(`/api/events/${ev}/envelope`)).data.envelopes[0];
    if (opened.receiver.name === 'Léa') assert.deepEqual(opened.hints, ['Un livre', 'Du thé', 'Des chaussettes']);
  }
  // Duos : pas avant la fête, puis visibles des participants.
  assert.equal((await f.thomas.post(`/api/events/${ev}/santa/reveal`)).status, 400);
  assert.equal((await f.lea.get(`/api/events/${ev}/envelope`)).data.revealed, null);
  const past = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  await f.thomas.patch(`/api/events/${ev}`, { title: 'Noël', date: past, participants: [f.ids.thomas, f.ids.lea, f.ids.marc] });
  assert.equal((await f.thomas.get(`/api/events/${ev}/santa`)).data.canReveal, true);
  assert.equal((await f.lea.post(`/api/events/${ev}/santa/reveal`)).status, 403);
  assert.equal((await f.thomas.post(`/api/events/${ev}/santa/reveal`)).status, 200);
  const pairs = (await f.lea.get(`/api/events/${ev}/envelope`)).data.revealed;
  assert.equal(pairs.length, 3);
  assert.ok(pairs.every((p) => p.giver !== p.receiver));
});

test('journal : admin seulement, arrivées, invitations en attente annulables', async () => {
  assert.equal((await f.lea.get('/api/admin/journal')).status, 403);
  await f.thomas.post('/api/circle/invitations', { email: 'zoe@exemple.be' });
  const j = (await f.thomas.get('/api/admin/journal')).data;
  const texts = j.activity.map((a) => a.text);
  assert.ok(texts.includes('Cercle créé'));
  assert.ok(texts.includes('Léa a rejoint le cercle'));
  assert.ok(texts.some((t) => t.includes('Tonton (invité hors cercle)')));
  assert.ok(texts.some((t) => t.includes('tiré au sort')));
  assert.ok(!texts.some((t) => /cuisine|Livre/.test(t)), 'aucun contenu de cadeau');
  const inv = j.invitations.find((i) => i.email === 'zoe@exemple.be');
  assert.ok(inv);
  assert.equal(j.shares.length, 1);
  assert.equal(j.counts.guests, 1);
  assert.equal((await f.thomas.del(`/api/admin/invitations/${inv.id}`)).status, 200);
  assert.ok(!(await f.thomas.get('/api/admin/journal')).data.invitations.some((i) => i.email === 'zoe@exemple.be'));
});

test('Secret Santa : deux parents et un enfant géré, tirage possible seulement si autorisé', async () => {
  await f.thomas.post(`/api/circle/profiles/${f.ids.leon}/managers`, { managerId: f.ids.lea });
  const ev = (await f.thomas.post('/api/events', { title: 'Petit Noël', date: '2099-12-25', participants: [f.ids.thomas, f.ids.lea, f.ids.leon] })).data.id;
  await f.thomas.post(`/api/events/${ev}/santa`);
  await f.thomas.patch(`/api/events/${ev}/santa`, { avoidPrevious: false });
  const r = await f.thomas.post(`/api/events/${ev}/santa/draw`);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'managers');
  assert.match(r.data.error, /Léon/);
  assert.equal((await f.thomas.post(`/api/events/${ev}/santa/draw`, { allowManagers: true })).status, 200);
  await f.thomas.del(`/api/circle/profiles/${f.ids.leon}/managers/${f.ids.lea}`);
});

test('transfert de liste : vers le compte de l’enfant, le parent reste gestionnaire', async () => {
  const lid = (await f.thomas.post('/api/lists', { title: 'Pour Marc' })).data.id;
  const item = (await f.thomas.post(`/api/lists/${lid}/items`, { title: 'Vélo' })).data.id;
  assert.equal((await f.lea.post(`/api/items/${item}/reserve`, {})).status < 300, true);
  assert.equal((await f.lea.post(`/api/lists/${lid}/transfer`, { memberId: f.ids.marc })).status, 403, 'simple offrant');
  assert.equal((await f.thomas.post(`/api/lists/${lid}/transfer`, { memberId: f.ids.lea })).status, 409, 'Léa a réservé dessus');
  assert.equal((await f.thomas.post(`/api/lists/${lid}/transfer`, { memberId: f.ids.marc, keepManager: true })).status, 200);
  const v = (await f.marc.get(`/api/lists/${lid}`)).data;
  assert.equal(v.role, 'owner');
  assert.equal(v.canSeeGifts, false);
  const t = (await f.thomas.get(`/api/lists/${lid}`)).data;
  assert.equal(t.role, 'manager');
  assert.equal(t.canSeeGifts, true);
});
