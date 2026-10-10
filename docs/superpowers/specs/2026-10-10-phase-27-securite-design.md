# Phase 27 — Sécurité : conception

> Rédigé le 2026-10-10, validé en conversation (« Oui allons y »). Choix : espace super-admin
> réservé à une liste d'IP avec un deuxième facteur ; Sentry activé par variable ; mots de passe de
> 8 caractères avec une lettre et un chiffre ; script de sauvegarde et restauration testée.

## 1. Existant (vérifié)

Argon2id ; jeton d'accès 15 min, rafraîchissement 30 jours à rotation avec révocation sur rejeu ;
cookie `HttpOnly`, `SameSite=strict` ; helmet ; Zod partout ; Prisma paramétré, sans SQL brut ;
isolation par entreprise testée ; droits et modules ; limite de débit (300/min, connexion 10/min) ;
uploads limités (taille, type d'image reconnu au contenu) ; audit en ajout seul.

## 2. Espace super-admin invisible

- `PLATFORM_ALLOWED_IPS` : adresses ou plages CIDR séparées par des virgules. Hors liste, toute
  route de la plateforme (`/api/v1/platform/*`, connexion comprise) répond `404 NOT_FOUND`, avant
  l'authentification. Le Web répond 404 sur `/admin/*` (proxy Next.js, même variable).
- Sans liste : ouvert en développement et en test ; fermé (404 pour tous) en staging et production.
- Le lien « Plateforme » quitte la page d'accueil publique.
- **Deuxième facteur (TOTP, RFC 6238)** pour les comptes plateforme : code à 6 chiffres, pas de
  30 s, tolérance d'un pas. Première connexion : la réponse demande l'enrôlement (`TOTP_SETUP`)
  avec l'URI `otpauth://` ; le code saisi confirme l'enrôlement. Ensuite, la connexion exige le
  code (`TOTP_REQUIRED`, `TOTP_INVALID`). Un pas déjà utilisé est refusé (rejeu).
- Secret chiffré en base (AES-256-GCM, `DATA_ENCRYPTION_KEY`, 32 octets en base64), obligatoire
  en staging et production.
- Script `platform:reset-2fa <email>` pour un téléphone perdu (accès au serveur requis).

## 3. IP réelle

`TRUST_PROXY` : nombre de proxys de confiance (0 par défaut) passé à Express (`trust proxy`).
L'IP sert à la liste de la plateforme, à l'audit, aux sessions et à la limite de débit.

## 4. Blocage du compte

5 échecs consécutifs de mot de passe → compte bloqué 15 minutes (`403 ACCOUNT_LOCKED`, avec la fin
du blocage). Comptes de l'entreprise (Web et téléphone) et comptes plateforme. Une connexion
réussie remet le compteur à zéro ; la réinitialisation du mot de passe par l'admin débloque.
Audit `auth.lockout`.

## 5. Mots de passe

Nouveau mot de passe : 8 à 200 caractères, au moins une lettre et un chiffre, différent de
l'actuel, ne contenant pas l'identifiant. Mots de passe provisoires conformes.

## 6. Configuration

- En staging et production : `JWT_ACCESS_SECRET` (32 caractères, différent de la valeur de
  développement) et `DATA_ENCRYPTION_KEY` obligatoires, sinon l'API refuse de démarrer.
- Cookie `Secure` partout sauf développement et test.
- `.env.example` à jour, sans variable inutilisée.
- Dépendances : versions corrigées forcées (`pnpm.overrides`) quand un correctif existe ; les autres
  sont listées dans security.md avec leur portée (outils de build).

## 7. Supervision

Sentry sur l'API (`SENTRY_DSN`) et le Web (`NEXT_PUBLIC_SENTRY_DSN`), inactif sans variable.
Erreurs 500 avec identifiant de requête, entreprise et utilisateur (identifiants seulement) ; ni
corps de requête, ni en-têtes d'authentification, ni cookies. Mobile : phase de déploiement.

## 8. Sauvegardes

`scripts/backup-db.sh` (pg_dump format personnalisé, compressé, horodaté, rotation N jours) et
`scripts/restore-db.sh` (vers une base cible). Test : sauvegarde de la base de développement,
restauration dans une base vide, comptes de lignes identiques. Procédure dans security.md.

## 9. Livrable et tests

`docs/security.md` ; architecture §16 ; plan_VF phase 27 cochée. Tests : liste d'IP, TOTP
(enrôlement, connexion, rejeu), blocage et déblocage, règle des mots de passe, `TRUST_PROXY`,
validation de la configuration, chiffrement, restauration.
