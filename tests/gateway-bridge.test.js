// Pont avec la connexion centralisee de node-gateway : req.gateway (pose par la passerelle) ouvre une
// session locale COURTE pour le membre de meme e-mail, sans jamais creer de compte. Hors passerelle : inchange.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { start, client, PASSWORD } = require('./helpers');
const express = require('express');
const app = require('../server');

let server, outer, base;
const gw = (email, role = 'member') => ({ 'x-test-gateway': JSON.stringify({ app: 'kdo', role, user: { login: 'x', name: 'X', email, isSuper: false } }) });
const me = (headers = {}) => fetch(base + '/api/me', { headers });

before(async () => {
  server = await start();
  const r = await client().post('/api/auth/setup', { name: 'Thomas', email: 'thomas@exemple.be', password: PASSWORD });
  assert.equal(r.status, 201);
  outer = express();
  outer.use((req, res, next) => { const h = req.get('x-test-gateway'); if (h) req.gateway = JSON.parse(h); next(); });
  outer.use('/kdo', app);
  const s2 = http.createServer(outer);
  await new Promise((r2) => s2.listen(0, r2));
  server.bridge = s2;
  base = `http://127.0.0.1:${s2.address().port}/kdo`;
});
after(() => { server.bridge.close(); server.close(); });

test('e-mail de la passerelle -> membre local de meme e-mail (session courte, limitee au chemin)', async () => {
  const r = await me(gw('THOMAS@exemple.be'));
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(String(j.email || '').toLowerCase(), 'thomas@exemple.be');
  const cookie = r.headers.get('set-cookie');
  assert.match(cookie, /Path=\/kdo\//);
  assert.match(cookie, /Max-Age=7200\b/);
  assert.match(cookie, /HttpOnly/);
});

test('aucun compte cree : e-mail inconnu, sans e-mail, anonyme ou sans droit => pas connecte', async () => {
  for (const h of [gw('inconnu@exemple.be'), gw(''), {}, { 'x-test-gateway': JSON.stringify({ app: 'kdo', role: null, user: { login: 'x', email: 'thomas@exemple.be' } }) }]) {
    assert.equal((await me(h)).status, 401);
  }
  const { db } = require('../lib/db');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM members').get().n, 1);
});
