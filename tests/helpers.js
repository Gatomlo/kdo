// Outils de test : serveur sur une base temporaire (chaque fichier de test tourne dans
// son propre processus), clients avec leur cookie, famille de test.
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HOTTE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hotte-test-'));
process.env.HOTTE_MAIL = process.env.HOTTE_MAIL || 'log';
process.env.HOTTE_QUIET = '1';
process.env.HOTTE_PUSH = 'log';
const app = require('../server');
const { outbox } = require('../lib/mailer');

let base = '';
async function start() {
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  return server;
}

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b || {}),
    put: (u, b) => call('PUT', u, b || {}), del: (u, b) => call('DELETE', u, b), cookie: () => cookie,
  };
}

const PASSWORD = 'motdepasse1';
const tokenOf = (url, param) => new URL(url).searchParams.get(param);

// Famille de test : thomas (admin), lea, marc (comptes), leon (profil sans compte gere par thomas).
async function family() {
  const thomas = client();
  await thomas.post('/api/auth/setup', { name: 'Thomas', email: 'thomas@exemple.be', password: PASSWORD });
  const join = async (name, email) => {
    const inv = await thomas.post('/api/circle/invitations', { email });
    const c = client();
    const r = await c.post('/api/auth/register', { invite: tokenOf(inv.data.url, 'invite'), name, email, password: PASSWORD });
    return { c, id: r.data.id };
  };
  const lea = await join('Léa', 'lea@exemple.be');
  const marc = await join('Marc', 'marc@exemple.be');
  const leon = (await thomas.post('/api/circle/profiles', { name: 'Léon' })).data.id;
  const ids = { thomas: (await thomas.get('/api/me')).data.id, lea: lea.id, marc: marc.id, leon };
  return { thomas, lea: lea.c, marc: marc.c, ids };
}

module.exports = { start, client, family, outbox, PASSWORD, tokenOf };
