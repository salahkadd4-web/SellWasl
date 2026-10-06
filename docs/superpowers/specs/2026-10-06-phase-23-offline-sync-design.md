# Phase 23 — Offline-first et synchronisation : conception

> Validée le 2026-10-06. Plan : `docs/superpowers/plans/2026-10-06-phase-23-offline-sync.md`.
> Références : plan_VF.md (phase 23), business-rules.md §17 (BR-SYN-01 à 07), BR-JOU-04, BR-JOU-06,
> architecture.md §10 (ARC-03), api.md §6 et §7, database.md §1.2.

## 1. Objectif et décisions

Les utilisateurs du terrain (pré-vendeur, vendeur cash van, livreur) travaillent sans réseau : chaque
action est enregistrée sur le téléphone, puis envoyée au serveur dès que le réseau revient
(BR-SYN-01). Le serveur reste la référence pour ce qu'il possède (BR-SYN-03).

Décisions de l'utilisateur (2026-10-06) :

| Sujet | Décision |
|---|---|
| Rôles hors connexion | Terrain seulement : pré-vendeur, cash van, livreur. Le magasinier reste en ligne. |
| Données locales | Tables locales SQLite alimentées par `GET /sync/pull` différentiel ; le téléphone recalcule ses écrans avec les règles partagées. |
| Découpage | Toute la phase, par étapes (moteur, puis pré-vendeur, cash van, livreur), fusion locale sans push. |
| Démarrage de journée | Sans réseau, permis seulement si une synchronisation complète a réussi **le jour même** (date du téléphone) ; sinon le réseau est obligatoire. |
| Vente cash van reçue au-delà du quota ou du stock du camion | Acceptée et signalée (`APPLIED_WITH_CHANGES`) : la vente est un fait. |

Critères de validation (plan_VF) :

1. Une commande créée sans réseau est synchronisée une seule fois au retour du réseau.
2. Un quota baissé pendant que le téléphone était hors connexion transforme l'excédent en « en
   attente », sans perte ni écrasement silencieux.
3. Une journée complète de cash van se déroule sans réseau, puis se synchronise.

## 2. Périmètre

Dans la phase :

- serveur : curseur fiable, `GET /sync/pull`, `APPLIED_WITH_CHANGES` pour `order.confirm` et
  `sale.confirm`, indicateurs « démarrée / clôturée hors connexion », page Web « Synchronisation » ;
- nouveau paquet `packages/offline` (moteur, effets locaux, écrans recalculés), testé avec vitest ;
- téléphone : SQLite, file d'envoi, synchronisation automatique et manuelle, indicateur permanent,
  écran « Synchronisation », écrans du terrain lus en local ;
- `docs/offline-sync.md`, mises à jour d'api.md §6, architecture.md §10, database.md.

Hors de la phase (restent en ligne, avec le message « Réseau nécessaire ») : écrans du magasinier,
« Ma paie », objectifs du livreur, historique d'un client, contestations de refus, association de
l'appareil, changement de mot de passe, photos du catalogue (affichées si déjà en cache d'image).

## 3. Serveur

### 3.1 Curseur fiable : `change_xid`

Problème : `change_seq` est pris au moment de l'écriture, pas de la validation. Une transaction
longue peut valider une ligne avec un numéro inférieur à un curseur déjà envoyé : la ligne serait
perdue pour le téléphone.

Solution :

- migration : colonne `change_xid BIGINT NOT NULL DEFAULT 0` et index `(company_id, change_xid)`
  sur toutes les tables qui ont `change_seq` ; la fonction `sync_row_change()` renseigne aussi
  `NEW.change_xid := pg_current_xact_id()::text::bigint` (identifiant de transaction sur 64 bits,
  sans bouclage) ; les lignes existantes gardent 0 ;
- `GET /sync/pull` lit dans une transaction `REPEATABLE READ` ; le nouveau curseur est
  `pg_snapshot_xmin(pg_current_snapshot())`, la plus ancienne transaction encore en cours ;
