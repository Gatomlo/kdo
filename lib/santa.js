// Tirage Secret Santa : chaque participant recoit une autre personne, jamais lui-meme,
// en respectant les interdits (paires orientees donateur -> destinataire).
// Recherche en profondeur a ordre aleatoire : trouve une solution si elle existe,
// renvoie null sinon (exclusions trop nombreuses).
const key = (giver, receiver) => `${giver}>${receiver}`;

function shuffle(a, rand) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function draw(participants, forbidden, rand = Math.random, maxSteps = 200000) {
  if (participants.length < 2) return null;
  const options = new Map(participants.map((g) => [g, participants.filter((r) => r !== g && !forbidden.has(key(g, r)))]));
  // Les plus contraints d'abord : elague beaucoup plus vite.
  const givers = shuffle(participants, rand).sort((a, b) => options.get(a).length - options.get(b).length);
  const taken = new Set();
  const result = new Map();
  let steps = 0;
  const solve = (i) => {
    if (i === givers.length) return true;
    if (++steps > maxSteps) return false;
    const g = givers[i];
    for (const r of shuffle(options.get(g), rand)) {
      if (taken.has(r)) continue;
      taken.add(r);
      result.set(g, r);
      if (solve(i + 1)) return true;
      taken.delete(r);
      result.delete(g);
    }
    return false;
  };
  return solve(0) ? result : null;
}

module.exports = { draw, key };
