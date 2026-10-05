# Phase 20 — Cash van, pointage du camion, impression, encaissements et versements

> Spec validée le 2026-10-06. Plan : `plan_VF.md`, phase 20. Règles : `docs/business-rules.md`
> (BR-CV-01 à 07, BR-QUO-04, BR-IMP-01 à 06, BR-PAY-03 à 08, BR-JOU-09), cas d'usage UC-15, UC-18,
> UC-34, UC-35, UC-62, UC-70, UC-71.

## 1. Décisions

| Sujet | Décision |
|---|---|
| Vente cash van | **Définitive** (BR-CV-05) : panier libre jusqu'à la confirmation, puis livrée, payée, sans modification ni annulation. La modification des commandes reste celle du livreur (phase 19). |
| Pointage | Au démarrage, le livreur et le vendeur cash van **pointent tout le stock du camion** : chargements reçus + stock resté de la veille (P-06). Écart ajusté (motif « Marchandise manquante » ou « Autre ») et signalé. Rien ne se vend ni ne se livre avant le pointage (BR-CV-02, BR-PRE-05). |
| Stock du camion | Consultable à tout moment, par le livreur et le vendeur cash van (`GET /me/truck-stock`, permission `stock.read`). |
| Catalogue cash van | Stock du camion (articles avec un prix pour le client et du stock) ; quantités affichées ; bonus limités par le camion. Quota épuisé : produit grisé, demande perdue possible (BR-QUO-04) ; une quantité au-delà du quota est refusée. |
| Chargement cash van | Préparé sur le Web par le superviseur (`loads.plan`), éventuellement à partir du chargement précédent ; validé par le magasinier (`loads.load`) avec les quantités réellement chargées. Chargement libre de la phase 17 conservé. |
| Impression | Imprimante Bluetooth appairée choisie et gardée sur le téléphone, largeur de l'entreprise (58 / 80 mm). Bons de livraison et de vente, reçus de dette, récapitulatif de journée ; réimpression « DUPLICATA » tracée ; jamais bloquante. |
| Versements | Comptable (`settlements.create`) : un versement par journée, `écart = remis − attendu`, audité ; liste des écarts pour le superviseur. Notifications : phase 24. |
| Hors phase | Hors connexion complet (phase 23), notifications (phase 24), avoirs et retours clients (après le MVP). |

## 2. Règles partagées (`packages/business-rules`)

- `daySummary(payments: { kind; dueAmount; cashAmount; creditAmount }[])` → `{ receipts, totalSold, cashSales, cashDebts, credit, expected }` (BR-PAY-07) : `expected = cashSales + cashDebts`.
- `settlementGap(expected, remitted)` → `remitted − expected`.

## 3. Serveur

### Pointage — opération `truck.check` (`loads.receive`)
`{ lines: [{ variantId, countedQty }] }` : journée en cours ; camion de l'utilisateur ; tous les articles du camion attendus (stock > 0 ou chargement à recevoir). Écart `compté − physique` → `ADJUSTMENT` (source `LOAD` du chargement reçu, sinon sans source). Chargements `LOADED` de l'utilisateur → `RECEIVED` ; tournées liées → commandes `OUT_FOR_DELIVERY`. Audit `truck.check`. `GET /me/truck-check` : lignes à pointer `{ variantId, article, inTruck, toReceive }`.
Livraison et vente refusées tant qu'un chargement de l'utilisateur est `LOADED`.

### Chargement cash van (UC-62)
- `POST /loads/plan` `{ truckId, date, lines }` (`loads.plan`) → `Load PLANNED` (`plannedQty`), type `CASH_VAN` ou `RELOAD` (P-07).
- `GET /loads/planned` (`loads.read`) ; `POST /loads/:id/validate` `{ lines: [{ variantId, loadedQty }] }` (`loads.load`) → transfert dépôt → camion du chargé, `LOADED`.
- `GET /loads/last?truckId=` : dernier chargement du camion (pour repartir de lui).

### Vente — opérations `sale.confirm` et `lost_demand.create` (`sales.own`, `lost_demands.own`)
- `GET /me/visit-catalog?customerId=` : pour un vendeur cash van, stock du camion à la place du dépôt et `truckStock` par article.
- `sale.confirm` `{ orderId, number, visitId, lines, freeVariantChoices?, cashAmount, latitude?, longitude? }` : visite sur place en cours ; pointage fait ; prix du type du client ; quota : une quantité au-delà du reste est refusée ; bonus limités au camion ; `OUT` du camion (source `DELIVERY`) ; `Order` source `CASH_VAN` `DELIVERED` ; `Delivery DELIVERED` (numéro = numéro du bon) ; `Payment` selon BR-PAY-03 ; visite terminée.
- `lost_demand.create` `{ lostDemandId, customerId, variantId, qty }` : demande perdue du jour.

### Bons, récapitulatif, réimpression
- `GET /me/receipts?date=` : bons de l'utilisateur ce jour-là (livraisons, ventes, reçus de dette) avec lignes, payé, reste, dette — de quoi imprimer.
- `GET /me/day-summary` et `GET /workdays/:id/summary` (`workdays.read`) : `daySummary`.
- Opération `receipt.reprint` `{ number }` : réimpression tracée (audit).

### Comptabilité (UC-70, UC-71)
- `GET /settlements?date=` (`settlements.read`) : journées d'utilisateurs qui ont encaissé : attendu, versé, écart.
- `POST /settlements` `{ workdayId, remittedAmount }` (`settlements.create`) : journée clôturée, un seul versement ; écart ; audit.
- `GET /debtors` (`payments.read`) : clients avec dette ; `GET /payments?from=&to=` et `GET /payments/export?from=&to=` (CSV).

## 4. Mobile

- **Pointage du camion** (livreur, cash van) remplace la réception ; **Stock du camion** pour le cash van aussi.
- **Vente cash van** : l'écran de commande du vendeur cash van vend depuis le camion ; quantités du camion affichées ; quota grisé et « Demande perdue » ; paiement ; impression du bon.
- **Impression** : choix de l'imprimante (profil), bon après livraison / vente / dette, historique du jour avec réimpression, récapitulatif de journée.
- **Livreur** : position partagée pendant la journée (BR-JOU-09).

## 5. Web

- **Chargements** : « Préparer un chargement cash van » (superviseur), chargements préparés à valider (magasinier).
- **Comptabilité** : pages Versements et Dettes et paiements (export CSV) ; récapitulatif d'une journée.

## 6. Tests

- Règles : `daySummary`, `settlementGap`.
- API : pointage (écart, chargements reçus, vente refusée avant) ; chargement préparé puis validé ; vente (stock du camion, quota refusé, bonus limité, paiement, crédit) ; demande perdue ; bons et récapitulatif ; réimpression tracée ; versement (écart, un seul) ; dettes et export ; droits.
