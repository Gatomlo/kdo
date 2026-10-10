// La Hotte : serveur Express. Seul (npm start, PORT) ou monte dans node-gateway sur
// /hotte (dossier apps/hotte) : le module exporte l'app, et n'ecoute un port ou
// n'installe de gestionnaire global que s'il est lance directement.
const fs = require('fs');
const path = require('path');
const express = require('express');
const security = require('./lib/security');
const auth = require('./lib/auth');
const { router } = require('./lib/api');
const photos = require('./lib/photos');

if (require.main === module) {
  const fatal = (kind) => (err) => { console.error(`${kind} :`, err); process.exit(1); };
  process.on('uncaughtException', fatal('Erreur non interceptee'));
  process.on('unhandledRejection', fatal('Promesse rejetee non geree'));
}

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const INDEX = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');

app.disable('x-powered-by');
app.use(security.headers);
app.use(express.json({ limit: '1mb' }));

// Interface : fichiers toujours revalides (304 si inchanges), sauf la page elle-meme.
app.use(express.static(PUBLIC_DIR, { index: false, setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

// Photos des articles : nom aleatoire et definitif, gardees par le navigateur.
app.use('/photos', express.static(photos.DIR, { index: false, immutable: true, maxAge: '365d' }));

app.use('/api', auth.loadUser, security.jsonOnly, router());
app.use('/api', (req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));
app.use('/api', (err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Erreur interne du serveur.' : err.message });
});

// Page unique (navigation par #). <base> = racine de l'app, pour des chemins relatifs
// valables seuls comme sous /hotte.
app.get('/', (req, res) => {
  security.pagePolicy(res);
  const root = auth.rootPath(req).replace(/[<>"&]/g, '');
  res.set('Cache-Control', 'no-cache').type('html').send(INDEX.replace(/\{\{ROOT\}\}/g, root));
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`La Hotte : http://localhost:${PORT}/`));
}

module.exports = app;
