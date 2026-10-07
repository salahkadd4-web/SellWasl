# Hors connexion et synchronisation

> **Phase 23 — réalisée le 2026-10-07.** Spec : `docs/superpowers/specs/2026-10-06-phase-23-offline-sync-design.md`.
> Règles : [business-rules.md §17](business-rules.md) (BR-SYN-01 à 07), BR-JOU-04, BR-JOU-06.
> Contrat d'API : [api.md §6](api.md#6-synchronisation-du-mobile). Principe : [architecture.md §10](architecture.md#10-hors-connexion-et-synchronisation).

Le pré-vendeur, le vendeur cash van et le livreur travaillent sans réseau. Le magasinier reste en
ligne (il travaille au dépôt).

## 1. Principe

```text
Action de l'utilisateur
   └─► file d'envoi (SQLite) + effet affiché tout de suite
         └─► réseau ? ─► POST /sync/push (lots de 100, dans l'ordre)
                         GET  /sync/pull (pages de 500)
                         └─► données reçues remplacées, file nettoyée
```

- Le téléphone n'envoie jamais « la nouvelle version d'une ligne » mais « ce que l'utilisateur a
  fait » (ARC-03). Chaque opération porte un `opId` et un numéro d'ordre (`deviceSeq`) : renvoyée,
  elle n'est appliquée qu'une fois (BR-SYN-02).
- **Affichage local** = données reçues + effet des opérations encore en file : une vente baisse
  le stock du camion, un encaissement la dette, une commande consomme le quota. Une opération
  refusée n'a plus d'effet ; elle reste visible avec son motif.

## 2. Code

| Où | Quoi |
|---|---|
| `packages/offline` | TypeScript pur, testé (vitest) : `SyncEngine` (file, cycle, nouveaux essais), `MemoryStore`, effets locaux (`applyOps`), écrans recalculés (`todayView`, `visitCatalogView`, `customersView`, `ordersView`, `truckStockView`, `truckCheckView`, `daySummaryView`, `receiptsView`, `driverRouteView`, `deliveryPreviewView`), `buildOrder` (panier comme le serveur), `syncStatus` |
| `apps/mobile/src/offline` | `SqliteStore` (expo-sqlite), `httpTransport`, moteur unique, `SyncProvider` (NetInfo, retour au premier plan, nouveaux essais), `useLocal`, `SyncBar`, `SyncScreen`, `startWorkday`, `confirmLogout` |
| `apps/api/src/sync` | `SyncPullService` (`GET /sync/pull`), registre `SyncKinds` et sortes (`kinds/`), `SyncLogService` (`GET /sync/operations`) |
| `packages/business-rules/src/reprice.ts` | `repriceOrder` : recalcul P-04, partagé serveur et téléphone |

## 3. Réception (`GET /sync/pull`)

- **Curseur fiable** : chaque écriture d'une table synchronisée enregistre sa transaction
  (`change_xid`, 64 bits). Le curseur rendu au téléphone est la plus ancienne transaction encore
  en cours au début de la lecture (`pg_snapshot_xmin`). Une écriture validée après la lecture porte
  une transaction au moins égale au curseur : elle arrive à la lecture suivante. Une ligne peut
  arriver deux fois, jamais zéro.
- **Sortes** (une par donnée, inscrites par domaine) : `settings`, `reason`, `product`, `pricing`,
  `territory`, `planningDay` (jour et lendemain), `customer`, `quota` (hier à J+7), `objective`,
  `workday`, `visit`, `order`, `payment` (7 jours), `driverDay`, `truckStock`, `truckCheck`,
  `depotStock`. Chacune déclare les rôles qui la reçoivent.
  - mode **rows** (`customer`, `order`) : seules les lignes changées ; une ligne sortie du
    périmètre arrive avec `deleted: true` ;
  - mode **set** (les autres) : la sorte entière quand une de ses tables a changé ; elle figure
    dans `replace` et le téléphone la remplace.
- **Réception complète** : la première du jour (date du téléphone), ou après un changement de
  secteur ou de camion (`reset: true` : le téléphone envoie ses opérations, efface ses données et
  relit tout).
- Les pages sont cumulées puis écrites en une transaction ; le curseur n'avance qu'à la dernière.
- Une réception complète enregistre `Device.lastSyncAt` (dernier contact prouvé côté serveur).

## 4. États d'une opération

| État | Sens | Sur le téléphone |
|---|---|---|
| `PENDING` | En attente | Compte dans « N en attente » |
| `SYNCING` | En cours d'envoi | Idem |
| `FAILED` | Erreur réseau ou serveur | Nouvel essai après 5 s, 15 s, 60 s, puis toutes les 5 min ; le bouton « Synchroniser » force l'essai |
| `SYNCED` | Appliquée | Retirée après la réception ; gardée tant que ses changements ne sont pas vus |
| `CONFLICT` | Refusée par le serveur | Gardée avec son motif ; « Erreur » jusqu'à « J'ai vu » ; jamais effacée en silence |

