# Cas d'utilisation — SellWasl

> **Phase 0 — validé le 2026-10-01.**
> Chaque cas d'utilisation (`UC-xx`) renvoie aux [règles métier](business-rules.md) (`BR-XXX-nn`) qui le gouvernent. Le périmètre d'ensemble est décrit dans le [cahier des charges](cahier-des-charges.md).

## Lecture

Chaque cas indique :
- **Acteurs** : qui le réalise ;
- **Préconditions** : ce qui doit être vrai avant ;
- **Scénario** : le déroulement normal ;
- **Variantes** : les cas particuliers ;
- **Règles** : les règles métier appliquées.

Sauf mention contraire, les cas mobiles fonctionnent **hors connexion** (BR-SYN-01).

## Vue d'ensemble

| ID | Cas d'utilisation | Acteurs | Outil |
|---|---|---|---|
| UC-01 | Activer l'application et se connecter | Terrain, superviseur | Mobile |
| UC-02 | Consulter son tableau de bord | Terrain | Mobile |
| UC-03 | Démarrer la journée | Pré-vendeur, livreur, vendeur cash van | Mobile |
| UC-04 | Synchroniser | Terrain | Mobile |
| UC-05 | Clôturer la journée | Pré-vendeur, livreur, vendeur cash van | Mobile |
| UC-10 | Consulter les clients du jour | Vendeurs | Mobile |
| UC-11 | Consulter la fiche d'un client | Vendeurs, livreur | Mobile |
| UC-12 | Créer un client | Vendeurs | Mobile |
| UC-13 | Démarrer une visite | Vendeurs | Mobile |
| UC-14 | Prendre une commande | Pré-vendeur | Mobile |
| UC-15 | Vendre et livrer depuis le camion | Vendeur cash van | Mobile |
| UC-16 | Clore une visite sans commande | Vendeurs | Mobile |
| UC-17 | Modifier ou annuler une commande | Pré-vendeur | Mobile |
| UC-18 | Enregistrer une demande perdue | Vendeur cash van | Mobile |
| UC-19 | Encaisser une dette | Pré-vendeur, vendeur cash van | Mobile |
| UC-20 | Consulter ses objectifs | Vendeurs | Mobile |
| UC-21 | Consulter le catalogue | Vendeurs | Mobile |
| UC-30 | Confirmer la réception d'un chargement | Livreur, vendeur cash van | Mobile |
| UC-31 | Consulter sa tournée | Livreur | Mobile |
| UC-32 | Livrer une commande et encaisser | Livreur | Mobile |
| UC-33 | Déclarer un échec de livraison | Livreur | Mobile |
| UC-34 | Imprimer ou réimprimer un bon | Livreur, vendeur cash van | Mobile |
| UC-35 | Imprimer le récapitulatif de journée | Livreur, vendeurs | Mobile |
| UC-40 | Enregistrer une entrée de stock | Magasinier | Mobile |
| UC-41 | Préparer une tournée | Magasinier | Mobile |
| UC-42 | Charger un camion | Magasinier | Mobile |
| UC-43 | Décharger un camion | Magasinier | Mobile |
| UC-44 | Faire l'inventaire du dépôt | Magasinier | Mobile |
| UC-50 | Dessiner les secteurs et les parties | Superviseur, admin | Web |
| UC-51 | Affecter vendeurs, livreurs et camions | Superviseur, admin | Web |
| UC-52 | Définir le planning des parties | Superviseur, admin | Web |
| UC-53 | Gérer les clients | Superviseur, admin | Web |
| UC-54 | Reprogrammer une visite | Superviseur | Web |
| UC-55 | Fixer les quotas du jour | Superviseur | Web |
| UC-56 | Fixer les objectifs du mois | Superviseur, admin | Web |
| UC-57 | Suivre les équipes en temps réel | Superviseur | Web |
| UC-58 | Rouvrir une journée | Superviseur | Web |
| UC-59 | Changer l'appareil d'un profil, révoquer, bloquer | Superviseur, admin | Web |
| UC-60 | Traiter les lignes en attente | Superviseur | Web |
| UC-61 | Lancer la préparation d'une tournée | Superviseur | Web |
| UC-62 | Préparer le chargement d'un vendeur cash van | Superviseur | Web |
| UC-63 | Exporter en CSV | Superviseur, admin, comptable | Web |
| UC-70 | Enregistrer un versement | Comptable | Web |
| UC-71 | Consulter les dettes et les paiements | Comptable | Web |
| UC-80 | Gérer les utilisateurs | Admin | Web |
| UC-81 | Gérer le catalogue et les prix | Admin | Web |
| UC-82 | Paramétrer l'entreprise | Admin | Web |
| UC-83 | Importer des clients et des produits | Admin | Web |
| UC-90 | Créer une entreprise | Super Admin | Web |

