# Phase 19 — Livraison, tournées et objectifs du livreur

> Spec validée le 2026-10-06. Plan : `plan_VF.md`, phase 19. Règles : `docs/business-rules.md`
> (BR-PRE-05, BR-LIV-01 à 06, BR-PAY-03, BR-PAY-04, BR-CAT-10, P-04, P-05), cas d'usage UC-30 à
> UC-33.

## 1. Décisions

| Sujet | Décision |
|---|---|
| Périmètre | Phase 19 **avec les écrans mobiles du livreur** nécessaires pour livrer : journée, réception du chargement, tournée (liste triée par distance, carte, itinéraire), livraison totale ou partielle, ventes ajoutées, échec, encaissement, objectifs. La phase 20 garde le cash van, l'impression, les versements. |
| Réseau | Comme le vendeur : opérations envoyées tout de suite à `POST /sync/push` (`load.receive`, `delivery.confirm`, `delivery.fail`) ; lectures REST. |
| Ventes ajoutées | Le livreur ajoute à une commande existante de sa tournée des produits de son camion (retour d'un autre client). Prix et paliers du type du client, recalculés sur la commande ; pas de quota ; plafond de crédit respecté ; aucun client créé. La vente compte pour le vendeur du client. |
| Recalcul | Paliers et bonus recalculés (prix du type du client) si une quantité baisse et que P-04 est vrai, ou si des produits sont ajoutés. Un bonus ne dépasse jamais ce qui a été préparé pour lui. Sinon, prix confirmés conservés. |
| Échec et reprogrammation | P-05 vrai : motif « client absent », « magasin fermé » ou « non livrée », premier échec → commande `LOCKED`, livraison au jour ouvré suivant, hors tournée ; sa marchandise rentre au dépôt au déchargement puis y est réservée de nouveau. Sinon, échec définitif. |
| Objectif du livreur | Réglé par l'admin ou le superviseur (`objectives.update`) : **paliers du taux de retour** (ex. ≤ 5 % → 100 %, ≤ 8 % → 70 %, ≤ 12 % → 40 %, au-delà → 0 %) et **critères pondérés notés sur 10** (ex. propreté du camion). Poids du taux de retour + poids des critères = 100. Chaque mois : prime du livreur et notes. Prime due = prime × score. Date de versement : règle des objectifs de l'entreprise (fin du mois ou du mois suivant). |
| Taux de retour | Sur le mois : quantité comptée aux déchargements du livreur ÷ quantité chargée, en unité de base. Pas de chargement : pas de taux, score du taux de retour = 0. |
| Hors phase | Impression des bons (phase 20), versement au comptable (phase 20), preuves photo et signature (après le MVP), ordre de passage optimisé (après le MVP), hors connexion (phase 23). |

## 2. Règles partagées (`packages/business-rules`)

- `minimumCash({ due, isCreditAllowed, creditLimit, debt })` → montant minimum à encaisser (BR-PAY-03) : `due` sans crédit, sinon `max(0, due − max(0, creditLimit − debt))`.
- `shouldReschedule({ reasonCode, attempt, rescheduleEnabled })` → vrai si P-05, premier essai, motif `CUSTOMER_ABSENT` | `STORE_CLOSED` | `NOT_DELIVERED`.
- `returnRate(loaded, returned)` → pourcentage arrondi à 0,1, ou `null` sans chargement.
- `tierScore(rate, tiers)` → score du premier palier dont `rate ≤ maxRate`, sinon 0 ; `rate = null` → 0.
- `driverScore({ returnWeight, returnScore, criteria: [{ weight, rating }] })` → `(returnWeight × returnScore + Σ weight × rating × 10) / 100`, arrondi à l'entier.
- `driverBonus(bonusAmount, score)` → `round(bonusAmount × score / 100)`.

## 3. Serveur — livraison (`apps/api/src/delivery/`)

### Opérations du téléphone
- **`load.receive`** `{ loadId, lines: [{ variantId, receivedQty }] }` (`loads.receive`, journée en cours) : chargement `LOADED` de l'utilisateur ; `receivedQty` en unité de base ; écart → `ADJUSTMENT` sur le camion (motif « Marchandise manquante » si manquant, « Autre » si surplus), `hasGap`, audit : le livreur livre ce qu'il a reçu. Chargement `RECEIVED`. Tournée liée : commandes `READY` → `OUT_FOR_DELIVERY`, tournée `OUT_FOR_DELIVERY` (BR-PRE-05).
- **`delivery.confirm`** `{ deliveryId, number, orderId, lines: [{ lineId, qty }], added: [{ variantId, unitId, qty }], cashAmount, latitude?, longitude? }` (`deliveries.own`) :
  1. commande `OUT_FOR_DELIVERY` d'une tournée du livreur ; journée en cours ; numéro libre ;
  2. `qty` (unité de la ligne) ≤ préparé pour chaque ligne normale ; lignes ajoutées : article actif avec prix pour le type du client ; même article qu'une ligne existante → même unité, la ligne augmente ;
  3. prix et bonus selon §1 « Recalcul » ;
  4. dû = Σ lignes normales livrées ; `minimumCash ≤ cashAmount ≤ dû` sinon `BUSINESS_RULE` ; crédit = dû − encaissé → dette du client (`CREDIT_SALE`) ;
  5. stock : `OUT` du camion de chaque quantité livrée (normales, bonus, ajoutées), source `DELIVERY` — refus si le camion ne l'a pas ;
  6. `Delivery` (`DELIVERED` si tout le préparé est livré sans baisse, sinon `PARTIAL`), `Payment` `DELIVERY_PAYMENT`, lignes (`deliveredQty`, prix, montant), commande `DELIVERED` ou `PARTIALLY_DELIVERED` et son total.
- **`delivery.fail`** `{ deliveryId, number, orderId, reasonId, latitude?, longitude? }` (`deliveries.own`) : motif `DELIVERY_FAILURE` ; `Delivery FAILED` ; commande `FAILED`, ou reprogrammée (`shouldReschedule`) : `LOCKED`, `deliveryDate = nextWorkingDay`, `routeId = null`.
- **Clôture du livreur** (`workday.close` et clôture d'office) : commandes encore `OUT_FOR_DELIVERY` de ses tournées → échec « non livrée » (règle de reprogrammation appliquée) ; tournées → `CLOSED` (BR-LIV-04).
- **Déchargement** (phase 17, complété) : livré et offert lus dans les livraisons de la journée (lignes bonus = offert) ; après le retour au dépôt, les commandes reprogrammées de la journée sont réservées de nouveau (partiellement si le dépôt manque).

### Lectures du livreur (`deliveries.own`)
- `GET /me/route` : journée, chargement à recevoir, tournée du jour (date de la journée en cours, sinon aujourd'hui) avec ses livraisons : client (position, adresse, téléphone, dette, crédit), statut, montant, lignes à livrer (préparé dans l'unité de la ligne, prix), résultat éventuel ; compteurs.
- `GET /me/truck-stock` : stock du camion par article (pour les ventes ajoutées).
- `POST /me/deliveries/preview` `{ orderId, lines, added }` : lignes chiffrées, bonus, dû, minimum à encaisser, dette — mêmes calculs que `delivery.confirm`, sans rien écrire.
- `GET /me/driver-objectives` : objectif du mois (et du mois précédent si versement décalé).

### Suivi Web
- `GET /routes?date=` : chaque tournée lancée gagne `progress { delivered, partial, failed, pending, collected }`.

## 4. Serveur — objectifs du livreur (`apps/api/src/supervision/`)

- Paramètres (`companySettingsSchema.driverObjectives`) : `{ returnWeight, returnTiers: [{ maxRate, score }], criteria: [{ id, name, weight }] }`, défaut `{ 100, [5→100, 8→70, 12→40], [] }`.
- `GET`, `PUT /driver-objectives/settings` (`objectives.read`, `objectives.update`) : poids entiers, somme 100 ; paliers triés par `maxRate` croissant, scores 0 à 100.
- Table `DriverObjective` (`month`, `userId`, `bonusAmount`, `ratings` JSON `{ criterionId: 0..10 }`), unique par livreur et mois.
- `GET /driver-objectives?month=` : pour chaque livreur actif : prime, notes, chargé, retourné, taux, score du taux, score total, prime due, date de versement.
- `PUT /driver-objectives` `{ month, entries: [{ userId, bonusAmount, ratings }] }` : notes 0 à 10 sur des critères existants.

## 5. Mobile — livreur (`apps/mobile/app/driver/*`)

Rôle `LIVREUR` → écrans `driver` ; composants de `src/ui.tsx` ; opérations via `sendOperation` :
- **Tableau de bord** : démarrer, clôturer la journée ; chargement à recevoir ; avancement de la tournée (livrées, partielles, échecs, encaissé).
- **Réception du chargement** : quantités chargées, reçu modifiable, confirmer.
- **Ma tournée** : liste triée par distance depuis la position, ou carte ; dette du client ; itinéraire Google Maps.
- **Livraison** : lignes ajustables, « Ajouter un produit du camion », aperçu chiffré (dû, minimum), encaissé, confirmer ; « Échec » avec motif.
- **Objectifs** : score du mois, taux de retour, prime due.
- **Profil** : identité, déconnexion.

## 6. Web

- **Tournées** : avancement des tournées lancées.
- **Objectifs** : onglets « Vendeurs » (page actuelle) et « Livreurs » : paliers du taux de retour, critères et poids, puis par livreur la prime, les notes, le taux de retour calculé, le score et la prime due.

## 7. Erreurs

| Cas | Code |
|---|---|
| Commande hors de la tournée du livreur, déjà livrée ou pas encore partie | `INVALID_STATE` |
| Quantité au-delà du préparé ; article sans prix pour le client ; unité différente d'une ligne existante | `BUSINESS_RULE` |
| Encaissé sous le minimum ou au-dessus du dû | `BUSINESS_RULE` (BR-PAY-03) |
| Camion sans le stock d'une vente ajoutée | `BUSINESS_RULE` (registre) |
| Poids dont la somme ≠ 100 ; note hors 0–10 ; critère inconnu | `VALIDATION_ERROR` / `BUSINESS_RULE` |

## 8. Tests

- `packages/business-rules` : `minimumCash`, `shouldReschedule`, `returnRate`, `tierScore`, `driverScore`, `driverBonus`.
- `apps/api/test/delivery.test.ts` : réception avec écart ; livraison totale (stock du camion, paiement espèces) ; partielle avec palier perdu ; vente ajoutée depuis le camion ; crédit (minimum, dette) ; encaissé insuffisant refusé ; échec reprogrammé puis réservé de nouveau au déchargement ; refus définitif ; clôture : non livrées en échec, tournée close ; déchargement : livré et offert ; droits.
- `apps/api/test/driver-objectives.test.ts` : paramètres (somme des poids), primes et notes, taux de retour calculé depuis les déchargements, score et prime due.
