# Déploiement — SellWasl

> **Phase 30 — rédigé le 2026-10-15, réorganisé le 2026-10-16 en guide pas à pas.** Mise en ligne gratuite pour l'entreprise pilote (15 vendeurs, 15 livreurs, 1 magasinier, 1 comptable, 2 superviseurs). Images et CI : [ci-cd.md](ci-cd.md). Sécurité : [security.md](security.md). Notifications : [notifications.md](notifications.md).

**Comment suivre ce guide** : 18 étapes, en 4 séances d'environ une heure. Les faire **dans l'ordre** : chaque étape utilise une valeur obtenue avant. Cocher chaque case une fois faite. Chaque étape finit par **« Vérifier »** : ne pas passer à la suivante tant que la vérification échoue (voir l'annexe F, « En cas de problème »).

## Vue d'ensemble

```text
Téléphones (APK) ──────────────────────────────► API NestJS ─────► PostgreSQL
                                                 Render, Francfort   Supabase, Francfort
Navigateurs ──► Web Next.js ── /api/* ──────────►      │
                Vercel, fra1                            └──────────► Photos : Cloudinary

cron-job.org ── toutes les 10 min ──► /api/v1/health   (garde l'API et la base éveillées)
GitHub Actions ── chaque nuit ──► sauvegarde chiffrée de la base
```

| Service | Rôle | Offre | Limite à surveiller |
|---|---|---|---|
| Supabase | Base PostgreSQL | Free | 500 Mo ; projet mis en pause après 7 jours sans activité (évité par l'étape 9) |
| Render | API (image Docker de `apps/api`) | Free | 512 Mo de RAM, 0,1 CPU, 750 h/mois : **un seul** service allumé en continu ; disque effacé à chaque redémarrage |
| Vercel | Web (`apps/web`) | Hobby | Usage non commercial ; quotas partagés par tout le compte |
| Cloudinary | Photos des produits | Free | Crédits mensuels |
| cron-job.org | Réveil de l'API | Gratuit | — |
| GitHub Actions | Sauvegarde de nuit | Gratuit (dépôt public) | Tâches suspendues après 60 jours sans commit |
| Expo (EAS) | Compilation de l'APK | Free | Nombre de compilations par mois |

Coût : 0 €. À prévoir quand l'entreprise paiera : annexe E.

---

## Séance 1 — Préparer (rien n'est mis en ligne)

### Étape 1 — Gestionnaire de mots de passe

- [ ] Installer un gestionnaire de mots de passe (Bitwarden : gratuit, sur PC et téléphone).
- [ ] Y créer une note « SellWasl — production » : toutes les valeurs de ce guide y seront rangées. Liste complète :

| Nom | Obtenue à l'étape |
|---|---|
| `JWT_ACCESS_SECRET` | 2 |
| `DATA_ENCRYPTION_KEY` | 2 |
| `WEB_PROXY_SECRET` | 2 |
| `BACKUP_PASSPHRASE` (phrase secrète des sauvegardes) | 2 |
| Mot de passe du Super Admin | 2 |
| Mot de passe de la base Supabase | 5 |
| `DATABASE_URL` (adresse Supabase) | 5 |
| `CLOUDINARY_URL` | 7 |
| Adresse de l'API (`https://….onrender.com`) | 8 |
| Adresse du Web (`https://….vercel.app`) | 10 |
| Clé de secours de la double authentification | 12 |

**Ne jamais** écrire ces valeurs dans le dépôt (il est public), dans un fichier du projet ni dans une capture d'écran partagée.

**Vérifier** : la note existe, elle est vide pour l'instant.

### Étape 2 — Générer les secrets

- [ ] Dans VS Code, ouvrir un terminal (**Terminal → Nouveau terminal**) et lancer, une ligne à la fois :

  ```powershell
  node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

- [ ] Ranger le premier résultat sous `JWT_ACCESS_SECRET`, le deuxième sous `DATA_ENCRYPTION_KEY`, le troisième sous `WEB_PROXY_SECRET`.
- [ ] Choisir une **phrase secrète des sauvegardes** : 5 mots ou plus, sans rapport avec vous (ex. « tapis orange quatre nuage boulon »). La ranger sous `BACKUP_PASSPHRASE`.
- [ ] Choisir le **mot de passe du Super Admin** : 12 caractères ou plus, avec lettres et chiffres. Le ranger.

À savoir : perdre `DATA_ENCRYPTION_KEY` rend illisibles les doubles authentifications enregistrées ; perdre `BACKUP_PASSPHRASE` rend les sauvegardes illisibles. **Il n'y a pas de récupération possible.**

**Vérifier** : cinq valeurs rangées.

### Étape 3 — Créer les comptes

Créer chaque compte avec la même adresse e-mail (de préférence « Continuer avec GitHub » quand c'est proposé : la connexion au dépôt sera plus simple).

- [ ] **Supabase** — <https://supabase.com> → *Start your project*.
- [ ] **Render** — <https://render.com> → *Get Started* (avec GitHub).
- [ ] **Vercel** — <https://vercel.com/signup> → offre **Hobby**, avec GitHub. **Compte séparé de vos autres projets** (caba-store…) : quotas et règle « non commercial » s'appliquent à tout le compte ; une autre adresse e-mail si besoin.
- [ ] **Cloudinary** — <https://cloudinary.com/users/register_free>.
- [ ] **cron-job.org** — <https://console.cron-job.org/signup>.
- [ ] **Expo** — <https://expo.dev/signup> (pour compiler l'application Android ; déjà fait si vous avez déjà compilé l'APK).
- [ ] **Firebase** — <https://console.firebase.google.com> avec un compte Google (notifications Android, étape 16).

**Vérifier** : vous pouvez vous connecter à chacun des sept.

### Étape 4 — Relever votre adresse IP

L'espace Super Admin ne sera visible que depuis votre adresse (sécurité).

- [ ] Depuis le PC qui servira à administrer (même connexion internet), ouvrir <https://api.ipify.org> : noter l'adresse (ex. `105.98.12.34`).
- [ ] Ouvrir <https://api64.ipify.org> : si l'adresse est différente (avec des `:`), la noter aussi ; si c'est la même, vous n'avez pas d'IPv6.
- [ ] Composer la valeur `PLATFORM_ALLOWED_IPS` : les adresses séparées par une virgule, ex. `105.98.12.34, 2c0f:f8f0:abcd::1`.

Votre adresse change (redémarrage de la box, 4G) : annexe B.

**Vérifier** : la valeur `PLATFORM_ALLOWED_IPS` est notée.

---

## Séance 2 — La base de données et l'API

### Étape 5 — Supabase : créer la base

- [ ] **New project** :
  - *Name* : `sellwasl` ;
  - *Database Password* : cliquer *Generate a password*, le **copier et le ranger** (« Mot de passe de la base Supabase ») ;
  - *Region* : **Central EU (Frankfurt)** ;
  - *Plan* : Free → *Create new project* (2 minutes).
- [ ] **Désactiver la Data API** (obligatoire) : **Project Settings → Data API** → désactiver *Enable Data API* → enregistrer. Sinon, les tables seraient lisibles par l'API REST de Supabase.
- [ ] **Copier l'adresse de connexion** : bouton **Connect** (en haut) → onglet *Connection String* → *Method* : **Session pooler** (port **5432**) → copier l'adresse.
- [ ] Dans l'adresse, remplacer `[YOUR-PASSWORD]` par le mot de passe de la base (sans les crochets). La ranger sous `DATABASE_URL`. Elle ressemble à :
  `postgresql://postgres.abcdefgh:MOTDEPASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`

Ne pas prendre « Direct connection » : elle n'existe qu'en IPv6, que Render et GitHub ne savent pas joindre.

**Vérifier** : Data API désactivée ; `DATABASE_URL` rangée, sans `[YOUR-PASSWORD]`.

### Étape 6 — Tester la connexion et créer les tables

- [ ] Ouvrir **un nouveau terminal** VS Code, à la racine du dépôt, et lancer (remplacer l'adresse) :

  ```powershell
  $env:DATABASE_URL = "postgresql://postgres.abcdefgh:MOTDEPASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
  pnpm --filter @sellwasl/api prisma:deploy
  ```

- [ ] Attendre le message **« All migrations have been successfully applied »** (17 migrations au 2026-10-16).
- [ ] **Fermer ce terminal** (icône corbeille) : il pointe sur la base de production. Ne jamais y lancer `pnpm db:seed` ni `pnpm db:reset` (`db:reset` efface tout).

**Vérifier** : Supabase → **Table Editor** montre les tables (`company`, `customer`, `permission`…).

### Étape 7 — Cloudinary : stockage des photos

- [ ] Tableau de bord Cloudinary → **Settings** (roue dentée) → **API Keys** (ou *Product environment*) → copier **API environment variable** : `cloudinary://<clé>:<secret>@<nom>`.
- [ ] La ranger sous `CLOUDINARY_URL`.

Obligatoire : sans elle, les photos des produits seraient écrites sur le disque de Render, effacé à chaque redémarrage.

**Vérifier** : la valeur commence par `cloudinary://`.

### Étape 8 — Render : mettre l'API en ligne

- [ ] Vérifier d'abord que la CI de `main` est **verte** : GitHub → dépôt → **Actions** → dernière exécution « CI » sur `main`.
- [ ] Render → **New + → Web Service** → *Git Provider* : GitHub → autoriser Render → choisir le dépôt `SellWasl`.
- [ ] Remplir :

| Champ | Valeur |
|---|---|
| Name | `sellwasl-api` (donne l'adresse `https://sellwasl-api.onrender.com`, ou proche) |
| Language | **Docker** |
| Branch | `main` |
| Region | **Frankfurt (EU Central)** |
| Root Directory | laisser vide |
| Instance Type | **Free** |

- [ ] **Advanced** :

| Champ | Valeur |
|---|---|
| Dockerfile Path | `apps/api/Dockerfile` |
| Docker Build Context Directory | `.` |
| Health Check Path | `/api/v1/health` |
| Auto-Deploy | **After CI Checks Pass** |

- [ ] **Environment Variables** → *Add Environment Variable*, une par ligne :

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `DATABASE_URL` | étape 5 |
| `JWT_ACCESS_SECRET` | étape 2 |
| `DATA_ENCRYPTION_KEY` | étape 2 |
| `WEB_PROXY_SECRET` | étape 2 |
| `CLOUDINARY_URL` | étape 7 |
| `PLATFORM_ALLOWED_IPS` | étape 4 |
| `TRUST_PROXY` | `1` |

- [ ] **Create Web Service**. La première compilation prend 10 à 15 minutes (onglet **Logs**). Les migrations s'appliquent seules à chaque démarrage.
- [ ] Ranger l'adresse affichée en haut (`https://sellwasl-api.onrender.com`) sous « Adresse de l'API ».

**Vérifier** : ouvrir `https://<adresse de l'API>/api/v1/health` dans le navigateur → `{"status":"ok","database":"ok",…}`.

### Étape 9 — cron-job.org : garder l'API éveillée

Render Free s'endort après 15 minutes sans requête : les tâches de nuit (paie, purge des positions) et l'envoi des notifications s'arrêteraient, et Supabase se mettrait en pause.

- [ ] cron-job.org → **Create cronjob** :
  - *Title* : `SellWasl API` ;
  - *URL* : `https://<adresse de l'API>/api/v1/health` ;
  - *Execution schedule* : **Every 10 minutes** ;
  - *Notifications* : cocher l'envoi d'un e-mail **en cas d'échec** ;
  - *Create*.

**Vérifier** : après 10 minutes, l'historique de la tâche montre une exécution réussie (code 200).

---

## Séance 3 — Le Web, le Super Admin et les vérifications

### Étape 10 — Vercel : mettre le Web en ligne

- [ ] Vercel → **Add New… → Project** → importer le dépôt `SellWasl` (autoriser l'accès GitHub si demandé).
- [ ] **Root Directory** → *Edit* → `apps/web`. *Framework Preset* : Next.js (détecté seul).
- [ ] **Environment Variables**, une par ligne :

| Key | Value |
|---|---|
| `API_URL` | adresse de l'API, **sans** `/api` à la fin (ex. `https://sellwasl-api.onrender.com`) |
| `NEXT_PUBLIC_MAPTILER_KEY` | votre clé MapTiler (celle du fichier `apps/web/.env`) |
| `TRUST_PROXY` | `1` |
| `WEB_PROXY_SECRET` | **la même** qu'à l'étape 8 |
| `PLATFORM_ALLOWED_IPS` | **la même** qu'à l'étape 8 |

- [ ] **Deploy** (3 à 5 minutes). Ranger l'adresse (`https://….vercel.app`) sous « Adresse du Web ».
- [ ] **Settings → Functions → Function Region** : **Frankfurt, Germany (fra1)** → *Save*.
- [ ] **Settings → Git → Ignored Build Step** → *Custom* → commande :
  `git diff --quiet HEAD^ HEAD -- . ../../packages ../../pnpm-lock.yaml` → *Save* (pas de nouveau déploiement quand seuls l'API ou le mobile changent).
- [ ] MapTiler (<https://cloud.maptiler.com/account/keys>) : si votre clé est limitée à certains domaines, ajouter l'adresse du Web.
- [ ] **Deployments → … → Redeploy** (la région et les réglages s'appliquent au déploiement suivant).

**Vérifier** : l'adresse du Web affiche la page de connexion ; une connexion avec un mauvais mot de passe affiche un message d'erreur (preuve que le Web joint l'API).

### Étape 11 — Créer le Super Admin

- [ ] Ouvrir **un nouveau terminal** VS Code, à la racine du dépôt :

  ```powershell
  $env:DATABASE_URL = "<DATABASE_URL de l'étape 5>"
  pnpm --filter @sellwasl/api platform:bootstrap vous@exemple.com "Votre Nom"
  ```

- [ ] Saisir le mot de passe du Super Admin (étape 2) deux fois : **rien ne s'affiche pendant la frappe**, c'est normal ; coller avec clic droit fonctionne.
- [ ] Le script affiche `✔ 81 permissions à jour.` puis `✔ Super Admin créé`.
- [ ] **Fermer ce terminal.**

Il n'y a pas d'écran pour changer ce mot de passe : il doit rester dans le gestionnaire. Relancer la commande ne modifie jamais un compte existant.

**Vérifier** : les deux lignes `✔`.

### Étape 12 — Première connexion du Super Admin

- [ ] Sur le téléphone, installer **Google Authenticator**, **Microsoft Authenticator** ou **2FAS**.
- [ ] Sur le PC (réseau de l'étape 4), ouvrir `https://<adresse du Web>/admin/login` ; e-mail et mot de passe.
- [ ] Un **QR code** s'affiche. Dans l'application du téléphone : **+ → Scanner un QR code** → viser l'écran. « SellWasl » apparaît avec un code à 6 chiffres qui change toutes les 30 secondes.
- [ ] **Avant de continuer**, copier la **clé** affichée sous le QR code dans le gestionnaire (« Clé de secours de la double authentification ») : elle permet de réinscrire un nouveau téléphone.
- [ ] Saisir le code à 6 chiffres.

Ensuite, chaque connexion demande : e-mail, mot de passe, code du moment. Téléphone perdu : annexe B.

**Vérifier** : l'espace Super Admin s'ouvre. Si `/admin/login` affiche « Page introuvable » : votre adresse n'est pas dans `PLATFORM_ALLOWED_IPS` (annexe B).

### Étape 13 — Vérifier l'adresse IP vue par l'API

L'adresse sert à la liste de l'étape 4, à la limite de tentatives de connexion et au journal d'audit. Le Web transmet lui-même l'adresse du visiteur (avec `WEB_PROXY_SECRET`) ; pour le mobile, c'est `TRUST_PROXY` qui compte, à mesurer une fois.

- [ ] Sur un téléphone **en 4G** (Wi-Fi coupé), ouvrir <https://api.ipify.org> : noter l'adresse.
- [ ] Sur ce même téléphone, ouvrir `https://<adresse de l'API>/api/v1/health/ip` : `ip` doit être **la même adresse**.
  - Autre adresse : Render → **Environment** → `TRUST_PROXY` = `2` → *Save* (redémarrage seul, 2 minutes) → recommencer.
- [ ] Essai d'usurpation, sur le PC (PowerShell) :

  ```powershell
  curl.exe -H "X-Forwarded-For: 198.51.100.7" https://<adresse de l'API>/api/v1/health/ip
  curl.exe -H "X-Sellwasl-Client-Ip: 198.51.100.7" -H "X-Sellwasl-Proxy-Key: inventee" https://<adresse de l'API>/api/v1/health/ip
  ```

  `ip` ne doit **jamais** valoir `198.51.100.7`. Si c'est le cas : `TRUST_PROXY` est trop haut, le baisser d'un, et recommencer cette étape.

La vérification côté Web (journal d'audit) se fait à l'étape 15, une fois l'entreprise créée.

**Vérifier** : bonne adresse en 4G, et jamais `198.51.100.7`.

### Étape 14 — Activer la sauvegarde de nuit

Chaque nuit à 2 h 30, GitHub copie la base, la **restaure dans une base vide** pour vérifier qu'elle se relit, la **chiffre** (le dépôt est public) et la garde **30 jours**.

- [ ] GitHub → dépôt `SellWasl` → **Settings → Secrets and variables → Actions → New repository secret** :
  - *Name* `PRODUCTION_DATABASE_URL`, *Secret* : `DATABASE_URL` de l'étape 5 → *Add secret* ;
  - *Name* `BACKUP_PASSPHRASE`, *Secret* : la phrase de l'étape 2 → *Add secret*.
- [ ] **Actions** → à gauche **Sauvegarde** → **Run workflow** → *Run workflow*.
- [ ] Attendre la fin (3 à 5 minutes) : coche **verte**. Ouvrir l'exécution : en bas, *Artifacts* contient `sauvegarde-<n°>` ; l'étape « Restauration d'essai » indique le nombre de tables.

GitHub vous écrit si une sauvegarde échoue. Restaurer une sauvegarde : annexe C.

**Vérifier** : exécution verte, avec un fichier dans *Artifacts*.

---

## Séance 4 — L'entreprise, le mobile, la répétition

### Étape 15 — Créer l'entreprise pilote

- [ ] Espace Super Admin → **Nouvelle entreprise** : nom, code (court, ex. `PILOTE`), mode de vente (prévente, cash van ou les deux), et son **administrateur** (prénom, nom, identifiant, e-mail). Noter le **mot de passe provisoire** affiché.
- [ ] Se déconnecter, puis se connecter sur `https://<adresse du Web>` avec le code de l'entreprise et le compte administrateur ; changer le mot de passe provisoire.
- [ ] Dans l'ordre :
  1. **Paramètres** de l'entreprise (règles P-01 à P-10, jours fériés, motifs, entrepôts) ;
  2. **Paramètres → Types de clients** ;
  3. **Utilisateurs** : 15 vendeurs, 15 livreurs, 1 magasinier, 1 comptable, 2 superviseurs (noter chaque mot de passe provisoire) ;
  4. **Produits → Importer** : télécharger le modèle, le remplir, l'importer ;
  5. **Clients → Importer** : idem ;
  6. **Secteurs** : dessiner les secteurs et leurs parties sur la carte, affecter vendeurs et livreurs ;
  7. **Planning** et fréquences de visite ;
  8. **Clients** → filtre « à revoir » : placer les clients restés « hors partie ».
- [ ] **Vérification Web de l'étape 13** : depuis le téléphone en 4G, se connecter au Web avec un compte de l'entreprise, puis (administrateur) **Audit** : la connexion montre l'adresse 4G du téléphone. Sinon : `WEB_PROXY_SECRET` différent entre Render et Vercel (le corriger, puis *Redeploy* sur Vercel).

**Vérifier** : les listes Utilisateurs, Produits, Clients et Secteurs sont remplies ; l'audit montre la bonne adresse.

### Étape 16 — L'application Android

- [ ] **Notifications** (une fois) : suivre [notifications.md](notifications.md) §5, points 2 et 3 (projet Firebase, `google-services.json`, clé FCM v1 envoyée à Expo).
- [ ] **Compte Expo** : `apps/mobile/app.json` contient `"owner": "sellwasl"`. Si votre compte Expo ne s'appelle pas `sellwasl`, remplacer par votre nom d'utilisateur Expo, puis lancer `cd apps/mobile; npx eas-cli@latest init`.
- [ ] **Adresse de l'API dans l'application** : dans [eas.json](../apps/mobile/eas.json), profil `preview`, ajouter :

  ```json
  "preview": {
    "distribution": "internal",
    "android": { "buildType": "apk" },
    "env": {
      "EXPO_PUBLIC_API_URL": "https://<adresse de l'API>",
      "EXPO_PUBLIC_MAPTILER_KEY": "<votre clé MapTiler>"
    }
  }
  ```

  Commiter et pousser ce changement.
- [ ] **Compiler** (20 à 30 minutes, dans les serveurs d'Expo) :

  ```powershell
  npm install -g eas-cli
  eas login
  cd apps/mobile
  eas build -p android --profile preview
  ```

  À la fin, un **lien** et un QR code de téléchargement de l'APK s'affichent.
- [ ] **Installer sur chaque téléphone** : ouvrir le lien → télécharger → autoriser « Installer des applications inconnues » pour le navigateur → installer.
- [ ] **Associer chaque téléphone** : sur le Web (administrateur ou superviseur), **Appareils** → l'utilisateur → **Associer un téléphone** : un QR code et un code (`ABCD-EFGH`) s'affichent. Sur le téléphone, ouvrir l'application → **Scanner le QR code** (ou saisir le code) → mot de passe de l'utilisateur → **Associer ce téléphone**.

Changer l'adresse de l'API demande une nouvelle compilation : elle est figée dans l'APK.

**Vérifier** : sur un téléphone associé, l'utilisateur se connecte et voit ses clients du jour.

### Étape 17 — Répétition générale

Avec des comptes de test, sur de vrais téléphones **en 4G**, une journée complète :

- [ ] Prévente : commande, préparation et chargement (magasinier), livraison, encaissement, impression Bluetooth (livreur)
- [ ] Cash van : chargement, vente, encaissement, impression
- [ ] Hors ligne : couper le réseau pendant une visite, le remettre, vérifier la synchronisation
- [ ] Comptable : dettes, récapitulatifs, versements
- [ ] Superviseur : carte du suivi, objectifs, exports CSV
- [ ] Notifications reçues sur Android
- [ ] Restauration d'une sauvegarde réussie (annexe C)

Puis supprimer les données de test (ou recréer l'entreprise).

**Vérifier** : toutes les cases cochées.

### Étape 18 — Le soir de la bascule

Après la dernière tournée dans l'ancien système, avant la première journée dans SellWasl :

- [ ] **Stock initial** : le magasinier fait l'**inventaire du dépôt** (Stock → Inventaires) ; camions vides.
- [ ] **Dettes des clients** : Comptabilité → **Soldes d'ouverture** → télécharger le modèle (`code;nom;dette`), le remplir depuis l'ancien système, l'importer ; ou saisir le solde sur la fiche du client. Un solde se corrige tant que le client n'a ni vente à crédit ni encaissement.
- [ ] Vérifier quelques clients au hasard : la dette affichée est celle de l'ancien système.

**Vérifier** : Comptabilité → Dettes et paiements montre le total des dettes attendu.

---

## Annexe A — Toutes les variables

| Variable | API (Render) | Web (Vercel) | Mobile (`eas.json`) |
|---|---|---|---|
| `NODE_ENV` | `production` | (posé par Vercel) | — |
| `PORT` | `3001` | — | — |
| `DATABASE_URL` | étape 5 | — | — |
| `JWT_ACCESS_SECRET` | étape 2 | — | — |
| `DATA_ENCRYPTION_KEY` | étape 2 | — | — |
| `WEB_PROXY_SECRET` | étape 2 | étape 2 (même valeur) | — |
| `CLOUDINARY_URL` | étape 7 | — | — |
| `PLATFORM_ALLOWED_IPS` | étape 4 | étape 4 (même valeur) | — |
| `TRUST_PROXY` | `1`, ou la valeur mesurée à l'étape 13 | `1` | — |
| `API_URL` | — | adresse de l'API | — |
| `NEXT_PUBLIC_MAPTILER_KEY` | — | clé MapTiler | — |
| `EXPO_PUBLIC_API_URL` | — | — | adresse de l'API |
| `EXPO_PUBLIC_MAPTILER_KEY` | — | — | clé MapTiler |
| `EXPO_ACCESS_TOKEN` | facultatif ([notifications.md](notifications.md) §5) | — | — |
| `SENTRY_DSN` | facultatif | facultatif | — |

Secrets GitHub (étape 14) : `PRODUCTION_DATABASE_URL`, `BACKUP_PASSPHRASE`.

En production, l'API refuse de démarrer sans `JWT_ACCESS_SECRET` et `DATA_ENCRYPTION_KEY` propres, et l'espace plateforme reste **fermé** sans `PLATFORM_ALLOWED_IPS`.

Une variable modifiée sur **Render** redémarre l'API seule ; sur **Vercel**, elle ne s'applique qu'après **Deployments → … → Redeploy**.

## Annexe B — Adresse IP changée, téléphone perdu

**Votre adresse a changé** (`/admin/login` affiche « Page introuvable ») :

1. Relever la nouvelle adresse (étape 4).
2. Render → service → **Environment** → `PLATFORM_ALLOWED_IPS` → nouvelle valeur → *Save*.
3. Vercel → projet → **Settings → Environment Variables** → `PLATFORM_ALLOWED_IPS` → *Edit* → *Save* → **Deployments → … → Redeploy**.

Pour moins de mises à jour, mettre la plage de votre fournisseur (ex. `105.98.0.0/16`) : moins strict, mais le mot de passe et la double authentification restent exigés.

**Téléphone du Super Admin perdu** : avec la clé de secours (étape 12), l'ajouter à l'application du nouveau téléphone (*Saisir une clé*). Sans elle, depuis le PC :

```powershell
$env:DATABASE_URL = "<DATABASE_URL de l'étape 5>"
pnpm --filter @sellwasl/api platform:reset-2fa vous@exemple.com
```

À la connexion suivante, un nouveau QR code s'affiche. Fermer ensuite le terminal.

## Annexe C — Restaurer une sauvegarde

Pour vérifier une sauvegarde (avant le premier jour, puis chaque trimestre) ou récupérer des données. Sur le PC, Docker Desktop lancé, dans **Git Bash** à la racine du dépôt :

1. GitHub → **Actions → Sauvegarde** → une exécution verte → *Artifacts* → télécharger `sauvegarde-<n°>` (fichier `.zip`).
2. Lancer :

   ```bash
   pnpm db:up
   unzip ~/Downloads/sauvegarde-<n°>.zip
   gpg --output sellwasl.dump --decrypt sellwasl-<date>.dump.gpg   # demande BACKUP_PASSPHRASE
   docker compose exec -T postgres psql -U sellwasl -d postgres -c "create database sellwasl_copie"
   PG_DOCKER_CONTAINER=sellwasl-postgres-1 \
     TARGET_DATABASE_URL=postgresql://sellwasl:sellwasl@localhost:5432/sellwasl_copie \
     scripts/restore-db.sh sellwasl.dump
   ```

3. « Restauration terminée » : la copie est dans la base locale `sellwasl_copie` (Prisma Studio, ou `psql`).
4. Supprimer ensuite les fichiers `sellwasl.dump` et `.gpg` du PC : ils contiennent les données de l'entreprise.

On ne restaure **jamais par-dessus** la base de production : le script refuse une base qui n'est pas vide.

GitHub suspend les tâches programmées d'un dépôt public **après 60 jours sans commit** : dans ce cas, Actions → Sauvegarde → *Enable workflow*.

## Annexe D — Exploitation

**Mise à jour** : fusion sur `main` → CI verte → Render et Vercel se mettent à jour seuls. L'API redémarre en 1 à 2 minutes : fusionner **le soir**, hors tournées. Le mobile continue hors ligne pendant ce temps, pas le Web.

**Retour arrière** : Render → *Events* → *Rollback* ; Vercel → *Deployments* → *Instant Rollback*. Une migration de base ne se défait pas : une migration qui supprime ou renomme se prépare à part.

**Tâches automatiques** : paie (2 h 15), sauvegarde (2 h 30), purge des positions de plus de 90 jours (2 h 45), envoi des notifications (toutes les 10 s).

**Chaque semaine** :

- Supabase → *Reports* / *Usage* : taille de la base (limite 500 Mo)
- Render → *Logs* : erreurs ; Sentry si configuré
- Vercel → *Usage*
- cron-job.org : aucun échec
- GitHub → Actions : sauvegardes de la semaine en vert

## Annexe E — Quand passer à une offre payante

- L'entreprise pilote paie : la règle « non commercial » de Vercel Hobby ne tient plus.
- La base approche 400 Mo.
- Les coupures dues aux déploiements ou la lenteur de Render Free gênent.

Le plus simple alors : un serveur unique (5 à 7 $/mois) avec [docker/compose.yml](../docker/compose.yml), une sauvegarde restaurée dessus (annexe C), et les adresses `API_URL` et `EXPO_PUBLIC_API_URL` mises à jour (nouvel APK).

## Annexe F — En cas de problème

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Étape 6 : `self-signed certificate` ou autre erreur SSL | Réglage SSL de la connexion | Ne rien ajouter au hasard à l'adresse : garder le message exact et demander de l'aide (le réglage se fait aussi sur Render) |
| Étape 6 : `Can't reach database server` | Mauvaise adresse ou « Direct connection » | Reprendre l'adresse **Session pooler** (port 5432) |
| Étape 6 : `password authentication failed` | `[YOUR-PASSWORD]` mal remplacé | Supabase → Project Settings → Database → *Reset database password*, refaire l'adresse |
| Étape 8 : `Configuration invalide` dans les Logs | Variable manquante ou trop courte | Comparer avec l'annexe A ; `WEB_PROXY_SECRET` doit faire 32 caractères au moins |
| Étape 8 : `/api/v1/health` répond `DATABASE_UNAVAILABLE` | `DATABASE_URL` fausse sur Render | Recopier la valeur qui a marché à l'étape 6 |
| Étape 8 : le déploiement attend sans démarrer | CI pas encore verte (Auto-Deploy « After CI Checks Pass ») | Attendre la CI, ou *Manual Deploy → Deploy latest commit* |
| Première requête lente (30 s ou plus) | API endormie (étape 9 pas faite ou en échec) | Vérifier la tâche cron-job.org |
| Étape 10 : la connexion ne répond pas | `API_URL` fausse (avec `/api` à la fin, ou `http`) | Corriger, puis *Redeploy* |
| `/admin/login` : « Page introuvable » | Adresse IP hors de `PLATFORM_ALLOWED_IPS` | Annexe B |
| Étape 11 : `La plateforme a déjà un compte` | Super Admin déjà créé | Se connecter avec ce compte ; en cas d'oubli du mot de passe, demander de l'aide |
| Étape 14 : avertissement « Secrets … absents » | Nom de secret mal écrit | Vérifier `PRODUCTION_DATABASE_URL` et `BACKUP_PASSPHRASE`, exactement |
| Étape 16 : l'application ne se connecte pas | `EXPO_PUBLIC_API_URL` absente ou fausse dans l'APK | Corriger `eas.json`, recompiler |

Pour toute autre erreur : noter l'étape, copier le message exact (Logs Render, terminal, ou capture **sans valeur secrète**).
