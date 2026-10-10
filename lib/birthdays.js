// Anniversaires automatiques : pour chaque personne qui a une date de naissance et un
// delai (birthday_lead_days, reglable par personne), la liste « Anniversaire de X » et
// l'evenement correspondant (toute la famille invitee) sont crees ce nombre de jours avant
// l'anniversaire, une seule fois par an (birthday_runs). La personne (ou les gestionnaires
// de son profil) est prevenue de remplir sa liste ; les autres, de l'anniversaire qui vient.
// Verifie au fil des requetes (au plus une fois par heure, comme les rappels).
const { db, tx } = require('./db');
const { httpError, isoDate } = require('./util');
const A = require('./access');
const notify = require('./notify');
const { DEFAULT_CATEGORIES } = require('./lists');

const MAX_LEAD = 180;

// « AAAA-MM-JJ » ou « MM-JJ » (annee inconnue -> 0000-MM-JJ).
function parseBirthDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const full = isoDate(s);
  if (full) return full;
  const m = s.match(/^(?:0000-)?(\d{2})-(\d{2})$/);
  if (m && isoDate(`2000-${m[1]}-${m[2]}`)) return `0000-${m[1]}-${m[2]}`;
  throw httpError(400, 'Date de naissance invalide.');
}

// Prochain anniversaire (aujourd'hui compris). Un 29 fevrier tombe le 28 les autres annees.
function nextBirthday(birthDate, now = new Date()) {
  const [, mm, dd] = birthDate.split('-').map(Number);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const at = (y) => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return new Date(Date.UTC(y, mm - 1, mm === 2 && dd === 29 && !leap ? 28 : dd));
  };
  let d = at(today.getUTCFullYear());
  if (d < today) d = at(today.getUTCFullYear() + 1);
  return { date: d.toISOString().slice(0, 10), year: d.getUTCFullYear(), days: Math.round((d - today) / 86400000) };
}

const canEdit = (user, memberId) => user.id === memberId || user.isAdmin || A.managedProfileIds(user.id).includes(memberId);

function setBirthday(user, memberId, b) {
  const m = db.prepare('SELECT id, guest_list_id FROM members WHERE id = ?').get(memberId);
  if (!m || m.guest_list_id) throw httpError(404, 'Membre introuvable.');
  if (!canEdit(user, memberId)) throw httpError(403, 'Tu ne peux pas modifier l’anniversaire de cette personne.');
  const birth = parseBirthDate(b.birthDate);
  let lead = b.leadDays === '' || b.leadDays == null || b.leadDays === false ? null : parseInt(b.leadDays, 10);
  if (lead != null && (!Number.isFinite(lead) || lead < 1 || lead > MAX_LEAD)) throw httpError(400, `Délai entre 1 et ${MAX_LEAD} jours.`);
  if (!birth) lead = null;
  db.prepare('UPDATE members SET birth_date = ?, birthday_lead_days = ? WHERE id = ?').run(birth, lead, memberId);
}

// Anniversaires a venir (tableau de bord, cercle).
function upcoming(now = new Date(), within = 60) {
  return db.prepare('SELECT id, name, color, birth_date, birthday_lead_days FROM members WHERE birth_date IS NOT NULL AND guest_list_id IS NULL').all()
    .map((m) => {
      const n = nextBirthday(m.birth_date, now);
      const age = m.birth_date.startsWith('0000') ? null : n.year - Number(m.birth_date.slice(0, 4));
      return { id: m.id, name: m.name, color: m.color, date: n.date, days: n.days, age };
    })
    .filter((x) => x.days <= within)
    .sort((a, b) => a.days - b.days);
}

// Cree les listes et evenements dus. Renvoie le nombre de creations.
async function run(base, now = new Date()) {
  const due = [];
  const people = db.prepare(`SELECT id, name, email, birth_date, birthday_lead_days FROM members
    WHERE birth_date IS NOT NULL AND birthday_lead_days IS NOT NULL AND guest_list_id IS NULL`).all();
  for (const p of people) {
    const n = nextBirthday(p.birth_date, now);
    if (n.days > p.birthday_lead_days) continue;
    if (db.prepare('SELECT 1 FROM birthday_runs WHERE member_id = ? AND year = ?').get(p.id, n.year)) continue;
    const age = p.birth_date.startsWith('0000') ? null : n.year - Number(p.birth_date.slice(0, 4));
    const created = tx(() => {
      // Organisateur : la personne, ou le premier gestionnaire d'un profil sans compte.
      const organizer = p.email ? p.id : (db.prepare('SELECT manager_id FROM profile_managers WHERE profile_id = ? ORDER BY manager_id LIMIT 1').get(p.id) || {}).manager_id || null;
      const evTitle = `Anniversaire de ${p.name}`;
      const eventId = Number(db.prepare('INSERT INTO events (title, date, organizer_id, created_at) VALUES (?, ?, ?, ?)').run(evTitle, n.date, organizer, Date.now()).lastInsertRowid);
      for (const m of db.prepare('SELECT id FROM members WHERE guest_list_id IS NULL').all()) {
        db.prepare('INSERT INTO event_participants (event_id, member_id) VALUES (?, ?)').run(eventId, m.id);
      }
      const title = age ? `${evTitle} (${age} ans)` : evTitle;
      const listId = Number(db.prepare(`INSERT INTO lists (owner_id, title, occasion, date, cover, event_id, created_at) VALUES (?, ?, 'Anniversaire', ?, '🎂', ?, ?)`)
        .run(p.id, title, n.date, eventId, Date.now()).lastInsertRowid);
      DEFAULT_CATEGORIES.forEach((c, i) => db.prepare('INSERT INTO categories (list_id, name, position) VALUES (?, ?, ?)').run(listId, c, i));
      db.prepare('INSERT INTO birthday_runs (member_id, year, list_id, event_id) VALUES (?, ?, ?, ?)').run(p.id, n.year, listId, eventId);
      return { member: { id: p.id, name: p.name }, list: { id: listId, title }, event: { id: eventId }, days: n.days };
    });
    due.push(created);
  }
  for (const c of due) await notify.birthdayCreated(c, base).catch((e) => console.error('Anniversaire', e.message));
  return due.length;
}

module.exports = { parseBirthDate, nextBirthday, setBirthday, upcoming, run, MAX_LEAD };
