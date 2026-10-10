// Pre-remplissage d'un article depuis un lien marchand : titre, image et prix lus dans
// les balises Open Graph / donnees produit de la page. Garde-fous (comme l'import de
// recette du Cabas) : http(s) seulement, adresses internes refusees a chaque
// redirection, 8 s, 1,5 Mo, en-tete de page seulement.
const dns = require('dns').promises;
const net = require('net');
const { httpError } = require('./util');

const MAX_BYTES = 1.5 * 1024 * 1024;
const TIMEOUT = 8000;

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw httpError(400, 'Lien invalide.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw httpError(400, 'Lien invalide (http ou https).');
  if (process.env.KDO_ALLOW_PRIVATE_FETCH !== '1') { // tests uniquement
    const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
    if (!addrs.length) throw httpError(400, 'Site introuvable.');
    if (addrs.some((a) => privateIp(a.address))) throw httpError(400, 'Adresse non autorisée.');
  }
  return u;
}

async function fetchHead(raw) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await checkUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let res;
    try {
      res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Kdo, aperçu de lien)', accept: 'text/html', 'accept-language': 'fr,en;q=0.8' } });
    } catch {
      clearTimeout(timer);
      throw httpError(502, 'Page inaccessible.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), u).href;
      continue;
    }
    if (!res.ok) { clearTimeout(timer); throw httpError(502, `Page inaccessible (${res.status}).`); }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size > MAX_BYTES || /<\/head>/i.test(Buffer.from(value).toString('latin1'))) { ctrl.abort(); break; }
      }
    } catch { /* coupure volontaire */ } finally { clearTimeout(timer); }
    return { html: Buffer.concat(chunks).toString('utf8'), url: u };
  }
  throw httpError(502, 'Trop de redirections.');
}

const NAMED = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>', nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', icirc: 'î', rsquo: '’', euro: '€' };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return NAMED[e] ?? m;
  const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
  return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
}).replace(/\s+/g, ' ').trim();

function meta(html, names) {
  for (const n of names) {
    const tags = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)\s*=\s*["']${n}["'][^>]*>`, 'i'));
    const content = tags && tags[0].match(/content\s*=\s*["']([^"']*)["']/i);
    if (content && content[1].trim()) return decode(content[1]);
  }
  return null;
}

function parse(html, base) {
  const title = meta(html, ['og:title', 'twitter:title']) || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]) || null;
  let image = meta(html, ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image']);
  try { image = image ? new URL(image, base).href : null; } catch { image = null; }
  if (image && !/^https?:/.test(image)) image = null;
  const raw = meta(html, ['product:price:amount', 'og:price:amount', 'price']) || (html.match(/"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)/) || [])[1] || null;
  const price = raw && /^\d+([.,]\d{1,2})?$/.test(raw.trim()) ? raw.trim().replace('.', ',') : null;
  return { title: title ? title.slice(0, 200) : null, image, price };
}

async function preview(url) {
  const { html, url: final } = await fetchHead(url);
  return parse(html, final);
}

module.exports = { preview, parse, privateIp };