« Vendeurs » désigne le pré-vendeur et le vendeur cash van. Partout où le superviseur agit, l'admin peut aussi agir (BR-USR-03).

---

## 1. Commun aux utilisateurs terrain (mobile)

### UC-01 — Activer l'application et se connecter

- **Acteurs** : utilisateur terrain ; superviseur pour l'activation.
- **Préconditions** : l'admin a créé l'utilisateur (UC-80).

**Scénario**
1. Depuis le Web, le superviseur associe le profil au téléphone. Le mécanisme, par exemple un code d'activation, sera défini en phase 1.
2. L'utilisateur se connecte sur ce téléphone.
3. La première synchronisation télécharge les données de son rôle.
4. L'application affiche le tableau de bord de son rôle (UC-02).

**Variantes**
- **Remplacement** : le superviseur associe le profil à un autre téléphone, et l'ancien est révoqué (UC-59).
- **Appareil révoqué ou bloqué** : la connexion est refusée avec le message « Appareil révoqué, contactez votre superviseur ».

**Règles** : BR-USR-02, BR-USR-06 à 09, BR-SYN-04.

### UC-02 — Consulter son tableau de bord

- **Acteurs** : utilisateur terrain.

**Contenu selon le rôle**

| Rôle | Tableau de bord |
|---|---|
| Pré-vendeur | Bouton « Démarrer » ou « Clôturer la journée », bouton « Synchroniser » et état de la synchronisation, clients du jour x/N (+k hors programme), commandes du jour, chiffre d'affaires du jour, résumé des objectifs |
| Vendeur cash van | Comme le pré-vendeur, avec en plus le stock du camion, l'encaissé du jour et la réception du chargement |
| Livreur | « Démarrer » ou « Clôturer la journée », « Synchroniser », réception du chargement, livraisons x/N, encaissé du jour |
| Magasinier | Préparations à faire, chargements et déchargements à faire, entrées de stock, inventaire |

**Règles** : BR-JOU-05, BR-SYN-06, BR-OBJ-04.

### UC-03 — Démarrer la journée

- **Acteurs** : pré-vendeur, livreur, vendeur cash van.
- **Préconditions** : jour ouvré ; journée `NOT_STARTED`.

**Scénario**
1. L'utilisateur appuie sur « Démarrer la journée ».
2. L'application tente une synchronisation.
3. La journée passe `IN_PROGRESS`, et le bouton devient « Clôturer la journée ».
4. L'envoi de la position commence.

**Variantes**
- **Pas de réseau** : la journée démarre avec les dernières données, et le superviseur est notifié.
- **Jour non travaillé ou férié** : le bouton n'est pas disponible.

**Règles** : BR-JOU-02 à 04, BR-JOU-09, BR-PLA-04.

### UC-04 — Synchroniser

- **Acteurs** : utilisateur terrain.

**Scénario**
1. La synchronisation part automatiquement dès qu'il y a du réseau, ou quand l'utilisateur appuie sur « Synchroniser ».
2. Les opérations en attente sont envoyées, puis les mises à jour sont reçues.
3. L'indicateur affiche « synchronisé ».

**Variantes**
- **Le serveur a transformé des lignes** (quota dépassé, rupture de stock) : un message explique les changements au vendeur.
- **Erreur** : l'indicateur affiche « erreur » et l'envoi est retenté plus tard.

