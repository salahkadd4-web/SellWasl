# Phase 17 — Entrepôt et stock

> Spec validée le 2026-10-05. Plan : `plan_VF.md`, phase 17. Règles : `docs/business-rules.md`
> (BR-STK-01 à 07, BR-CMD-04, BR-CV-01, BR-JOU-08, P-06, P-07), cas d'usage UC-40, UC-42, UC-43,
> UC-44.

## 1. Décisions

| Sujet | Décision |
|---|---|
| Écrans | **API et Web** dans cette phase. L'application mobile du magasinier arrive en phase 18 et utilisera la même API. |
| Droits Web | `COMPANY_ADMIN` et `SUPERVISEUR` reçoivent par défaut `stock.receive`, `inventory.count`, `loads.load`, `unloads.validate` (le magasinier est mobile seulement). Migration de données pour les entreprises existantes ; l'entreprise peut les retirer. |
| Architecture | **Un registre de stock unique** (`StockLedger`) : toute variation de stock passe par lui (verrou, contrôle, mouvement), y compris la réservation et la libération des commandes. |
| Chargement | Complet depuis le Web : transfert dépôt → camion **pris sur le disponible** (jamais sur le réservé). La consommation des réservations par la préparation des tournées : phase 18. Réception par le livreur : phase 20 (le chargement reste `LOADED`). |
| Déchargement | Complet depuis le Web, après la clôture de la journée du conducteur du camion. Écart dans les deux sens, motif obligatoire, P-06 respecté. |
| Inventaire | Le compté devient le stock réel. S'il passe sous le réservé, les réservations des commandes confirmées le plus récemment sont réduites et leurs lignes passent en rupture. |
| Stock faible | Seuil **par article** (`ProductVariant.lowStockQty`, unité de base, facultatif), comparé au disponible de chaque dépôt. Alerte sur la page Stock et compteur sur l'accueil ; notifications push en phase 24. |
| Dépôt des commandes | Inchangé : le dépôt actif principal (premier `DEPOT` par code). |
| Hors phase | Emplacements, transferts entre dépôts, retours clients `RETURN` (après le MVP), préparation des tournées et mobile magasinier (phase 18), sorties réelles à la livraison et à la vente (phases 19 et 20 ; la primitive `OUT` est prête), notifications (phase 24). |

## 2. Règles partagées (`packages/business-rules/src/stock.ts`)

- `applyMove(balance: { physical; reserved }, delta: { physical; reserved }): { physical; reserved } | null` — `null` si le résultat viole `physical ≥ 0`, `reserved ≥ 0` ou `reserved ≤ physical` (BR-STK-02, BR-STK-04).
- `moveDeltas(move)` — effet d'un mouvement sur chaque entrepôt :
  - `IN` : `to.physical + qty` ;
  - `OUT` : `from.physical − qty` ;
  - `TRANSFER` : `from.physical − qty`, `to.physical + qty` ;
  - `ADJUSTMENT` : `from.physical − qty` (manquant) ou `to.physical + qty` (surplus) ;
  - `RESERVATION` : `to.reserved + qty` ; `RELEASE` : `from.reserved − qty`.
- `unloadLine({ theoretical, delivered, free, counted })` → `{ loaded: theoretical + delivered + free, gap: counted − theoretical }`. Écart positif = surplus, négatif = manquant (BR-STK-07).
- `releaseNewestFirst(reservations: { lineId; confirmedAt; reservedQty }[], shortfall: number)` → `{ lineId; release }[]`, en commençant par la commande confirmée le plus récemment.
- `isLowStock(available: number, threshold: number | null): boolean` — `threshold !== null && available < threshold`.

## 3. Serveur — le registre (`apps/api/src/stock/stock-ledger.service.ts`)

`apply(tx, actor: { companyId; userId; deviceId? }, moves: Move[], occurredAt = now): Promise<void>`

`Move = { type; variantId; qty > 0; fromWarehouseId?; toWarehouseId?; source?: { type: StockSourceType; id }; reasonId? }`

1. Rassemble les couples (entrepôt, article) touchés ; crée les lignes `Stock` manquantes (`INSERT … ON CONFLICT DO NOTHING`) ; les verrouille dans l'ordre (`SELECT … FOR UPDATE` trié par entrepôt puis article).
2. Applique les mouvements dans l'ordre sur les soldes en mémoire avec `applyMove`. Au premier refus : `BUSINESS_RULE` « Stock insuffisant : <article> dans <entrepôt> (disponible N) » ; la transaction de l'appelant est annulée en entier (BR-STK-05).
3. Écrit les soldes (`Stock.physicalQty`, `reservedQty`, `version + 1`) et un `StockMovement` par mouvement (utilisateur, appareil, date, source, motif) — en ajout seul (BR-STK-03).

