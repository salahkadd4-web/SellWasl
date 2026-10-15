# Sécurité — SellWasl

> **Phase 27 — rédigé le 2026-10-10.** Décisions d'architecture : [architecture.md](architecture.md) §16. Droits et modules : [rbac.md](rbac.md), [modules.md](modules.md). Journal d'audit : [audit.md](audit.md).
>
> Pour chaque sujet : ce qui est en place, où, et le test qui le garde.

## 1. Authentification

| Sujet | En place | Où | Tests |
|---|---|---|---|
| Mots de passe | Argon2id ; vérification à temps constant, même pour un compte inconnu | `apps/api/src/auth/passwords.ts` | `auth`, `devices` |
| Règle des mots de passe | 8 à 200 caractères, au moins une lettre et un chiffre, différent de l'actuel, sans l'identifiant ; mots de passe provisoires conformes | `packages/validation/src/auth.ts` (`newPasswordSchema`), `auth.service.ts` | `security.test.ts` |
| Jetons | Accès : JWT de 15 minutes, en mémoire sur le Web. Rafraîchissement : 30 jours, aléatoire, haché en base, **renouvelé à chaque usage** ; un jeton rejoué révoque toute la session | `tokens.service.ts` | `auth`, `devices` |
| Cookie (Web) | `HttpOnly`, `SameSite=strict`, limité aux routes d'authentification, `Secure` partout sauf développement et test | `auth/cookies.ts` | `security.test.ts` |
| Mobile | Jeton de rafraîchissement dans expo-secure-store ; base locale chiffrée (§3) | `apps/mobile/src/auth/storage.ts` | — |
| Révocation | Déconnexion, blocage ou révocation d'appareil, changement de rôle, réinitialisation du mot de passe : sessions fermées | `devices.service.ts`, `users.service.ts` | `devices`, `admin` |
| Réinitialisation | Par l'admin (mot de passe provisoire à changer à la première connexion) ; aucun lien par e-mail dans le MVP | `users.service.ts` | `admin` |
| Force brute | Limite par IP : 10 connexions par minute (300 requêtes par minute ailleurs). **Blocage du compte** : 5 mots de passe faux consécutifs → 15 minutes (`403 ACCOUNT_LOCKED`), pour les comptes Web, téléphone et plateforme ; pendant le blocage, le mot de passe n'est pas vérifié ; la réinitialisation par l'admin débloque ; audit `auth.lockout` | `auth/lockout.service.ts` | `security.test.ts`, `api-contract` |

Un compte bloqué révèle qu'il existe (il faut déjà connaître le code de l'entreprise et l'identifiant) ; en échange, un essai juste pendant le blocage ne se distingue pas d'un essai faux.

## 2. Espace plateforme (Super Admin)

