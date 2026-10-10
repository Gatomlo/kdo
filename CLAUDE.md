# La Hotte (listes-cadeaux)

## Objectif
Outil familial privé : listes de souhaits par catégories, réservation des cadeaux cachée au destinataire, événements familiaux avec tirage Secret Santa secret. Spécifications : `CAHIER_DES_CHARGES.md`. Maquette d'origine : `maquette/index.html`.

## État (au 2026-10-10)
Étapes 1 à 4 du cahier codées, et l'essentiel de la 5 (PWA, pré-remplissage par URL, archivage, export filtré, mode sombre). Non fait : lien de partage externe (point ouvert §7), envoi de photos (photo = lien d'image). Pas encore déployé.

## Stack
Même socle que Le Cabas (`../listes-courses`, s'en inspirer) et MyLittleLibraryV2 : Node ≥ 22.5, Express 4, `node:sqlite` (base unique `data/hotte.db`), nodemailer. Front : SPA en modules ES sans framework ni build (`public/app/`), navigation par `#/…`, CSP stricte.

## Fichiers clés
- `server.js` : exporte `app` (listen seulement si lancé directement), page `index.html` avec `{{ROOT}}` → `<base href>`, API sur `/api`.
- `lib/db.js` : connexion, `tx` (imbriquable), `inList` (ids entiers pour `IN`), `MIGRATIONS` (`PRAGMA user_version` ; ne jamais modifier une entrée déployée).
- `lib/access.js` : **rôles et anti-spoiler** (`roleOn`, `listAccess`, `requireGiver`, `actorIds`, `hiddenListIds`). `lib/lists.js` (listes, articles, réservations, participations, discussions, hors liste, `view` = vue filtrée). `lib/events.js` (événements, Secret Santa, enveloppes, messages). `lib/santa.js` (tirage pur, testé). `lib/circle.js` (membres, profils, invitations). `lib/auth.js` (copié du Cabas). `lib/notify.js`, `lib/mailer.js`, `lib/preview.js` (Open Graph, garde-fou SSRF), `lib/exporter.js`, `lib/api.js` (toutes les routes).
- `public/app/` : `main.js` (cadre, routeur), `router.js` (`define(pattern, {load, view})`), `ui.js`, `api.js`, `state.js`, un fichier par domaine (`accueil`, `listes`, `evenements`, `cercle`, `connexion`, `install`), `cards.js`.

## Règles non évidentes
- **Anti-spoiler côté serveur** : `listAccess` teste propriétaire puis co-propriétaire avant gestionnaire (règle 3). `view()` ne charge réservations, commentaires et hors-liste que si `canSeeGifts`. Compteurs (`summaries`, « qui a déjà de quoi », export) passent par `hiddenListIds`. Personne ne change son propre rôle sur une liste.
- **Gestionnaire** : rôle explicite `list_roles` ou gestionnaire du profil sans compte propriétaire. Il voit/gère les réservations (annuler, réattribuer, acheté) et modifie les articles. `actorIds` = soi + profils gérés (on peut réserver « de la part de Léon »).
- **Secret Santa** : `ss_pairs.receiver_id` n'est lu que pour le donateur (ou gestionnaire d'un donateur sans compte) et seulement si l'enveloppe est ouverte. L'organisateur voit `opened_at` seul. Côté cible : messages sans rien sur le donateur. Exclusions automatiques : profil → ses gestionnaires. Nouveau tirage après une ouverture : `force` + participants prévenus.
- Cadeau commun : `reservations.amount` non nul ; quantité forcée à 1 ; premier participant = porteur ; « acheté » par le porteur ou un gestionnaire marque toutes les parts.
- **Pas d'e-mail en prod** (comme Le Cabas) : connexion par mot de passe, invitations et réinitialisations par **liens à copier**. Si `SMTP_HOST`/`HOTTE_MAIL` sont définis : lien de connexion par e-mail et notifications (§4.5), sinon ignorées.
- Rappels J-7 : vérifiés au fil des requêtes (au plus 1×/h), **pas de `setInterval`** (processus partagé de la passerelle).
- CSP : aucun script ni `onclick` en ligne → `data-a` / `data-f` / `data-ch` traités par délégation (`ui.js`). Texte affiché : toujours `esc()`. Liens d'articles : http(s) seulement (`webUrl`).
- Prix en centimes. Dates `AAAA-MM-JJ`.

## Commandes
- `npm test` (API sur base temporaire, e-mails en mémoire) — à lancer après chaque modification.
- `node scripts/demo.js` : instance jetable sur `http://localhost:3100/` avec une famille fictive (comptes et mot de passe affichés). Config de preview : `.claude/launch.json` (`hotte-demo`). Ne jamais essayer sur `data/`.
- `npm run set-password -- <email> <mdp>` (secours) · `node scripts/backup.js` (copie datée de la base dans `data/backups/`, 30 gardées).

## Déploiement (Infomaniak, via node-gateway)
Dossier `apps/hotte` de la passerelle → servi sur `/hotte` (local : jonction `node-gateway/apps/hotte` → ce dossier). Envoyer `server.js`, `package.json`, `package-lock.json`, `lib/`, `public/`, `scripts/` (jamais `data/`), `npm install --omit=dev`, redémarrer. Variable recommandée : `HOTTE_PUBLIC_URL` (ex. `https://<domaine>/hotte`, adresse des liens d'invitation). Migrations automatiques au démarrage. Sauvegarde : tâche planifiée `node scripts/backup.js`.

## Méthode de travail
Réponses en français, concises. Tester par l'API (`npm test`) avant l'interface. Commit après chaque fonctionnalité validée.
