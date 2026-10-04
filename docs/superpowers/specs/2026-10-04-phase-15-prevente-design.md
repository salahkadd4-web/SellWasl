# Phase 15 — Module Prévente : mobile pré-vendeur et visites

> Spec validée le 2026-10-04. Plan : `plan_VF.md`, phase 15. Règles : `docs/business-rules.md`
> (BR-JOU, BR-VIS, BR-PLA-06, BR-CLI-02/03, BR-PAY-04/05, BR-OBJ, BR-CAT-11), cas d'usage UC-02 à
> UC-21 de `docs/use-cases.md`.

## 1. Décisions

| Sujet | Décision | Raison |
|---|---|---|
| Hors connexion | **En ligne d'abord.** Les écrans appellent l'API ; le stockage local (SQLite) et `/sync/pull` viennent en phase 23. | Consigne de la phase 23 : valider le flux en ligne avant d'activer la synchronisation. |
| Écritures du terrain | **Opérations** au format de `docs/api.md` §6–7, envoyées tout de suite à `POST /sync/push`. | La phase 23 n'ajoute que la file locale : les règles serveur ne changent pas (approche A). |
| Lectures | Endpoints en ligne existants quand ils suffisent (`/customers`, `/customers/:id`, `/customers/:id/history`, `/reasons`, `/customer-types`, `/product-ranges`, `/product-categories`, `/products`), plus `GET /me/today` et `GET /me/objectives`. | Les clients sont déjà limités au secteur du vendeur sur le téléphone. |
| Commandes | Hors phase 15 : « Prendre une commande » (UC-14) et « Modifier ou annuler » (UC-17) viennent avec la phase 16. Le bouton est visible mais désactivé. | Le module Commandes n'existe pas encore. |
| Photo de visite | Après le MVP. | Plan. |
| Réouverture, clôture d'office | Hors phase 15 (superviseur, Web). | Plan, phase 16 et Web. |
| Démarrer / clôturer sans réseau (BR-JOU-04, BR-JOU-06 hors connexion) | Phase 23. Sans réseau : « Réseau nécessaire pour cette action ». | En ligne d'abord. |
| Rôles | Pré-vendeur et vendeur cash van partagent le groupe d'écrans « vendeur ». Le cash van n'a pas le mode « par téléphone » (BR-VIS-03). Les autres rôles terrain gardent l'accueil actuel. | Les écrans propres au cash van viennent en phase 20. |
| Textes | En français dans le code, comme le reste de l'application (i18next plus tard). | Cohérence avec l'existant. |

## 2. Serveur (`apps/api`)

### 2.1 Module `sync` — `POST /sync/push`

- Permission : utilisateur connecté sur le **téléphone** (`channel = MOBILE`, `deviceId` présent) ; chaque type d'opération vérifie ensuite sa propre permission (`workdays.own`, `visits.own`, `customers.create`, `payments.collect_debt`).
- Requête et réponse : `docs/api.md` §6.1. Schémas Zod dans `packages/validation/src/sync.ts` (enveloppe + un schéma de `payload` par type).
- Pour chaque opération, dans l'ordre :
  1. `opId` déjà connu (`SyncOperation`, `UNIQUE (company_id, op_id)`) → renvoyer le résultat enregistré, sans rejouer (BR-SYN-02).
  2. `deviceSeq` attendu = dernier `deviceSeq` enregistré pour l'appareil + 1. Un numéro déjà utilisé par une autre opération → `REJECTED` (`DUPLICATE`) ; un trou → `GAP` pour cette opération et les suivantes.
  3. Traitement dans **sa propre transaction** ; erreur métier (`ApiError`) → `REJECTED` avec `error: { code, message }` ; succès → `APPLIED` avec `result` (identifiants créés).
  4. Enregistrement dans `SyncOperation` (statut, résultat, `occurredAt`, heure de réception).
- `SyncStatus` du schéma : `APPLIED`, `APPLIED_WITH_CHANGES`, `REJECTED`. `GAP` n'est qu'une réponse : l'opération n'est pas enregistrée et le téléphone la renverra. Aucun changement de schéma n'est prévu dans cette phase.

### 2.2 Opérations