`OrderService.reserve`, `OrderService.release` et l'acceptation d'une ligne en attente (`PendingLinesService.accept`) passent par le registre : `RESERVATION` / `RELEASE` avec `source = ORDER`. La règle de couverture partielle (`take = min(demandé, disponible)`) reste dans l'appelant.

## 4. Serveur — documents et lectures

Contrôleurs dans `apps/api/src/stock/`. Schémas Zod dans `packages/validation/src/stock.ts`. Quantités saisies : `{ variantId, unitId, qty }` converties en unité de base (`qty × unit.baseQty`) ; l'unité doit appartenir au produit de l'article.

### Entrées au dépôt (UC-40) — `stock.receive`
- `POST /stock/receipts` `{ warehouseId (DEPOT actif), reference?, supplier?, lines (1 à 200, un article une fois) }` → `StockReceipt` + lignes + un `IN` par ligne (`source = RECEIPT`). Audit `stock.receive`.
- `GET /stock/receipts?from&to` (`stock.read`) : liste avec le nombre de lignes ; `GET /stock/receipts/:id` : détail.

### Inventaire (UC-44) — `inventory.count`
- `POST /inventories` `{ warehouseId (DEPOT) }` → brouillon `DRAFT` ; un seul brouillon par dépôt (`BUSINESS_RULE` sinon).
- `PUT /inventories/:id/lines` `{ lines: [{ variantId, unitId, qty }] }` : remplace le comptage du brouillon (`countedQty` en unité de base ; `expectedQty` = physique du moment, pour information).
- `POST /inventories/:id/validate` : verrouille, recalcule `expectedQty` sur le physique du moment, `gapQty = counted − expected` ; un `ADJUSTMENT` par écart non nul (`source = INVENTORY`) ; si `counted < reserved` (dépôt principal), libère `reserved − counted` avec `releaseNewestFirst` : `RELEASE` (`source = ORDER`), `OrderLine.reservedQty` diminué, `isStockout = true`. Statut `VALIDATED`. Résultat `{ adjustments, releasedLines: [{ orderNumber, customerName, variantId, released }] }`. Audit `inventory.validate`. Les articles non comptés ne changent pas.
- `DELETE /inventories/:id` : supprime un brouillon. `GET /inventories`, `GET /inventories/:id` (`stock.read`).

### Chargement (UC-42) — `loads.load`
- `POST /loads` `{ truckId, date, fromWarehouseId?, lines }` : camion `TRUCK` actif avec un utilisateur affecté ; dépôt par défaut = dépôt principal. Type : `CASH_VAN` si l'utilisateur affecté est `VENDEUR_CASH_VAN`, `RELOAD` s'il a déjà un chargement ce jour-là (refusé si P-07 est faux), sinon `ROUTE`. Chaque quantité ≤ disponible du dépôt (physique − réservé) sinon `BUSINESS_RULE`. Crée `Load` (`LOADED`, `loadedByUserId`, `loadedAt`), `LoadLine` (`plannedQty = loadedQty`) et un `TRANSFER` par ligne (`source = LOAD`). Audit `load.validate`.
- `GET /loads?date` (`loads.read`) : chargements du jour avec camion, conducteur, total ; `GET /loads/:id`.

### Déchargement (UC-43) — `unloads.validate`
- `GET /unloads/pending` (`loads.read`) : journées `CLOSED` d'un utilisateur affecté à un camion, sans déchargement, dont le camion a du stock ou un chargement ce jour-là.
- `GET /unloads/preview?workdayId` : une ligne par article du camion (stock > 0, ou chargé ou sorti ce jour-là) : `theoretical` = physique actuel du camion ; `delivered` = `OUT` du camion à la date de la journée ; `free` = 0 tant que les phases 19 et 20 ne distinguent pas l'offert ; `loaded = theoretical + delivered + free`.
- `POST /unloads` `{ workdayId, lines: [{ variantId, countedQty, reasonId? }] }` : toutes les lignes de l'aperçu sont attendues ; motif `ADJUSTMENT` obligatoire quand l'écart ≠ 0 (`VALIDATION_ERROR` sinon). Pour chaque écart : `ADJUSTMENT` (`from` le camion si manquant, `to` le camion si surplus ; `source = UNLOAD`). Puis, si `P06_fullUnload` : `TRANSFER` camion → dépôt principal du compté, le camion revient à zéro ; sinon le stock reste (`keepsStockInTruck = true`). Crée `Unload` (`VALIDATED`, `validatedByUserId`, `validatedAt`) et ses `UnloadLine`. Audit `unload.validate` (avec écart signalé : `hasGap` dans la liste).
- `GET /unloads?date` (`loads.read`) : déchargements avec conducteur, camion, total de l'écart.
- **BR-JOU-08** : `POST /workdays/:id/reopen` refuse une journée déjà déchargée.

