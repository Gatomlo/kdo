// Ecrans de l'application : chaque module declare ses adresses avec define().
// pattern : 'listes/:id/reglages' ; load(params) -> donnees (async) ; view(data, params) ->
// { title, back, body, right, noNav, tab }.
const routes = [];

export function define(pattern, def) {
  const keys = [];
  const re = new RegExp('^' + pattern.split('/').map((p) => (p.startsWith(':') ? (keys.push(p.slice(1)), '([^/]+)') : p)).join('/') + '$');
  routes.push({ re, keys, ...def });
}

export function match(path) {
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) return { route: r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
  }
  return null;
}
