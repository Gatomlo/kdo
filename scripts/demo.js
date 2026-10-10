// Instance de demonstration jetable : base temporaire (jamais data/), famille fictive,
// listes, reservations, evenement avec Secret Santa tire. E-mails affiches dans la console.
// Usage : node scripts/demo.js   (PORT=3100 par defaut) — mot de passe de tous : demo1234
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.HOTTE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hotte-demo-'));
process.env.HOTTE_MAIL = process.env.HOTTE_MAIL || 'log';
process.env.HOTTE_QUIET = '1';
const app = require('../server');

const PORT = Number(process.env.PORT) || 3100;
const PASSWORD = 'demo1234';
const base = `http://localhost:${PORT}`;

function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + '/api/' + url, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${url} : ${data && data.error}`);
    return data;
  };
}

async function seed() {
  const thomas = client();
  await thomas('POST', 'auth/setup', { name: 'Thomas', email: 'thomas@demo.be', password: PASSWORD });
  const join = async (name, email) => {
    const { url } = await thomas('POST', 'circle/invitations', { email });
    const c = client();
    const me = await c('POST', 'auth/register', { invite: new URL(url).searchParams.get('invite'), name, email, password: PASSWORD });
    return { c, id: me.id };
  };
  const lea = await join('Léa', 'lea@demo.be');
  const marc = await join('Marc', 'marc@demo.be');
  const mamy = await join('Mamy', 'mamy@demo.be');
  const leon = (await thomas('POST', 'circle/profiles', { name: 'Léon' })).id;

  const ev = (await thomas('POST', 'events', { title: 'Noël 2026 chez Mamy', date: '2026-12-24', place: 'Spa', budget: '30', participants: [1, lea.id, marc.id, mamy.id, leon] })).id;

  const lList = (await lea.c('POST', 'lists', { title: 'Noël de Léa', cover: '🎄', eventId: ev, welcome: 'Merci ! Je chausse du 38 et j’adore le vert.', defaultCategories: true })).id;
  const lv = await lea.c('GET', `lists/${lList}`);
  const cat = (n) => lv.categories.find((c) => c.name === n).id;
  const i1 = (await lea.c('POST', `lists/${lList}/items`, { title: 'Le Seigneur des anneaux (intégrale)', categoryId: cat('Livres'), price: '39,90', priority: 3, url: 'https://www.exemple.be/livre' })).id;
  const i2 = (await lea.c('POST', `lists/${lList}/items`, { title: 'Pull en laine vert', categoryId: cat('Vêtements'), price: '55', description: 'Taille M, col roulé', priority: 2 })).id;
  const i3 = (await lea.c('POST', `lists/${lList}/items`, { title: 'Week-end à la mer', categoryId: cat('Expériences'), price: '300', groupGift: true, priority: 3 })).id;
  await lea.c('POST', `lists/${lList}/items`, { title: 'Tasses en grès', categoryId: cat('Maison'), price: '12', quantity: 4, priority: 1 });
  await thomas('POST', `items/${i1}/reserve`, {});
  await marc.c('POST', `items/${i3}/participate`, { amount: '100' });
  await thomas('POST', `items/${i3}/participate`, { amount: '80' });
  await marc.c('POST', `items/${i3}/comments`, { body: 'Je m’occupe de réserver l’hôtel ?' });
  await mamy.c('POST', `lists/${lList}/off-list`, { description: 'Une écharpe tricotée main' });
  void i2;

  const leonList = (await thomas('POST', 'lists', { title: 'Liste de Léon', ownerId: leon, cover: '🧸', eventId: ev })).id;
  const lego = (await thomas('POST', `lists/${leonList}/items`, { title: 'Lego Ferme', price: '49,99', priority: 3 })).id;
  await thomas('POST', `lists/${leonList}/items`, { title: 'Livre « Petit Ours Brun »', price: '6,50', priority: 2 });
  await mamy.c('POST', `items/${lego}/reserve`, {});

  const tList = (await thomas('POST', 'lists', { title: 'Mes envies', cover: '🌟' })).id;
  const t1 = (await thomas('POST', `lists/${tList}/items`, { title: 'Casque audio', price: '120', priority: 3 })).id;
  await lea.c('POST', `items/${t1}/reserve`, {});

  await thomas('POST', `events/${ev}/santa`);
  await thomas('PATCH', `events/${ev}/santa`, { budget: '25', deadline: '2026-12-20', avoidPrevious: true });
  await thomas('POST', `events/${ev}/santa/exclusions`, { a: lea.id, b: marc.id });
  await thomas('POST', `events/${ev}/santa/draw`, {});
}

const server = app.listen(PORT, async () => {
  try {
    await seed();
    console.log(`\nLa Hotte (démo) : ${base}/\nComptes : thomas@demo.be (admin), lea@demo.be, marc@demo.be, mamy@demo.be — mot de passe : ${PASSWORD}\nDonnées : ${process.env.HOTTE_DATA_DIR}\n`);
  } catch (e) {
    console.error('Démo :', e.message);
    server.close();
  }
});