- **Invisible hors de la liste d'IP** : `PLATFORM_ALLOWED_IPS` (adresses ou plages CIDR, IPv4 et IPv6, séparées par des virgules). Hors liste, `/api/v1/platform/*` (connexion comprise) et `/admin` répondent **404**, comme s'ils n'existaient pas, et la documentation OpenAPI ne les montre pas. Sans liste : ouvert en développement et en test, **fermé en staging et en production**.
- Règle partagée par l'API (middleware) et le Web (proxy Next.js) : `packages/business-rules/src/ip-allowlist.ts`.
- **Deuxième facteur** (TOTP, RFC 6238 : 6 chiffres, pas de 30 s, tolérance d'un pas), compatible avec Google Authenticator, Microsoft Authenticator, etc. Première connexion : QR code d'enrôlement (`TOTP_SETUP`) ; ensuite code exigé (`TOTP_REQUIRED`). Un code faux compte comme un échec (blocage) ; un code ne sert qu'une fois. Secret chiffré en base (§3).
- **Premier Super Admin** : `pnpm --filter @sellwasl/api platform:bootstrap <email> ["Nom"]`, avec `DATABASE_URL` de la base visée (depuis un poste : l'offre gratuite de Render n'a pas de terminal) ; catalogue des permissions, puis compte créé avec un mot de passe saisi deux fois sans s'afficher (règle des mots de passe, §1). Relançable ; refuse un second compte (`docs/deployment.md` §8).
- **Téléphone perdu** : `pnpm --filter @sellwasl/api platform:reset-2fa <email>`, avec `DATABASE_URL` de la base visée ; nouvel enrôlement à la connexion suivante.
- Lien « Administration plateforme » retiré de la page d'accueil publique.
- Tests : `security.test.ts` (toutes les routes plateforme hors liste, enrôlement, rejeu), `totp.test.ts`, `ip-allowlist.test.ts`, `bootstrap-platform.test.ts` (premier Super Admin, saisie masquée).

## 3. API et données

| Sujet | En place |
|---|---|
| Validation | Toutes les entrées par Zod (`packages/validation`) ; erreurs `400 VALIDATION_ERROR` avec les champs (api.md §2) |
| Uploads | Photos : 5 Mo, type reconnu au contenu (JPEG, PNG, WebP), nom imprévisible ; imports CSV : 5 Mo ; exports : 100 000 lignes, cellules neutralisées contre l'injection de formule |
| Injections | Requêtes Prisma paramétrées, aucun SQL brut dans le code de l'application |
| Droits et modules | Garde globale : chaque route déclare son droit ou son accès, sinon refus (`routes.test.ts`) ; module actif vérifié (rbac.md, modules.md) |
| Isolation par entreprise | Client Prisma filtré par entreprise sur toutes les lectures et écritures ; client non filtré réservé à une liste de fichiers vérifiée par test (`routes.test.ts`) ; `tenant-isolation.test.ts` |
| IDOR | Une ressource d'une autre entreprise, ou hors du périmètre de l'utilisateur, répond `404` (rbac.md §3) |
| IP réelle | `TRUST_PROXY` : nombre de proxys de confiance devant l'API (0 par défaut : `X-Forwarded-For` ignoré). Sert à l'audit, aux sessions, à la limite de débit et à la liste de la plateforme. Sur le Web, `TRUST_PROXY` compte les proxys devant Next.js ; l'API, derrière le Web, compte aussi Next.js |
| HTTPS | Terminé par le proxy de l'hébergeur ; HSTS par helmet (API) et par Next.js en production (Web) ; en-têtes `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` |
| Chiffrement en base | Secrets TOTP en AES-256-GCM (`apps/api/src/common/crypto.ts`, clé `DATA_ENCRYPTION_KEY`). Les autres données (clients, positions, salaires) reposent sur le chiffrement du disque de la base gérée et sur les droits ; pas de chiffrement champ par champ dans le MVP |
| Téléphone | Base locale chiffrée par SQLCipher (expo-sqlite), clé de 256 bits dans expo-secure-store ; une ancienne base en clair est recopiée puis effacée. Vérifié le 2026-10-11 sur un téléphone (build de développement EAS) : synchronisation, puis début du fichier illisible (`adb shell run-as com.sellwasl.app head -c 16 files/SQLite/sellwasl-offline-v2.db`) |
| Fichiers | Photos publiques par nom imprévisible (comme les adresses Cloudinary) ; imports CSV jamais servis |
| Journaux | pino sans en-têtes d'authentification ni cookies ; audit sans mot de passe ni jeton (audit.md) |

## 4. Configuration et secrets

- Variables d'environnement, jamais dans le dépôt (`.env.example` sans valeur réelle).
- L'API **refuse de démarrer** en staging et en production sans `JWT_ACCESS_SECRET` propre au serveur (32 caractères au moins, différent de la valeur de développement) ni `DATA_ENCRYPTION_KEY` (32 octets en base64). Générer une clé : `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
- Les secrets sont rangés dans le gestionnaire de secrets de l'hébergeur (chiffrés au repos), jamais dans une image Docker.
- Changer `DATA_ENCRYPTION_KEY` rend illisibles les secrets TOTP : réinitialiser alors le deuxième facteur des comptes plateforme (§2).

| Variable | Rôle |
|---|---|
| `JWT_ACCESS_SECRET` | Signature des jetons d'accès |
| `DATA_ENCRYPTION_KEY` | Chiffrement des données sensibles en base |
| `TRUST_PROXY` | Proxys de confiance (API et Web) |
| `PLATFORM_ALLOWED_IPS` | Liste d'IP de la plateforme (API et Web) |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | Supervision des erreurs (facultatif) |
| `CLOUDINARY_URL` | Photos des produits (facultatif) |

## 5. Supervision et alertes

- **Sentry** (API et Web), inactif sans `SENTRY_DSN` : les erreurs 500 partent avec l'identifiant de requête, l'entreprise et l'utilisateur (identifiants seulement). Ni corps de requête, ni cookies, ni paramètres d'URL, ni en-têtes d'authentification (`apps/api/src/common/sentry.ts`, `apps/web/src/lib/sentry-scrub.ts`, test `sentry.test.ts`). Alertes par e-mail réglées dans Sentry. Mobile : à la phase de déploiement.
- **Santé** : `GET /api/v1/health` (API et base), surveillé par un service de disponibilité externe.
- **Journaux** JSON (pino) avec identifiant de requête ; journal de synchronisation (BR-SYN-07) ; journal d'audit consultable par l'admin.

## 6. Sauvegardes

| Élément | Décision |
|---|---|
| Hébergeur | Sauvegardes automatiques de la base gérée, avec restauration à un instant donné si proposée (architecture §18.3) |
| Script | `pnpm db:backup` (`scripts/backup-db.sh`) : pg_dump au format personnalisé, compressé, horodaté, relu après écriture ; dossier et fichiers lisibles par leur seul propriétaire ; rotation sur `RETENTION_DAYS` jours (14 par défaut). Sans client PostgreSQL : `PG_DOCKER_CONTAINER`. `BACKUP_SCHEMA=public` : ce seul schéma (Supabase) |
| Fréquence | Une fois par jour : workflow GitHub Actions `backup.yml` (2 h 30), restauration d'essai dans une base vide, archive chiffrée en AES-256 (`BACKUP_PASSPHRASE`, le dépôt est public) gardée 30 jours hors de l'hébergeur (`docs/deployment.md` §11) |
| Restauration | `scripts/restore-db.sh <archive>` vers une **base vide** seulement (refus sinon) ; une archive d'un seul schéma recrée elle-même `public` |
| Test | `pnpm db:test-restore` : sauvegarde, restauration dans une base vide, comptes de lignes comparés table par table (79 tables vérifiées le 2026-10-10). À refaire avant le pilote, puis chaque trimestre |

## 7. Dépendances

`pnpm audit --prod` au 2026-10-10 : `mysql2` forcé en version corrigée (`pnpm.overrides`). Restent, toutes dans des outils et jamais dans le code exécuté en production :

| Paquet | Gravité | Chemin | Raison |
|---|---|---|---|
| `deepmerge-ts` | haute | CLI Prisma (`@prisma/config`) | Correctif dans une version majeure suivante |
| `node-forge`, `braces` | haute | CLI Expo | Pas de correctif publié |
| `uuid`, `decode-uri-component` | moyenne | CLI Expo, expo-router | Correctif dans une version majeure suivante |

À revoir à chaque montée de version d'Expo et de Prisma.

## 8. Reste à faire

- Politique de sécurité du contenu (CSP) des pages Web : Next.js demande des nonces ; aujourd'hui seul le service worker en a une.
- Audit des actions du support (`platform_audit_log`) consultable : après le MVP.