- une page renvoie les lignes dont `change_xid >= cursor`. Une transaction en cours au moment
  d'une lecture a un identifiant supérieur ou égal au curseur rendu : ses lignes arrivent à la
  lecture suivante. Aucune perte ; une ligne peut arriver deux fois (le téléphone la remplace).
- `change_seq` reste en place (ordre de tri, compatibilité) ; Prisma déclare `changeXid BigInt`.

### 3.2 `GET /sync/pull`

```text
GET /sync/pull?cursor=0&scope=<clé>&page=<jeton>
```

Réponse :

```json
{
  "rows": [{ "kind": "customer", "id": "…", "data": { "…": "…" }, "deleted": false }],
  "cursor": "1844674",
  "hasMore": false,
  "page": null,
  "scope": "VENDEUR_CASH_VAN:t=…:w=…",
  "reset": false,
  "serverTime": "2026-10-06T09:43:01Z"
}
```

- Réservé au canal mobile et aux rôles du terrain (sinon 403 `OFFLINE_NOT_AVAILABLE`).
- **Clé de périmètre** : rôle, secteur (`territoryId`), camion (`warehouseId`). Si la clé envoyée
  diffère de la clé actuelle, la réponse a `reset: true` : le téléphone envoie d'abord ses
  opérations en attente, efface ses données reçues et repart de `cursor=0` (RESYNC_REQUIRED,
  api.md §6.2).
- **Pagination** : 500 lignes au plus par page ; `page` est un jeton opaque (sorte et dernier `id`)
  valable avec le même curseur ; le curseur final n'est appliqué qu'à la dernière page
  (`hasMore: false`).
- **Registre des sortes** (`SyncKinds`, sur le modèle de `SyncHandlers`) : chaque sorte déclare
  les rôles, la requête de ses lignes changées depuis le curseur et la transformation en données
  pour le téléphone. Les sortes « calculées » (paramètres, objectifs) sont renvoyées entières à
  chaque lecture : peu de lignes, pas de colonne de changement.
- **Sortie de périmètre** : la requête porte sur les lignes changées **de l'entreprise** ; une ligne
  changée mais hors du périmètre de l'utilisateur est envoyée avec `deleted: true`. Les
  suppressions logiques (`deletedAt`) aussi.

Sortes (BR-SYN-04, adapté au terrain) :

| Sorte | Rôles | Contenu |
|---|---|---|
| `settings` (calculée) | tous | Règles utiles au téléphone (P-01 à P-05, distance hors zone), version des paramètres, réglages du ticket |
| `reason` | tous | Motifs actifs |
| `product` | tous | Produit avec gamme, catégorie, unités et parfums actifs |
| `price`, `priceTier`, `bonusRule` | pré-vendeur, cash van | Grille de prix, paliers, bonus |
| `territory` | pré-vendeur, cash van | Son secteur, ses parties, polygones et jours de passage ; jours fériés |
| `customer` | tous | Pré-vendeur, cash van : clients du secteur ; livreur : clients de ses tournées. Avec la dette |
| `quota` | pré-vendeur, cash van | Ses quotas d'hier à J+7 |
| `objective` (calculée) | pré-vendeur, cash van | Objectifs du mois (`MyObjective`) |
| `workday` | tous | Ses journées des 7 derniers jours |
| `visit` | pré-vendeur, cash van | Ses visites des 7 derniers jours |
| `order` | tous | Pré-vendeur, cash van : ses commandes et ventes des 7 derniers jours, avec lignes ; livreur : commandes de ses tournées ouvertes |
| `payment` | tous | Ses encaissements des 7 derniers jours |
| `route`, `delivery` | livreur, cash van | Ses tournées ouvertes et leurs livraisons |
| `load` | livreur, cash van | Chargements à recevoir |
| `truckStock` | livreur, cash van | Stock de son camion |
| `depotStock` | pré-vendeur | Disponible au dépôt (physique − réservé) par article |

Une modification d'une ligne enfant (ligne de commande, unité, parfum) renvoie la ligne parente
entière.

### 3.3 `APPLIED_WITH_CHANGES` pour `order.confirm` et `order.update` (BR-SYN-05)

