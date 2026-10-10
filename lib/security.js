// En-tetes de securite. Sur toutes les reponses : pas de deduction du type de contenu,
// pas d'adresse d'origine transmise. Sur la page : politique de contenu (CSP) qui
// n'autorise que les scripts de l'application (aucun script ni onclick en ligne).
function headers(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

function pagePolicy(res) {
  res.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    // Photos des articles : liens vers les sites marchands.
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
}

// Les POST/PUT/PATCH doivent etre en JSON : un formulaire d'un autre site ne peut pas
// en envoyer sans CORS (protection CSRF, avec le cookie SameSite=Lax).
// Exception : depot d'une photo (corps image/*, qu'un formulaire d'un autre site ne peut
// pas envoyer non plus sans verification CORS prealable).
function jsonOnly(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method) || req.is('application/json')) return next();
  if (req.method === 'POST' && req.path === '/photos' && req.is(['image/jpeg', 'image/png', 'image/webp'])) return next();
  res.status(415).json({ error: 'Requête JSON attendue.' });
}

module.exports = { headers, pagePolicy, jsonOnly };