### Consultation et seuils
- `GET /stock?warehouseId` (`stock.read`) : par article actif `{ variantId, productName, variantName, physical, reserved, available, lowStockQty, isLow }`.
- `GET /stock/movements?warehouseId&variantId&type&from&to` (`stock.read`) : 200 derniers, avec utilisateur, entrepôts, motif, source.
- `GET /stock/alerts` (`stock.read`) : articles sous le seuil dans un dépôt actif ; l'accueil Web affiche leur nombre.
- `PUT /stock/thresholds` `{ entries: [{ variantId, lowStockQty: number | null }] }` (`products.write`). Audit `stock.thresholds`.

## 5. Données

- Migration : `product_variant.low_stock_qty INT NULL CHECK (low_stock_qty >= 0)`.
- Migration de données : permissions de la §1 ajoutées aux rôles `COMPANY_ADMIN` et `SUPERVISEUR` existants ; motifs `ADJUSTMENT` « Retour client » et « Marchandise manquante » ajoutés à chaque entreprise (et à `DEFAULT_REASONS`).
- `packages/business-rules/src/permissions.ts` : matrice mise à jour ; `docs/rbac.md` aussi.

## 6. Web (`apps/web`, espace `/app`)

Menu : une entrée « Stock » (`stock.read`) ; les pages du stock partagent une barre d'onglets : Stock, Entrées, Inventaires, Chargements, Déchargements, Mouvements.
- **Stock** : choix de l'entrepôt ; tableau physique / réservé / disponible ; articles sous le seuil mis en évidence ; seuils modifiables (`products.write`).
- **Entrées** : liste par période ; formulaire « Nouvelle entrée » (dépôt, fournisseur, référence, lignes article + unité + quantité).
- **Inventaires** : liste ; brouillon (comptage par article, enregistrement, validation avec le résultat des réservations réduites).
- **Chargements** : liste du jour ; formulaire « Nouveau chargement » (camion, date, lignes, disponible affiché).
- **Déchargements** : à décharger ; écran de comptage (chargé, livré, théorique, compté, écart signé, motif) ; historique avec écart.
- **Mouvements** : filtres et liste.
- **Accueil** : compteur des articles sous le seuil, lien vers la page Stock.

## 7. Erreurs

| Cas | Code |
|---|---|
| Stock insuffisant (registre ou chargement) | `BUSINESS_RULE` avec l'article et le disponible |
| Entrepôt inconnu, inactif ou du mauvais type ; camion sans conducteur | `BUSINESS_RULE` |
| Brouillon d'inventaire déjà ouvert ; document déjà validé | `BUSINESS_RULE` |
| Deuxième chargement du jour avec P-07 faux | `BUSINESS_RULE` |
| Journée non clôturée ou déjà déchargée ; ligne d'aperçu manquante ; motif absent sur un écart | `BUSINESS_RULE` / `VALIDATION_ERROR` |
| Réouverture d'une journée déchargée | `BUSINESS_RULE` |

## 8. Tests

- `packages/business-rules` : `applyMove`, `moveDeltas`, `unloadLine` (écart positif et négatif), `releaseNewestFirst`, `isLowStock`.
- `apps/api/test/stock.test.ts` : entrée → stock et `IN` ; chargement au-delà du disponible refusé sans rien écrire ; deux chargements simultanés ne dépassent pas le disponible ; réservation d'une commande → `RESERVATION` ; inventaire (ajustements, réservations réduites, rupture) ; chargement `CASH_VAN` / `RELOAD` et P-07 ; déchargement (surplus, manquant, motif obligatoire, retour au dépôt, P-06 garde le stock) ; réouverture refusée après déchargement ; droits (pré-vendeur refusé, superviseur accepté) ; seuils et alertes.

## 9. Besoins futurs notés

- **Phase 19** : vente des produits refusés à d'autres clients de la tournée (sorties `OUT` du camion ; le théorique du déchargement en tient compte) ; objectif du livreur sur le taux de retour (`UnloadLine` : chargé, livré, compté) et des critères notés par le superviseur.
- **Phase 20** : écart d'argent au versement (`remis − attendu`, positif ou négatif, BR-PAY-08), affiché à côté de l'écart de marchandise dans le récapitulatif du livreur ; `free` du déchargement rempli par les sorties des lignes bonus.
