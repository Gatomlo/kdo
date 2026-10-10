// Sauvegarde : copie coherente de la base dans data/backups/hotte-AAAA-MM-JJ.db
// (les 30 plus recentes sont gardees). A lancer chaque jour (tache planifiee de
// l'hebergement) : node scripts/backup.js
const fs = require('fs');
const path = require('path');
const { backupTo, DATA_DIR } = require('../lib/db');

const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `hotte-${new Date().toISOString().slice(0, 10)}.db`);
if (fs.existsSync(file)) fs.rmSync(file);
backupTo(file);
const old = fs.readdirSync(dir).filter((f) => /^hotte-.*\.db$/.test(f)).sort().slice(0, -30);
old.forEach((f) => fs.rmSync(path.join(dir, f)));
console.log(`Sauvegarde : ${file}`);