**Règles** : BR-SYN-01 à 07.

### UC-05 — Clôturer la journée

- **Acteurs** : pré-vendeur, livreur, vendeur cash van.
- **Préconditions** : journée `IN_PROGRESS` ; aucune visite en cours.

**Scénario**
1. L'utilisateur appuie sur « Clôturer la journée ».
2. L'application affiche le résumé : visites x/N, commandes, ventes ou livraisons, montants, encaissé.
3. L'utilisateur confirme.
4. Les effets de la clôture s'appliquent selon son rôle (BR-JOU-07).
5. Le livreur et le vendeur cash van peuvent imprimer leur récapitulatif (UC-35), puis passent au déchargement (UC-43) et au versement (UC-70).

**Variantes**
- **Hors connexion** : la clôture est envoyée à la prochaine synchronisation, et le superviseur voit « clôture en attente de synchronisation ».
- **Une visite est en cours** : l'application demande de la terminer d'abord.

**Règles** : BR-JOU-06 à 08, BR-PLA-06, BR-LIV-04.

---

## 2. Vendeurs : pré-vendeur et vendeur cash van (mobile)

### UC-10 — Consulter les clients du jour

- **Acteurs** : pré-vendeur, vendeur cash van.
- **Préconditions** : aucune. La consultation est possible même hors journée.

**Scénario**
1. Depuis le tableau de bord, le vendeur ouvre « Clients du jour (x/N) ».
2. La liste s'affiche, triée du plus proche au plus loin de sa position.
3. Il peut passer à la **carte** : marqueurs rouges pour les clients à visiter, verts pour les clients visités.
4. Une bascule affiche **tous les clients du secteur**, en liste comme sur la carte.
5. Sur la carte, un appui sur un client affiche trois boutons : itinéraire dans Google Maps, fiche du client (UC-11), commencer la visite (UC-13).
6. Dans la liste, un appui sur un client ouvre sa fiche (UC-11).

**Variantes**
- **Position du téléphone indisponible** : la liste est triée par nom.

**Règles** : BR-PLA-02, BR-PLA-07, BR-VIS-06, BR-VIS-10, BR-JOU-05.

### UC-11 — Consulter la fiche d'un client

- **Acteurs** : pré-vendeur, vendeur cash van, livreur.

**Scénario**
1. La fiche affiche les informations du client : type, partie, fréquence, dette.
2. Elle donne l'historique de ses visites et de ses commandes ou ventes.
3. Actions possibles : commencer la visite (si la journée est en cours), ouvrir sur la carte, appeler le client.

**Règles** : BR-CLI-01, BR-PAY-06, BR-JOU-05.

### UC-12 — Créer un client

- **Acteurs** : pré-vendeur, vendeur cash van.
- **Préconditions** : journée `IN_PROGRESS`.

**Scénario**
1. Dans la liste des clients, le vendeur appuie sur « Ajouter un client ».
2. Il saisit le nom, le téléphone et l'adresse, et choisit le type parmi ceux que sert son secteur.
3. Il appuie sur l'icône de localisation : la position GPS se remplit.
4. Il choisit la fréquence de visite.
5. Il enregistre. Le client est rattaché à son secteur, sa partie est calculée, et il est actif et marqué « nouveau ».

**Variantes**
- **Position hors des parties du secteur** : le client est enregistré « hors partie », et le vendeur en est averti. Il peut quand même le visiter tout de suite ; le superviseur le placera ensuite.

**Règles** : BR-CLI-02, BR-CLI-03, BR-CLI-05, BR-ORG-04, BR-PLA-03.

### UC-13 — Démarrer une visite

- **Acteurs** : pré-vendeur, vendeur cash van.
- **Préconditions** : journée `IN_PROGRESS`. Pour le vendeur cash van, réception du chargement confirmée.

**Scénario**
1. Depuis la fiche, la liste ou la carte, le vendeur appuie sur « Commencer la visite ».
2. Le pré-vendeur choisit le mode : **sur place** ou **par téléphone**. En cash van, la visite est toujours sur place.
3. Sur place, l'application calcule la distance au client. Au-delà de la distance réglée, la visite est marquée « hors zone », sans être bloquée.
4. La visite passe `IN_PROGRESS`. Le vendeur prend une commande (UC-14), fait une vente (UC-15) ou clôt la visite sans commande (UC-16).

