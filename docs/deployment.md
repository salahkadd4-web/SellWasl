# Déploiement — SellWasl

> **Phase 30 — rédigé le 2026-10-15.** Mise en ligne gratuite pour l'entreprise pilote (15 vendeurs, 15 livreurs, 1 magasinier, 1 comptable, 2 superviseurs). Images et CI : [ci-cd.md](ci-cd.md). Sécurité : [security.md](security.md). Notifications : [notifications.md](notifications.md).
>
> Les étapes marquées **🔧** dépendent de code pas encore écrit (§1.1) : les faire après lui.

## 0. Vue d'ensemble

```text
Téléphones (APK) ──────────────────────────────► API NestJS ─────► PostgreSQL
                                                 Render, Francfort   Supabase, Francfort
Navigateurs ──► Web Next.js ── /api/* ──────────►      │
                Vercel, fra1                            └──────────► Photos : Cloudinary

cron-job.org ── toutes les 10 min ──► /api/v1/health   (garde l'API et la base éveillées)
GitHub Actions ── chaque nuit ──► sauvegarde de la base
```

| Service | Rôle | Offre | Limite à surveiller |
|---|---|---|---|
| Render | API (image Docker de `apps/api`) | Free | 512 Mo de RAM, 0,1 CPU, 750 h/mois : **un seul** service allumé en continu ; disque effacé à chaque redémarrage |
| Supabase | Base PostgreSQL | Free | 500 Mo ; pas de sauvegarde exploitable (d'où §11) |
| Vercel | Web (`apps/web`) | Hobby | Usage non commercial ; quotas partagés par tout le compte |
| Cloudinary | Photos des produits | Free | Crédits mensuels |
| cron-job.org | Réveil de l'API | Gratuit | — |
| Expo (EAS) | Compilation de l'APK | Free | Nombre de compilations par mois |

Coût : 0 €. À prévoir quand l'entreprise paiera : Vercel Pro ou un serveur unique avec [docker/compose.yml](../docker/compose.yml).

## 1. Avant de commencer

### 1.1 Code à terminer 🔧

| Sujet | Pourquoi |
|---|---|
| Sauvegarde nocturne par GitHub Actions | Supabase Free ne fournit pas de sauvegarde exploitable |
| Lecture de l'IP du client derrière Vercel et Render (§9) | Le Web passe par Vercel puis Render, le mobile par Render seul : un même `TRUST_PROXY` peut ne pas convenir aux deux chemins |

### 1.2 Comptes à créer

GitHub (déjà fait), Supabase, Render, Vercel (**compte séparé de vos autres projets** : quotas et règle « non commercial » s'appliquent à tout le compte), Cloudinary, cron-job.org, Expo, MapTiler (déjà fait), Firebase (notifications Android), Sentry (facultatif).

### 1.3 Secrets

Générer une fois, dans un terminal :

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # DATA_ENCRYPTION_KEY
```

Les garder dans un gestionnaire de mots de passe, **jamais dans le dépôt**. Perdre `DATA_ENCRYPTION_KEY` rend illisibles les secrets de double authentification enregistrés en base.

| Variable | API (Render) | Web (Vercel) | Mobile (EAS) |
|---|---|---|---|
| `NODE_ENV` | `production` | (posé par Vercel) | — |
| `PORT` | `3001` | — | — |
| `DATABASE_URL` | §2 | — | — |
| `JWT_ACCESS_SECRET` | §1.3 | — | — |
| `DATA_ENCRYPTION_KEY` | §1.3 | — | — |
| `CLOUDINARY_URL` | §3 | — | — |
| `PLATFORM_ALLOWED_IPS` | §7 | §7 (même valeur) | — |
| `TRUST_PROXY` | §9 | §9 | — |
| `API_URL` | — | adresse Render | — |
| `NEXT_PUBLIC_MAPTILER_KEY` | — | clé MapTiler | — |
| `EXPO_PUBLIC_API_URL` | — | — | adresse Render |
| `EXPO_PUBLIC_MAPTILER_KEY` | — | — | clé MapTiler |
| `EXPO_ACCESS_TOKEN` | facultatif | — | — |
| `SENTRY_DSN` | facultatif | facultatif | — |

En production, l'API refuse de démarrer sans `JWT_ACCESS_SECRET` et `DATA_ENCRYPTION_KEY` propres, et l'espace plateforme reste **fermé** sans `PLATFORM_ALLOWED_IPS`.

## 2. Base de données — Supabase

1. **New project** : région **Central EU (Frankfurt)**, mot de passe de base solide (le noter).
2. **Project Settings → Data API : désactiver.** Obligatoire : les tables Prisma sont dans le schéma `public` sans RLS, la Data API les exposerait.
3. **Connect → Session pooler** (port 5432) : copier l'adresse, remplacer `[YOUR-PASSWORD]`. C'est `DATABASE_URL`. Ne pas prendre « Direct connection » (IPv6 seul, Render n'y accède pas).
4. Tester depuis le poste, en appliquant les migrations (PowerShell, à la racine du dépôt) :

   ```powershell
   $env:DATABASE_URL = "postgresql://postgres.xxxx:MOT_DE_PASSE@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
   pnpm --filter @sellwasl/api prisma:deploy
   ```

   Une erreur de certificat (`self-signed certificate`) se règle par un paramètre SSL dans l'adresse : à voir ensemble. **Fermer ce terminal ensuite**, pour ne jamais lancer `pnpm db:seed` ou `pnpm db:reset` sur la base de production (`db:reset` efface tout).

## 3. Photos — Cloudinary

Créer le compte, puis copier **API Environment variable** (`cloudinary://<clé>:<secret>@<cloud>`) du tableau de bord : c'est `CLOUDINARY_URL`. Obligatoire sur Render : sans elle, les photos seraient écrites sur un disque effacé à chaque redémarrage.

## 4. API — Render

**New → Web Service**, connecter le dépôt GitHub :

| Réglage | Valeur |
|---|---|
| Language | Docker |
| Branch | `main` |
| Dockerfile Path | `apps/api/Dockerfile` |
| Docker Build Context Directory | `.` |
| Region | Frankfurt (EU Central) |
| Instance Type | Free |
| Health Check Path | `/api/v1/health` |
| Auto-Deploy | **After CI Checks Pass** (le service ne se met à jour que si la CI est verte) |

Variables : celles de la colonne « API » du §1.3. `PLATFORM_ALLOWED_IPS` : §7. `TRUST_PROXY` : `1` en attendant le §9.

La première compilation prend une dizaine de minutes. Les migrations s'appliquent seules à chaque démarrage (`prisma migrate deploy` dans le Dockerfile). Vérifier : `https://<service>.onrender.com/api/v1/health` répond `"status":"ok"` et `"database":"ok"`.

## 5. Garder l'API éveillée — cron-job.org

Render Free s'endort après 15 minutes sans requête, et les tâches planifiées (envoi des notifications toutes les 10 s, paie à 2 h 15) ne tournent plus. Créer une tâche :

- URL : `https://<service>.onrender.com/api/v1/health`
- Fréquence : **toutes les 10 minutes, 24 h/24**
- Alerte par e-mail en cas d'échec : activée (c'est aussi votre surveillance de disponibilité)

Le même appel interroge la base, ce qui évite la mise en pause de Supabase.

## 6. Web — Vercel

1. **Add New → Project**, importer le même dépôt.
2. **Root Directory** : `apps/web` (Next.js et pnpm sont détectés seuls).
3. Variables : colonne « Web » du §1.3 ; `API_URL` = `https://<service>.onrender.com` (sans `/api` à la fin).
4. **Settings → Functions → Function Region** : Frankfurt (`fra1`).
5. **Settings → Git → Ignored Build Step**, commande : `git diff --quiet HEAD^ HEAD -- . ../../packages ../../pnpm-lock.yaml` (pas de nouveau déploiement si seuls l'API ou le mobile ont changé).
6. Si la clé MapTiler est limitée à certains domaines, y ajouter le domaine Vercel.

Une variable modifiée sur Vercel ne s'applique qu'au déploiement suivant : **Deployments → … → Redeploy**.

## 7. Liste d'IP de la plateforme — `PLATFORM_ALLOWED_IPS`

L'espace plateforme (`/admin`, `/api/v1/platform/*`) n'est visible que depuis les adresses listées ; ailleurs il répond 404. Liste vide en production : **fermé pour tout le monde**.

1. Relever votre adresse : <https://api.ipify.org> (IPv4) et <https://api64.ipify.org> (IPv6 si votre connexion en a une).
2. Mettre les deux, séparées par une virgule, sur Render **et** Vercel : `105.x.x.x, 2c0f:xxxx::1`.
3. Votre adresse change (box, 4G) : mettre à jour la variable sur les deux services (Render redémarre seul, Vercel demande un Redeploy). La plateforme ne sert qu'à créer et régler les entreprises, c'est rare.

Pour éviter les mises à jour fréquentes, on peut lister la plage de votre fournisseur (par exemple `105.96.0.0/16`) : moins strict, mais le mot de passe et la double authentification restent exigés.

## 8. Initialiser la plateforme

1. Depuis votre poste, à la racine du dépôt, sur la base Supabase (après les migrations : §2 ou premier démarrage de Render) :

   ```powershell
   $env:DATABASE_URL = "<adresse du §2>"
   pnpm --filter @sellwasl/api platform:bootstrap vous@exemple.com "Votre Nom"
   ```

   Le mot de passe est demandé deux fois, sans s'afficher (8 caractères au moins, une lettre et un chiffre ; 12 ou plus conseillés). Le script inscrit le catalogue des permissions puis crée le Super Admin. Relancé, il remet les permissions à jour sans toucher au compte ; il refuse de créer un second compte. **Il n'y a pas d'écran pour changer ce mot de passe : rangez-le dans un gestionnaire de mots de passe.** Fermer ensuite le terminal.
2. `https://<projet>.vercel.app/admin/login` (votre IP dans `PLATFORM_ALLOWED_IPS`, §7) : e-mail et mot de passe, puis QR code à scanner avec une application d'authentification (Google Authenticator, Microsoft Authenticator, 2FAS), et le code à 6 chiffres. Téléphone perdu : même terminal, `pnpm --filter @sellwasl/api platform:reset-2fa vous@exemple.com`.
3. Créer l'entreprise pilote, son mode et son administrateur.
4. Avec le compte administrateur de l'entreprise : utilisateurs (15 vendeurs, 15 livreurs, magasinier, comptable, 2 superviseurs), paramètres, import CSV du catalogue et des clients, secteurs et parties sur la carte, planning.
5. **Le soir de la bascule**, après la dernière tournée dans l'ancien système et avant la première journée dans SellWasl : inventaire du dépôt (stock initial), puis Comptabilité → **Soldes d'ouverture** (import CSV `code;nom;dette`, ou fiche du client). Un solde se corrige tant que le client n'a ni vente à crédit ni encaissement.

## 9. Vérifier l'IP du client — `TRUST_PROXY` 🔧

L'IP sert à la liste du §7, à la limite de tentatives de connexion et au journal d'audit. Chaque proxy ajoute une adresse à `X-Forwarded-For` ; `TRUST_PROXY` dit combien en ignorer en partant de la droite. Trop bas : l'application voit l'adresse d'un proxy (tout le bureau partage alors la même limite de tentatives). Trop haut : un client peut se faire passer pour une autre adresse.

1. Sur un téléphone en 4G, relever l'adresse sur <https://api.ipify.org>.
2. Depuis ce téléphone : se connecter au Web, puis à l'application mobile.
3. Dans le journal d'audit (Web → Audit), les deux connexions doivent montrer **cette** adresse, pas celle de Vercel ou de Render.
4. Essai d'usurpation, depuis un réseau **hors** de la liste du §7 (PowerShell) :

   ```powershell
   curl.exe -i -H "X-Forwarded-For: <une IP de la liste>" https://<service>.onrender.com/api/v1/platform/companies
   curl.exe -i -H "X-Forwarded-For: <une IP de la liste>" https://<projet>.vercel.app/api/v1/platform/companies
   ```

   Réponse attendue : **404** (401 voudrait dire que l'en-tête falsifié a été cru).

Si le Web et le mobile demandent des valeurs différentes, l'ajustement se fait dans le code (§1.1).

## 10. Application Android — EAS

1. Notifications : suivre [notifications.md](notifications.md) (projet Firebase, `google-services.json`, clé FCM v1 envoyée à Expo).
2. Dans [eas.json](../apps/mobile/eas.json), profil `preview` : `"env": { "EXPO_PUBLIC_API_URL": "https://<service>.onrender.com", "EXPO_PUBLIC_MAPTILER_KEY": "<clé>" }`.
3. Compiler :

   ```powershell
   npm install -g eas-cli
   eas login
   cd apps/mobile
   eas build -p android --profile preview
   ```

4. Envoyer le lien de l'APK aux utilisateurs ; sur chaque téléphone, autoriser l'installation d'applications inconnues, installer, associer l'appareil avec son code d'activation (Web → utilisateurs).

Changer d'adresse d'API demande une nouvelle compilation : l'adresse est figée dans l'APK.

## 11. Sauvegardes 🔧

1. GitHub → Settings → Secrets and variables → Actions : secret `PRODUCTION_DATABASE_URL` (adresse du §2).
2. Le workflow nocturne fait un `pg_dump` et le garde en artefact GitHub.
3. Avant le premier jour : restaurer une sauvegarde sur une base locale et vérifier les données ([scripts/test-backup-restore.sh](../scripts/test-backup-restore.sh)).

## 12. Répétition générale

Avec des comptes de test, sur de vrais téléphones en 4G (pas en Wi-Fi) :

- [ ] Prévente : commande J, préparation et chargement (magasinier), livraison, encaissement, impression Bluetooth (livreur)
- [ ] Cash van : chargement, vente, encaissement, impression
- [ ] Hors ligne : couper le réseau pendant une visite, le remettre, vérifier la synchronisation
- [ ] Comptable : dettes, récapitulatifs, versements
- [ ] Superviseur : carte du suivi, objectifs, exports CSV
- [ ] Notifications reçues sur Android
- [ ] Journal d'audit : IP correctes (§9)
- [ ] Restauration de sauvegarde réussie (§11)

Puis supprimer les données de test, ou recréer l'entreprise.

## 13. Exploitation

**Mise à jour** : fusion sur `main` → CI verte → Render et Vercel se mettent à jour seuls. L'API redémarre en 1 à 2 minutes : fusionner **le soir**, hors tournées. Le mobile continue hors ligne pendant ce temps, pas le Web.

**Retour arrière** : Render → Events → Rollback ; Vercel → Deployments → Instant Rollback. Une migration de base ne se défait pas : une migration qui supprime ou renomme se prépare à part.

**Chaque semaine** :

- Supabase → Usage : taille de la base (limite 500 Mo)
- Render → Logs : erreurs ; Sentry si configuré
- Vercel → Usage
- cron-job.org : aucun échec
- GitHub → Actions : sauvegardes de la semaine présentes

## 14. Quand passer à une offre payante

- L'entreprise pilote paie : la règle « non commercial » de Vercel Hobby ne tient plus.
- La base approche 400 Mo.
- Les coupures dues aux déploiements ou la lenteur de Render Free gênent.

Le plus simple alors : un serveur unique (5 à 7 $/mois) avec [docker/compose.yml](../docker/compose.yml), sauvegarde Supabase restaurée dessus, et les variables `API_URL`, `EXPO_PUBLIC_API_URL` mises à jour (nouvel APK).