| Type | Payload | Règles |
|---|---|---|
| `workday.start` | `{ workdayId, date, settingsVersion? }` | `workdays.own`. Une journée par utilisateur et par date (BR-JOU-01) : déjà démarrée → `INVALID_STATE`. Jour non travaillé ou férié : refusé si P-01 l'interdit (BR-JOU-03). Date = celle du téléphone (BR-JOU-11) ; écart de plus d'une heure entre `occurredAt` et l'heure du serveur → audit `workday.clock_skew`. Audit `workday.start`. |
| `workday.close` | `{ workdayId }` | `workdays.own`. Journée `IN_PROGRESS` à soi ; une visite en cours → `INVALID_STATE` (BR-JOU-06). Crée une visite `MISSED` pour chaque client du jour sans visite terminée (BR-PLA-06, `missedCustomers`). Le passage des commandes à `LOCKED` (BR-JOU-07) sera ajouté en phase 16. Audit `workday.close`. |
| `visit.start` | `{ visitId, customerId, mode, latitude?, longitude? }` | `visits.own`. Journée en cours (BR-JOU-05). Client du secteur du vendeur, actif. Une seule visite `IN_PROGRESS` à la fois. Cash van : `PHONE` refusé (BR-VIS-03). `ON_SITE` : distance téléphone–client calculée par le serveur (`distanceM`) ; au-delà de `outOfZoneDistanceM` → `isOutOfZone` ; client sans position → `isCustomerPositionUnknown` ; téléphone sans position → `isOutOfZone` (non vérifiable). Jamais bloquant (BR-VIS-02). Client hors des clients du jour → `isScheduled = false`, refusé si P-02 l'interdit (BR-VIS-07). Plusieurs visites le même jour possibles (BR-VIS-08). |
| `visit.close_no_order` | `{ visitId, reasonId }` | `visits.own`. Visite `IN_PROGRESS` à soi. Motif actif de type `NO_ORDER`. Visite `COMPLETED`, `outcome = NO_ORDER`, `endedAt`. Motif système `CLOSED_PERMANENTLY` → `customer.isClosedPermanently = true` (client à revoir, BR-VIS-05). |
| `customer.create` | `{ customerId, name, phone?, address?, customerTypeId, latitude, longitude, frequency }` | `customers.create`. Réutilise `CustomersService.create` (BR-CLI-02, BR-CLI-03), avec l'identifiant fourni par le téléphone. Résultat : la partie, ou `null` si hors partie (avertissement affiché, UC-12). |
| `payment.debt` | `{ paymentId, number, customerId, amount }` | `payments.collect_debt`. Journée en cours (BR-JOU-05). Client du secteur. `0 < amount ≤ dette` (BR-PAY-05) ; en ligne, la dette est connue, donc pas d'avance. Crée `Payment` (`DEBT_PAYMENT`, `cashAmount = amount`, `workdayId`), une écriture `CustomerDebtEntry` (`DEBT_PAYMENT`, montant négatif) et baisse `customer.debtAmount`. Numéro fourni par le téléphone : `code utilisateur + série + séquence sur 4 chiffres` (ARC-11) ; numéro déjà pris → `DUPLICATE`. Audit `payment.debt`. |

Les identifiants (`workdayId`, `visitId`, `customerId`, `paymentId`) sont créés par le téléphone (UUID v7), comme le fera la file hors connexion.

### 2.3 Lectures

- `GET /me/today?date=AAAA-MM-JJ` (`workdays.own`), date du téléphone, par défaut le jour de l'entreprise :
  - `workday` : `{ id, status, startedAt, closedAt } | null` (`NOT_STARTED` si absente) ;
  - `day` : la liste du jour (`PlanningService.day`, même calcul que la phase 14) ;
  - `visits` : les visites du jour du vendeur (`id, customerId, status, mode, isScheduled, isOutOfZone, startedAt, endedAt`) ;
  - `counters` : `visited` (clients du jour avec au moins une visite terminée, comptés une fois — BR-VIS-08), `planned` (N), `outOfProgram` (clients hors programme visités — BR-VIS-07), `collectedAmount` (encaissé du jour) ;
  - `currentVisit` : la visite `IN_PROGRESS`, s'il y en a une ;
  - `rules` : `{ outOfZoneDistanceM, P01_workOnNonWorkingDays, P02_outOfProgramVisits }` ;
  - `seller` : `{ code, series }` (numérotation des reçus).
- `GET /me/objectives?month=AAAA-MM` (`objectives.read`) : pour chaque objectif du vendeur ce mois-là, `{ range, targetAmount, realizedAmount, rate, bonusAmount, capPercent, estimatedBonus }`. Le réalisé suit BR-OBJ-02 (lignes payantes des produits de la gamme, livrées dans le mois, commandes du vendeur) : il vaut 0 tant que les livraisons n'existent pas (phases 19–20). Le calcul (BR-OBJ-03) est dans `packages/business-rules`.

### 2.4 Règles partagées (`packages/business-rules`)

- `distanceMeters(a, b)` (haversine), dans `geo.ts`.
- `visitCounters(dayCustomerIds, visits)` → `{ visited, planned, outOfProgram }` (BR-VIS-06/07/08).
- `objectiveProgress({ targetAmount, realizedAmount, bonusAmount, capPercent })` → `{ rate, estimatedBonus }` (BR-OBJ-03, arrondi au dinar).
- `paymentNumber(userCode, series, sequence)` → `V07-B0042` (ARC-11).

## 3. Mobile (`apps/mobile`)

