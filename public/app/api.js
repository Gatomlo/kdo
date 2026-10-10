// Appels a l'API (adresses relatives : la balise <base> pointe sur la racine de l'app,
// /kdo/ dans la passerelle).
import { toast } from './ui.js';
import { S } from './state.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch('api/' + url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'Pas de réseau.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Erreur.');
  return data;
}

export const get = (u) => api('GET', u);

// Photo : reduite dans le navigateur (1200 px max, JPEG) avant l'envoi, pour aller vite
// meme en 4G et ne pas remplir le serveur. Renvoie le chemin de la photo (photos/....jpg).
export async function uploadPhoto(file) {
  const bitmap = await createImageBitmap(file).catch(() => { throw new ApiError(415, 'Image illisible : choisis une photo JPEG ou PNG.'); });
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; // fond blanc pour les PNG transparents
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
  let res;
  try {
    res = await fetch('api/photos', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob, credentials: 'same-origin' });
  } catch { throw new ApiError(0, 'Pas de réseau.'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'Erreur.');
  return data.url;
}
export const post = (u, b) => api('POST', u, b);
export const patch = (u, b) => api('PATCH', u, b);
export const put = (u, b) => api('PUT', u, b);
export const del = (u, b) => api('DELETE', u, b);

// Action avec message d'erreur : renvoie le resultat (true si vide), ou null en cas d'echec.
export async function attempt(fn) {
  try {
    const r = await fn();
    return r == null ? true : r;
  } catch (e) {
    // 401 d'une personne connectee = session expiree ; sinon (mot de passe faux) : simple message.
    if (e.status === 401 && S.me) { location.href = './'; return null; }
    toast(e.message, true);
    return null;
  }
}
