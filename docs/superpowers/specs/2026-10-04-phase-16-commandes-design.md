# Phase 16 — Commandes

> Spec validée le 2026-10-04. Plan : `plan_VF.md`, phase 16. Règles : `docs/business-rules.md`
> (BR-CMD, BR-QUO, BR-CAT-04 à 16, BR-JOU-07/08/10, BR-OBJ, BR-VIS-09), cas d'usage UC-14, UC-17,
> UC-55, UC-56, UC-58, UC-60, UC-64.

## 1. Décisions

| Sujet | Décision |
|---|---|
| Périmètre | Toute la phase en une fois : commande sur le téléphone (A) et écrans Web du superviseur (B). |
| Calcul du panier | **Sur le téléphone** avec `priceCart` (catalogue du client chargé au début de la commande) ; le **serveur recalcule** et fige à la confirmation. Le résultat du serveur fait foi. |
| Réseau | En ligne d'abord, comme la phase 15 : opérations envoyées tout de suite à `POST /sync/push`. |
| Dépôt | Le dépôt actif de l'entreprise (`Warehouse.type = DEPOT`, le premier par code) : stock proposable, bonus limités, réservation. Plusieurs dépôts : plus tard. |
| Prix d'une modification | `order.update` recalcule avec les prix **en vigueur** au moment de la modification (la commande est figée de nouveau). |
| Réservation | Lignes normales **et** lignes bonus réservent le stock du dépôt ; la partie non couverte est marquée « rupture » (`isStockout`). Les lignes en attente ne réservent rien tant qu'elles ne sont pas acceptées. |
| Notifications | Aucune dans cette phase (phase 24). |
| Hors phase | Saisie au bureau sans visite (après le MVP), vente cash van et demande perdue (phase 20), préparation (phase 18), hors connexion (phase 23). |

## 2. Règles partagées (`packages/business-rules`)

- `canTransition(from: OrderStatusCode, to: OrderStatusCode): boolean` — les passages de BR-CMD-02 (`DRAFT→CONFIRMED`, `CONFIRMED→LOCKED|CANCELLED`, `LOCKED→CONFIRMED|PREPARING`, `PREPARING→READY`, `READY→OUT_FOR_DELIVERY`, `OUT_FOR_DELIVERY→DELIVERED|PARTIALLY_DELIVERED|FAILED`, `FAILED→LOCKED`).
- `splitByQuota(qty: number, unitBaseQty: number, remainingBase: number | null): { normal: number; pending: number }` — quantités dans l'unité saisie ; `remainingBase = null` : pas de quota ; reste négatif traité comme 0 ; une unité incomplète du reste n'est pas couverte (BR-QUO-03).
- `nextWorkingDay(date: string, calendar: { workingDays; holidays }): string` — premier jour suivant ni chômé ni férié (BR-CMD-05).
- Calcul des prix : `priceCart` existant (phase 12), inchangé.

## 3. Serveur — opérations du téléphone

Schémas dans `packages/validation/src/sync.ts`. `OPERATION_TYPES` gagne `order.confirm`, `order.update`, `order.cancel`.

### `order.confirm`
Payload : `{ orderId, number, visitId, lines: [{ variantId, unitId, qty }] (1 à 200), freeVariantChoices?: Record<ruleId, variantId> }`. Permission `orders.own`.

