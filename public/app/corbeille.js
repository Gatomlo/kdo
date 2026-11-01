// Corbeille de l'administrateur : articles et listes supprimés, restaurables 7 jours.
import { esc, on, toast, confirmSheet } from './ui.js';
import { get, post, del, attempt } from './api.js';
import { reload } from './state.js';
import { define } from './router.js';
import { empty } from './cards.js';

const when = (t) => new Date(t).toLocaleString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const left = (t) => { const d = Math.max(0, Math.ceil((t - Date.now()) / 86400000)); return `${d} jour${d > 1 ? 's' : ''}`; };

define('corbeille', {
  load: () => get('admin/trash'),
  view: (items) => ({
    title: 'Corbeille', sub: 'Vidée automatiquement après 7 jours', back: '#/reglages', tab: 'cercle',
    body: `<div class="stack-lg"><section class="stack">
      ${items.length ? items.map((t) => `<div class="card between"><span><b>${t.kind === 'list' ? '📋' : '🎁'} ${esc(t.label)}</b>
        <span class="meta">${t.kind === 'list' ? 'Liste' : 'Article'}${t.context ? ` · ${esc(t.context)}` : ''} · supprimé le ${when(t.deletedAt)}${t.deletedBy ? ` par ${esc(t.deletedBy)}` : ''} · encore ${left(t.expiresAt)}</span></span>
        <button class="btn sm" data-a="trash-restore" data-id="${t.id}">Restaurer</button></div>`).join('') : empty('La corbeille est vide.')}
      ${items.length ? '<button class="btn danger-t" data-a="trash-empty">Vider la corbeille</button>' : ''}
    </section></div>`,
  }),
});
on('click', 'trash-restore', async (el) => {
  if (await attempt(() => post(`admin/trash/${el.dataset.id}/restore`))) { toast('Restauré'); reload(); }
});
on('click', 'trash-empty', async () => {
  if (!(await confirmSheet({ title: 'Vider la corbeille ?', text: 'Les éléments seront perdus définitivement.', ok: 'Vider', danger: true }))) return;
  if (await attempt(() => del('admin/trash'))) { toast('Corbeille vidée'); reload(); }
});
