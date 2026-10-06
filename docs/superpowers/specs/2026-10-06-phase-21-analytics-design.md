# Phase 21 — Dashboard, rapports et analyse des retours (conception)

Source : `plan_VF.md`, phase 21 (y compris l'analyse des retours ajoutée par l'utilisateur). Analyse des causes : après le MVP, hors de cette phase.

## Décisions de l'utilisateur

- Tout le MVP de la phase en une fois : dashboard, suivi temps réel, rapports, exports, analyse des retours avec les données qui lui manquent.
- Lots : saisis à l'entrée en stock (n°, fournisseur, péremption) et au déchargement (lot des produits retournés). Le stock reste compté par article ; les ventes ne sont pas rattachées à un lot.
- Contestation d'un refus : par le pré-vendeur, tranchée par le superviseur.
- Au déchargement, le défectueux, le périmé et le cassé sortent du stock en perte ; seul le « remis en stock » revient au dépôt (ou reste dans le camion selon P-06).
- Approche : calcul à la demande pour le dashboard et les rapports ; table de faits `ReturnFact` écrite en même temps que la livraison et le déchargement pour l'analyse des retours.

## 1. Données

### Fournisseurs et lots

- `Supplier` [S] : `name` (unique par entreprise), `phone?`, `isActive`. CRUD Web (`products.write`), lecture `products.read`.
- `Product.supplierId?` : fournisseur habituel.
- `StockReceipt.supplierId?` : fournisseur choisi dans la liste ; l'ancien champ texte `supplier` est gardé en lecture pour les entrées passées.
- `Lot` [S] : `productVariantId`, `number`, `expiresAt?` (date), `supplierId?`, `receivedQty` (unité de base). Unique `(companyId, productVariantId, number)`.
- `StockReceiptLine` gagne `lotNumber?`, `expiresAt?`. À l'entrée, un lot est créé ou sa `receivedQty` augmentée ; son fournisseur est celui de l'entrée.

### État constaté au déchargement

- `enum ReturnCondition { RESTOCK DEFECTIVE EXPIRED BROKEN }`.
- `UnloadLineCondition` [S] : `unloadLineId`, `condition`, `qty` (base), `lotId?`, `photoFileId?` (fichier `StoredFile`).
- Règles : la somme des répartitions d'une ligne = `countedQty` ; une répartition `DEFECTIVE` exige une photo ; un lot indiqué doit être un lot de l'article. Sans répartition envoyée, tout le compté est `RESTOCK` (compatibilité des appels existants).
- Stock : seul `RESTOCK` suit le chemin actuel (retour au dépôt ou stock gardé, P-06). Le reste sort du camion par un mouvement `WRITE_OFF` (nouvelle valeur de `StockMovementType`, source `UNLOAD`).

### Motif de refus et contestation

