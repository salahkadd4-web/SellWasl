# API — SellWasl

> **Phase 1 — rédigé le 2026-10-02.**
> Ce document fixe les conventions de l'API REST et la liste de ses endpoints pour le MVP, dont le protocole de synchronisation du mobile. La documentation détaillée de chaque endpoint (schémas complets) sera générée en OpenAPI à partir des schémas Zod de `packages/validation` (architecture §3).
>
> Documents liés : [rbac.md](rbac.md) (permissions), [modules.md](modules.md) (modules), [database.md](database.md) (données), [architecture.md](architecture.md) §10 (synchronisation).

## Sommaire

1. [Conventions](#1-conventions)
2. [Erreurs](#2-erreurs)
3. [Authentification et appareils](#3-authentification-et-appareils)
4. [Plateforme](#4-plateforme)
5. [Endpoints de l'entreprise](#5-endpoints-de-lentreprise)
6. [Synchronisation du mobile](#6-synchronisation-du-mobile)
7. [Opérations du mobile](#7-opérations-du-mobile)
8. [Imports et exports](#8-imports-et-exports)
9. [Limites de débit](#9-limites-de-débit)

---

## 1. Conventions

| Sujet | Convention |
|---|---|
| Adresse | `https://<domaine>/api/v1/…`. Sur le Web, même domaine que l'application (architecture §8) |
| Version | Dans le chemin (`/v1`). Une modification incompatible crée `/v2` ; les ajouts de champs restent en `/v1` |
| Format | JSON, en UTF-8. Clés en `camelCase` |
| Ressources | Noms au pluriel, en `kebab-case` : `/customer-types`, `/price-tiers` |
| Identifiants | UUID v7 |
| Montants | Entiers, en **dinars** (`"totalAmount": 67200`) (ARC-05) |
| Quantités | Entiers en unité de base (`qty`), accompagnés, à la saisie, de l'unité et de la quantité saisies (`unitId`, `enteredQty`) |
| Dates | Date métier : `"2026-10-03"`. Instant : ISO 8601 en UTC, `"2026-10-03T08:15:00Z"` |
| Entreprise | **Jamais dans la requête** : déduite de la session (BR-TEN-02). Un champ `companyId` envoyé est ignoré |
| Authentification | En-tête `Authorization: Bearer <jeton d'accès>` ; sur le Web, le jeton de rafraîchissement est dans un cookie `HttpOnly` |
| Pagination | Par curseur : `?limit=50&cursor=<opaque>` → `{ "data": [...], "nextCursor": "…" }`. `limit` vaut 50 par défaut, 200 au plus |
| Filtres et tri | Paramètres de requête nommés (`?territoryId=…&status=ACTIVE`) ; tri par `?sort=name` ou `?sort=-createdAt` |
| Modification concurrente | Les ressources éditables sur le Web renvoient leur `version`. Une mise à jour (`PATCH`) l'envoie : si elle a changé entre-temps, la réponse est `409 VERSION_CONFLICT` et rien n'est écrasé |
| Idempotence sur le Web | Les créations qui touchent à l'argent ou au stock (versement, entrée de stock, lancement de préparation) acceptent l'en-tête `Idempotency-Key`. Un double clic ne crée qu'une seule fois |
| Documentation | OpenAPI généré, servi à `/api/docs` en développement et en staging, jamais en production |

---

## 2. Erreurs

Toutes les erreurs ont la même forme :

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Le quota du jour est atteint pour ce produit.",
    "details": { "productVariantId": "…", "remainingQty": 0 },
    "requestId": "01J…"
  }
}
```

`message` est en français et peut être affiché tel quel. Le Web et le mobile s'appuient sur `code`, qui ne change jamais.

| HTTP | Codes | Signification |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Données invalides ; `details` liste les champs |
| 401 | `UNAUTHENTICATED`, `TOKEN_EXPIRED` | Pas de session, ou jeton expiré : le client rafraîchit |
| 403 | `FORBIDDEN`, `WRONG_CHANNEL`, `DEVICE_REVOKED`, `DEVICE_BLOCKED`, `COMPANY_SUSPENDED`, `MODULE_DISABLED` | Refus : voir rbac.md §3 |
| 404 | `NOT_FOUND` | Inexistant **ou hors du périmètre** de l'utilisateur (rbac.md §3) |
| 409 | `VERSION_CONFLICT`, `DUPLICATE`, `INVALID_STATE` | Modification concurrente, doublon, ou action impossible dans l'état actuel (par exemple rouvrir une journée dont la préparation est lancée) |
| 422 | `BUSINESS_RULE` | Règle métier violée ; `details.rule` donne l'identifiant (`BR-JOU-08`) |
| 422 | `AMBIGUOUS_PART` | Plusieurs parties contiennent la position d'un client ; `details.options` les liste, à choisir (BR-ORG-04) |
| 422 | `IMPORT_INVALID` | Fichier d'import illisible : colonnes obligatoires absentes, trop de lignes |
| 429 | `RATE_LIMITED` | Trop de requêtes (§9) |
| 500 | `INTERNAL_ERROR` | Erreur inattendue, remontée à Sentry avec le `requestId` |

---

## 3. Authentification et appareils

### 3.1 Web

| Méthode | Chemin | Usage |
|---|---|---|
| `POST` | `/auth/login` | Code de l'entreprise, code ou email de l'utilisateur, mot de passe → jeton d'accès ; cookie de rafraîchissement. Les codes utilisateur n'étant uniques que dans une entreprise, le code de l'entreprise est demandé ; le Web le mémorise |
| `POST` | `/auth/refresh` | Nouveau jeton d'accès ; rotation du jeton de rafraîchissement |
| `POST` | `/auth/logout` | Révoque la session |
| `POST` | `/auth/password` | Changer son mot de passe (obligatoire si `mustChangePassword`) |
| `GET` | `/me` | Utilisateur, rôle, permissions effectives, modules actifs, paramètres utiles à l'affichage |

Le mot de passe oublié d'un utilisateur d'entreprise est réinitialisé par l'admin (`POST /users/{id}/reset-password`), qui obtient un mot de passe provisoire à changer à la première connexion. La réinitialisation par email viendra avec les notifications par email, après le MVP.

### 3.2 Mobile

| Méthode | Chemin | Usage |
|---|---|---|
| `POST` | `/auth/device/activate` | Code d'association (QR ou code de secours, ARC-04), informations de l'appareil, mot de passe → appareil enregistré, `deviceId`, série, jetons |
| `POST` | `/auth/device/login` | `deviceId` et mot de passe → jetons : l'utilisateur est celui de l'appareil. Refusé si l'appareil n'est plus actif |
| `POST` | `/auth/refresh` | Comme sur le Web ; le jeton de rafraîchissement est lié à l'appareil |
| `POST` | `/devices/heartbeat` | Signal de vie : batterie, opérations en attente, position, version de l'application (architecture §11.3). Position ignorée hors journée en cours (BR-JOU-09) ; la réponse donne `positionRecorded` et l'intervalle d'envoi `intervalMin` (paramètres de l'entreprise) |
| `PUT` | `/devices/push-token` | Enregistrer le jeton de notification push |
| `GET` | `/me/today?date=AAAA-MM-JJ` | `workdays.own` — journée du vendeur à la date du téléphone : état de la journée, liste du jour (secteur, partie, clients), visites du jour, compteurs x/N et hors programme, encaissé du jour, visite en cours, règles utiles (distance hors zone, P-01, P-02), code et série pour les reçus (phase 15) |
| `GET` | `/me/objectives?month=AAAA-MM` | `objectives.read` — objectifs du mois par gamme : cible, réalisé, taux, prime estimée (BR-OBJ-04) |
| `GET` | `/me/visit-catalog?customerId=…&date=…` | `orders.own` — articles proposables au client (prix de son type, stock disponible au dépôt), grille de prix, quota restant par article ; aucune quantité de stock (BR-CMD-06) |
| `GET` | `/me/orders?date=…` | `orders.own` — commandes du vendeur à cette date, avec leurs lignes |

### 3.3 Appareils, côté Web

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/devices`, `/users/{id}/devices` | `devices.read` — utilisateurs terrain et téléphone en service (batterie, opérations en attente, dernier signal) ; historique des téléphones et sessions ouvertes d'un utilisateur |
| `POST` | `/users/{id}/activation-codes` | `devices.associate` — renvoie le code et le contenu du QR ; avertit si l'ancien appareil a des opérations en attente (BR-USR-08) |
| `POST` | `/devices/{id}/revoke` | `devices.revoke` |
| `POST` | `/devices/{id}/block`, `/devices/{id}/unblock` | `devices.revoke` — le blocage ferme les sessions mais garde l'association ; après le déblocage, l'utilisateur se reconnecte avec son mot de passe |
| `POST` | `/sessions/{id}/revoke`, `/users/{id}/sessions/revoke` | `devices.revoke` — ferme une session, ou toutes celles d'un utilisateur terrain : il doit ressaisir son mot de passe. Les sessions Web se ferment en désactivant le compte ou en réinitialisant le mot de passe |

---

## 4. Plateforme

Préfixe `/platform`, réservé aux sessions `PlatformUser` (rbac.md §2.1).

| Méthode | Chemin | Permission | Usage |
|---|---|---|---|
| `POST` | `/platform/auth/login`, `/platform/auth/refresh`, `/platform/auth/logout` | — | Connexion séparée du Super Admin |
| `GET` | `/platform/companies` | `companies.read` | Liste, avec statut et mode |
| `POST` | `/platform/companies` | `companies.create` | Nom, code, mode, administrateur → entreprise, modules, rôles, paramètres par défaut (modules.md §4) ; renvoie une seule fois le mot de passe provisoire de l'administrateur |
| `GET` | `/platform/companies/{id}` | `companies.read` | Détail, nombre d'utilisateurs et d'appareils |
| `POST` | `/platform/companies/{id}/mode` | `companies.update` | Changement de mode avec ses contrôles (modules.md §8) ; refus `409 INVALID_STATE` avec la liste de ce qui bloque (`details.blockers`) |
| `PATCH` | `/platform/companies/{id}` | `companies.update` | Nom *(après le MVP)* |
| `POST` | `/platform/companies/{id}/suspend`, `/platform/companies/{id}/reactivate` | `companies.suspend` | |
| `GET` | `/platform/audit` | `platform.audit.read` | |

---

## 5. Endpoints de l'entreprise

Chaque ligne indique la permission requise ; les modules de ces permissions sont dans [rbac.md §4](rbac.md#4-catalogue-des-permissions). Les écritures du terrain (visites, commandes, livraisons…) ne passent **pas** par ces endpoints, mais par la synchronisation (§6).

### 5.1 Entreprise et utilisateurs

| Méthode | Chemin | Permission |
|---|---|---|
| `GET`, `PUT` | `/settings` | `settings.read`, `settings.update` — crée une nouvelle version (ARC-12) |
| `GET` | `/settings/versions` | `settings.read` |
| `GET` | `/modules` | `modules.read` |
| `GET`, `POST`, `PATCH` | `/customer-types`, `/reasons`, `/warehouses` | `settings.read`, `settings.update` (`isActive: false` désactive ; un motif système reste actif ; il reste toujours un type de client actif) |
| `GET`, `POST`, `DELETE` | `/holidays` | `settings.read`, `settings.update` |
| `GET`, `POST` | `/users` | `users.read`, `users.create` — la création renvoie une seule fois le mot de passe provisoire |
| `GET` | `/roles` | `users.read` — rôles de l'entreprise, avec `available` selon les modules actifs |
| `PATCH` | `/users/{id}` | `users.update` — jamais son propre rôle ; il reste toujours un administrateur actif ; un changement de rôle ferme les sessions |
| `POST` | `/users/{id}/disable`, `/users/{id}/enable` | `users.disable` |
| `POST` | `/users/{id}/reset-password` | `users.update` |
| `GET` | `/audit` | `audit.read` |
| `GET`, `PATCH` | `/notifications`, `/notifications/{id}/read` | Propres notifications |

### 5.2 Catalogue

| Méthode | Chemin | Permission |
|---|---|---|
| `GET`, `POST`, `PATCH` | `/product-ranges`, `/product-categories` | `products.read`, `products.write` |
| `GET`, `POST` | `/products` | `products.read`, `products.write` |
| `GET`, `PATCH` | `/products/{id}` | `products.read`, `products.write` |
| `POST` | `/products/{id}/variants` (parfums), `/products/{id}/units` (conditionnements) | `products.write` — le premier parfum d'un produit qui n'en avait pas reprend son article, avec son stock et son historique ; le nombre d'unités de base d'un conditionnement ne change plus ensuite |
| `PATCH` | `/products/{id}/variants/{variantId}`, `/products/{id}/units/{unitId}` | `products.write` — nom, référence, activation ; l'unité de base et le dernier parfum actif ne se désactivent pas |
| `PUT`, `DELETE` | `/products/{id}/photo`, `/products/{id}/variants/{variantId}/photo` | `products.write` — formulaire `file` (JPEG, PNG ou WebP, 5 Mo au plus, type vérifié sur le contenu). `photo` du produit et des parfums : `{ url, thumbUrl }` |
| `GET` | `/catalog/photos` | `products.read` — toutes les photos du catalogue actif (`productId`, `variantId`, `file`, `url` en 400 px), que le téléphone télécharge d'un coup après la connexion et garde hors connexion ; un fichier modifié change de nom |
| `GET`, `PUT` | `/products/{id}/prices` | `prices.read`, `prices.update` — grille complète : types de clients × unités × (produit ou parfum à prix propre). Un prix retiré est marqué supprimé, pour que les téléphones le retirent |
| `GET`, `POST`, `PATCH`, `DELETE` | `/price-tiers` | `prices.read`, `price_tiers.update` — `?productId=` ; seuil sur le total des parfums ou par parfum (BR-CAT-15) |
| `GET`, `POST`, `PATCH`, `DELETE` | `/bonus-rules` | `prices.read`, `bonuses.update` |
| `POST` | `/pricing/simulate` | `prices.read` — calcule un panier (prix, paliers, bonus) avec `packages/business-rules`, pour vérifier une grille avant de la publier |

### 5.3 Organisation du terrain et clients

| Méthode | Chemin | Permission |
|---|---|---|
| `GET`, `POST` | `/territories` | `territories.read`, `territories.update` — liste avec parties (GeoJSON), planning, vendeur, livreur, types servis et nombre de clients par partie |
| `PATCH` | `/territories/{id}` | `territories.update` — code, nom, types de clients servis, vendeur (un seul secteur par vendeur, BR-ORG-01), livreur, nombre de parties, activation |
| `PUT` | `/territories/{id}/parts` | `territories.update` — toutes les parties (numéro, nom, polygone GeoJSON) ; une partie absente est supprimée. Parties d'un même secteur qui se chevauchent : `422`. Réponse : clients déplacés, chevauchements avec des secteurs d'un même type (signalés, non bloquants), parties supprimées (BR-ORG-06) ; `?dryRun=true` pour l'aperçu avant confirmation |
| `PUT` | `/territories/{id}/schedule` | `territories.update` — `days: [{ weekday, partId }]` ; quand les jours d'une partie changent, la date de référence de ses clients passe au nouveau jour de la même semaine |
| `GET` | `/territories/overlaps` | `territories.read` — chevauchements entre parties d'un même secteur, ou de secteurs qui servent un même type (BR-ORG-02, BR-ORG-03) |
| `GET` | `/map/customers`, `/map/field-users` | `territories.read` — clients actifs avec position ; dernière position des vendeurs et livreurs en journée (moins de 24 h) |
| `POST` | `/customers/assign-part` | `customers.update` — `customerIds`, `partId` : place des clients dans une partie (forcée) ; `partId: null` les rend au calcul automatique |
| `GET`, `POST` | `/customers` | `customers.read`, `customers.create` — filtres : `q` (nom, code, téléphone, adresse), `territoryId`, `partId` (`none` : hors partie), `customerTypeId`, `status` (`ACTIVE` par défaut, `INACTIVE`, `ALL`), `toReview=true` (BR-CLI-05) ; tri par nom, réponse `{ data, nextCursor, total }`. Un utilisateur terrain ne voit que les clients de son secteur (vendeur) ou des secteurs qu'il livre (livreur). Créé par un vendeur : rattaché à son secteur, « nouveau », sans crédit, position obligatoire (BR-CLI-02, BR-CLI-03). Créé sur le Web : partie calculée parmi tous les secteurs qui servent le type, ou `partId` choisi (partie forcée) ; si plusieurs parties conviennent, `422 AMBIGUOUS_PART` avec `details.options` |
| `GET`, `PATCH` | `/customers/{id}` | `customers.read`, `customers.update` — `partId` force la partie, `partId: null` la libère ; une nouvelle position ou un nouveau type recalcule la partie si elle n'est pas forcée ; un changement de partie recalcule la date de référence (BR-PLA-03) ; `isClosedPermanently: false` retire le signalement |
| `POST` | `/customers/{id}/validate` | `customers.update` — valide un client créé par un vendeur : il n'est plus « nouveau » ni limité au comptant (BR-CLI-03) |
| `POST` | `/customers/{id}/disable`, `/customers/{id}/enable` | `customers.disable` |
| `GET` | `/customers/{id}/history` | `customers.read` — visites, commandes, paiements, dette |
| `GET` | `/customers/{id}/reschedules`, `/planning/reschedules?userId=…` | `customers.read`, `territories.read` — reprogrammations à venir |
| `POST` | `/customers/{id}/reschedules` | `customers.reschedule` — `{ date }` : jour ouvré à venir, ni chômé ni férié (BR-PLA-04, BR-PLA-05) ; déjà reprogrammé ce jour : `409` |
| `DELETE` | `/customers/{id}/reschedules/{date}` | `customers.reschedule` |
| `GET` | `/planning/day?userId=…&date=…` | `territories.read` — liste du jour d'un vendeur, calculée comme sur le téléphone : statut du jour (travaillé, chômé, férié), partie prévue, clients avec `reason` `SCHEDULED` ou `RESCHEDULED` |
| `GET` | `/planning/calendar?userId=…&from=…&days=14` | `territories.read` — nombre de clients prévus chaque jour (31 jours au plus) |

### 5.4 Quotas, objectifs, journées

| Méthode | Chemin | Permission |
|---|---|---|
| `GET`, `PUT` | `/quotas?date=…` | `quotas.read`, `quotas.update` — saisie en masse : plusieurs vendeurs et articles |
| `GET`, `PUT` | `/objectives?month=…` | `objectives.read`, `objectives.update` |
| `GET` | `/workdays?date=…` | `workdays.read` |
| `POST` | `/workdays/{id}/reopen` | `workdays.reopen` — motif obligatoire ; `409 INVALID_STATE` si l'étape suivante a commencé (BR-JOU-08) |
| `POST` | `/workdays/{id}/force-close` | `workdays.force_close` — motif obligatoire (BR-JOU-10) |
| `GET` | `/workdays/{id}/summary` | `workdays.read` — récapitulatif de journée (BR-PAY-07) |

Phase 16 (réalisé) :

| Méthode | Chemin | Permission |
|---|---|---|
| `GET`, `PUT` | `/quotas?date=…` / `/quotas` | `quotas.read`, `quotas.update` — `{ date, entries: [{ userId, productVariantId, unitId, qty }] }`, `qty = 0` supprime ; pas de date passée |
| `GET`, `PUT` | `/objectives?month=…` / `/objectives` | `objectives.read`, `objectives.update` — avec réalisé et prime due |
| `GET` | `/pending-lines?date=…` | `pending_lines.process` |
| `POST` | `/pending-lines/decide` | `pending_lines.process` — `{ lineIds, decision: ACCEPT \| REFUSE }` ; accepter fusionne dans la ligne normale et réserve ; refuser crée une vente perdue |
| `GET` | `/orders?date=&sellerId=&status=`, `/orders/{id}` | `orders.read` — sur le téléphone, limité aux commandes du vendeur |
| `GET` | `/workdays?date=…` | `workdays.read` — une ligne par utilisateur terrain (visites, commandes, encaissé) |
| `POST` | `/workdays/{id}/reopen`, `/workdays/{id}/force-close` | `workdays.reopen`, `workdays.force_close` — `{ reason }` |

### 5.5 Commandes, ventes, préparation, livraison

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/orders`, `/orders/{id}` | `orders.read` — filtres : date, vendeur, secteur, statut, source |
| `GET` | `/pending-lines` | `pending_lines.process` |
| `POST` | `/pending-lines/decisions` | `pending_lines.process` — accepte ou refuse plusieurs lignes ; une ligne refusée devient une vente perdue (BR-QUO-06) |
| `GET` | `/delivery-routes?date=…` | `deliveries.read` — tournées, avec l'état de leurs conditions de lancement (BR-PRE-02) |
| `PATCH` | `/delivery-routes/{id}` | `preparation.launch` — changer le livreur avant le lancement (BR-PRE-01) |
| `POST` | `/delivery-routes/{id}/launch` | `preparation.launch` — `422` avec la liste de ce qui bloque si les conditions ne sont pas remplies |
| `GET` | `/deliveries` | `deliveries.read` |
| `GET` | `/lost-demands` | `orders.read` — ventes perdues et demandes perdues |

### 5.6 Stock et chargements

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/stock?warehouseId=…` | `stock.read` |
| `GET` | `/stock-movements` | `stock.read` |
| `GET` | `/loads`, `/unloads` | `loads.read` |
| `POST` | `/loads` | `loads.plan` — chargement d'un vendeur cash van ou rechargement (UC-62, P-07) |
| `GET` | `/inventory-counts` | `stock.read` |

Phase 17 (réalisé) — toute variation passe par le registre de stock (verrou, BR-STK-04, mouvement) ; quantités saisies `{ variantId, unitId, qty }`, stockées en unité de base :

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/stock?warehouseId=` | `stock.read` — physique, réservé, disponible, seuil, `isLow` ; dépôt principal par défaut |
| `GET` | `/stock/movements?warehouseId=&variantId=&type=&from=&to=` | `stock.read` — 200 derniers |
| `GET` | `/stock/alerts` | `stock.read` — articles sous leur seuil dans un dépôt actif |
| `PUT` | `/stock/thresholds` | `products.write` — `{ entries: [{ variantId, lowStockQty \| null }] }` |
| `GET`, `POST` | `/stock/receipts?from=&to=`, `/stock/receipts/{id}` | `stock.read`, `stock.receive` — entrée au dépôt (UC-40) : un `IN` par ligne ; phase 21 : `supplierId` (liste des fournisseurs), `lotNumber` et `expiresAt` par ligne, lot créé ou cumulé |
| `GET`, `POST`, `PATCH` | `/suppliers`, `/suppliers/{id}` | `products.read`, `products.write` — fournisseurs, nom unique (`409`) ; `supplierId` sur `PATCH /products/{id}` (fournisseur habituel) |
| `GET` | `/lots?variantId=` | `stock.read` — lots d'un article : n°, péremption, reçu, fournisseur |
| `POST` | `/unloads/photos` | `unloads.validate` — photo d'un produit défectueux (multipart `file`) → `{ key, url }` |
| `GET`, `POST` | `/inventories`, `/inventories/{id}` | `stock.read`, `inventory.count` — un brouillon par dépôt |
| `PUT` | `/inventories/{id}/lines` | `inventory.count` — remplace le comptage du brouillon |
| `POST` | `/inventories/{id}/validate` | `inventory.count` — `ADJUSTMENT` par écart ; compté sous le réservé : réservations des commandes les plus récentes réduites, lignes en rupture (UC-44) |
| `DELETE` | `/inventories/{id}` | `inventory.count` — brouillon seulement |
| `GET`, `POST` | `/loads?date=`, `/loads/{id}` | `loads.read`, `loads.load` — transfert dépôt → camion sur le disponible ; `CASH_VAN`, `RELOAD` (P-07) ou `ROUTE` (UC-42) |
| `GET` | `/unloads/pending`, `/unloads/preview?workdayId=`, `/unloads?date=` | `loads.read` |
| `POST` | `/unloads` | `unloads.validate` — journée clôturée ; écart signé avec motif `ADJUSTMENT` ; retour au dépôt ou stock gardé (P-06) ; la journée ne peut plus être rouverte (UC-43, BR-JOU-08) ; phase 21 : `conditions: [{ variantId, condition, qty, lotId?, photoKey? }]` (`RESTOCK`, `DEFECTIVE` avec photo, `EXPIRED`, `BROKEN`), somme = compté ; seul `RESTOCK` revient au dépôt, le reste sort en `WRITE_OFF` ; sans répartition, tout est remis en stock |

Phase 18 (réalisé) — tournées et préparation :

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/routes?date=` | `preparation.launch` — par livreur : commandes figées à livrer, secteurs, montant, ruptures, bloquants (`WORKDAY_IN_PROGRESS`, `PENDING_SYNC`, `PENDING_LINES`, `NO_DRIVER`, `NO_TRUCK`) ; tournées lancées |
| `POST` | `/routes/launch` | `preparation.launch` — `{ date, driverId }` ; bloquant → `422` avec `details.blockers` ; commandes `PREPARING` (UC-61) |
| `GET` | `/routes/preparing` | `preparation.do` — tournées à préparer (`PREPARING`) ou à charger (`READY`) |
| `GET` | `/routes/{id}/preparation` | `preparation.do` — liste de chargement par article et détail par commande (UC-41) |
| `POST` | `/routes/{id}/prepare` | `preparation.do` — `{ lines: [{ lineId, preparedQty }] }` dans l'unité de la ligne ; rupture : paliers et bonus recalculés (P-04), réservation ajustée ; commandes et tournée `READY` |
| `POST` | `/routes/{id}/load` | `loads.load` — réservation consommée, transfert dépôt → camion du livreur, tournée `LOADED` (UC-42) |

Phase 19 (réalisé) — livraison et objectifs du livreur. Opérations du téléphone (`POST /sync/push`) : `load.receive` (`loads.receive`), `delivery.confirm` et `delivery.fail` (`deliveries.own`) ; à la clôture du livreur, les livraisons non faites échouent « non livrée » et ses tournées se terminent.

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/me/route` | `deliveries.own` — journée, chargement à recevoir, tournée du jour, livraisons (client, dette, lignes), avancement |
| `GET` | `/me/truck-stock` | `stock.read` — stock du camion, consultable à tout moment (livreur et cash van) |
| `POST` | `/me/deliveries/preview` | `deliveries.own` — `{ orderId, lines, added }` : lignes chiffrées, bonus, dû, minimum à encaisser (BR-PAY-03) |
| `GET` | `/me/driver-objectives` | `deliveries.own` — objectif du mois (et du mois précédent si versement décalé) |
| `GET`, `PUT` | `/driver-objectives/settings` | `objectives.read`, `objectives.update` — `{ returnWeight, returnTiers: [{ maxRate, score }], criteria: [{ id, name, weight }] }`, poids de somme 100 |
| `GET`, `PUT` | `/driver-objectives?month=` / `/driver-objectives` | `objectives.read`, `objectives.update` — prime et notes (0 à 10) par livreur ; taux de retour, score, prime due |

Phase 20 (réalisé) — cash van, pointage du camion et bons. Opérations du téléphone : `truck.check` (`loads.receive`), `sale.confirm` (`sales.own`), `lost_demand.create` (`lost_demands.own`), `receipt.reprint` (`workdays.own`). Rien ne se livre ni ne se vend tant qu'un chargement `LOADED` du camion n'est pas pointé.

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/me/truck-check` | `loads.receive` — tout le stock du camion à pointer : reste de la veille et chargements du jour (BR-CV-02) |
| `GET` | `/me/receipts?date=` | `workdays.own` — bons du jour (livraison, vente, reçu de dette) avec de quoi les imprimer, nombre de réimpressions |
| `GET` | `/me/day-summary` | `workdays.own` — récapitulatif de la journée : bons, vendu, espèces, crédit, montant attendu (BR-PAY-07) |
| `GET` | `/me/ticket` | `workdays.own` — largeur du ticket (58 ou 80 mm) et en-tête de l'entreprise (BR-IMP-01) |
| `POST` | `/loads/plan` | `loads.plan` — `{ truckId, date, lines }` : chargement cash van préparé, `PLANNED` ; P-07 pour un second chargement (UC-62) |
| `GET` | `/loads/planned` | `loads.read` — chargements préparés à valider |
| `GET` | `/loads/last?truckId=` | `loads.read` — dernier chargement du camion, pour le reprendre |
| `POST` | `/loads/{id}/validate` | `loads.load` — `{ lines: [{ variantId, loadedQty }] }` en unité de base : transfert dépôt → camion, `LOADED` (BR-CV-01) |

### 5.7 Argent

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/payments` | `payments.read` |
| `GET` | `/debts` | `payments.read` — dettes par client, filtres par secteur et vendeur |
| `GET` | `/settlements?date=…` | `settlements.read` — journées à verser, montant attendu |
| `POST` | `/settlements` | `settlements.create` — journée et montant remis → écart (BR-PAY-08) |

Phase 20 (réalisé) :

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/workdays/{id}/summary` | `workdays.read` — récapitulatif d'une journée (BR-PAY-07) |
| `GET` | `/settlements?date=` | `settlements.read` — journées du jour : attendu, remis, écart signé (remis − attendu) |
| `POST` | `/settlements` | `settlements.create` — `{ workdayId, remittedAmount }` : journée clôturée, un seul versement (`409` sinon), audité |
| `GET` | `/debtors` | `payments.read` — clients endettés, plafond |
| `GET` | `/payments?from=&to=` | `payments.read` — paiements des journées de la période |
| `GET` | `/payments/export?from=&to=` | `payments.read` — CSV (`;`), formules neutralisées |

### 5.8 Analyse

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/reports/today` | `reports.read` — tableau du jour par utilisateur (UC-57). Le Web l'interroge toutes les 30 secondes (architecture §3) |
| `GET` | `/reports/map?date=…` | `reports.read` — polygones, clients visités ou non, dernières positions |
| `GET` | `/reports/users/{id}` | `reports.read` — fiche d'un vendeur ou d'un livreur |
| `GET` | `/reports/lost-sales` | `reports.read` |

Phase 21 (réalisé). Périodes `from`, `to` (jours inclus, 366 au plus, sinon `400`) ; filtres `territoryId`, `partId`, `userId`, `customerId`, `productId`, `driverId` ; calcul à la demande.

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/reports/dashboard?from&to&territoryId` | `reports.read` — CA, commandes, visites planifiées et réalisées, clients non visités et en retard, conversion, pré-vendeurs et livreurs actifs, commandes en préparation et en livraison, échecs, stock faible et ruptures ; bloc `returns` si le module `RETURNS_ANALYSIS` est actif et le droit `returns.read` accordé |
| `GET` | `/reports/today` | `reports.read` — une ligne par utilisateur de terrain : journée, x/N, hors zone, par téléphone, commandes, CA, dernière position, dernière synchronisation, batterie, opérations en attente, `online` (signal de moins de 3 × l'intervalle de position) |
| `GET` | `/reports/map?date` | `reports.read` — parties du jour, clients du jour (visités ou non), dernière position du jour de chaque utilisateur |
| `GET` | `/reports/users/{id}?from&to` | `reports.read` — fiche en lecture seule ; `returns` si le module est actif |
| `GET` | `/reports/commercial`, `/reports/presales`, `/reports/delivery`, `/reports/lost-sales` | `reports.read` — par jour, produit et client ; par pré-vendeur et secteur ; par livreur (délai moyen) et motif d'échec ; par article, client et vendeur |

Analyse des retours (module `RETURNS_ANALYSIS`, désactivé par défaut ; sinon `403`). Filtres en plus : `sellerId`, `lotId`, `supplierId`, `reasonId`, `condition`. Sous le volume minimum (`returnsMinVolume`, défaut 20), un taux vaut `null` avec `insufficient: true`.

| Méthode | Chemin | Permission |
|---|---|---|
| `GET` | `/returns/axis/{axis}?from&to` | `returns.read` — `axis` : `product`, `lot`, `supplier`, `seller`, `driver`, `customer`, `territory`, `route`, `reason`, `condition` ; refusé, retourné, revendu, écarts, coût net, taux de l'axe (`rateLabel`), part du défectueux ; un refus dont la contestation est retenue ne compte pas pour le client |
| `GET` | `/returns/cross?rows&cols&kind` | `returns.read` — deux axes différents (`400` sinon), faits `REFUSAL`, `RESALE`, `RETURN` ou `GAP` |
| `GET` | `/returns/facts?kind&axis&value` | `returns.read` — 200 faits au plus, avec commande, bon et déchargement ; `value=none` : faits sans valeur pour l'axe |
| `GET` | `/me/refusals?from&to` | `returns.contest` — refus des commandes du pré-vendeur (30 derniers jours par défaut) |
| `GET` | `/refusals/contested` | `returns.decide` — contestations à trancher |
| `POST` | `/refusals/{deliveryId}/decide` | `returns.decide` — `{ upheld }` → `UPHELD` (contestation retenue) ou `REJECTED` ; une seule fois (`409`), audité |

Les faits (`ReturnFact`) sont écrits dans la transaction qui les produit : `delivery.confirm` (un refus par ligne livrée sous le préparé, au prix de la commande ; une revente par quantité ajoutée), `delivery.fail` avec le motif système `REFUSED` (toute la commande), validation du déchargement (un retour par état constaté, un écart par ligne, valorisés au prix moyen des ventes du jour). Ils gardent les axes du moment.

---

## 6. Synchronisation du mobile

Principe et justification : [architecture §10](architecture.md#10-hors-connexion-et-synchronisation).

### 6.1 Envoi : `POST /sync/push`

Requête : les opérations en attente, dans l'ordre de l'appareil, par lots de 100 au plus.

```json
{
  "deviceId": "0192…",
  "operations": [
    {
      "opId": "0192a…",
      "deviceSeq": 418,
      "type": "order.confirm",
      "occurredAt": "2026-10-03T09:42:10Z",
      "workdayId": "0192b…",
      "settingsVersion": 7,
      "payload": { "…": "…" }
    }
  ]
}
```

Réponse : un résultat par opération, dans le même ordre.

```json
{
  "results": [
    {
      "opId": "0192a…",
      "status": "APPLIED_WITH_CHANGES",
      "changes": [
        { "kind": "QUOTA_PENDING", "productVariantId": "…", "pendingQty": 60 },
        { "kind": "STOCKOUT", "productVariantId": "…", "reservedQty": 40, "orderedQty": 60 }
      ]
    }
  ],
  "serverTime": "2026-10-03T09:43:01Z"
}
```

| Statut | Signification | Sur le téléphone |
|---|---|---|
| `APPLIED` | Appliquée telle quelle | L'opération quitte la file |
| `APPLIED_WITH_CHANGES` | Appliquée avec une transformation (BR-SYN-05) | L'opération quitte la file ; le vendeur voit les changements |
| `REJECTED` | Refusée, avec `error.code` | L'opération quitte la file mais reste visible dans « Synchronisation », avec le motif ; le superviseur la voit dans le journal |

- **Idempotence** : une opération déjà reçue (`opId` connu) renvoie le résultat enregistré, sans être rejouée (BR-SYN-02).
- **Ordre** : si `deviceSeq` saute un numéro, le serveur traite les opérations jusqu'au trou et répond `GAP` pour la suite. Le téléphone renvoie alors les opérations manquantes.
- **Transaction** : chaque opération est appliquée dans sa propre transaction. Une opération refusée n'empêche pas les suivantes, sauf si elles en dépendent (par exemple, le paiement d'une commande refusée est refusé aussi, avec le code `DEPENDS_ON_REJECTED`).
- **Recalage** : avec `GAP`, ou `REJECTED` + `DUPLICATE` sur le numéro d'ordre, `result.expectedDeviceSeq` donne le numéro attendu ; le téléphone renvoie l'opération avec ce numéro.
- **En ligne d'abord (phase 15)** : le téléphone envoie chaque opération tout de suite, une par requête ; la file hors connexion arrive avec la phase 23.
- **Appareil révoqué** : les opérations dont `occurredAt` est antérieur à la révocation sont acceptées ; les autres sont refusées avec `DEVICE_REVOKED` (BR-USR-11).

### 6.2 Réception : `GET /sync/pull`

```text
GET /sync/pull?cursor=184467&limit=500
```

```json
{
  "changes": {
    "customers":  [ { "id": "…", "name": "…", "debtAmount": 42000, "version": 12, "deletedAt": null } ],
    "quotas":     [ { "…": "…" } ],
    "orders":     [ { "…": "…" } ]
  },
  "cursor": 184982,
  "hasMore": false,
  "settingsVersion": 7,
  "modules": ["PRE_SALES", "DELIVERY", "WAREHOUSE", "ANALYTICS"],
  "permissions": ["orders.own", "visits.own", "…"]
}
```

- Le curseur est le dernier `change_seq` reçu (database.md §1.2). `cursor=0` déclenche la première synchronisation complète, page par page.
- Seules les tables et les lignes du périmètre de l'utilisateur sont envoyées (database.md §17).
- Les suppressions arrivent avec `deletedAt` renseigné.
- Si l'utilisateur change de secteur, le serveur répond `RESYNC_REQUIRED` : le téléphone envoie d'abord ses opérations en attente, puis repart de `cursor=0`.

### 6.3 Ordre d'une synchronisation

```text
1. POST /sync/push   tant qu'il reste des opérations
2. GET  /sync/pull   tant que hasMore = true
3. Mise à jour de l'indicateur : « Synchronisé » ou « N opérations en attente » (BR-SYN-06)
```

Au démarrage de la journée, le téléphone fait une synchronisation complète, puis enregistre la version des paramètres qu'il utilisera jusqu'à la clôture (ARC-12).

---

## 7. Opérations du mobile

Chaque type a un schéma Zod dans `packages/validation/sync`. Le serveur vérifie la permission, le module, le périmètre et l'état de la journée, puis applique les règles métier.

| Type | Rôles | Permission | Effets sur le serveur |
|---|---|---|---|
| `workday.start` | Pré-vendeur, cash van, livreur | `workdays.own` | Crée la journée ; P-01 ; signale un démarrage hors connexion (BR-JOU-04) ; écart d'horloge (BR-JOU-11) |
| `workday.close` | Idem | `workdays.own` | Clôture : commandes `LOCKED`, visites manquées, livraisons non traitées en échec, montant attendu (BR-JOU-07) |
| `customer.create` | Pré-vendeur, cash van | `customers.create` | Client du secteur du vendeur, partie calculée, « nouveau », P-09 ; notification au superviseur |
| `visit.start` | Pré-vendeur, cash van | `visits.own` | Visite `IN_PROGRESS`, mode, distance, hors zone (BR-VIS-02) ; P-02 pour une visite hors programme |
| `visit.close_no_order` | Idem | `visits.own` | Visite `COMPLETED` avec motif ; « fermé définitivement » → client à revoir |
| `order.confirm` | Pré-vendeur | `orders.own` | Prix figés ; scission des lignes au-delà du quota ; réservation au dépôt ; rupture ; bonus (BR-CMD, BR-QUO-03) |
| `order.update`, `order.cancel` | Pré-vendeur | `orders.own` | Seulement tant que la journée est en cours (BR-CMD-02) ; ajuste ou libère la réservation |
| `sale.confirm` | Cash van | `sales.own` | Vente définitive `DELIVERED` sur place, quota refusé (BR-QUO-04), sortie du stock du camion, paiement et bon (BR-CV-03 à 05) |
| `lost_demand.create` | Cash van | `lost_demands.own` | Demande perdue (BR-QUO-04) |
| `payment.delivery` | Livreur, cash van | `payments.collect_delivery` | Paiement, crédit dans la limite du plafond, écriture de dette (BR-PAY-03) |
| `payment.debt` | Pré-vendeur, cash van, livreur (P-08) | `payments.collect_debt` | Encaissement de dette ; excédent en avance si double encaissement (BR-PAY-04) |
| `load.receive` | Livreur, cash van | `loads.receive` | Réception ; écart signalé au superviseur (BR-PRE-05) |
| `truck.check` | Livreur, cash van | `loads.receive` | Pointage de tout le camion : écarts ajustés (« Marchandise manquante », « Autre »), chargements `RECEIVED`, tournées démarrées (BR-CV-02) |
| `delivery.complete` | Livreur | `deliveries.own` | Livrée ou partielle, recalcul selon P-04, sortie du stock du camion ; une quantité refusée exige `refusalReasonId` (BR-RET-01) ; quantités ajoutées gardées (`addedQty`) |
| `delivery.fail` | Livreur | `deliveries.own` | Échec avec motif ; reprogrammation selon P-05 (BR-LIV-06) ; motif « refus » : `refusalReasonId` obligatoire (BR-RET-01) |
| `refusal.contest` | Pré-vendeur | `returns.contest` | `{ deliveryId, comment }` : conteste un refus sur l'une de ses commandes, une fois (phase 21) |
| `receipt.reprint` | Livreur, cash van, pré-vendeur | `workdays.own` (ses propres bons) | Réimpression tracée dans l'audit ; le téléphone imprime « DUPLICATA » (BR-IMP-03) |
| `stock_receipt.create` | Magasinier | `stock.receive` | Entrée au dépôt (`IN`) |
| `preparation.submit` | Magasinier | `preparation.do` | Quantités préparées ; ruptures ; commandes `READY` (BR-PRE-03) |
| `load.validate` | Magasinier | `loads.load` | Transfert dépôt → camion ; la réservation est remplacée (BR-PRE-04) |
| `unload.validate` | Magasinier | `unloads.validate` | Comptage, écart, retour au dépôt ou stock gardé selon P-06 (BR-STK-07) |
| `inventory.submit` | Magasinier | `inventory.count` | Écarts en `ADJUSTMENT`, audités (BR-STK-06) |

Les numéros (commande, bon, reçu) sont fournis par le téléphone, au format de BR-CMD-07. Un numéro déjà utilisé par une autre opération est refusé (`DUPLICATE`) : c'est le signe d'une erreur de l'application, remontée à Sentry.

---

## 8. Imports et exports

### 8.1 Import CSV (BR-IO-01, BR-IO-02)

```text
1. POST /imports              (multipart : fichier, type CUSTOMERS ou PRODUCTS)
                              → importJob avec l'aperçu : lignes valides, lignes en erreur et motif
2. POST /imports/{id}/confirm → importe les lignes valides, dans une transaction
3. GET  /imports/{id}         → résultat
```

Fichier limité à 5 Mo et 10 000 lignes. Le champ `kind` du formulaire vaut `CUSTOMERS` (par défaut) ou `PRODUCTS`. Les modèles de fichiers CSV sont téléchargeables sur `GET /imports/templates/{customers|products}`. Permission : `imports.run`.

Colonnes du fichier des clients : `code`, `nom`*, `telephone`, `adresse`, `type`* (code ou nom du type), `latitude`, `longitude` (degrés décimaux, virgule acceptée), `frequence` (1, 2 ou 4 semaines), `credit_autorise` (oui ou non), `plafond_credit` (DA). Les en-têtes acceptent accents et majuscules. Un client sans position, ou dont la position est dans aucune ou plusieurs parties, est importé hors partie et rejoint les clients à revoir. Le fichier est vérifié de nouveau à la confirmation.

Fichier des produits : une ligne par produit (`reference_produit`*, `nom_produit`*, `gamme`*, `categorie`, `unite_base`*, `conditionnements` au format `carton=24|pack=6`), puis une ligne par parfum avec la même `reference_produit`, `reference_parfum` et `nom_parfum`. Prix en DA dans les colonnes `prix_<TYPE>_<unité>` : sur la ligne du produit, son prix ; sur la ligne d'un parfum, son prix propre (vide : prix du produit). Une gamme ou une catégorie inconnue est créée. Un produit dont une ligne est en erreur n'est pas importé ; l'import ne modifie pas un produit existant.

### 8.2 Exports CSV (BR-IO-03)

```text
GET /exports/{type}?from=…&to=…&territoryId=…&userId=…
type : sales, visits, objectives, debts, settlements, refusals, returns, resales, gaps
```

Permission `reports.export` ; `refusals`, `returns`, `resales` et `gaps` exigent aussi le module `RETURNS_ANALYSIS` (`403`). Un texte qui commence comme une formule est neutralisé.

La réponse est le fichier CSV (séparateur `;`, encodage UTF-8 avec BOM, pour une ouverture directe dans Excel), dans la limite de 100 000 lignes. Les exports ne contiennent que les données des modules actifs.

---

## 9. Limites de débit

| Endpoint | Limite |
|---|---|
| `/auth/login`, `/auth/device/login`, `/platform/auth/login` | 5 échecs par compte en 15 minutes, puis blocage de 15 minutes ; 20 tentatives par adresse IP et par minute |
| `/auth/device/activate` | 10 tentatives par adresse IP et par heure |
| `/sync/push`, `/sync/pull` | 60 requêtes par appareil et par minute |
| `/devices/heartbeat` | 2 par appareil et par minute |
| Autres endpoints | 300 requêtes par utilisateur et par minute |
