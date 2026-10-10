# Phase 26 — Audit : conception

> Rédigé le 2026-10-10, validé en conversation (« Oui allons y »). Choix : consultation par l'admin
> seulement (`audit.read`, rbac.md) ; journal filtrable avec export CSV.

## 1. Existant

- `audit_log` (database.md) : auteur, action, fiche, avant, après, motif, appareil, IP, navigateur.
  Ajout seul : le déclencheur `audit_log_append_only` refuse toute modification ou suppression.
- `AuditService.write` est appelé par une quarantaine de services depuis la phase 5 ; la liste de
  BR-AUD-01 est presque entièrement tracée.
- Manques : `ip`, `user_agent` et `device_id` ne sont jamais renseignés ; aucune route ni écran ne
  permet de consulter le journal ; les actions sont des textes libres, sans libellé.

## 2. Contexte automatique

- Le garde d'authentification met dans le contexte de la requête (nestjs-cls) : IP, navigateur
  (300 caractères au plus) et appareil de la session (téléphone).
- `AuditService.write` complète chaque ligne avec ce contexte quand l'appel ne le donne pas. Hors
  requête (tâches de nuit), les champs restent vides.

## 3. Catalogue des actions

- `packages/validation/src/audit.ts` : `AUDIT_ACTIONS` (code → libellé français) et
  `AUDIT_ENTITIES` (fiche → libellé). Type `AuditAction` = codes du catalogue.
- `AuditEntry.action` est de type `AuditAction` : une action sans libellé ne compile pas. Les aides
  des services qui prennent `action: string` passent à `AuditAction`.
- En construisant le catalogue, comparaison avec BR-AUD-01 et plan_VF phase 26 ; un trou trouvé est
  comblé avec un test.

## 4. Consultation (admin, `audit.read`)

- `GET /audit` : liste paginée (phase 25), tri `createdAt` (`-createdAt` par défaut). Filtres :
  `from`, `to` (dates, fuseau de l'entreprise), `userId`, `entity`, `entityId`, `action`.
  Ligne : `id, at, action, actionLabel, entity, entityLabel, entityId, actor {id, code, name} | null,
  deviceId, ip, userAgent, reason, before, after`.
- `GET /audit/export` : mêmes filtres, CSV (« ; », UTF-8 avec BOM, cellules neutralisées contre
  l'injection de formule), 10 000 lignes au plus, les plus récentes.
- Isolation : client Prisma de l'entreprise ; une autre entreprise ne voit rien.

## 5. Écran Web « Journal d'audit »

- `/app/audit`, menu Administration, droit `audit.read`.
- Filtres : du, au (30 derniers jours par défaut), utilisateur, type de fiche, action. Liste :
  date, utilisateur, action, fiche ; « Afficher plus » (ShowMore). Bouton « Exporter (CSV) ».
- Détail (fenêtre) : qui, quand, appareil, IP, navigateur, motif ; champs changés avec ancienne et
  nouvelle valeur (champs de `before` et `after`), le reste replié.

## 6. Sécurité des données

- Aucun mot de passe, empreinte ou jeton dans `before` / `after` : test sur les actions de
  connexion, de mot de passe et d'appareil.

## 7. Tests et limites

- Tests API : contexte Web (IP, navigateur) et téléphone (appareil) ; droits (admin 200, autre rôle
  403, autre entreprise vide) ; filtres, pagination, export CSV et injection de formule ; ajout
  seul ; pas de secret dans le journal.
- Hors périmètre : audit plateforme (actions du support) après le MVP ; historique sur chaque fiche.
