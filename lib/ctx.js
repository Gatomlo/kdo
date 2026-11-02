// Cercle courant de la requete (AsyncLocalStorage) : toutes les requetes SQL « du cercle »
// filtrent sur circleId(). Hors contexte il vaut null, donc rien ne correspond (echec ferme).
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

const circleId = () => {
  const s = als.getStore();
  return s ? s.circleId : null;
};
const run = (id, fn) => als.run({ circleId: id }, fn);

module.exports = { circleId, run };