### 3.1 Dépendances natives (déjà installées)

`expo-location` (position pendant la journée, sans arrière-plan), `@maplibre/maplibre-react-native` (carte), `expo-crypto` (UUID). Une nouvelle compilation de l'APK est nécessaire.

### 3.2 Socle

- `src/sync/operations.ts` : `sendOperation(type, payload)` crée l'`opId` (UUID v7 via `expo-crypto`), incrémente `deviceSeq` gardé dans `expo-secure-store`, envoie `POST /sync/push` avec une seule opération et renvoie le résultat ; `REJECTED` → erreur avec le message du serveur ; réseau absent → « Réseau nécessaire pour cette action. » Ce module deviendra la file d'envoi en phase 23.
- `src/today/TodayContext.tsx` : charge `GET /me/today`, l'expose aux écrans, se rafraîchit après chaque opération et au retour dans l'application.
- `src/location/useLocation.ts` : autorisation « pendant l'utilisation », dernière position connue ; refus → `null`.
- Signal de vie : la position du téléphone est ajoutée pendant une journée en cours (le serveur l'ignore sinon, BR-JOU-09).
- Navigation : `AuthGate` envoie le pré-vendeur et le vendeur cash van vers le groupe d'écrans vendeur ; les autres rôles vers l'accueil actuel.

### 3.3 Écrans

| Écran | Contenu |
|---|---|
| Tableau de bord (UC-02) | Démarrer / Clôturer la journée, état de la journée, secteur et partie du jour (ou jour férié / non travaillé), clients du jour x/N (+k hors programme), encaissé du jour, état de la connexion, accès : clients, objectifs, catalogue, profil. |
| Clôture (UC-05) | Résumé (visites x/N, hors programme, encaissé) à confirmer ; refusée si une visite est en cours. |
| Clients (UC-10) | Liste triée par distance (par nom sans position), distance affichée, état visité ou non ; bascule « Clients du jour » / « Tout le secteur » ; bascule Liste / Carte ; « Ajouter un client ». |
| Carte (UC-10) | MapLibre, tuiles OpenStreetMap, marqueurs rouges (à visiter) et verts (visités), regroupés ; appui → itinéraire Google Maps, fiche, commencer la visite. |
| Fiche client (UC-11) | Type, partie, fréquence, dette, téléphone, adresse ; historique des visites, commandes et paiements ; actions : commencer la visite, encaisser une dette, appeler, ouvrir l'itinéraire. |
| Ajouter un client (UC-12) | Nom, téléphone, adresse, type (parmi ceux du secteur), bouton GPS, fréquence ; avertissement « hors partie ». |
| Visite (UC-13, UC-16) | Choix du mode (sur place / par téléphone ; cash van : sur place), distance et « hors zone » ; « Prendre une commande » désactivé (phase 16) ; « Pas de commande » → liste des motifs. |
| Encaisser une dette (UC-19) | Montant ≤ dette, confirmation, nouveau solde. Impression du reçu : phase 20 (numérotation déjà en place). |
| Objectifs (UC-20) | Par gamme : cible, réalisé, taux, prime estimée. |
| Catalogue (UC-21) | Gammes, catégories, produits et parfums, photos gardées sur le téléphone, sans aucun prix (BR-CAT-11). |
| Profil | Nom, rôle, entreprise, série du téléphone, déconnexion, test d'impression. |

Hors journée en cours, les actions (visite, ajout de client, encaissement) sont désactivées avec la raison affichée (BR-JOU-05) ; la consultation reste possible.

## 4. Erreurs

- Pas de réseau : « Réseau nécessaire pour cette action. » ; les écrans de consultation affichent la dernière donnée chargée.
- Opération refusée : le message du serveur, tel quel (`docs/api.md` §2).
- Position indisponible : liste triée par nom ; visite sur place acceptée, marquée hors zone ; ajout de client impossible sans position (BR-CLI-02).

## 5. Tests

- `packages/business-rules` : `distanceMeters`, `visitCounters` (visite répétée comptée une fois, hors programme à part), `objectiveProgress` (plafond, arrondi), `paymentNumber`.
- `apps/api` (Vitest, base réelle) : `/sync/push` (idempotence, `GAP`, `REJECTED` sans bloquer les suivantes) ; `workday.start` (doublon, P-01) ; `workday.close` (visite en cours refusée, visites `MISSED`) ; `visit.start` (hors zone, position inconnue, hors programme, cash van sans `PHONE`, une seule visite en cours) ; `visit.close_no_order` (fermé définitivement) ; `customer.create` ; `payment.debt` (plafond de la dette, numéro en double) ; `GET /me/today` (compteurs) ; `GET /me/objectives`.
- Mobile : typecheck ; contrôle des écrans par un agent séparé (ui-consistency) ; test sur téléphone par l'utilisateur.
