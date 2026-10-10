# La Hotte (listes-cadeaux)

## Objectif
Outil familial privé : listes de souhaits par catégories, réservation des cadeaux cachée au destinataire, événements familiaux avec tirage Secret Santa secret. Spécifications : `CAHIER_DES_CHARGES.md`. Maquette d'origine : `maquette/index.html`.

## État (au 2026-10-10)
Étapes 1 à 5 du cahier codées, plus §4.8 (idées secrètes, notifications push, anniversaires automatiques, reçu/report, budget et historique, duplication) et §4.9 (partage vers l'app, fiches tailles, recherche, Secret Santa : 3 idées et duos dévoilés, journal admin, texte agrandi / vue simplifiée, interface compacte). Pas encore déployé.

## Stack
Même socle que Le Cabas (`../listes-courses`, s'en inspirer) et MyLittleLibraryV2 : Node ≥ 22.5, Express 4, `node:sqlite` (base unique `data/hotte.db`), nodemailer, web-push (JS pur). Front : SPA en modules ES sans framework ni build (`public/app/`), navigation par `#/…`, CSP stricte.

## Fichiers clés
- `server.js` : exporte `app` (listen seulement si lancé directement), page `index.html` avec `{{ROOT}}` → `<base href>`, API sur `/api`.
- `lib/db.js` : connexion, `tx` (imbriquable), `inList` (ids entiers pour `IN`), `MIGRATIONS` (`PRAGMA user_version` ; ne jamais modifier une entrée déployée).
- `lib/access.js` : **rôles et anti-spoiler** (`roleOn`, `listAccess`, `requireGiver`, `actorIds`, `hiddenListIds`). `lib/lists.js` (listes, articles, réservations, participations, discussions, hors liste, `view` = vue filtrée). `lib/events.js` (événements, Secret Santa, enveloppes, messages). `lib/santa.js` (tirage pur, testé). `lib/circle.js` (membres, profils, invitations). `lib/auth.js` (copié du Cabas). `lib/notify.js`, `lib/mailer.js`, `lib/preview.js` (Open Graph, garde-fou SSRF), `lib/exporter.js`, `lib/share.js` (lien de partage, mot de passe, invités, `guestAllowed`), `lib/photos.js` (dépôt, vérification du type, nettoyage), `lib/push.js` (Web Push, clés VAPID en base), `lib/ideas.js` (idées secrètes), `lib/birthdays.js` (anniversaires automatiques), `lib/gifts.js` (historique, budget), `lib/fiches.js` (tailles et préférences), `lib/search.js`, `lib/activity.js` (journal admin, jamais de contenu de cadeau), `lib/api.js` (toutes les routes).
- `public/app/` : `main.js` (cadre, routeur), `router.js` (`define(pattern, {load, view})`), `ui.js`, `api.js`, `state.js`, un fichier par domaine (`accueil`, `listes`, `evenements`, `cercle` (+ Mon compte, réglages, anniversaire, push), `idees`, `cadeaux`, `recherche` (+ fiche), `journal`, `connexion`, `install`), `cards.js`. Cadre (`main.js`) : une vue peut déclarer `settings` (roue dans l'en-tête), `fab` (bouton d'ajout flottant), `right`. `public/sw.js` : cache + réception des notifications (changer `VERSION` quand les fichiers changent).

## Règles non évidentes
- **Anti-spoiler côté serveur** : `listAccess` teste propriétaire puis co-propriétaire avant gestionnaire (règle 3). `view()` ne charge réservations, commentaires et hors-liste que si `canSeeGifts`. Compteurs (`summaries`, « qui a déjà de quoi », export) passent par `hiddenListIds`. Personne ne change son propre rôle sur une liste.
- **Gestionnaire** : rôle explicite `list_roles` ou gestionnaire du profil sans compte propriétaire. Il voit/gère les réservations (annuler, réattribuer, acheté) et modifie les articles. `actorIds` = soi + profils gérés (on peut réserver « de la part de Léon »).
- **Secret Santa** : `ss_pairs.receiver_id` n'est lu que pour le donateur (ou gestionnaire d'un donateur sans compte) et seulement si l'enveloppe est ouverte. L'organisateur voit `opened_at` seul. Côté cible : messages sans rien sur le donateur. Exclusions automatiques : profil → ses gestionnaires. Nouveau tirage après une ouverture : `force` + participants prévenus.
- Cadeau commun : `reservations.amount` non nul ; quantité forcée à 1 ; premier participant = porteur ; « acheté » par le porteur ou un gestionnaire marque toutes les parts.
- **Pas d'e-mail en prod** (comme Le Cabas) : connexion par mot de passe, invitations et réinitialisations par **liens à copier**. Si `SMTP_HOST`/`HOTTE_MAIL` sont définis : lien de connexion par e-mail et notifications (§4.5), sinon ignorées.
- Rappels J-7 : vérifiés au fil des requêtes (au plus 1×/h), **pas de `setInterval`** (processus partagé de la passerelle).
- CSP : aucun script ni `onclick` en ligne → `data-a` / `data-f` / `data-ch` traités par délégation (`ui.js`). Texte affiché : toujours `esc()`. Liens d'articles : http(s) seulement (`webUrl`).
- **Invités hors cercle** : `members.guest_list_id` (+ `guest_email` facultatif), sans compte. Session valable tant que `lists.share_token` existe ; route permise seulement si `share.guestAllowed` (sa liste, actions d'offrant). Même prénom = même invité. Mot de passe de liste (`share_password_hash`) : le changer supprime les sessions des invités. Exclus partout ailleurs (`guest_list_id IS NULL` : cercle, événements, rôles, réattribution).
- **Photos** : réduites par le navigateur (1200 px, JPEG), `POST /api/photos` en binaire (seule exception à `jsonOnly`), type vérifié par les octets, `data/photos/<32 hex>.jpg` servi sans connexion sur `/photos/…` ; `items.image` = `photos/…` ou lien http(s). Fichier non référencé depuis 24 h supprimé à chaque dépôt.
- **Réglages** (table `meta` : `getSetting`/`setSetting`) : `smtp` et `public_url`, saisis par l'admin dans l'app (#/reglages). Priorité : variable d'environnement > réglage > défaut. Mot de passe SMTP jamais renvoyé à l'interface.
- **Notifications** : `notify.deliver` envoie chaque message par e-mail (si configuré) ET push (`push.sendTo`). Abonnement par appareil (Mon compte) ; 404/410 = abonnement supprimé. `HOTTE_PUSH=log` en test.
- **Idées secrètes** (`ideas`) : jamais lisibles ni comptées par le destinataire ; « je m'en occupe » = `taken_by`.
- **Anniversaires** : `members.birth_date` (`0000-MM-JJ` si année inconnue) + `birthday_lead_days` **réglable par personne** (soi, gestionnaire du profil, admin ; NULL = pas d'automatique). `birthdays.run` (au fil des requêtes, ≤ 1×/h, et à l'enregistrement) crée liste + événement (toute la famille) une fois par an (`birthday_runs`).
- **Après la fête** : `items.received_at` (marqué par ceux qui modifient la liste) ; `carry` copie les non-reçus vers une liste du même destinataire puis archive ; `duplicate` copie catégories, articles et rôles.
- **Interface compacte** : article replié = une ligne (vignette, titre, ★ prix, point de statut, action rapide en icône) ; toucher = déplier (`S.q.open`). Boutons-icônes `.ib` avec `aria-label`/`title` et libellé `.lbl` visible seulement en vue simplifiée. En-tête de liste sur une ligne, infos derrière ℹ️ (`S.q.info`).
- **Affichage par appareil** (localStorage) : `hotte-big` (texte agrandi), `hotte-simple` (vue simplifiée : libellés visibles, sans discussion ni filtres). Invités : bouton « Aa ».
- **Partage vers l'app** : `manifest.json` `share_target` → `/?partage-url=…&titre=…&texte=…` → `#/ajouter` (choix de la liste) → fiche article pré-remplie (Android, app installée ; pas iPhone).
- Prix en centimes. Dates `AAAA-MM-JJ`.

## Commandes
- `npm test` (API sur base temporaire, e-mails en mémoire) — à lancer après chaque modification.
- `node scripts/demo.js` : instance jetable sur `http://localhost:3100/` avec une famille fictive (comptes et mot de passe affichés). Config de preview : `.claude/launch.json` (`hotte-demo`). Ne jamais essayer sur `data/`.
- `npm run set-password -- <email> <mdp>` (secours) · `node scripts/backup.js` (copie datée de la base dans `data/backups/`, 30 gardées).

## Déploiement (Infomaniak, via node-gateway)
Dossier `apps/hotte` de la passerelle → servi sur `/hotte` (local : jonction `node-gateway/apps/hotte` → ce dossier). Envoyer `server.js`, `package.json`, `package-lock.json`, `lib/`, `public/`, `scripts/` (jamais `data/`), `npm install --omit=dev`, redémarrer. Après la mise en ligne : Cercle → Réglages de l'app → adresse publique (`https://<domaine>/hotte`) et, si voulu, SMTP (bouton d'e-mail d'essai). Les photos sont dans `data/photos/` (à sauvegarder avec la base). Migrations automatiques au démarrage. Sauvegarde : tâche planifiée `node scripts/backup.js`.

## Méthode de travail
Réponses en français, concises. Tester par l'API (`npm test`) avant l'interface. Commit après chaque fonctionnalité validée.
