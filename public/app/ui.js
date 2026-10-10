// Briques d'interface : echappement, formats, panneau du bas, messages, actions.
// La politique de contenu interdit les onclick en ligne : chaque bouton porte
// data-a="nom" (et ses parametres en data-*), traite par delegation (voir on()).

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const eur = (cents) => (cents == null ? '' : (cents / 100).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 }));
// Centimes -> saisie ("12,5").
export const eurInput = (cents) => (cents == null ? '' : String(cents / 100).replace('.', ','));
export const fmtDate = (iso, o = { day: 'numeric', month: 'long', year: 'numeric' }) => (iso ? new Date(iso + 'T12:00').toLocaleDateString('fr-BE', o) : '');
export const daysUntil = (iso) => (iso ? Math.round((new Date(iso + 'T12:00') - new Date(new Date().toDateString() + ' 12:00')) / 86400000) : null);
export const stars = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('');
export const avatar = (m, size = '') => `<span class="av ${size}" style="background:${esc(m.color || '#5b4bb7')}" aria-hidden="true">${esc(initials(m.name))}</span>`;
export const plural = (n, one, many = one + 's') => `${n} ${n > 1 ? many : one}`;
export const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'lien'; } };

// ---------- Actions par delegation ----------
const handlers = { click: {}, input: {}, change: {}, submit: {} };
export function on(kind, name, fn) { handlers[kind][name] = fn; }
for (const kind of ['click', 'input', 'change']) {
  document.addEventListener(kind, (ev) => {
    const attr = kind === 'click' ? 'a' : kind === 'input' ? 'in' : 'ch';
    const el = ev.target.closest(`[data-${attr}]`);
    if (!el) return;
    const fn = handlers[kind][el.dataset[attr]];
    if (!fn) return;
    if (kind === 'click') ev.preventDefault();
    fn(el, ev);
  });
}
// Formulaires : <form data-f="nom"> -> on('submit', 'nom', (form, valeurs)).
document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-f]');
  if (!form) return;
  ev.preventDefault();
  const fn = handlers.submit[form.dataset.f];
  if (fn) fn(form, formData(form));
});

// ---------- Panneau (bas sur mobile, dialogue centre sur PC) ----------
export function sheet(html) {
  closeSheet();
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg) closeSheet(); });
  document.body.appendChild(bg);
  const first = bg.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea');
  if (first) first.focus();
  return bg.querySelector('.sheet');
}
export function closeSheet() { document.querySelectorAll('.sheet-bg').forEach((e) => e.remove()); }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
on('click', 'close-sheet', () => closeSheet());

// Confirmation : resout true / false.
export function confirmSheet({ title, text, ok = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    const s = sheet(`<h3>${esc(title)}</h3><p class="muted">${text}</p><div class="row end"><button class="btn ghost" data-r="0">Annuler</button><button class="btn ${danger ? 'danger' : 'main'}" data-r="1">${esc(ok)}</button></div>`);
    s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-r]');
      if (b) { closeSheet(); resolve(b.dataset.r === '1'); }
    });
  });
}

// ---------- Message ----------
let toastTimer;
export function toast(msg, isError = false) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), isError ? 4500 : 2400);
}

// Valeurs des champs name=... d'un conteneur (cases data-multi -> tableau).
export function formData(root) {
  const out = {};
  root.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox' && el.dataset.multi != null) {
      out[el.name] = out[el.name] || [];
      if (el.checked) out[el.name].push(el.value);
    } else if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  });
  return out;
}

// Copie dans le presse-papiers (lien d'invitation...).
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Lien copié'); } catch { toast('Copie impossible : sélectionne le lien', true); }
}
on('click', 'copy', (el) => copy(el.dataset.text));