- `ReasonKind` gagne `REFUSAL`. Motifs par défaut : Produit non commandé, Prix, Pas d'argent, Stock suffisant, Produit abîmé, Date proche, Autre (`systemCode` `OTHER`). Ajoutés aux entreprises existantes par la migration et aux nouvelles par `companies/defaults.ts`.
- `Delivery.refusalReasonId?` : obligatoire dès qu'une quantité est refusée — livraison partielle (une ligne livrée en dessous du commandé) ou échec de motif système `REFUSED`. Sinon refusé `422` avec `rule: 'BR-RET-01'`.
- `enum ContestStatus { NONE CONTESTED UPHELD REJECTED }` sur `Delivery` : `contestStatus` (défaut `NONE`), `contestComment?`, `contestedAt?`, `contestDecidedByUserId?`, `contestDecidedAt?`.
  - `CONTESTED` : le pré-vendeur conteste (la contestation est « retenue » s'il a raison).
  - `UPHELD` : contestation retenue par le superviseur, le refus n'est pas imputé au client.
  - `REJECTED` : contestation rejetée, le refus est confirmé.

### Revente en tournée

- `OrderLine.addedQty` (base, défaut 0) : quantité ajoutée par le livreur à une ligne existante ; une ligne créée en tournée a `addedQty = orderedQty`.

### Faits des retours

- `enum ReturnFactKind { REFUSAL RESALE RETURN GAP }`.
- `ReturnFact` [S] (lecture seule après écriture) : `kind`, `date` (jour de la journée), `qty` (base, toujours positive ; signe porté par `GAP` via `gapQty` signé), `value` (DA, BigInt), `productVariantId`, `productId`, `lotId?`, `supplierId?`, `sellerUserId?`, `driverUserId?`, `customerId?`, `territoryId?`, `partId?`, `routeId?`, `orderId?`, `deliveryId?`, `unloadId?`, `reasonId?`, `condition?`.
- Écriture, dans la même transaction :
  - `delivery.confirm` : un `REFUSAL` par ligne livrée sous le commandé (qty = commandé − livré, valeur au prix de la ligne) ; un `RESALE` par ligne avec `addedQty > 0`. Axes : pré-vendeur de la commande, livreur, client, secteur et partie du client au moment de la livraison, tournée, motif de refus, fournisseur habituel du produit.
  - `delivery.fail` avec motif `REFUSED` : un `REFUSAL` par ligne de la commande, quantité entière.
  - Validation du déchargement : un `RETURN` par répartition (état, lot ; fournisseur = celui du lot, sinon le fournisseur habituel), un `GAP` par ligne à écart non nul. Axes : livreur ou vendeur cash van, tournée du jour s'il y en a une.
- Valeur d'un `RETURN` ou `GAP` : prix moyen pondéré (par unité de base) de l'article dans les lignes livrées de cet utilisateur ce jour-là ; à défaut, dernier prix vendu de l'article dans l'entreprise ; à défaut 0.
- Les retours antérieurs à la phase n'ont pas de faits (pas de reprise).

### Modules, droits, paramètres

- `ModuleCode` gagne `RETURNS_ANALYSIS`, désactivé par défaut, activable par la plateforme comme les autres.
- Droits : `returns.read` (admin, superviseur), `returns.contest` (pré-vendeur), `returns.decide` (superviseur, admin), tous du module `RETURNS_ANALYSIS`. Dashboard et rapports : `reports.read`, exports : `reports.export` (module `ANALYTICS`).
- `companySettings.returnsMinVolume` (entier, défaut 20) : en dessous, un taux est rendu `null` avec `insufficient: true`.

### Taux (fonctions pures, `business-rules/src/returns.ts`)

- Refus (nombre) = commandes avec au moins un `REFUSAL` ÷ commandes présentées (livrées, partielles ou en échec) ; refus (valeur) = valeur refusée ÷ valeur commandée des commandes présentées.
- Retour d'un livreur = retourné ÷ chargé (lignes de déchargement).
- Retour d'un produit = retourné ÷ livré.
- Retour d'un lot = retourné ÷ reçu.
- Coût net des retours = valeur `RETURN` − valeur `RESALE`.
- Volume = dénominateur du taux ; s'il est sous `returnsMinVolume`, le taux est `null`.
- Les refus `UPHELD` restent comptés dans les refus du livreur et du produit, mais pas dans ceux du client.

## 2. API

Module `reports` (dashboard, tableau du jour, carte, fiches, rapports, exports) et module `returns` (analyse, contestation). Calcul à la demande, filtré par l'entreprise (isolation automatique). Les dates sont des jours (`YYYY-MM-DD`) dans le fuseau de l'entreprise ; `from`/`to` inclus, 366 jours au plus.

| Méthode | Chemin | Permission | Contenu |
|---|---|---|---|
| `GET` | `/reports/dashboard?from&to&territoryId` | `reports.read` | CA, commandes, visites planifiées et réalisées, clients non visités, clients en retard (aucune visite depuis plus de leur fréquence), taux de conversion (visites avec commande ÷ visites réalisées), pré-vendeurs et livreurs actifs (journée démarrée), commandes en préparation et en livraison, échecs de livraison, articles sous le seuil et ruptures ; bloc `returns` si le module est actif et le droit `returns.read` présent : refus (nombre, valeur, taux), retours (quantité, valeur, taux), reventes (valeur), coût net, écarts |
| `GET` | `/reports/today` | `reports.read` | Par utilisateur de terrain : état de la journée, visites x/N, hors zone, par téléphone, commandes, CA, dernière position et heure, dernière synchronisation, batterie, opérations en attente, `online` (dernier signal il y a moins de 3 × `positionIntervalMin`) |
| `GET` | `/reports/map?date` | `reports.read` | Polygones des parties du jour, clients planifiés (visités ou non, avec coordonnées), dernière position de chaque utilisateur |
| `GET` | `/reports/users/{id}?from&to` | `reports.read` | Fiche en lecture seule : journées, visites, commandes, CA, livraisons, objectifs du mois ; `returns` si le module est actif |
| `GET` | `/reports/commercial?from&to&…` | `reports.read` | CA et commandes par jour, par produit, par client |
| `GET` | `/reports/presales?from&to&…` | `reports.read` | Par pré-vendeur et par secteur : visites, commandes, conversion, CA |
| `GET` | `/reports/delivery?from&to&…` | `reports.read` | Par livreur : livraisons, partielles, échecs par motif, délai moyen (confirmation → livraison, en jours) |
| `GET` | `/reports/lost-sales?from&to&…` | `reports.read` | Ventes perdues et demandes perdues par produit, client et vendeur |
| `GET` | `/exports/{type}?from&to&…` | `reports.export` | CSV `;`, BOM UTF-8, formules neutralisées, 100 000 lignes ; `type` : `sales`, `visits`, `objectives`, `debts`, `settlements`, `refusals`, `returns`, `resales`, `gaps` (les quatre derniers exigent aussi le module `RETURNS_ANALYSIS`) |
| `GET` | `/returns/axis/{axis}?from&to&…` | `returns.read` | `axis` ∈ `product`, `lot`, `supplier`, `seller`, `driver`, `customer`, `territory`, `route`, `reason`, `condition` : une ligne par valeur de l'axe avec quantités, valeurs, taux (`null` + `insufficient` sous le volume minimum) |
| `GET` | `/returns/cross?rows&cols&kind&from&to&…` | `returns.read` | Vue croisée de deux axes différents ; cellule = quantité et valeur des faits de `kind` |
| `GET` | `/returns/facts?kind&axis=valeur…&from&to` | `returns.read` | Faits derrière un chiffre (200 au plus), avec n° de commande, livraison, déchargement |
| `GET` | `/me/refusals?from&to` | `returns.contest` | Refus des commandes du pré-vendeur, avec statut de contestation |
| `GET` | `/refusals/contested` | `returns.decide` | Contestations à trancher |
| `POST` | `/refusals/{deliveryId}/decide` | `returns.decide` | `{ upheld: boolean }` → `UPHELD` ou `REJECTED` ; audité |
| `GET`, `POST`, `PATCH` | `/suppliers`, `/suppliers/{id}` | `products.read`, `products.write` | Fournisseurs |
| `GET` | `/lots?variantId` | `stock.read` | Lots d'un article |

Filtres communs : `territoryId`, `partId`, `userId`, `customerId`, `productId`, `driverId` ; pour les retours en plus `lotId`, `supplierId`, `reasonId`, `condition`.

Opération mobile : `refusal.contest` `{ deliveryId, comment }` (`returns.contest`) — la commande doit être du pré-vendeur, la livraison avoir un refus et un statut `NONE` ; sinon refusée.

Changements des opérations existantes : `delivery.confirm` et `delivery.fail` acceptent `refusalReasonId` ; `unloads` (Web) et l'opération de déchargement mobile acceptent `conditions: [{ variantId, condition, qty, lotId?, photoFileId? }]` ; l'entrée en stock accepte `supplierId`, et `lotNumber`, `expiresAt` par ligne.

Erreurs : module inactif → `403` ; axe inconnu ou axes identiques → `400` ; contestation déjà tranchée → `409`.

## 3. Web

- Accueil = dashboard : cartes de chiffres, sélecteur de période (aujourd'hui, 7 jours, mois en cours, dates libres) et de secteur ; bloc retours si le module est actif.
- « Suivi du jour » : tableau du jour rafraîchi toutes les 30 s, puis carte Leaflet (polygones, clients verts ou rouges, positions) ; chaque utilisateur ouvre sa fiche.
- « Rapports » : onglets Commercial, Prévente, Livraison, Ventes perdues ; barre de filtres ; bouton « Exporter en CSV ».
- « Analyse des retours » (module actif) : onglet Par axe (choix de l'axe), onglet Croisé (deux axes, type de fait), onglet Contestations ; chaque chiffre ouvre la liste des faits.
- Catalogue : page Fournisseurs ; fournisseur habituel sur la fiche produit.
- Stock : entrée avec fournisseur choisi dans la liste, lot et péremption par ligne ; déchargement avec répartition par état, lot et photo.
- Fiches produit et client : bloc « Retours » (module actif).

## 4. Mobile

- Livreur : motif de refus obligatoire dès qu'une quantité est refusée (livraison partielle ou échec « refus »).
- Magasinier : déchargement avec répartition par état, lot et photo prise à l'appareil (photo envoyée à `/files`).
- Pré-vendeur : écran « Refus de mes commandes » (`/me/refusals`) avec « Contester » et le statut.

## 5. Tests

- `business-rules` : taux, volume minimum, coût net, prix moyen pondéré.
- API (Vitest, base partagée, la suite nettoie derrière elle) :
  - faits écrits par `delivery.confirm`, `delivery.fail` (refus), validation du déchargement, avec leurs axes et valeurs ;
  - motif de refus obligatoire ;
  - répartition au déchargement : somme, photo du défectueux, `WRITE_OFF`, seul `RESTOCK` au dépôt ;
  - lots et fournisseurs à l'entrée ;
  - dashboard, tableau du jour, carte, fiche, rapports sur des données connues ;
  - axes, vue croisée, faits, volume insuffisant ;
  - contestation : cycle complet, refus d'une seconde décision ;
  - exports : format, injection de formule ;
  - module `RETURNS_ANALYSIS` inactif → `403` ; isolation entre entreprises.
- Web et mobile : typecheck.

## Hors de cette phase

Analyse des causes (taux normal, indice d'excès, diagnostics, alerte qualité, score de risque client), exports Excel et PDF, rapports de stock (rotation), reprise de l'historique des retours.