Un numéro d'ordre décalé (`GAP`, `DUPLICATE`) est recalé automatiquement sur celui qu'attend le
serveur. Une opération en attente de délai retient les suivantes (le serveur exige l'ordre).

## 5. Changements à la réception (BR-SYN-05)

Le serveur recalcule tout à la réception et renvoie `APPLIED_WITH_CHANGES` avec la liste des
transformations :

| Changement | Quand | Effet |
|---|---|---|
| `QUOTA_PENDING` | Commande : le découpage du serveur diffère de celui du téléphone (`expected`) — quota baissé | Excédent en ligne « en attente » (BR-QUO-05) |
| `STOCKOUT` | Commande : disponible du dépôt plus bas que prévu | Ligne en rupture (BR-CMD-04) |
| `QUOTA_EXCEEDED` | Vente cash van faite hors connexion, quota baissé entre-temps | Vente acceptée en entier, signalée |
| `TRUCK_STOCK_SHORT` | Vente cash van hors connexion au-delà du stock du camion (ajusté entre-temps) | Sortie limitée au stock présent (jamais négatif), manque en écart de stock « à examiner » |

Le vendeur voit un bandeau sur son accueil et le détail dans « Synchronisation » ; le superviseur
voit tout dans la page Web « Synchronisation » (BR-SYN-07).

**Garde-fous de la vente hors connexion** (revue de sécurité) : la règle assouplie ne vaut que si
la vente est postérieure à la dernière réception complète connue du serveur (`Device.lastSyncAt`)
et date d'au moins 30 secondes avant sa réception. Sinon, les règles en ligne s'appliquent
(BR-QUO-04 : refus).

## 6. Journée

- **Démarrage** : avec réseau, synchronisation complète puis démarrage. Sans réseau : permis
  seulement si une synchronisation complète a réussi le jour même ; sinon « Réseau nécessaire pour
  démarrer : aucune synchronisation aujourd'hui ». Le superviseur voit « démarrée hors connexion »
  (BR-JOU-04).
- **Clôture** : toujours possible ; sans réseau, elle part à la prochaine synchronisation et le
  superviseur voit « clôturée hors connexion » (BR-JOU-06).
- **Déconnexion** : refusée tant que des actions attendent l'envoi. Appareil oublié ou révoqué :
  la base locale est effacée.

## 7. Ce qui reste en ligne

Écrans du magasinier, « Ma paie », objectifs du livreur, historique d'un client, contestations de
refus, association de l'appareil, changement de mot de passe (message « Réseau nécessaire »).

## 8. Vérification manuelle (mode avion)

1. **Pré-vendeur** : se connecter avec réseau (première synchronisation), activer le mode avion,
   démarrer la journée, visiter un client, prendre une commande, encaisser une dette. La barre
   affiche « N opérations en attente ». Couper le mode avion : la barre passe à « Synchronisé »,
   la commande apparaît sur le Web.
2. **Quota** : en mode avion, commander dans le quota ; sur le Web, baisser le quota ; couper le
   mode avion : bandeau « Changements à la réception » sur l'accueil, ligne en attente sur le Web.
3. **Cash van** : synchroniser au dépôt, mode avion, démarrer, pointer le camion, vendre, imprimer
   le bon, encaisser, clôturer ; le stock du camion baisse sur le téléphone ; au retour du réseau,
   tout est appliqué, la journée est « clôturée hors connexion ».
4. **Livreur** : synchroniser, mode avion, livrer (complète, partielle, échec) ; l'aperçu
   recalcule le dû (P-04) et le minimum à encaisser ; au retour du réseau, la tournée est à jour
   sur le Web.
5. **Refus** : provoquer une action refusée (par exemple, journée clôturée sur le Web pendant la
   coupure) : « Erreur » sur la barre, motif dans « Synchronisation ».
6. **Démarrage sans réseau un nouveau jour** (sans synchronisation ce jour-là) : message « Réseau
   nécessaire pour démarrer ».

## 9. Tests

- `packages/offline` : moteur (renvoi après réponse perdue, `GAP`, délais, refus, action pendant un
  cycle, pages, changement de périmètre, nouveau jour), effets et écrans des trois rôles.
- `apps/api/test/sync-pull.test.ts` : réception par rôle, différentiel, suppressions, transaction
  lente, pages, `reset`, changements à la réception, vente cash van hors connexion et garde-fous,
  journées hors connexion, journal.
- `apps/api/test/offline-e2e.test.ts` : les trois critères de la phase avec le vrai moteur et
  l'API, et la parité des écrans locaux avec le serveur.