**Variantes**
- **Client non prévu ce jour** : la visite est comptée hors programme.
- **Client déjà visité aujourd'hui** : une nouvelle visite est possible.

**Règles** : BR-VIS-01 à 03, BR-VIS-07, BR-VIS-08, BR-JOU-05, BR-CV-02.

### UC-14 — Prendre une commande (prévente)

- **Acteurs** : pré-vendeur.
- **Préconditions** : visite en cours.

**Scénario**
1. L'application affiche les produits proposables à ce client, avec les prix de son type.
2. Le vendeur appuie sur un produit, choisit l'unité et saisit la quantité.
3. À la validation, le produit quitte la liste et entre dans le panier. Le palier éventuel s'applique, et les bonus s'ajoutent automatiquement.
4. Il recommence pour les autres produits.
5. Le panier affiche le total. Le vendeur peut encore modifier ou retirer une ligne.
6. Il confirme. La commande passe `CONFIRMED`, la visite `COMPLETED`, le marqueur devient vert et le compteur augmente.

**Variantes**
- **Quota atteint ou dépassé** : la ligne est scindée, et l'excédent part en attente. Un produit dont le quota est épuisé reste visible, grisé « quota atteint », et sélectionnable.
- **Stock insuffisant pour un bonus** : le bonus est réduit, et la ligne l'indique.
- **Hors connexion** : tout fonctionne. La réservation se fait à la synchronisation, et une ligne peut alors être marquée « rupture ».

**Règles** : BR-CAT-04 à 11, BR-QUO-02, BR-QUO-03, BR-CMD-01 à 07, BR-VIS-06, BR-VIS-09.

### UC-15 — Vendre et livrer depuis le camion (cash van)

- **Acteurs** : vendeur cash van.
- **Préconditions** : visite en cours.

**Scénario**
1. L'application affiche les produits encore présents dans le camion, avec les prix du type du client.
2. Le vendeur ajoute les produits au panier comme en UC-14. La quantité ne peut pas dépasser le stock du camion.
3. Il confirme la vente. Elle passe directement `DELIVERED`, et le stock du camion baisse.
4. Il enregistre le paiement, en espèces ou à crédit selon les droits du client.
5. Il imprime le bon (UC-34).

**Variantes**
- **Quota épuisé** : le produit est grisé, et le vendeur peut enregistrer une demande perdue (UC-18).
- **Crédit non autorisé** : le paiement total est exigé.
- **Pas d'imprimante** : le bon reste imprimable plus tard.

**Règles** : BR-CV-02 à 05, BR-QUO-04, BR-CAT-04 à 11, BR-PAY-03, BR-IMP-02 à 05.

### UC-16 — Clore une visite sans commande

- **Acteurs** : pré-vendeur, vendeur cash van.
- **Préconditions** : visite en cours.

**Scénario**
1. Le vendeur appuie sur « Pas de commande ».
2. Il choisit un motif.
3. La visite passe `COMPLETED`, le marqueur devient vert et le compteur augmente.

**Variantes**
- **Motif « fermé définitivement »** : le client est ajouté à la liste « clients à revoir ».

**Règles** : BR-VIS-04 à 06.

### UC-17 — Modifier ou annuler une commande (prévente)

- **Acteurs** : pré-vendeur.
- **Préconditions** : commande `CONFIRMED` ; journée `IN_PROGRESS`.

**Scénario**
1. Le vendeur ouvre « Commandes du jour » et choisit une commande.
2. Il modifie les quantités, ajoute ou retire des produits, avec les mêmes règles de prix, de bonus et de quotas. Il peut aussi annuler la commande.
3. Il enregistre. La réservation est ajustée, ou libérée en cas d'annulation, à la synchronisation.

**Variantes**
- **Journée clôturée** : la commande est en consultation seule. Seul le superviseur peut rouvrir la journée (UC-58).

