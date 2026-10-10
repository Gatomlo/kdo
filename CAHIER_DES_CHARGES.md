# La Hotte — Cahier des charges (v0.4)

Outil **privé et familial** de listes de souhaits, d'événements et de Secret Santa.
Pas de vocation grand public, pas de modèle économique. Interface en français.

---

## 1. Objectif

Permettre aux membres d'une famille de :
- publier leurs listes de souhaits (classées par catégories) ;
- réserver / acheter les cadeaux des autres **sans que le destinataire le sache** ;
- organiser des **événements** (Noël, anniversaire…) regroupant plusieurs personnes, avec **tirage au sort Secret Santa** caché.

## 2. Le cercle familial

- L'application héberge **un cercle familial** (une famille = une instance).
- Chaque membre a un **compte** : connexion par **e-mail + mot de passe** (le serveur de prod n'envoie pas d'e-mails, comme pour Le Cabas) ; lien de connexion par e-mail en option si un SMTP est configuré.
- Un **administrateur du cercle** invite les membres par un **lien d'invitation** à transmettre (envoyé par e-mail si possible).
- **Profils sans compte** (enfants, personnes âgées sans e-mail) : créés par un adulte qui en devient automatiquement **gestionnaire**.
- **Tableau de bord** : toutes les listes de la famille, les événements à venir, mes réservations, mon Secret Santa.
- Lien de partage externe (personne hors cercle, ex. parrain) : **optionnel**, désactivé par défaut ; l'invité externe s'identifie par prénom (+ e-mail facultatif).

## 3. Rôles sur une liste

