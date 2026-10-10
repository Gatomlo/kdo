// Base SQLite unique data/kdo.db (module node:sqlite integre a Node >= 22.5 : aucun
// module natif a compiler sur l'hebergement mutualise), creee et migree au demarrage.
// KDO_DATA_DIR change le dossier (tests, essais).
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.KDO_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const conn = new DatabaseSync(path.join(DATA_DIR, 'kdo.db'));
conn.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');

// Requetes preparees gardees : le meme SQL n'est compile qu'une fois.
const statements = new Map();
const db = {
  prepare(sql) {
    let st = statements.get(sql);
    if (!st) { st = conn.prepare(sql); statements.set(sql, st); }
    return st;
  },
  exec: (sql) => conn.exec(sql),
};

// Transaction ; une transaction deja ouverte est reutilisee (appels imbriques).
let depth = 0;
function tx(fn) {
  if (depth) return fn();
  conn.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    conn.exec('COMMIT');
    return r;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  } finally {
    depth--;
  }
}

// Liste d'identifiants pour IN (...) : uniquement des entiers (jamais de saisie brute).
const inList = (ids) => (ids.length ? ids.map((n) => Number(n) | 0).join(',') : 'NULL');

// Chaque entree n'est jouee qu'une fois (PRAGMA user_version). Ne jamais modifier une
// entree deja deployee : en ajouter une nouvelle.
const MIGRATIONS = [
  `-- Membres du cercle familial. email NULL = profil sans compte (enfant, aine...),
   -- pilote par ses gestionnaires (profile_managers).
   CREATE TABLE members (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL,
     email TEXT UNIQUE COLLATE NOCASE,
     password_hash TEXT,
     color TEXT NOT NULL DEFAULT '#5b4bb7',
     is_admin INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE profile_managers (
     profile_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     manager_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     PRIMARY KEY (profile_id, manager_id)
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL
   );
   CREATE TABLE login_tokens (
     token_hash TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     expires_at INTEGER NOT NULL,
     used_at INTEGER
   );
   CREATE TABLE reset_tokens (
     token_hash TEXT PRIMARY KEY,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     expires_at INTEGER NOT NULL,
     used_at INTEGER
   );
   -- Invitation au cercle. member_id = profil sans compte qui recoit son propre compte.
   CREATE TABLE invitations (
     token_hash TEXT PRIMARY KEY,
     email TEXT,
     member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
     is_admin INTEGER NOT NULL DEFAULT 0,
     invited_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
     expires_at INTEGER NOT NULL,
     used_at INTEGER
   );

   CREATE TABLE events (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     date TEXT,
     place TEXT,
     budget INTEGER,
     organizer_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
     reminder_sent INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE event_participants (
     event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     PRIMARY KEY (event_id, member_id)
   );

   CREATE TABLE lists (
     id INTEGER PRIMARY KEY,
     owner_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     occasion TEXT,
     date TEXT,
     cover TEXT NOT NULL DEFAULT '🎁',
     welcome TEXT,
     event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
     archived INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX lists_owner ON lists(owner_id);
   CREATE INDEX lists_event ON lists(event_id);
   CREATE TABLE list_roles (
     list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     role TEXT NOT NULL CHECK (role IN ('co_owner', 'manager')),
     PRIMARY KEY (list_id, member_id)
   );
   CREATE TABLE categories (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     position INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE items (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
     category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
     title TEXT NOT NULL,
     url TEXT,
     url2 TEXT,
     price INTEGER,
     image TEXT,
     description TEXT,
     priority INTEGER NOT NULL DEFAULT 2,
     quantity INTEGER NOT NULL DEFAULT 1,
     group_gift INTEGER NOT NULL DEFAULT 0,
     position INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX items_list ON items(list_id);

   -- Reservation d'un offrant. amount non NULL = participation a un cadeau commun.
   CREATE TABLE reservations (
     id INTEGER PRIMARY KEY,
     item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
     giver_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     quantity INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'bought')),
     amount INTEGER,
     is_carrier INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX reservations_item ON reservations(item_id);
   CREATE TABLE comments (
     id INTEGER PRIMARY KEY,
     item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
     author_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE off_list_gifts (
     id INTEGER PRIMARY KEY,
     list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
     giver_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     description TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );

   CREATE TABLE ss_draws (
     id INTEGER PRIMARY KEY,
     event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
     budget INTEGER,
     deadline TEXT,
     avoid_previous INTEGER NOT NULL DEFAULT 1,
     status TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup', 'drawn')),
     drawn_at INTEGER,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE ss_exclusions (
     draw_id INTEGER NOT NULL REFERENCES ss_draws(id) ON DELETE CASCADE,
     member_a INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     member_b INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     PRIMARY KEY (draw_id, member_a, member_b)
   );
   CREATE TABLE ss_pairs (
     id INTEGER PRIMARY KEY,
     draw_id INTEGER NOT NULL REFERENCES ss_draws(id) ON DELETE CASCADE,
     giver_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     receiver_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     opened_at INTEGER
   );
   CREATE TABLE ss_messages (
     id INTEGER PRIMARY KEY,
     pair_id INTEGER NOT NULL REFERENCES ss_pairs(id) ON DELETE CASCADE,
     direction TEXT NOT NULL CHECK (direction IN ('question', 'reply')),
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,

  `-- Partage hors cercle : lien d'une liste (NULL = desactive) et invites externes
   -- (membres sans compte rattaches a une seule liste, e-mail facultatif).
   -- share_password_hash : mot de passe facultatif demande a l'invite (scrypt).
   ALTER TABLE lists ADD COLUMN share_token TEXT;
   ALTER TABLE lists ADD COLUMN share_password_hash TEXT;
   CREATE UNIQUE INDEX lists_share ON lists(share_token);
   ALTER TABLE members ADD COLUMN guest_list_id INTEGER REFERENCES lists(id) ON DELETE CASCADE;
   ALTER TABLE members ADD COLUMN guest_email TEXT;`,

  `-- Idees de cadeaux pour quelqu'un, invisibles de cette personne (taken_by = « je m'en occupe »).
   CREATE TABLE ideas (
     id INTEGER PRIMARY KEY,
     recipient_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     author_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     title TEXT NOT NULL,
     url TEXT,
     price INTEGER,
     note TEXT,
     taken_by INTEGER REFERENCES members(id) ON DELETE SET NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX ideas_recipient ON ideas(recipient_id);
   -- Abonnements aux notifications du telephone (Web Push), un par appareil.
   CREATE TABLE push_subs (
     id INTEGER PRIMARY KEY,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     endpoint TEXT NOT NULL UNIQUE,
     p256dh TEXT NOT NULL,
     auth TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   -- Anniversaire : birth_date AAAA-MM-JJ (annee 0000 si inconnue) ; birthday_lead_days =
   -- nombre de jours avant l'anniversaire ou la liste et l'evenement sont crees (NULL = non).
   ALTER TABLE members ADD COLUMN birth_date TEXT;
   ALTER TABLE members ADD COLUMN birthday_lead_days INTEGER;
   CREATE TABLE birthday_runs (
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     year INTEGER NOT NULL,
     list_id INTEGER REFERENCES lists(id) ON DELETE SET NULL,
     event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
     PRIMARY KEY (member_id, year)
   );
   -- Apres la fete : article marque recu par le destinataire.
   ALTER TABLE items ADD COLUMN received_at INTEGER;`,

  `-- Fiche « tailles et preferences » d'une personne (JSON), visible de la famille.
   CREATE TABLE member_fiches (
     member_id INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
     data TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   -- Secret Santa : 3 idees donnees par chaque participant a son Secret Santa (JSON),
   -- et revelation des duos apres la fete.
   CREATE TABLE ss_hints (
     draw_id INTEGER NOT NULL REFERENCES ss_draws(id) ON DELETE CASCADE,
     member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
     hints TEXT NOT NULL,
     PRIMARY KEY (draw_id, member_id)
   );
   ALTER TABLE ss_draws ADD COLUMN revealed_at INTEGER;
   -- Journal de l'administrateur (arrivees, invitations, partages, tirages…).
   CREATE TABLE activity (
     id INTEGER PRIMARY KEY,
     at INTEGER NOT NULL,
     kind TEXT NOT NULL,
     text TEXT NOT NULL,
     actor_id INTEGER REFERENCES members(id) ON DELETE SET NULL
   );`,

  `-- Liste surprise : invisible pour son destinataire (comme si elle n'existait pas).
   ALTER TABLE lists ADD COLUMN surprise INTEGER NOT NULL DEFAULT 0;`,
];

// Reglages de l'app (table meta, valeurs JSON) : e-mails, adresse publique.
function getSetting(key, def = null) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  if (!row) return def;
  try { return JSON.parse(row.value); } catch { return def; }
}
function setSetting(key, value) {
  if (value == null) db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  else db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

function migrate() {
  const version = conn.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++) {
    tx(() => {
      const m = MIGRATIONS[v];
      if (typeof m === 'function') m(conn); else conn.exec(m);
      conn.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
migrate();

// Copie coherente de la base (sauvegarde) vers `file`.
function backupTo(file) {
  conn.exec(`VACUUM INTO '${String(file).replace(/'/g, "''")}'`);
}

module.exports = { db, tx, inList, backupTo, getSetting, setSetting, DATA_DIR };