**Règles** : BR-CMD-02, BR-CMD-04, BR-JOU-05, BR-JOU-08.

### UC-18 — Enregistrer une demande perdue (cash van)

- **Acteurs** : vendeur cash van.
- **Préconditions** : visite en cours ; produit dont le quota est épuisé.

**Scénario**
1. Sur le produit grisé « quota atteint », le vendeur appuie sur « Demande perdue ».
2. Il saisit la quantité que voulait le client.
3. La demande est enregistrée pour les statistiques.

**Règles** : BR-QUO-04.

### UC-19 — Encaisser une dette

- **Acteurs** : pré-vendeur, vendeur cash van.
- **Préconditions** : journée `IN_PROGRESS` ; dette du client supérieure à 0.

**Scénario**
1. Sur la fiche du client, le vendeur appuie sur « Encaisser une dette ».
2. Il saisit le montant, au plus égal à la dette.
3. Le paiement est enregistré et la dette diminue. Un reçu s'imprime si une imprimante est connectée.
4. Le montant s'ajoute au récapitulatif de la journée.

**Règles** : BR-PAY-04 à 07.

### UC-20 — Consulter ses objectifs

- **Acteurs** : pré-vendeur, vendeur cash van.

**Scénario**
1. L'écran « Objectifs » affiche, pour chaque gamme : la cible, le réalisé, le taux et la prime estimée.

**Règles** : BR-OBJ-01 à 04.

### UC-21 — Consulter le catalogue

- **Acteurs** : pré-vendeur, vendeur cash van.

**Scénario**
1. Le vendeur parcourt les produits par gamme et par catégorie, **sans les prix**.

**Règles** : BR-CAT-11.

---

## 3. Livreur (mobile)

### UC-30 — Confirmer la réception d'un chargement

- **Acteurs** : livreur, vendeur cash van.
- **Préconditions** : le magasinier a validé le chargement (UC-42).

**Scénario**
1. L'écran « Chargement » affiche la liste des produits et des quantités.
2. L'utilisateur vérifie son camion, puis confirme la réception ou signale un écart en saisissant les quantités réelles.
3. Pour le livreur, les commandes passent `OUT_FOR_DELIVERY`. Pour le vendeur cash van, la vente devient possible.

**Variantes**
- **Écart** : le superviseur est notifié, et l'utilisateur travaille avec ce qu'il a réellement reçu.

**Règles** : BR-PRE-05, BR-CV-01, BR-CV-02.

### UC-31 — Consulter sa tournée

- **Acteurs** : livreur.

**Scénario**
1. Le livreur voit la liste des livraisons, triée par distance, et la carte.
2. Pour chaque livraison : le client, le montant et la dette.
3. Un bouton ouvre l'itinéraire dans Google Maps.

**Règles** : BR-LIV-01.

### UC-32 — Livrer une commande et encaisser

- **Acteurs** : livreur.
- **Préconditions** : commande `OUT_FOR_DELIVERY` ; journée `IN_PROGRESS`.

**Scénario**
1. Le livreur ouvre la livraison.
2. Il confirme la livraison complète, ou il ajuste les quantités (livraison partielle). Paliers et bonus sont alors recalculés.
3. Il enregistre le paiement, en espèces ou à crédit.
4. Il confirme. La commande passe `DELIVERED` ou `PARTIALLY_DELIVERED`, et la marchandise sort du stock du camion.
5. Il imprime le bon (UC-34).

**Variantes**
- **Le client ne peut pas payer le minimum exigé** : le livreur réduit les quantités ou déclare un échec avec le motif « refus » (UC-33).

**Règles** : BR-LIV-02, BR-LIV-03, BR-CAT-10, BR-PAY-03, BR-IMP-02, BR-IMP-05.

### UC-33 — Déclarer un échec de livraison

- **Acteurs** : livreur.

**Scénario**
1. Le livreur appuie sur « Échec » et choisit un motif.
2. La commande passe `FAILED`, et la marchandise reste dans le camion.

**Règles** : BR-LIV-02, BR-LIV-05, BR-LIV-06.

