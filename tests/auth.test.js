// Connexion : premier compte, mot de passe, invitation, profil qui recoit un compte,
// reinitialisation, lien par e-mail, droits d'administration.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start, client, outbox, PASSWORD, tokenOf } = require('./helpers');

let server, thomas;
before(async () => { server = await start(); });
after(() => server.close());

test('premier compte = administrateur ; ensuite fermé', async () => {
  const anon = client();
  assert.deepEqual((await anon.get('/api/auth/options')).data, { mail: true, setup: true });
  assert.equal((await anon.get('/api/me')).status, 401);
  assert.equal((await anon.post('/api/auth/setup', { name: 'Thomas', email: 'thomas@exemple.be', password: 'court' })).status, 400);
  thomas = client();
  const r = await thomas.post('/api/auth/setup', { name: 'Thomas', email: 'Thomas@Exemple.be', password: PASSWORD });
  assert.equal(r.status, 201);
  assert.equal(r.data.isAdmin, true);
  assert.equal((await client().post('/api/auth/setup', { name: 'X', email: 'x@exemple.be', password: PASSWORD })).status, 403);
});

test('connexion par mot de passe ; mauvais mot de passe', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/login', { email: 'thomas@exemple.be', password: 'mauvais!!' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'THOMAS@exemple.be', password: PASSWORD })).status, 200);
  assert.equal((await c.get('/api/me')).data.name, 'Thomas');
  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/me')).status, 401);
});

test('invitation : seul l’admin invite ; le lien crée le compte', async () => {
  const inv = await thomas.post('/api/circle/invitations', { email: 'lea@exemple.be' });
  assert.equal(inv.status, 201);
  assert.equal(inv.data.sent, true);
  const token = tokenOf(inv.data.url, 'invite');
  assert.equal((await client().get(`/api/invitations/${token}`)).data.inviter, 'Thomas');
  const lea = client();
  const r = await lea.post('/api/auth/register', { invite: token, name: 'Léa', email: 'lea@exemple.be', password: PASSWORD });
  assert.equal(r.status, 201);
  assert.equal(r.data.isAdmin, false);
  assert.equal((await client().post('/api/auth/register', { invite: token, name: 'Bis', email: 'bis@exemple.be', password: PASSWORD })).status, 404, 'lien à usage unique');
  assert.equal((await lea.post('/api/circle/invitations', {})).status, 403, 'un membre n’invite pas');
  assert.equal((await lea.patch(`/api/circle/members/${r.data.id}`, { isAdmin: true })).status, 403);
});

test('profil sans compte : créé par un membre, puis reçoit son compte', async () => {
  const lea = client();
  await lea.post('/api/auth/login', { email: 'lea@exemple.be', password: PASSWORD });
  const p = await lea.post('/api/circle/profiles', { name: 'Zoé' });
  assert.equal(p.status, 201);
  assert.equal((await lea.get('/api/me')).data.profiles[0].name, 'Zoé');
  const circle = (await lea.get('/api/circle')).data.members;
  const zoe = circle.find((m) => m.id === p.data.id);
  assert.equal(zoe.hasAccount, false);
  assert.equal(zoe.iManage, true);
  assert.equal(circle.find((m) => m.name === 'Thomas').email, undefined, 'adresses cachées aux non-admins');
  const inv = await lea.post('/api/circle/invitations', { memberId: p.data.id });
  assert.equal(inv.status, 201);
  const z = client();
  const r = await z.post('/api/auth/register', { invite: tokenOf(inv.data.url, 'invite'), name: 'Zoé', email: 'zoe@exemple.be', password: PASSWORD });
  assert.equal(r.data.id, p.data.id, 'même membre : ses listes sont gardées');
  assert.equal((await lea.get('/api/me')).data.profiles.length, 0);
});

test('lien de réinitialisation créé par l’admin', async () => {
  const lea = (await thomas.get('/api/circle')).data.members.find((m) => m.name === 'Léa');
  const r = await thomas.post(`/api/circle/members/${lea.id}/reset-link`);
  const c = client();
  assert.equal((await c.post('/api/auth/reset', { token: tokenOf(r.data.url, 'reset'), password: 'nouveaumdp1' })).status, 200);
  assert.equal((await client().post('/api/auth/login', { email: 'lea@exemple.be', password: 'nouveaumdp1' })).status, 200);
});

test('lien de connexion par e-mail (si l’envoi est configuré)', async () => {
  const c = client();
  assert.equal((await c.post('/api/auth/request', { email: 'thomas@exemple.be' })).status, 200);
  const url = outbox.at(-1).text.match(/https?:\S+/)[0];
  assert.equal((await c.post('/api/auth/verify', { token: tokenOf(url, 'login') })).status, 200);
  assert.equal((await c.get('/api/me')).data.name, 'Thomas');
  assert.equal((await c.post('/api/auth/verify', { token: tokenOf(url, 'login') })).status, 400, 'usage unique');
  const n = outbox.length;
  assert.equal((await c.post('/api/auth/request', { email: 'inconnu@exemple.be' })).status, 200);
  assert.equal(outbox.length, n, 'pas d’e-mail pour une adresse inconnue');
});

test('requêtes non JSON refusées (CSRF)', async () => {
  const r = await fetch(server.address ? `http://127.0.0.1:${server.address().port}/api/auth/login` : '', { method: 'POST', body: 'email=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r.status, 415);
});
