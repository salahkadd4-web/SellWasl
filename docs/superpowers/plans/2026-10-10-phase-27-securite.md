# Phase 27 — Sécurité : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fermer les écarts de sécurité restants (super-admin invisible avec deuxième facteur, blocage des comptes, IP réelle, configuration, supervision, sauvegardes) et livrer `docs/security.md`.

**Architecture:** garde d'IP sur les routes plateforme ; TOTP maison (node:crypto) avec secret chiffré AES-GCM ; compteur d'échecs sur les comptes ; `trust proxy` configurable ; Sentry facultatif ; scripts shell de sauvegarde.

**Tech Stack:** NestJS 11, Prisma 7, Next.js 16 (proxy), node:crypto, @sentry/nestjs, @sentry/nextjs, pg_dump.

**Spec:** `docs/superpowers/specs/2026-10-10-phase-27-securite-design.md`

## Global Constraints

- Hors liste d'IP : 404, jamais 403 (l'espace ne doit pas se révéler).
- Fermé par défaut en staging et production.
- Aucun secret dans le dépôt ni dans les journaux.
- Fusion locale dans `main`, sans push ; CI locale verte.

## Review Focus

1. `X-Forwarded-For` falsifié avec `TRUST_PROXY=0` : ignoré (tâche 1).
2. Le blocage ne révèle pas plus qu'avant l'existence d'un compte inconnu (tâche 2).
3. Une route plateforme oubliée par la garde d'IP (tâche 3) : test sur toutes les routes `platform`.
4. Code TOTP rejoué dans le même pas : refusé (tâche 4).
5. Sentry n'envoie ni mot de passe ni jeton (tâche 5).

---

### Task 1: IP réelle et configuration

**Files:** `apps/api/src/config/env.ts`, `app.setup.ts`, `auth/cookies.ts`, `.env.example`, `package.json` (overrides). Test `apps/api/test/security.test.ts`.

- [ ] Tests : `TRUST_PROXY=1` → IP de `X-Forwarded-For` dans l'audit ; 0 → ignorée ; env production sans secret ou avec le secret de développement → refus ; cookie `Secure` hors développement.
- [ ] Commit `feat(api): IP réelle derrière le proxy et configuration durcie`.

### Task 2: Blocage des comptes et règle des mots de passe

**Files:** Prisma (`failedLoginCount`, `lockedUntil` sur `User` et `PlatformUser`) ; `auth.service.ts`, `platform-auth.service.ts`, `users.service.ts` ; `packages/validation/src/auth.ts`.

- [ ] Tests : 5 échecs → `ACCOUNT_LOCKED` même avec le bon mot de passe ; fin du blocage → connexion ; réinitialisation → débloqué ; règle des mots de passe (lettre, chiffre, identifiant, ancien).
- [ ] Commit `feat: blocage des comptes et règle des mots de passe`.

### Task 3: Liste d'IP de la plateforme

**Files:** `apps/api/src/platform/platform-ip.guard.ts` ; `apps/web/src/proxy.ts` ; page d'accueil.

- [ ] Tests : hors liste, chaque route plateforme (découverte par les métadonnées) → 404 ; dans la liste → normal ; staging sans liste → fermé.
- [ ] Commit `feat: espace plateforme réservé à une liste d'adresses IP`.

### Task 4: Deuxième facteur de la plateforme

**Files:** `apps/api/src/common/crypto.ts` (AES-GCM), `auth/totp.ts`, Prisma (`totpSecret`, `totpEnabledAt`, `totpLastStep`), connexion plateforme ; Web `/admin/login` ; script `platform:reset-2fa`.

- [ ] Tests : chiffrement aller-retour et altération détectée ; TOTP (vecteurs RFC 6238) ; enrôlement puis connexion ; code faux ; rejeu refusé.
- [ ] Commit `feat: deuxième facteur pour les comptes plateforme`.

### Task 5: Sentry

**Files:** `apps/api/src/common/sentry.ts`, filtre d'erreurs ; Web `instrumentation*.ts`.

- [ ] Tests : sans DSN rien n'est initialisé ; l'événement envoyé ne contient ni corps, ni en-tête d'authentification, ni cookie (fonction de nettoyage testée).
- [ ] Commit `feat: erreurs envoyées à Sentry quand il est configuré`.

### Task 6: Sauvegardes

**Files:** `scripts/backup-db.sh`, `scripts/restore-db.sh`.

- [ ] Test manuel scripté : sauvegarde, restauration dans une base vide, comptes de lignes identiques.
- [ ] Commit `feat: scripts de sauvegarde et de restauration de la base`.

### Task 7: Documentation et CI

- [ ] `docs/security.md`, architecture §16, api.md (codes d'erreur), plan_VF phase 27 cochée.
- [ ] CI locale, commit `docs: sécurité ; phase 27 cochée`.
