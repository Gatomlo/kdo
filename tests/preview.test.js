// Lecture des balises d'une page produit et garde-fou d'adresses internes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parse, privateIp } = require('../lib/preview');

test('Open Graph : titre, image absolue, prix', () => {
  const html = `<head><title>Ignoré</title><meta property="og:title" content="Lego Ferme &amp; animaux">
    <meta property="og:image" content="/img/ferme.jpg"><meta property="product:price:amount" content="49.99"></head>`;
  assert.deepEqual(parse(html, new URL('https://boutique.be/p/1')), { title: 'Lego Ferme & animaux', image: 'https://boutique.be/img/ferme.jpg', price: '49,99' });
});

test('sans Open Graph : balise title, pas d’image javascript:', () => {
  const r = parse('<title> Livre </title><meta property="og:image" content="javascript:alert(1)">', new URL('https://x.be'));
  assert.equal(r.title, 'Livre');
  assert.equal(r.image, null);
});

test('adresses internes refusées', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.4', '172.20.0.1', '169.254.1.1', '::1', '::ffff:127.0.0.1', 'fd00::1']) assert.ok(privateIp(ip), ip);
  assert.ok(!privateIp('93.184.216.34'));
});
