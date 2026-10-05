# Phase 18 — Préparation et mobile magasinier

> Spec validée le 2026-10-05. Plan : `plan_VF.md`, phase 18. Règles : `docs/business-rules.md`
> (BR-PRE-01 à 04, BR-QUO-06, BR-CAT-10, P-04, BR-STK-03 à 05), cas d'usage UC-41, UC-42, UC-61.

## 1. Décisions

| Sujet | Décision |
|---|---|
| Tournée | **Créée au lancement** (approche A). Avant, un regroupement calculé : commandes `LOCKED` d'une date de livraison, par livreur du secteur du client. |
| Réseau du magasinier | **En ligne, direct** : l'appli mobile appelle les mêmes routes REST que le Web. Hors connexion : phase 23. |
| Droits | `preparation.do` accordé par défaut à `COMPANY_ADMIN` et `SUPERVISEUR` (comme les opérations de stock en phase 17) ; migration pour les entreprises existantes. |
| Saisie préparée | Dans **l'unité de la ligne**, pré-remplie avec la quantité réservée (`floor(reservedQty ÷ base de l'unité)`). Lignes normales et bonus. |
| Recalcul | Si `P04_recalculateOnDecrease` (défaut vrai) : paliers et bonus recalculés sur les quantités préparées avec `priceCart` et la grille du type de client ; un bonus ne dépasse jamais ce qui a été préparé pour lui. Sinon les prix et bonus de la commande sont conservés. |
| Chargement d'une tournée | **Quantités préparées, confirmées** : pas de saisie. `RELEASE` de la réservation puis `TRANSFER` dépôt → camion du livreur. |
| Lignes en attente | Jamais préparées : le lancement est bloqué tant qu'il en reste à traiter ; une ligne refusée reste une vente perdue (phase 16). |
| Hors phase | Codes-barres (après le MVP) ; réception par le livreur, tournée et livraison (phases 19 et 20) ; vente des produits refusés à d'autres commandes de la tournée, sans créer de client (phase 19) ; chargement cash van préparé sur le Web (UC-62, phase 20) ; hors connexion (phase 23). |

## 2. Règles partagées (`packages/business-rules/src/preparation.ts`)

- `launchBlockers(x: { inProgressWorkdays: number; pendingSyncDevices: number; pendingLines: number; hasDriver: boolean; hasTruck: boolean }): LaunchBlocker[]` — codes `WORKDAY_IN_PROGRESS`, `PENDING_SYNC`, `PENDING_LINES`, `NO_DRIVER`, `NO_TRUCK`, dans cet ordre (BR-PRE-02).
- `defaultPrepared(reservedQty: number, unitBaseQty: number): number` — `floor(reservedQty / unitBaseQty)`.
- `capBonus(recomputed: number, prepared: number): number` — `min(recomputed, prepared)`.

## 3. Serveur — tournées (`apps/api/src/preparation/`)

### Lecture et lancement (UC-61) — `preparation.launch`
- `GET /routes?date=` → `RouteCandidateDto[]` : pour chaque livreur ayant des commandes `LOCKED` (sans tournée) livrables à cette date, et pour chaque tournée déjà créée ce jour-là : `{ routeId | null, status, driver | null, truck | null, territories: [{ id, code, name }], ordersCount, totalAmount, stockouts, blockers }`. Les commandes dont le secteur n'a pas de livreur forment un groupe `driver = null` bloqué par `NO_DRIVER`.
- Bloquants calculés sur les vendeurs des secteurs du groupe : journée `IN_PROGRESS` ; appareil actif avec `pendingOps > 0` ; lignes `PENDING` `TO_PROCESS` sur ces commandes ; livreur sans camion actif.
- `POST /routes/launch { date, driverId }` : refait le calcul **dans la transaction** ; bloquant → `BUSINESS_RULE` avec la liste. Crée `DeliveryRoute` (`PREPARING`, `truckId`, `launchedAt`, `launchedByUserId`), rattache les commandes (`routeId`, `PREPARING`). Audit `route.launch`.
- Changer le livreur d'un secteur : `PATCH /territories/:id` existant (`deliveryUserId`), appelé depuis la page Tournées.

### Préparation (UC-41) — `preparation.do`
- `GET /routes/preparing` (aussi `READY`) : tournées à préparer ou à charger, avec livreur, camion, nombre de commandes.
- `GET /routes/:id/preparation` → `{ route, items: [{ variantId, productName, variantName, orderedBase, reservedBase, available }], orders: [{ orderId, number, customerName, lines: [{ lineId, kind, variantId, productName, variantName, unitName, unitBaseQty, enteredQty, reservedQty, defaultPrepared }] }] }`.
- `POST /routes/:id/prepare { lines: [{ lineId, preparedQty }] }` (quantités dans l'unité de la ligne ; chaque ligne normale et bonus de la tournée attendue ; `0 ≤ préparé ≤ commandé`) : dans une transaction, par commande :
  1. prix : si P-04, `priceCart` sur les lignes normales préparées → nouveau `unitPrice` des lignes normales ; bonus recalculé par règle et plafonné par `capBonus` ; sinon prix et bonus de la commande ;
  2. réservation : écart `préparé(base) − réservé` → `RESERVATION` si positif (refusé si le dépôt n'a pas le disponible), `RELEASE` si négatif ; `reservedQty = préparé(base)` ;
  3. ligne : `preparedQty` (base), `lineAmount = unitPrice × préparé` (0 pour un bonus), `isStockout = préparé < commandé` ;
  4. commande : `totalAmount` = somme des lignes normales, statut `READY`.
  Tournée `READY`. Audit `route.prepare`.

### Chargement d'une tournée (UC-42) — `loads.load`
- `POST /routes/:id/load` : tournée `READY`, camion actif. Par ligne préparée : `RELEASE` de `reservedQty` ; par article : `TRANSFER` dépôt principal → camion du total préparé. Lignes `reservedQty = 0`. Crée `Load` (`ROUTE`, `routeId`, `LOADED`) et ses lignes. Tournée `LOADED`. Audit `load.validate`.

## 4. Mobile — magasinier (`apps/mobile/app/warehouse/*`)

Rôle `MAGASINIER` → écrans `warehouse` (comme `seller` pour les vendeurs), composants de `src/ui.tsx`, appels REST avec `request()` :
- **Tableau de bord** : tournées à préparer, à charger ; camions à décharger ; articles sous le seuil ; accès aux écrans.
- **Préparations** : tournées `PREPARING` → liste par article (commandé, réservé) → détail par commande avec quantité préparée modifiable → « Valider la préparation ».
- **Chargements** : tournées `READY` → « Charger le camion » ; chargement libre d'un camion (comme le Web).
- **Entrées**, **Déchargements**, **Inventaire**, **Stock** : mêmes fonctions que les pages Web de la phase 17.
- **Synchronisation** : état de la connexion au serveur (l'appli est en ligne).
- **Profil** : changer le mot de passe, se déconnecter.

## 5. Web

- Menu **Tournées** (`preparation.launch`) : date de livraison (prochain jour ouvré par défaut), une carte par livreur : secteurs (livreur modifiable par secteur), commandes, montant, ruptures, bloquants en clair, bouton « Lancer la préparation » désactivé avec la raison ; tournées lancées avec leur statut.
- Onglet **Préparations** des pages Stock (`preparation.do`) : même préparation que le mobile.
- Page **Chargements** : section « Tournées prêtes à charger » avec « Charger le camion ».

## 6. Erreurs

| Cas | Code |
|---|---|
| Lancement avec un bloquant | `BUSINESS_RULE` avec `details.blockers` |
| Tournée dans le mauvais état (préparer une tournée déjà prête, charger une tournée non prête) | `INVALID_STATE` |
| Ligne manquante, en trop, ou préparée au-delà du commandé | `VALIDATION_ERROR` / `BUSINESS_RULE` |
| Stock insuffisant pour préparer au-delà du réservé | `BUSINESS_RULE` (registre) |

## 7. Tests

- `packages/business-rules` : `launchBlockers`, `defaultPrepared`, `capBonus`.
- `apps/api/test/preparation.test.ts` : regroupement par livreur ; bloquants (journée en cours, ligne en attente, secteur sans livreur) puis lancement ; changement de livreur avant lancement ; préparation avec rupture (ligne réduite, palier recalculé, bonus plafonné, réservation libérée, total) ; P-04 faux conserve les prix ; préparation au-delà du réservé avec stock disponible ; chargement (réservation consommée, camion approvisionné, stock jamais négatif) ; droits (pré-vendeur refusé) ; état invalide.
