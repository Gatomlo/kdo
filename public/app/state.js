// Etat partage de l'interface et rafraichissement de l'ecran.
export const S = {
  me: null,    // compte connecte (GET /api/me)
  route: [],   // ex. ['listes', '12']
  data: null,  // donnees de l'ecran courant (chargees par le routeur)
  q: {},       // filtres par ecran
};

let reloader = async () => {};
let renderer = () => {};
export const setReloader = (fn) => { reloader = fn; };
export const setRenderer = (fn) => { renderer = fn; };
// Recharge les donnees de l'ecran courant puis le redessine (apres une action).
export const reload = () => reloader();
// Redessine sans recharger (filtres).
export const render = () => renderer();

export function go(hash) {
  if (location.hash === hash) reload(); else location.hash = hash;
}