| Rôle | Modifie les articles | Voit les réservations | Gère les réservations |
|---|---|---|---|
| **Propriétaire** (destinataire) | ✅ | ❌ jamais | ❌ |
| **Co-propriétaire** (liste de couple, naissance…) | ✅ | ❌ jamais | ❌ |
| **Gestionnaire** (personne de confiance, parent d'un enfant) | ✅ | ✅ | ✅ annuler, réattribuer, marquer acheté |
| **Membre du cercle / invité** | ❌ | ✅ | ses propres réservations |

- Une liste peut avoir un propriétaire **sans compte** (enfant) : elle est alors entièrement pilotée par son/ses gestionnaire(s).
- Le gestionnaire ne peut pas être le propriétaire ni un co-propriétaire.

## 4. Fonctionnalités

### 4.1 Listes, catégories, articles
- Plusieurs listes par personne : titre, occasion, date, couverture, message d'accueil, rattachement facultatif à un événement.
- **Catégories par liste**, nommées librement, réordonnables (ex. Livres, Jeux, Vêtements, Maison, Expériences).
- Article : nom, catégorie, lien(s) marchand(s), prix indicatif, photo, description/taille/couleur, priorité (★ à ★★★), quantité souhaitée.
- Pré-remplissage depuis une URL (Open Graph : titre, image, prix) quand possible.
- Tri par glisser-déposer, filtres par catégorie / priorité / disponibilité.
- Archivage de la liste après l'événement.

### 4.2 Réservations
- Statuts : **Disponible → Réservé → Acheté**.
- Quantités multiples (« 2 sur 6 »).
- **Participation commune** : plusieurs participants sur un cadeau, montant par personne, jauge de financement, un « porteur » désigné qui achète.
- **Fil de discussion** entre offrants par article, invisible au propriétaire.
- **Cadeau hors liste** : « J'offre autre chose » (visible des offrants), pour éviter les doublons.

### 4.3 Événements
- Un événement (ex. *Noël 2026 chez Mamy*) : date, lieu, participants (membres du cercle et profils sans compte), budget indicatif.
- Chaque participant peut y rattacher sa liste ; la page de l'événement les regroupe.
- Vue « qui a déjà de quoi » : pour chaque destinataire, nombre de cadeaux réservés (jamais visible par le destinataire lui-même).

### 4.4 Secret Santa (option d'un événement)
- L'organisateur active le Secret Santa, fixe un **budget** et une **date limite**.
- **Exclusions** : couples, frères et sœurs, ou « pas la même personne que l'an dernier » (historique des tirages précédents).
- **Tirage au sort côté serveur** : chaque participant reçoit une autre personne, jamais lui-même, en respectant les exclusions (permutation aléatoire avec contraintes, nouvel essai si impossible, message clair si les exclusions rendent le tirage infaisable).
- **Secret total** : chaque participant ne voit **que sa propre cible** (dévoilement par un geste « ouvrir l'enveloppe »). L'organisateur **ne voit pas** les attributions, seulement qui a ouvert son enveloppe.
- Un enfant sans compte participe via son gestionnaire, qui voit la cible de l'enfant.
- **Messages anonymes** : le donateur peut poser une question à sa cible (« ta pointure ? ») sans être identifié ; la cible répond.
- Relance du tirage possible tant qu'aucune enveloppe n'est ouverte ; ensuite seulement par décision explicite de l'organisateur (tous les participants sont prévenus).
- Le donateur voit directement la liste de sa cible pour l'événement.

### 4.5 Notifications (e-mail)
- Invitation au cercle, à une liste, à un événement.
- Article réservé modifié ou supprimé → prévenir les offrants concernés et le gestionnaire (jamais le propriétaire).
- Tirage Secret Santa effectué → « ton enveloppe t'attend ».
- Rappel J-7 avant l'événement aux réservations non marquées « acheté ».

### 4.6 Règles anti-spoiler (non négociables)
1. Le serveur **ne transmet jamais** les données de réservation au propriétaire ni aux co-propriétaires (filtrage côté API, pas seulement dans l'interface).
2. Les attributions Secret Santa ne sont transmises qu'au donateur concerné (et à son gestionnaire s'il n'a pas de compte).
3. Le propriétaire qui consulte sa propre liste voit toujours la vue propriétaire, quel que soit le chemin d'accès.
4. Les notifications et compteurs (tableau de bord, événement) excluent les informations sur ses propres cadeaux.
5. Bandeau rappel sur les vues offrant : « Ne montre pas cet écran à … ».

### 4.7 Confort
- Mobile d'abord, installable (PWA).
- Mode sombre.
- Export/sauvegarde des données du cercle.

## 5. Choix techniques (v0.4 : alignés sur Le Cabas et MyLittleLibraryV2)

| Couche | Choix |
|---|---|
| Application | **Express 4** (Node ≥ 22.5), `server.js` exporte l'app : front + API dans un seul service |
| Interface | SPA en **modules ES sans framework ni build**, navigation par `#/…`, CSP stricte |
| Base de données | **SQLite via `node:sqlite`** (aucun module natif), migrations par `PRAGMA user_version` |
| Auth | E-mail + mot de passe (scrypt), invitations et réinitialisations par lien, session 90 j (cookie httpOnly limité à `/hotte/`) |
| E-mails | nodemailer, **facultatifs** (SMTP ou sendmail) : notifications ignorées si non configurés |
| Déploiement | Monté dans **node-gateway** sur `/hotte` (Infomaniak : une seule app Node par hébergement) |
| Sauvegarde | `node scripts/backup.js` (copie quotidienne de la base) |

### Modèle de données (simplifié)
- `Member` : id, nom, e-mail (nullable = profil sans compte), avatar, is_admin
- `List` : id, owner_id, titre, occasion, date, event_id?, share_token?, archived
- `ListRole` : list_id, member_id, role (`co_owner` | `manager`)
- `Category` : id, list_id, nom, position
- `Item` : id, list_id, category_id, titre, url, prix, image, priorité, quantité, position
- `Reservation` : id, item_id, giver_id, quantité, statut, montant (participation), is_carrier
- `Comment` : id, item_id, author_id, texte
- `OffListGift` : id, list_id, giver_id, description
- `Event` : id, titre, date, lieu, budget, organizer_id
- `EventParticipant` : event_id, member_id
- `SecretSantaDraw` : id, event_id, budget, deadline, status, created_at
- `SecretSantaExclusion` : draw_id, member_a, member_b
- `SecretSantaPair` : draw_id, giver_id, receiver_id, opened_at
- `SecretSantaMessage` : pair_id, direction (giver→receiver / reply), texte

Règle clé : toute requête de lecture de `Reservation`, `Comment`, `OffListGift` filtre les listes dont le demandeur est propriétaire/co-propriétaire ; toute lecture de `SecretSantaPair` est limitée au `giver_id` du demandeur (ou d'un profil qu'il gère).

## 6. Étapes

1. **Socle** — cercle, comptes (lien magique), profils sans compte, listes, catégories, articles, réservations simples, anti-spoiler, déploiement node-gateway.
2. **Gestion** — rôles co-propriétaire / gestionnaire, quantités, notifications e-mail.
3. **Événements & Secret Santa** — événements, tirage avec exclusions, enveloppes, messages anonymes.
4. **Collaboration** — participation commune, discussions, cadeaux hors liste, rappels.
5. **Confort** — PWA, pré-remplissage URL, archivage, export, lien externe.

## 7. Points ouverts

- Nom définitif de l'application (adresse : `/hotte` sur le domaine de la passerelle, pas de sous-domaine).
- Lien de partage externe (hors cercle) : utile ou non ? (non codé)
- E-mails : aucun envoi en prod aujourd'hui ; un SMTP activerait le lien de connexion et les notifications (§4.5).
