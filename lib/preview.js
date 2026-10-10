// Pre-remplissage d'un article ou d'une idee depuis un lien marchand : titre, image, prix
// et vendeur lus dans les balises Open Graph, les donnees produit (JSON-LD) ou, a defaut,
// l'image principale d'Amazon. Garde-fous (comme l'import de recette du Cabas) : http(s)
// seulement, adresses internes refusees a chaque redirection, 8 s, 3 Mo. Les sites
// proteges contre les robots (403) ne sont pas contournes.
// fetchImage : copie de l'image dans data/photos (un lien externe casse ou est bloque).
const dns = require('dns').promises;
const net = require('net');
const { httpError } = require('./util');

const MAX_BYTES = 3 * 1024 * 1024;
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

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Kdo',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'fr-BE,fr;q=0.9,en;q=0.8',
};

// Lecture d'une adresse en suivant les redirections (chacune verifiee). wanted(chunk deja
// lu) => true arrete la lecture plus tot.
async function fetchLimited(raw, accept, wanted = () => false) {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await checkUrl(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let res;
    try {
      res = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { ...HEADERS, accept } });
    } catch {
      clearTimeout(timer);
      throw httpError(502, 'Page inaccessible.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      url = new URL(res.headers.get('location'), u).href;
      continue;
    }
    if (!res.ok) {
      clearTimeout(timer);
      throw httpError(502, [401, 403, 429].includes(res.status) ? 'ce site refuse la lecture automatique : colle la photo ou remplis à la main' : `Page inaccessible (${res.status}).`);
    }
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size > MAX_BYTES) { ctrl.abort(); return { tooBig: true, url: u }; }
        if (wanted(Buffer.concat(chunks))) { ctrl.abort(); break; }
      }
    } catch { /* coupure volontaire */ } finally { clearTimeout(timer); }
    return { buf: Buffer.concat(chunks), url: u, type: res.headers.get('content-type') || '' };
  }
  throw httpError(502, 'Trop de redirections.');
}

// Page : on s'arrete des que l'en-tete suffit (titre + image + prix), sinon on lit le
// corps (donnees produit, image Amazon) jusqu'a 3 Mo.
async function fetchPage(raw) {
  const r = await fetchLimited(raw, HEADERS.accept, (buf) => {
    const s = buf.toString('latin1');
    const end = s.search(/<\/head>/i);
    if (end < 0) return false;
    const p = parse(s.slice(0, end), new URL(raw));
    return !!(p.title && p.image && p.price);
  });
  return { html: r.buf ? r.buf.toString('utf8') : '', url: r.url };
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

// Produit decrit en JSON-LD (schema.org), y compris dans un @graph ou une liste.
function ldProduct(html) {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
  const find = (o) => {
    if (!o || typeof o !== 'object') return null;
    if (Array.isArray(o)) { for (const x of o) { const r = find(x); if (r) return r; } return null; }
    const t = [].concat(o['@type'] || []);
    if (t.includes('Product')) return o;
    return find(o['@graph']) || find(o.mainEntity);
  };
  for (const b of blocks) {
    try { const p = find(JSON.parse(b.replace(/^<script[^>]*>|<\/script>$/gi, ''))); if (p) return p; } catch { /* JSON invalide */ }
  }
  return null;
}
const first = (v) => (Array.isArray(v) ? v[0] : v);
const imgOf = (v) => { const x = first(v); return x && typeof x === 'object' ? x.url || x.contentUrl : x; };

function parse(html, base) {
  const p = ldProduct(html) || {};
  const offer = first(p.offers) || {};
  const title = meta(html, ['og:title', 'twitter:title']) || (typeof p.name === 'string' ? decode(p.name) : null)
    || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]) || null;
  let image = meta(html, ['og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image']) || imgOf(p.image)
    || (html.match(/data-old-hires="(https:[^"]+)"/) || [])[1] || (html.match(/"hiRes":"(https:[^"]+)"/) || [])[1]
    || (html.match(/id="landingImage"[^>]+src="(https:[^"]+)"/) || [])[1] || null;
  try { image = image ? new URL(decode(image), base).href : null; } catch { image = null; }
  if (image && !/^https?:/.test(image)) image = null;
  const raw = String(meta(html, ['product:price:amount', 'og:price:amount', 'price']) || offer.price || offer.lowPrice
    || (html.match(/"priceAmount"\s*:\s*(\d+(?:\.\d{1,2})?)/) || [])[1]
    || (html.match(/"price"\s*:\s*"?(\d+(?:[.,]\d{1,2})?)/) || [])[1] || '').trim();
  const price = /^\d+([.,]\d{1,2})?$/.test(raw) ? Number(raw.replace(',', '.')).toFixed(2).replace('.', ',') : null;
  const shop = meta(html, ['og:site_name', 'application-name']) || (offer.seller && typeof offer.seller.name === 'string' ? decode(offer.seller.name) : null)
    || base.hostname.replace(/^www\./, '');
  // « Le Petit Prince : Amazon.fr : Livres » -> « Le Petit Prince » (nom du site retire).
  const brand = base.hostname.replace(/^www\./, '').split('.').slice(-2, -1)[0];
  const cut = brand ? new RegExp(`\\s*[|:–—-]\\s*${brand.replace(/[^a-z0-9]/gi, '.')}\\b.*$`, 'i') : null;
  const clean = title && cut ? title.replace(cut, '') || title : title;
  return { title: clean ? clean.slice(0, 200) : null, image, price, shop: shop.slice(0, 80) };
}

async function preview(url) {
  const { html, url: final } = await fetchPage(url);
  return parse(html, final);
}

// Image trouvee par l'apercu : copiee dans l'app (JPEG, PNG ou WebP, 3 Mo).
async function fetchImage(url) {
  const r = await fetchLimited(url, 'image/avif;q=0.1,image/webp,image/png,image/jpeg,*/*;q=0.5');
  if (r.tooBig) throw httpError(413, 'Image trop lourde.');
  return r.buf;
}

module.exports = { preview, parse, privateIp, fetchImage };
