// Algorithme de tirage (sans serveur).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { draw, key } = require('../lib/santa');

const check = (ps, f, res) => {
  assert.ok(res, 'un tirage est trouvé');
  assert.deepEqual([...res.keys()].sort(), [...ps].sort());
  assert.equal(new Set(res.values()).size, ps.length, 'chacun reçoit une seule fois');
  for (const [g, r] of res) {
    assert.notEqual(g, r, 'jamais soi-même');
    assert.ok(!f.has(key(g, r)), 'exclusion respectée');
  }
};

test('respecte les règles sur de nombreux tirages', () => {
  const ps = [1, 2, 3, 4, 5, 6, 7];
  const f = new Set([key(1, 2), key(2, 1), key(3, 4), key(4, 3)]);
  for (let i = 0; i < 300; i++) check(ps, f, draw(ps, f));
});

test('détecte un tirage impossible', () => {
  assert.equal(draw([1, 2, 3], new Set([key(1, 2), key(1, 3)])), null);
  assert.equal(draw([1], new Set()), null);
});

test('trouve la seule solution possible', () => {
  const res = draw([1, 2, 3], new Set([key(1, 3), key(2, 1), key(3, 2)]));
  assert.deepEqual([res.get(1), res.get(2), res.get(3)], [2, 3, 1]);
});