### UC-34 — Imprimer ou réimprimer un bon

- **Acteurs** : livreur, vendeur cash van.

**Scénario**
1. Après une livraison ou une vente, ou depuis l'historique, l'utilisateur appuie sur « Imprimer ».
2. L'application imprime sur l'imprimante Bluetooth, en l'associant au téléphone la première fois.
3. Une réimpression porte la mention « DUPLICATA » et est tracée.

**Règles** : BR-IMP-01 à 05.

### UC-35 — Imprimer le récapitulatif de journée

- **Acteurs** : livreur, vendeur cash van, pré-vendeur qui a encaissé des dettes.
- **Préconditions** : journée clôturée.

**Scénario**
1. L'utilisateur ouvre « Récapitulatif ».
2. Le récapitulatif s'affiche, et il l'imprime.
3. Il remet l'argent au comptable (UC-70).

**Règles** : BR-PAY-07, BR-IMP-06.

---

## 4. Magasinier (mobile)

### UC-40 — Enregistrer une entrée de stock

- **Acteurs** : magasinier.

**Scénario**
1. Le magasinier saisit les produits et les quantités reçus.
2. Il valide, et un mouvement `IN` est créé au dépôt.

**Règles** : BR-STK-02, BR-STK-03, BR-STK-05.

### UC-41 — Préparer une tournée

- **Acteurs** : magasinier.
- **Préconditions** : préparation lancée par le superviseur (UC-61).

**Scénario**
1. Le magasinier ouvre la liste des tournées à préparer.
2. Il consulte la liste de chargement (total par produit) et le détail par commande.
3. Il saisit les quantités préparées. En cas de rupture, il saisit une quantité inférieure.
4. Il valide, et les commandes passent `READY`.

**Règles** : BR-PRE-03, BR-PRE-04, BR-CAT-10.

### UC-42 — Charger un camion

- **Acteurs** : magasinier.
- **Préconditions** : en prévente, tournée `READY` ; en cash van, chargement prévu par le superviseur (UC-62) ou saisi directement.

**Scénario**
1. Le magasinier choisit le camion.
2. Il vérifie ou saisit les quantités chargées.
3. Il valide. Un transfert du dépôt vers le camion est créé, et la réception reste à confirmer par le livreur ou le vendeur (UC-30).

**Règles** : BR-PRE-04, BR-CV-01, BR-STK-03, BR-STK-05.

### UC-43 — Décharger un camion

- **Acteurs** : magasinier.
- **Préconditions** : journée du livreur ou du vendeur cash van clôturée.

**Scénario**
1. Le magasinier choisit le camion.
2. Il compte le stock restant, produit par produit.
3. Il valide. L'écart est calculé et enregistré, le stock compté retourne au dépôt et le camion revient à zéro. Un écart est signalé au superviseur.

**Variantes**
- **Après le déchargement**, la journée ne peut plus être rouverte.

**Règles** : BR-STK-07, BR-JOU-08.

### UC-44 — Faire l'inventaire du dépôt

- **Acteurs** : magasinier.

**Scénario**
1. Le magasinier saisit les quantités comptées.
2. Il valide. Chaque écart crée un `ADJUSTMENT`, audité.

**Règles** : BR-STK-06.

---

## 5. Superviseur (Web)

### UC-50 — Dessiner les secteurs et les parties

- **Acteurs** : superviseur, admin.

**Scénario**
1. Il crée un secteur : code, nom, types de clients servis.
2. Il dessine sur la carte le polygone de chaque partie.
3. Il enregistre. Les clients sont affectés ou réaffectés, et le nombre de clients par partie s'affiche.

**Variantes**
- **Chevauchement avec un secteur qui sert le même type de clients** : l'application le signale.
- **Modification d'un polygone existant** : le nombre de clients déplacés s'affiche avant la confirmation.

**Règles** : BR-ORG-01 à 06.

### UC-51 — Affecter vendeurs, livreurs et camions

- **Acteurs** : superviseur, admin.