- Le payload reçoit un champ optionnel `expected` : pour chaque article, la quantité en attente et la
  quantité en rupture que le téléphone a calculées.
- Le serveur compare avec son propre découpage (quota et disponible au moment de la réception). S'il
  diffère, le statut est `APPLIED_WITH_CHANGES` et `changes` liste :
  `{ kind: 'QUOTA_PENDING', productVariantId, pendingQty }` et
  `{ kind: 'STOCKOUT', productVariantId, orderedQty, reservedQty }`.
- Sans `expected` (anciens téléphones, en ligne), le comportement ne change pas (`APPLIED`).
- `SyncOperation.status` enregistre `APPLIED_WITH_CHANGES` ; une opération renvoyée reçoit le même
  résultat.

### 3.4 Vente cash van reçue au-delà du quota ou du stock (décision du 2026-10-06)

- `sale.confirm` reçu avec `offline: true` (le téléphone l'a enregistrée sans réseau) n'est plus
  refusé pour le quota ni pour le stock du camion :
  - quota dépassé : la vente est appliquée en entier ; changement `QUOTA_EXCEEDED`
    (`productVariantId`, `exceededQty`) ;
  - stock du camion insuffisant : la sortie du stock est limitée au stock présent (le stock ne
    devient jamais négatif, contrainte BR-STK-04) ; le manque est enregistré comme écart de stock
    (`Discrepancy` `STOCK`, quantité négative, valeur au prix de vente, cause « Vente hors
    connexion au-delà du stock du camion ») ; changement `TRUCK_STOCK_SHORT`
    (`productVariantId`, `shortQty`).
- En ligne (`offline` absent ou faux), BR-QUO-04 et le contrôle du stock restent inchangés : refus.

### 3.5 Journée hors connexion

- `workday.start` et `workday.close` reçoivent `offline?: boolean` ; le serveur renseigne
  `isStartedOffline` et `isClosedOffline`.
- La page Web « Journées » et le suivi du jour affichent « démarrée hors connexion » et « clôturée
  hors connexion ».

### 3.6 Journal de synchronisation sur le Web (BR-SYN-07)

- `GET /sync/operations?status=&userId=&from=&to=` (permission `devices.read`) : opérations
  reçues, avec utilisateur, appareil, type, statut, motif, heure sur le téléphone et heure de
  réception, changements.
- Page Web « Synchronisation » (groupe Administration, à côté d'« Appareils »), filtre par statut
  (refusées, avec changements) et par utilisateur.

## 4. Paquet `packages/offline`

TypeScript pur, sans dépendance à React Native ; testé avec vitest.

### 4.1 Stockage (interface)

```ts
interface OfflineStore {
  // Lignes reçues
  upsertRows(rows: PulledRow[]): Promise<void>;     // deleted → suppression
  rows<K extends Kind>(kind: K): Promise<RowData<K>[]>;
  clearRows(): Promise<void>;
  // File d'envoi
  enqueue(op: OutboxOp): Promise<void>;
  outbox(): Promise<OutboxOp[]>;                     // ordre deviceSeq
  updateOp(opId: string, patch: Partial<OutboxOp>): Promise<void>;
  // Méta : curseur, scope, lastFullSyncDate, deviceSeq
  getMeta(key: MetaKey): Promise<string | null>;
  setMeta(key: MetaKey, value: string | null): Promise<void>;
}
```

Implémentations : mémoire (tests), SQLite (téléphone, `expo-sqlite`).

### 4.2 Opérations et états

```text
PENDING ──► SYNCING ──► SYNCED (APPLIED, APPLIED_WITH_CHANGES)
   ▲           │
   └── FAILED ◄┤ (réseau, 5xx : nouvel essai, délai 5 s, 15 s, 60 s, puis 5 min)
               └──► CONFLICT (REJECTED : motif gardé, visible, jamais effacé en silence)
```

- `OutboxOp` : `opId`, `deviceSeq`, `type`, `payload`, `workdayId`, `occurredAt`, `status`,
  `attempts`, `nextAttemptAt`, `error`, `result`, `changes`, `acknowledged` (vu par l'utilisateur).
- Le numéro d'ordre est attribué à la mise en file, dans l'ordre des actions.

### 4.3 Cycle de synchronisation

1. **Envoi** : opérations `PENDING` ou `FAILED` échues, par lots de 100, dans l'ordre. Réponse
   `GAP` ou `DUPLICATE` avec `expectedDeviceSeq` : renumérotation des opérations non appliquées à
   partir du numéro attendu, puis nouvel envoi (une fois par cycle). Erreur réseau ou 5xx : les
   opérations du lot repassent `FAILED` avec le délai suivant ; le cycle s'arrête.
2. **Réception** : `GET /sync/pull` jusqu'à `hasMore: false` ; `reset: true` → effacement des
   lignes reçues, curseur à 0, relecture complète. Une réception complète réussie enregistre
   `lastFullSyncDate` (date du téléphone).
3. **Fin** : les opérations `SYNCED` cessent de compter dans l'affichage local seulement à ce
   moment (leurs effets sont alors dans les lignes reçues).

Un seul cycle à la fois ; une demande pendant un cycle en relance un à la fin.

### 4.4 Affichage local = lignes reçues + effets des opérations

- Chaque type d'opération du terrain a un **effet local** pur : il ajoute ou modifie des lignes de
  la vue (`workday.start` crée la journée, `visit.start` la visite en cours, `order.confirm` la
  commande avec ses lignes calculées par `priceCart` et `splitByQuota`, `sale.confirm` la vente et
  la sortie du stock du camion, `payment.*` l'encaissement et la baisse de la dette,
  `delivery.complete` / `delivery.fail` l'état de la livraison et le stock du camion,
  `load.receive` / `truck.check` le stock du camion, `customer.create` le client…).
- Les opérations `PENDING`, `SYNCING`, `FAILED` et `SYNCED` (jusqu'à la fin du cycle) s'appliquent ;
  `CONFLICT` ne s'applique pas.
- **Écrans recalculés** (fonctions pures, mêmes types que l'API qu'ils remplacent) :
  `TodayResponse`, `VisitCatalog`, liste et fiche des clients, `OrderDto` (liste et détail),
  `DaySummaryDto`, `DriverRouteDto`, `TruckStockDto`, `ReceiptPrintDto`, objectifs.
- Le quota restant d'un article = quota du jour − quantités des commandes du jour (reçues et en
  file), comme `consumedQuota` sur le serveur (P-03 pour les bonus).

### 4.5 Indicateur (BR-SYN-06)

`syncStatus(outbox, lastError)` : `{ state: 'SYNCED' | 'PENDING' | 'ERROR', pending: number,
conflicts: number, unseenChanges: number }`. « Erreur » : au moins une opération `CONFLICT` non
vue, ou le dernier cycle a échoué alors que le réseau est présent.

## 5. Téléphone

- **SQLite** (`expo-sqlite`, installé par `npx expo install`) : tables `records(kind, id, data,
  PRIMARY KEY(kind, id))`, `outbox(…)`, `meta(key, value)`. Ouverture et création au démarrage.
- **Réseau** : `@react-native-community/netinfo` (installé par `npx expo install`).
- **`SyncProvider`** : déclenche un cycle au retour du réseau, au retour dans l'application, après
  chaque mise en file et sur le bouton ; jamais en arrière-plan. Expose l'état, `syncNow()`, et
  notifie les écrans quand les données changent.
- **`sendOperation`** met l'opération en file et rend aussitôt le résultat de l'effet local (par
  exemple l'identifiant de la commande) ; il remplace l'envoi direct de la phase 15. L'opération
  laissée « en attente » par l'ancien envoi direct est reprise dans la file à la mise à jour.
- **Écrans du terrain** : `TodayContext` et les écrans du vendeur, du cash van et du livreur lisent
  les vues locales (hook `useLocal(builder)`), plus l'API.
- **Barre d'état** permanente en haut des écrans du terrain : « Synchronisé », « N en attente »,
  « Erreur ». Un appui ouvre l'écran **Synchronisation** : bouton « Synchroniser », dernière
  synchronisation, opérations en attente et refusées (motif), changements reçus
  (`QUOTA_PENDING`, `STOCKOUT`, `QUOTA_EXCEEDED`, `TRUCK_STOCK_SHORT`) à marquer « vu ».
- **Changements reçus** : un bandeau sur l'accueil du vendeur tant qu'ils ne sont pas vus
  (BR-SYN-05 « le vendeur en est informé »).
- **Démarrage de journée** : avec réseau, cycle complet puis `workday.start`. Sans réseau :
  permis si `lastFullSyncDate` = date du téléphone, avec `offline: true` ; sinon message « Réseau
  nécessaire pour démarrer : aucune synchronisation aujourd'hui ».
- **Clôture** : toujours possible (BR-JOU-06), avec `offline: true` sans réseau ; le résumé de
  clôture est calculé en local.
- **Impression** : les bons et reçus sont construits en local (`ReceiptPrintDto`) ; les numéros
  restent attribués par le téléphone.
- **Déconnexion** : refusée tant que des opérations sont en attente (message), pour ne pas les
  perdre ; changement d'utilisateur ou nouvelle association → base locale effacée après envoi.

## 6. Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Réponse perdue après application | L'opération est renvoyée ; le serveur rend le même résultat (BR-SYN-02) |
| Opération refusée | `CONFLICT`, visible avec le motif ; les suivantes continuent ; une opération qui dépend d'une entité refusée est refusée à son tour (entité introuvable) |
| Jeton expiré pendant un cycle | Renouvelé une fois par le client ; sinon cycle arrêté, `FAILED` |
| Changement de secteur ou de camion | `reset` : envoi, effacement, relecture complète |
| Appareil révoqué | Règle existante (BR-USR-11) : opérations postérieures refusées `DEVICE_REVOKED` |
| Base locale vide et pas de réseau | Écrans du terrain : « Réseau nécessaire pour la première synchronisation » |
| Transaction longue sur le serveur | Lignes reçues à la lecture suivante (§3.1) |

## 7. Tests

- `packages/offline` (vitest) : renvoi après réponse perdue, `GAP` et renumérotation, erreur réseau
  puis nouvel essai avec délai, refus → `CONFLICT`, ordre des opérations, cycle unique, `reset`,
  effets locaux de chaque type, écrans recalculés (journée, catalogue de visite avec quota consommé,
  stock du camion après ventes, résumé de clôture), indicateur.
- API (vitest, base réelle) : `/sync/pull` par rôle (périmètre, suppressions, sortie de périmètre,
  pagination, `reset`), transaction lente simulée (ligne écrite par une transaction ouverte avant la
  lecture, validée après : reçue à la lecture suivante), `APPLIED_WITH_CHANGES` et idempotence du
  résultat, vente cash van hors connexion au-delà du quota et du stock, indicateurs de journée,
  journal `/sync/operations`.
- Critères de validation rejoués de bout en bout dans les tests de l'API, avec le moteur du paquet
  `offline` branché sur l'API de test : commande envoyée deux fois → une seule commande ; quota
  baissé → ligne « en attente » et changement `QUOTA_PENDING` ; journée cash van complète mise en
  file puis synchronisée (démarrage, pointage du camion, visites, ventes, encaissement, clôture).
- Mobile : typage ; vérification manuelle décrite dans `docs/offline-sync.md` (mode avion).

## 8. Ordre de réalisation

1. Serveur : `change_xid`, registre des sortes, `GET /sync/pull`, tests.
2. Serveur : `APPLIED_WITH_CHANGES`, vente cash van hors connexion, journée hors connexion,
   journal Web.
3. Paquet `offline` : stockage mémoire, file, cycle, indicateur.
4. Paquet `offline` : effets locaux et écrans recalculés.
5. Téléphone : SQLite, NetInfo, `SyncProvider`, barre d'état, écran Synchronisation.
6. Téléphone : écrans du pré-vendeur en local.
7. Téléphone : écrans du cash van en local, impression locale.
8. Téléphone : écrans du livreur en local.
9. Tests de bout en bout des trois critères, documentation, plan_VF.
