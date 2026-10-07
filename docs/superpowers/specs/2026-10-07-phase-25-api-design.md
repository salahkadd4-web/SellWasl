# Phase 25 — API et intégrations : conception

> Validée le 2026-10-07. Plan : `docs/superpowers/plans/2026-10-07-phase-25-api.md`.
> Références : plan_VF.md (phase 25), docs/api.md §1 (conventions) et §2 (erreurs).

## 1. Objectif et décisions

Faire tenir à l'API toutes les promesses de `api.md` §1-2. Déjà en place : `/api/v1`, validation
Zod, format d'erreur unique, rate limiting, contrôle entreprise / droits / modules.

| Sujet | Décision (2026-10-07) |
|---|---|
| Périmètre | Tout le contrat : OpenAPI, `Idempotency-Key`, conflit de version, pagination et tri, tests d'erreurs |
| OpenAPI | Généré depuis le code (routes Nest, droits, schémas Zod) ; pas de décorateurs Swagger |
| Pagination | Les listes qui grossissent seulement |
| Intégrations externes | Après le MVP |

## 2. OpenAPI

- `OpenApiService` lit au démarrage les contrôleurs (`DiscoveryService`, métadonnées Nest) : méthode,
  chemin (`/api/v1/...`, `:id` → `{id}`), accès (`@Public`, `@PlatformOnly`, `@AnyAuthenticated`
  ou permission), schémas Zod des `ZodValidationPipe` sur `@Body`, `@Query`, `@Param`
  (`z.toJSONSchema`, mode « input »).
- Document OpenAPI 3.1 : `operationId` (`Contrôleur.méthode`), `tags` (premier segment du chemin),
  `x-permission`, `security` bearer sauf routes publiques, réponses : succès générique, erreurs au
  format `ErrorResponse` (§2 d'api.md), `Page` pour les listes paginées.
- `GET /api/docs/openapi.json` et `GET /api/docs` (Swagger UI, `swagger-ui-dist` servi par l'API,
  sans CDN) ; activés si `NODE_ENV !== 'production'` ou `API_DOCS=on` ; absents sinon (404).

## 3. `Idempotency-Key`

- Décorateur `@Idempotent()` + intercepteur global. En-tête facultatif `Idempotency-Key` (8 à 100
  caractères). Table `idempotency_key` : `companyId`, `userId`, `key`, `method`, `path`,
  `requestHash` (sha256 du corps), `status` (`IN_PROGRESS`, `DONE`), `responseStatus`,
  `responseBody`, `createdAt` ; unique `(company_id, key)`.
- Première requête : ligne `IN_PROGRESS`, exécution, puis `DONE` avec la réponse. Erreur 4xx/5xx :
  la ligne est supprimée (on peut réessayer avec la même clé).
- Même clé, même contenu : réponse enregistrée renvoyée (même statut). Contenu différent :
  `422 IDEMPOTENCY_MISMATCH`. Requête en cours : `409 IN_PROGRESS`. Expiration : 24 h.
- Routes : `POST /settlements`, `POST /stock/receipts`, `POST /routes/launch` (lancement de la
  préparation), `POST /loads/plan`, `POST /loads/:id/validate`, `POST /unloads`,
  `POST /inventories/:id/validate`, `POST /advances/:id/pay`, `POST /payroll/payments/:id/pay`.
- Web et mobile : une clé par tentative de formulaire (`useIdempotencyKey`), renouvelée après un
  succès.

## 4. Conflit de version

- DTO des fiches éditables : champ `version`. Corps de modification : `version?: number`.
- Si `version` est envoyée et différente de la base : `409 VERSION_CONFLICT` (`details.current`),
  rien n'est écrit. Mise à jour conditionnelle (`updateMany where { id, version }`) pour fermer la
  course entre lecture et écriture.
- Routes : `PATCH` clients, produits, unités, parfums, utilisateurs, secteurs, types de clients,
  gammes, catégories, fournisseurs, entrepôts, motifs, paliers, bonus, règles de prime ;
  `PUT /settings` (version des paramètres).
- Web : les formulaires de ces fiches envoient la version reçue ; un 409 affiche « Modifiée
  entre-temps par quelqu'un d'autre : rechargez la page. »

## 5. Pagination et tri

- Helper `paginate` : `?limit` (50 par défaut, 200 au plus), `?cursor` (opaque, valeur de tri + id),
  `?sort=champ` ou `?sort=-champ` parmi une liste autorisée par route ; réponse
  `{ data, nextCursor, total }`.
- Routes : `GET /orders`, `/payments`, `/stock/movements`, `/stock/receipts`, `/inventories`,
  `/loads`, `/unloads`, `/discrepancies`, `/advances`, `/deductions`, `/incentives`,
  `/platform/companies`. Les filtres existants restent.
- Consommateurs mis à jour : pages Web concernées (« Afficher plus »), écrans du magasinier.
- `sort` inconnu : `400 VALIDATION_ERROR`.

## 6. Erreurs et protections

- Tests : forme `{ error: { code, message, details?, requestId } }` pour 400 (champs dans
  `details`), 401, 403, 404 (ressource et route inconnue), 409, 422, 429.
- Test : chaque permission exigée par une route existe dans le catalogue et a un module.
- Rate limiting inchangé (300/min, connexion plus stricte).

## 7. Tests et limites

- API : OpenAPI (toutes les routes, schémas du corps de `POST /customers`, absent en production),
  idempotence (rejeu, conflit de contenu, en cours, erreur non mémorisée), versions (409, sans
  version accepté, réussite), pagination (pages complètes sans doublon, tri, limite, curseur
  invalide), erreurs.
- Web et mobile : typage ; pas de tests d'écran.