**Scénario**
1. Il affecte un vendeur à chaque secteur.
2. Il affecte à chaque livreur les secteurs qu'il livre.
3. Il affecte un camion à chaque livreur et à chaque vendeur cash van.

**Règles** : BR-ORG-01, BR-PRE-01, BR-STK-01.

### UC-52 — Définir le planning des parties

- **Acteurs** : superviseur, admin.

**Scénario**
1. Pour chaque secteur, il associe une partie à chaque jour travaillé.

**Règles** : BR-ORG-07, BR-PLA-02.

### UC-53 — Gérer les clients

- **Acteurs** : superviseur, admin.

**Scénario**
1. Il consulte les clients en liste et sur la carte, avec des filtres (secteur, partie, type, statut).
2. Il traite la liste « clients à revoir » : clients nouveaux, hors partie, fermés définitivement.
3. Il modifie un client : type, partie forcée, fréquence, date de référence, crédit autorisé, plafond. Il peut aussi le désactiver.

**Règles** : BR-CLI-04, BR-CLI-05, BR-ORG-04, BR-PLA-03, BR-PAY-02.

### UC-54 — Reprogrammer une visite

- **Acteurs** : superviseur.

**Scénario**
1. Il choisit un client et une date.
2. Le client s'ajoute aux clients du jour du vendeur à cette date.

**Règles** : BR-PLA-05.

### UC-55 — Fixer les quotas du jour

- **Acteurs** : superviseur.

**Scénario**
1. Il choisit la date, un ou plusieurs vendeurs, le produit, l'unité et la quantité.
2. Il enregistre, et les vendeurs concernés sont notifiés.

**Règles** : BR-QUO-01, BR-QUO-05.

### UC-56 — Fixer les objectifs du mois

- **Acteurs** : superviseur, admin.

**Scénario**
1. Pour chaque vendeur et chaque gamme, il saisit la cible, la prime et le plafond.
2. Il suit le réalisé et la prime due.

**Règles** : BR-OBJ-01 à 04.

### UC-57 — Suivre les équipes en temps réel

- **Acteurs** : superviseur.

**Scénario**
1. Le **tableau du jour** affiche, pour chaque utilisateur :
   - l'état de sa journée ;
   - ses visites x/N, dont hors zone et par téléphone ;
   - ses commandes et son chiffre d'affaires ;
   - sa dernière position et sa dernière synchronisation ;
   - sa batterie et ses opérations en attente.
2. La **carte** affiche les polygones, les clients (rouge ou vert) et la dernière position de chaque membre de l'équipe.
3. La **fiche d'un vendeur ou d'un livreur** montre ses visites, commandes et livraisons, en consultation seule.

**Règles** : BR-JOU-09, BR-VIS-02, BR-VIS-03, BR-USR-04, BR-USR-05.

### UC-58 — Rouvrir une journée

- **Acteurs** : superviseur.

**Scénario**
1. Il choisit une journée clôturée et saisit le motif.
2. La journée repasse `IN_PROGRESS`. Les commandes `LOCKED` redeviennent `CONFIRMED`, et l'utilisateur est notifié.

**Variantes**
- **Étape suivante déjà commencée** (préparation lancée, ou déchargement validé) : la réouverture est refusée, avec l'explication.

**Règles** : BR-JOU-08.

### UC-59 — Changer l'appareil d'un profil, révoquer, bloquer

- **Acteurs** : superviseur, admin.