1. Un article au plus une fois dans `lines` (une ligne normale et une en attente par article, BR-CMD-01) sinon `VALIDATION_ERROR`. Journée en cours (BR-JOU-05) ; visite `IN_PROGRESS` à soi ; aucune commande déjà liée à cette visite (BR-VIS-09) ; numéro libre (`DUPLICATE` sinon).
2. Calcul : `pricingCatalog(customer.customerTypeId)` + `priceCart(catalog, lines, { customerTypeId, date: journée, availableStock: dépôt, freeVariantChoices })`. Une ligne sans prix → `BUSINESS_RULE` « Article non proposable à ce client ». Panier vide → `VALIDATION_ERROR`.
3. Quotas (BR-QUO-02/03) : pour chaque article, reste = quota du vendeur à la date de la journée − quantités normales confirmées ce jour (commandes `CONFIRMED`/`LOCKED`, + bonus si P-03), en unité de base. la scission se fait **dans l'unité saisie** : partie normale = `floor(reste ÷ quantité de base de l'unité)` unités, l'excédent devient une ligne `PENDING` (`pendingStatus = TO_PROCESS`) dans la même unité et au même prix figé (le palier se calcule sur la quantité totale demandée).
4. Réservation (BR-CMD-04) : pour chaque ligne normale puis bonus, `reservedQty = min(demandé, disponible)` en unité de base ; `Stock.reservedQty` augmente d'autant ; `isStockout` si non couverte.
5. Création : `Order` (`CONFIRMED`, `confirmedAt`, `source = PHONE` si la visite est par téléphone sinon `PRE_SALES`, `orderDate` = date de la journée, `deliveryDate = nextWorkingDay`, `totalAmount` = somme des lignes normales), lignes `NORMAL` / `PENDING` / `BONUS` (prix 0, `bonusRuleId`), `priceTierId` quand un palier s'applique.
6. Visite → `COMPLETED`, `outcome = ORDER`, `endedAt`.
7. Résultat : `{ orderId, number, totalAmount, deliveryDate, pendingLines: [{ variantId, qty }], stockouts: [{ variantId, reservedQty, orderedQty }] }`. Audit `order.confirm`.

### `order.update`
Payload : `{ orderId, lines, freeVariantChoices? }`. Commande à soi, `CONFIRMED`, journée de la commande en cours (BR-CMD-02, UC-17). Libère les réservations, supprime les lignes, recalcule comme `order.confirm` (étapes 2 à 5, prix en vigueur), le quota ne comptant pas les anciennes lignes de cette commande. `version` incrémentée. Audit.

### `order.cancel`
Payload : `{ orderId }`. Commande à soi, `CONFIRMED`, journée en cours. Libère les réservations, `CANCELLED`, `cancelledAt`. Audit.

### Clôture (`workday.close` et clôture d'office)
Les commandes `CONFIRMED` de la journée passent `LOCKED` (`lockedAt`) (BR-JOU-07).

## 4. Serveur — lectures du vendeur

- `GET /me/visit-catalog?customerId=` (`orders.own`) : client du secteur ; renvoie `{ customerTypeId, date, catalog: PricingCatalog (prix du type, paliers, bonus), products: [{ id, name, reference, range, category, hasFlavors, units, variants: [{ id, name, quotaRemaining (unité de base) | null, quotaReached }] }], rules: { P03_bonusConsumesQuota } }` — seuls les articles avec un prix pour le type **et** un stock disponible positif au dépôt (BR-CMD-06) ; aucune quantité de stock n'est envoyée.
- `GET /me/orders?date=` (`orders.own`) : commandes du vendeur à cette date, avec leurs lignes (article, unité, quantités, prix, type de ligne, rupture).
- `GET /me/today` : `counters.ordersCount`, `counters.ordersAmount` (commandes non annulées de la journée).

## 5. Serveur et Web — superviseur (`apps/web`, espace `/app`)

| Écran | API | Règles |
|---|---|---|
| Quotas du jour (UC-55) | `GET /quotas?date=` (`quotas.read`), `PUT /quotas` (`quotas.update`) : `{ date, entries: [{ userId, productVariantId, unitId, qty }] }`, `qty = 0` supprime | Stocké en unité de base (`qty`), unité saisie gardée (`enteredQty`, `enteredUnitId`) ; date du jour ou future ; vendeurs pré-vendeurs et cash van ; audit. |
| Lignes en attente (UC-60) | `GET /pending-lines?date=` (`pending_lines.process`) ; `POST /pending-lines/decide` `{ lineIds, decision: 'ACCEPT' \| 'REFUSE' }` | Commande `CONFIRMED` ou `LOCKED`. Accepter : quantité ajoutée à la ligne normale de l'article (créée si absente), réservation du stock (rupture possible), total recalculé, ligne en attente `ACCEPTED` ; audit (BR-QUO-06). Refuser : `REFUSED` + `LostDemand` `LOST_SALE`. |
| Objectifs du mois (UC-56) | `GET /objectives?month=` (`objectives.read`), `PUT /objectives` (`objectives.update`) `{ month, entries: [{ userId, rangeId, targetAmount, bonusAmount, capPercent }] }` | Réalisé et prime due calculés comme `GET /me/objectives` (même service). |
| Commandes (historique) | `GET /orders?date=&sellerId=&status=` (`orders.read`), `GET /orders/:id` | Liste et détail en lecture. |
| Journées (UC-58, UC-64) | `GET /workdays?date=` (`workdays.read`) ; `POST /workdays/:id/reopen` (`workdays.reopen`) `{ reason }` ; `POST /workdays/:id/force-close` (`workdays.force_close`) `{ reason }` | Motif obligatoire, audit. Rouvrir : `CLOSED → IN_PROGRESS`, `reopenCount + 1`, commandes `LOCKED → CONFIRMED` ; refusé si une commande de la journée est `PREPARING` ou au-delà (`INVALID_STATE`). Clôture d'office : mêmes effets qu'une clôture (visites manquées, `LOCKED`), `isForceClosed`, `forceClosedByUserId`. |

Écrans Web : mêmes composants et mise en page que les écrans existants de `apps/web/src/app/app/(espace)` (vérifiés par ui-consistency).

## 6. Mobile (`apps/mobile`)

- **Commande** (`app/seller/order/[visitId].tsx`, depuis la visite en cours ; `?orderId=` pour modifier) :
  - charge `GET /me/visit-catalog` ; liste des produits par gamme avec recherche ; produit grisé « quota atteint » mais sélectionnable ;
  - un produit : choix de l'unité, une quantité par parfum (BR-CAT-16) ; validé, il quitte la liste et entre dans le panier ;
  - panier : lignes (quantité, prix, palier), lignes « GRATUIT » non modifiables, total, avertissement « en attente » estimé avec le quota restant ; modifier ou retirer une ligne ; parfum offert au choix quand la règle est `SELLER_CHOICE` ;
  - « Confirmer la commande » → `order.confirm` (numéro `nextOrderNumber`, compteur propre au téléphone) ou `order.update` ; affichage du résultat du serveur (lignes en attente, ruptures, total) puis retour.
- **Commandes du jour** (`app/seller/orders.tsx`, `app/seller/orders/[id].tsx`) : liste et détail ; « Modifier » et « Annuler » (confirmation) tant que la commande est `CONFIRMED` et la journée en cours.
- **Tableau de bord** : commandes du jour et CA du jour ; accès « Commandes du jour ».
- **Visite** : « Prendre une commande » activé.

## 7. Erreurs

- Article devenu non proposable, numéro pris, visite déjà commandée, commande non modifiable : message du serveur tel quel.
- Résultat différent du panier du téléphone (quota baissé, rupture) : le serveur fait foi ; le téléphone affiche le résultat du serveur.
- Réseau : comme la phase 15 (renvoi de l'action restée sans réponse, sans doublon).

## 8. Tests

- `packages/business-rules` : `canTransition`, `splitByQuota`, `nextWorkingDay` (jeudi → samedi, jour férié sauté).
- `apps/api` : `order.confirm` (prix figés, palier, bonus, scission au quota, rupture, livraison J+1 ouvré, source PHONE, visite terminée, refus sans visite / visite déjà commandée / article sans prix / numéro pris) ; `order.update` (réservation ajustée, quota hors lignes propres) ; `order.cancel` (réservation libérée) ; clôture → `LOCKED` ; `/me/visit-catalog` (articles sans prix ou sans stock exclus, quota restant) ; quotas, lignes en attente (accepter / refuser), objectifs, historique, réouverture (et refus), clôture d'office.
- Mobile et Web : typecheck, assemblage, contrôle ui-consistency par un agent séparé.