**Scénario**
1. Il ouvre la liste des appareils d'un profil.
2. Il associe un nouvel appareil (l'ancien est alors révoqué), révoque une session ou bloque un appareil.

**Variantes**
- **L'ancien appareil a des opérations non synchronisées** : un avertissement s'affiche avant la confirmation.

**Règles** : BR-USR-06 à 09.

### UC-60 — Traiter les lignes en attente

- **Acteurs** : superviseur.

**Scénario**
1. Il consulte la liste des lignes en attente : vendeur, client, produit, quantité, stock disponible.
2. Il accepte ou refuse chaque ligne, ou plusieurs lignes à la fois.
3. Une ligne acceptée devient normale et réserve du stock ; une ligne refusée devient une vente perdue. Le vendeur est notifié.

**Règles** : BR-QUO-06, BR-CMD-04.

### UC-61 — Lancer la préparation d'une tournée

- **Acteurs** : superviseur.

**Scénario**
1. Il consulte les tournées de la date de livraison. Pour chacune : journées encore en cours ou en attente de synchronisation, lignes en attente restantes, ruptures.
2. Si besoin, il change le livreur d'un secteur.
3. Il lance la préparation. Les commandes passent `PREPARING` et apparaissent chez le magasinier.

**Variantes**
- **Conditions non remplies** : le bouton est désactivé, avec la raison.

**Règles** : BR-PRE-01, BR-PRE-02.

### UC-62 — Préparer le chargement d'un vendeur cash van

- **Acteurs** : superviseur.

**Scénario**
1. Il choisit le vendeur et la date.
2. Il saisit les produits et les quantités, éventuellement en repartant du chargement précédent.
3. Le magasinier charge le camion (UC-42).

**Règles** : BR-CV-01.

### UC-63 — Exporter en CSV

- **Acteurs** : superviseur, admin, comptable, selon leurs droits.

**Scénario**
1. Il choisit l'export (ventes, visites, objectifs, dettes, versements) et les filtres (période, secteur, vendeur).
2. Il télécharge le fichier CSV.

**Règles** : BR-IO-03.

---

## 6. Comptable (Web)

### UC-70 — Enregistrer un versement

- **Acteurs** : comptable.

**Scénario**
1. Le comptable consulte la liste des journées clôturées, avec le montant attendu pour chacune.
2. Il ouvre le récapitulatif de la journée et saisit le montant remis.
3. Il valide. L'écart est calculé, et le superviseur est notifié s'il n'est pas nul.

**Règles** : BR-PAY-07, BR-PAY-08.

### UC-71 — Consulter les dettes et les paiements

- **Acteurs** : comptable.

**Scénario**
1. Il consulte les dettes par client, l'historique des paiements et les clients proches de leur plafond ou au-delà.
2. Il peut exporter ces données (UC-63).

**Règles** : BR-PAY-02, BR-PAY-04.

---

## 7. Administration (Web)

### UC-80 — Gérer les utilisateurs

- **Acteurs** : admin.

**Scénario**
1. Il crée, modifie ou désactive un utilisateur : nom, code, rôle.
2. Les affectations au secteur ou au camion se font en UC-51.

**Règles** : BR-USR-01, BR-USR-03, BR-USR-10.

### UC-81 — Gérer le catalogue et les prix

- **Acteurs** : admin.

**Scénario**
1. Il gère les produits, gammes, catégories et conditionnements.
2. Il saisit les prix par type de client et par unité.
3. Il définit les paliers et les bonus.

**Règles** : BR-CAT-01 à 09.

### UC-82 — Paramétrer l'entreprise

- **Acteurs** : admin.

**Scénario**
1. Il règle :
   - les types de clients ;
   - les jours travaillés et les jours fériés ;
   - les motifs de non-commande et d'échec de livraison ;
   - la distance hors zone ;
   - la largeur du ticket ;
   - les dépôts et les camions ;
   - les informations imprimées en tête des bons.

**Règles** : BR-TEN-06, BR-TEN-07, BR-STK-01, BR-IMP-02.

### UC-83 — Importer des clients et des produits

- **Acteurs** : admin.

**Scénario**
1. Il charge un fichier CSV.
2. Il vérifie l'aperçu.
3. Il lance l'import. Les lignes valides sont importées, et les lignes en erreur sont listées avec la raison.

**Règles** : BR-IO-01, BR-IO-02.

### UC-90 — Créer une entreprise

- **Acteurs** : Super Admin.

**Scénario**
1. Il saisit le nom de l'entreprise et choisit son mode : Prévente, Cash van ou Mixte.
2. Il crée le compte de l'administrateur de l'entreprise.
3. Les paramètres par défaut sont créés.
4. L'entreprise apparaît dans la liste des entreprises.

**Règles** : BR-TEN-03, BR-TEN-07.
