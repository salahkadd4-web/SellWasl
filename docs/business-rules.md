# Règles métier — SellWasl

> **Phase 0 — validé le 2026-10-01.**
> Chaque règle porte un identifiant stable (`BR-XXX-nn`). Les [cas d'utilisation](use-cases.md) et, plus tard, les tests y font référence.
> Les règles marquées **(à confirmer)** ont été déduites pendant la rédaction et n'ont pas encore été validées explicitement. Elles sont listées au [§10 du cahier des charges](cahier-des-charges.md#10-règles-déduites-à-confirmer).

## Conventions

- **Unité de base** : la plus petite unité d'un produit (pièce, triplette…). Stocks, quotas et bonus sont calculés dans cette unité.
- **Montants** : en dinars algériens (DA), toutes taxes comprises.
- **Jour ouvré** : jour travaillé de la semaine selon l'entreprise, hors jours fériés.
- **Vendeur** : pré-vendeur ou vendeur cash van.
- **Terrain** : pré-vendeur, livreur, vendeur cash van, magasinier.

## Sommaire

1. [Entreprise et modules — TEN](#1-entreprise-et-modules--ten)
2. [Utilisateurs et appareils — USR](#2-utilisateurs-et-appareils--usr)
3. [Secteurs, parties et planning — ORG](#3-secteurs-parties-et-planning--org)
4. [Fréquences et clients du jour — PLA](#4-fréquences-et-clients-du-jour--pla)
5. [Clients — CLI](#5-clients--cli)
6. [Catalogue, prix, paliers, bonus — CAT](#6-catalogue-prix-paliers-bonus--cat)
7. [Quotas — QUO](#7-quotas--quo)
8. [Objectifs — OBJ](#8-objectifs--obj)
9. [Journée de travail — JOU](#9-journée-de-travail--jou)
10. [Visites — VIS](#10-visites--vis)
11. [Commandes de prévente — CMD](#11-commandes-de-prévente--cmd)
12. [Préparation et chargement — PRE](#12-préparation-et-chargement-prévente--pre)
13. [Livraison — LIV](#13-livraison--liv)
14. [Cash van — CV](#14-cash-van--cv)
15. [Stock — STK](#15-stock--stk)
16. [Paiements, dettes, versements — PAY](#16-paiements-dettes-versements--pay)
17. [Synchronisation — SYN](#17-synchronisation--syn)
18. [Impression — IMP](#18-impression--imp)
19. [Notifications — NOT](#19-notifications--not)
20. [Audit — AUD](#20-audit--aud)
21. [Import et export — IO](#21-import-et-export--io)
22. [Exemples chiffrés](#22-exemples-chiffrés)

---

## 1. Entreprise et modules — TEN

**BR-TEN-01** — Toute donnée métier appartient à une entreprise. Un utilisateur ne voit et ne modifie jamais les données d'une autre entreprise.

**BR-TEN-02** — L'entreprise concernée par une requête est déduite de la session de l'utilisateur, jamais d'une valeur envoyée par le téléphone ou le navigateur.

**BR-TEN-03** — Le Super Admin choisit le **mode** de l'entreprise ; les modules actifs en découlent.

| Mode | Modules actifs |
|---|---|
| Prévente | `PRE_SALES`, `DELIVERY`, `WAREHOUSE`, `ANALYTICS` |
| Cash van | `CASH_VAN`, `WAREHOUSE`, `ANALYTICS` |
| Mixte | `PRE_SALES`, `DELIVERY`, `CASH_VAN`, `WAREHOUSE`, `ANALYTICS` |

Le socle commun est toujours actif.

**BR-TEN-04** — Une fonction d'un module inactif n'apparaît ni sur le Web ni sur le mobile. Le serveur la refuse même si elle est appelée directement.

**BR-TEN-05** — Secteurs, parties, planning, journée de travail et visites sont disponibles dès que `PRE_SALES` ou `CASH_VAN` est actif.

**BR-TEN-06** — L'entreprise règle ses jours travaillés (par défaut du samedi au jeudi) et sa liste de jours fériés.

**BR-TEN-07** — Paramètres de l'entreprise et valeurs par défaut :

| Paramètre | Défaut |
|---|---|
| Distance au-delà de laquelle une visite sur place est « hors zone » | 100 m |
| Largeur du ticket d'impression | 58 mm |
| Intervalle d'envoi de la position pendant la journée | 5 min |
| Motifs de non-commande | voir BR-VIS-04 |
| Motifs d'échec de livraison | voir BR-LIV-02 |
| Types de clients | Détail |

---

## 2. Utilisateurs et appareils — USR

**BR-USR-01** — Un utilisateur a un seul rôle. **(à confirmer)**

**BR-USR-02** — Les rôles terrain (`PRE_VENDEUR`, `LIVREUR`, `VENDEUR_CASH_VAN`, `MAGASINIER`) utilisent uniquement l'application mobile. Les rôles `COMPANY_ADMIN`, `SUPERVISEUR`, `COMPTABLE` et `SUPER_ADMIN` utilisent uniquement le Web.

**BR-USR-03** — `COMPANY_ADMIN` a tous les droits du superviseur et du comptable. Il gère en plus les utilisateurs (superviseurs compris), le catalogue, les prix et les paramètres.

**BR-USR-04** — Dans le MVP, un superviseur voit toute l'entreprise : il n'y a pas de découpage par équipe.

**BR-USR-05** — Le superviseur et le comptable ne créent, ne modifient et ne suppriment jamais une commande, une vente, une visite, une livraison ou un paiement. Les actions du superviseur sur les équipes se limitent à :
- rouvrir une journée ;
- associer un profil à un appareil ;
- révoquer une session ;
- bloquer un appareil.

**BR-USR-06** — Un utilisateur terrain a au plus **un appareil actif**. **(à confirmer)**

**BR-USR-07** — Seuls le superviseur et l'admin associent un profil à un appareil. L'association d'un nouvel appareil révoque le précédent. Le mécanisme (par exemple un code d'activation à usage unique saisi sur le téléphone) sera défini en phase 1.

**BR-USR-08** — Si l'ancien appareil avait signalé des opérations non synchronisées lors de son dernier contact, le superviseur en est averti avant de confirmer le changement.

**BR-USR-09** — Chaque opération enregistre l'utilisateur **et** l'appareil qui l'a faite. On sait ainsi quel téléphone a travaillé pendant un remplacement.

**BR-USR-10** — Les codes (vendeur, secteur, camion) sont libres, sans format imposé, et uniques dans l'entreprise.

---

## 3. Secteurs, parties et planning — ORG

**BR-ORG-01** — Un secteur a un code (ex. `3101`), un nom, la liste des **types de clients qu'il sert** et un vendeur affecté. Un vendeur a un seul secteur. Le superviseur peut changer le vendeur d'un secteur.

**BR-ORG-02** — Un secteur est découpé en **N parties**, N étant réglable. Chaque partie est un polygone dessiné sur la carte par le superviseur ou l'admin. Les parties d'un même secteur ne se chevauchent pas.

**BR-ORG-03** — Des secteurs qui servent des types de clients différents peuvent se superposer. Exemple : un secteur « Supérette » couvre toute la ville, par-dessus les secteurs 3101 à 3110 qui servent le détail. En revanche, deux secteurs qui servent un même type de clients ne doivent pas se superposer, et l'application signale tout chevauchement. **(à confirmer)**

**BR-ORG-04** — **Affectation automatique d'un client** : parmi les secteurs qui servent le type du client, on retient la partie dont le polygone contient sa position.
- Si plusieurs parties conviennent, le superviseur choisit.
- Si aucune ne convient, le client est « **hors partie** ».
- Le superviseur peut toujours **forcer** la partie d'un client.

**BR-ORG-05** — Un client hors partie n'est jamais planifié. Il apparaît dans la liste « clients à revoir » (BR-CLI-05).

**BR-ORG-06** — Après la modification d'un polygone, les clients sont réaffectés selon BR-ORG-04, sauf ceux dont la partie a été forcée. Le superviseur voit le nombre de clients déplacés avant de confirmer.

**BR-ORG-07** — **Planning du secteur** : chaque jour travaillé de la semaine est associé à une partie. Une même partie peut être associée à plusieurs jours.

Exemple : 6 parties, de la partie 1 le samedi à la partie 6 le jeudi.

---

## 4. Fréquences et clients du jour — PLA

**BR-PLA-01** — Chaque client actif a une **fréquence** et une **date de référence**, qui est la date de sa première visite prévue.

| Code | Libellé | Période |
|---|---|---|
| `WEEKLY` | Chaque semaine | 1 semaine |
| `BIWEEKLY` | Tous les 15 jours | 2 semaines |
| `EVERY_4_WEEKS` | Toutes les 4 semaines | 4 semaines |

**BR-PLA-02** — Un client est **du jour** à la date D si :
1. D est un jour ouvré ;
2. la partie du client est celle que le planning de son secteur prévoit pour ce jour de la semaine ;
3. le nombre de semaines entre la date de référence et D est un multiple de la période ;
4. le client est actif et n'est pas hors partie.

Les clients reprogrammés pour D (BR-PLA-05) s'ajoutent à la liste.

**BR-PLA-03** — Quand un client est créé ou change de partie, sa date de référence est, par défaut, le prochain jour ouvré prévu pour sa partie. Le superviseur peut la changer, par exemple pour répartir les clients « tous les 15 jours » sur les deux semaines.

**BR-PLA-04** — Un jour non travaillé ou férié n'a pas de clients du jour. Les visites qui y tomberaient ne sont ni reportées ni comptées comme manquées. **(à confirmer)**

**BR-PLA-05** — Le superviseur peut **reprogrammer** un client à une date précise : le client s'ajoute aux clients du jour de cette date, sans que sa fréquence change.

**BR-PLA-06** — À la clôture de la journée, chaque client du jour qui n'a pas été visité reçoit une visite **manquée** (`MISSED`). Elle n'est pas reportée automatiquement.

**BR-PLA-07** — Le téléphone calcule la liste du jour hors connexion, avec ces mêmes règles. Le code de calcul est partagé entre le serveur et le mobile.

---

## 5. Clients — CLI

**BR-CLI-01** — Une fiche client comprend :
- nom, téléphone, adresse ;
- type, position GPS, secteur et partie ;
- fréquence et date de référence ;
- crédit autorisé et plafond ;
- statut (actif ou inactif) et indicateur « nouveau ».

**BR-CLI-02** — Un vendeur peut créer un client. Sont obligatoires : le nom, le type, la position (prise par le bouton GPS du formulaire) et la fréquence. Le vendeur ne peut choisir qu'un type de client servi par son secteur.
- Le client est rattaché au **secteur du vendeur**.
- Sa partie est calculée parmi les parties de ce secteur, même hors connexion.
- S'il n'est dans aucune, il est « hors partie » : rattaché au secteur, mais sans partie. **(à confirmer)**

**BR-CLI-03** — Un client créé par un vendeur est actif immédiatement : le vendeur peut le visiter et lui vendre, même s'il est hors partie. Il est marqué « **nouveau** » pour revue par le superviseur, qui peut le placer dans une autre partie ou un autre secteur. Le crédit n'est pas autorisé par défaut.

**BR-CLI-04** — Seuls le superviseur et l'admin modifient un client. Supprimer un client revient à le **désactiver** : son historique est conservé, mais il n'est plus planifié ni proposé à la vente.

**BR-CLI-05** — La liste « **clients à revoir** » du superviseur regroupe :
- les clients nouveaux ;
- les clients hors partie ;
- les clients signalés « fermé définitivement » lors d'une visite.

---

## 6. Catalogue, prix, paliers, bonus — CAT

**BR-CAT-01** — Un produit a :
- une référence, un nom, une **gamme** (ex. Bimo) et une catégorie ;
- une unité de base ;
- des **conditionnements**, chacun avec son nom et son nombre d'unités de base (ex. carton = 20 triplettes) ;
- un statut actif ou inactif.

**BR-CAT-02** — Le vendeur saisit une quantité dans l'unité de son choix (unité de base ou conditionnement). Elle est convertie en unité de base pour le stock, les quotas et les bonus.

**BR-CAT-03** — L'entreprise définit ses **types de clients** (ex. Détail, Supérette, Gros). Chaque client a un type.

**BR-CAT-04** — **Prix** : un prix TTC par produit, par type de client et par unité. Un produit sans prix pour le type d'un client n'est pas proposé à ce client.

**BR-CAT-05** — **Palier** : pour un produit, un type de client et une unité, « à partir de Q, le prix unitaire devient P ». Le palier s'applique aux lignes saisies dans son unité. Si plusieurs paliers sont atteints, c'est le plus élevé qui s'applique.

**BR-CAT-06** — **Bonus** : « pour Q (unité U) de X acheté, N (unité V) de Y offert ». La règle a des dates de validité et peut être limitée à certains types de clients. Y peut être X lui-même. Le bonus est **cumulatif** :

`offert = partie entière de (quantité de X ÷ Q) × N`, après conversion des quantités dans les unités de la règle.

**BR-CAT-07** — Le bonus s'ajoute automatiquement à la commande, sur une ligne « GRATUIT » à prix 0 que le vendeur ne peut pas modifier. Il est accordé dans la limite du stock disponible de Y : celui du dépôt en prévente, celui du camion en cash van. S'il est réduit faute de stock, la ligne l'indique.

**BR-CAT-08** — Les quantités offertes ne consomment pas de quota **(à confirmer)** et n'entrent pas dans le chiffre d'affaires des objectifs.

**BR-CAT-09** — À la confirmation, la commande **fige** les prix, paliers et bonus en vigueur. Un changement de prix ultérieur ne la modifie pas.

**BR-CAT-10** — Quand des quantités baissent (préparation ou livraison partielle), paliers et bonus sont **recalculés sur les quantités réelles**, avec la grille figée de la commande. **(à confirmer)**

**BR-CAT-11** — Hors visite, le vendeur consulte le catalogue **sans les prix**. En visite, il ne voit que les produits proposables à ce client (BR-CAT-04, BR-CMD-06, BR-CV-03), avec leurs prix.

---

## 7. Quotas — QUO

**BR-QUO-01** — Un quota est facultatif. Il porte sur un vendeur, un produit, une date et une quantité. Le superviseur le saisit dans l'unité de son choix, et il est stocké en unité de base.

**BR-QUO-02** — Le quota est consommé par les quantités **confirmées** du vendeur pour ce produit ce jour-là. Les bonus et les lignes en attente ne le consomment pas.

**BR-QUO-03** — **En prévente**, si la quantité demandée dépasse le reste du quota, la ligne est **scindée** : la partie couverte par le quota devient une ligne normale, l'excédent une ligne « **en attente** ». Quand le quota est épuisé, le produit reste visible, grisé avec la mention « quota atteint », et toute quantité saisie part en attente.

**BR-QUO-04** — **En cash van**, quand le quota est épuisé, le produit est grisé et ne peut plus être vendu. Le vendeur peut enregistrer une **demande perdue** : client, produit et quantité voulue.

**BR-QUO-05** — Le vendeur est notifié quand le superviseur modifie l'un de ses quotas. Si, à la synchronisation, des quantités confirmées dépassent un quota qui a été baissé entre-temps, l'excédent devient « en attente ».

**BR-QUO-06** — Le superviseur **accepte** ou **refuse** chaque ligne en attente, avant le lancement de la préparation (BR-PRE-02).
- Une ligne acceptée devient une ligne normale et réserve du stock. Accepter, c'est autoriser le dépassement du quota ; l'action est auditée.
- Une ligne refusée est retirée de la commande et enregistrée comme **vente perdue**.

---

## 8. Objectifs — OBJ

**BR-OBJ-01** — Un objectif est mensuel. Il porte sur un vendeur, une gamme et un mois, avec un montant cible, une prime et un plafond en %. Le superviseur ou l'admin le fixe ; le plafond est décidé par la direction de l'entreprise (ex. 120 %).

**BR-OBJ-02** — Le **réalisé** est le chiffre d'affaires **livré** du mois : le montant des lignes payantes des produits de la gamme, livrées dans le mois (selon la date de livraison), pour les commandes ou ventes du vendeur.

**BR-OBJ-03** — Calcul :
- `taux = réalisé ÷ cible`
- `prime due = prime × min(taux, plafond)`

**BR-OBJ-04** — Dans l'application, le vendeur voit pour chaque gamme la cible, le réalisé, le taux et la prime estimée, à la date de la dernière synchronisation.

---

## 9. Journée de travail — JOU

**BR-JOU-01** — La journée concerne le pré-vendeur, le livreur et le vendeur cash van. Il y a une journée par utilisateur et par date.

**BR-JOU-02** — États de la journée :

```text
NOT_STARTED ──Démarrer──▶ IN_PROGRESS ──Clôturer──▶ CLOSED
                               ▲                      │
                               └───── Réouverture ────┘
                                     (superviseur)
```

**BR-JOU-03** — La journée ne peut pas être démarrée un jour non travaillé ou férié. **(à confirmer)**

**BR-JOU-04** — « Démarrer la journée » tente une synchronisation. Sans réseau, la journée démarre quand même avec les dernières données, et le superviseur voit « démarrée hors connexion ».

**BR-JOU-05** — Hors de l'état `IN_PROGRESS`, l'utilisateur peut seulement **consulter** : clients, fiches, catalogue sans prix, historique, objectifs. Il ne peut faire ni visite, ni commande, ni vente, ni livraison, ni encaissement.

**BR-JOU-06** — Avant la clôture, l'application affiche un résumé (visites x/N, commandes, montants) que l'utilisateur confirme. Une visite en cours doit d'abord être terminée. Hors connexion, la clôture est enregistrée sur le téléphone et envoyée à la prochaine synchronisation ; le superviseur voit alors « clôture en attente de synchronisation ».

**BR-JOU-07** — Effets de la clôture :
- **pré-vendeur** : ses commandes passent au statut `LOCKED` (BR-CMD-02), et ses clients du jour non visités reçoivent une visite manquée (BR-PLA-06) ;
- **livreur** : ses livraisons non traitées passent en échec « non livrée » (BR-LIV-04) ;
- **vendeur cash van** : le déchargement du camion est attendu (BR-CV-06).

**BR-JOU-08** — **Réouverture** par le superviseur : le motif est obligatoire, l'action est auditée et l'utilisateur est notifié. Elle reste possible tant que l'étape suivante n'a pas commencé :
- pour un pré-vendeur, tant que la préparation de ses commandes n'est pas lancée ;
- pour un livreur ou un vendeur cash van, tant que le déchargement n'est pas validé.

Après une réouverture, les commandes `LOCKED` du pré-vendeur redeviennent `CONFIRMED`.

**BR-JOU-09** — La position de l'utilisateur n'est enregistrée que pendant une journée `IN_PROGRESS` : à chaque action, et toutes les 5 minutes tant que l'application est ouverte. Chaque envoi indique aussi le niveau de batterie et le nombre d'opérations en attente de synchronisation. Il n'y a pas de suivi en arrière-plan dans le MVP.

---

## 10. Visites — VIS

**BR-VIS-01** — Une visite comprend : le vendeur, le client, la date, le mode, les heures de début et de fin, la position, le résultat et le statut (`PLANNED`, `IN_PROGRESS`, `COMPLETED`, `MISSED`).

**BR-VIS-02** — **Mode sur place** (`ON_SITE`) : l'application calcule la distance entre le téléphone et le client. Au-delà de la distance réglée (BR-TEN-07), la visite est marquée « **hors zone** » et signalée au superviseur, mais elle n'est **jamais bloquée**. Si le client n'a pas de position, la visite est marquée « position client inconnue ».

**BR-VIS-03** — **Mode par téléphone** (`PHONE`) : il n'y a pas de contrôle de distance, et la commande porte la source `PHONE`. Le superviseur voit, pour chaque vendeur, la part de ses visites faites par téléphone. Ce mode n'existe qu'en prévente : en cash van, la vente se fait sur place.

**BR-VIS-04** — Une visite se termine par une commande (prévente), une vente (cash van) ou un **motif de non-commande**. Les motifs sont réglables par l'entreprise ; par défaut : client absent, client a encore du stock, magasin fermé, fermé définitivement, refus, autre.

**BR-VIS-05** — Le motif « fermé définitivement » ajoute le client à la liste « clients à revoir ».

**BR-VIS-06** — Une fois la visite terminée, le marqueur du client passe au vert. Si c'était un client du jour, le compteur x/N augmente.

**BR-VIS-07** — Le vendeur peut visiter un client de son secteur qui n'est pas prévu ce jour-là. Ces visites hors programme sont comptées à part (« +k hors programme ») et n'entrent pas dans x/N. **(à confirmer)**

**BR-VIS-08** — Un client peut être visité plusieurs fois le même jour, par exemple pour repasser après une absence. Il ne compte qu'une fois dans x/N.

**BR-VIS-09** — Une visite produit au plus une commande ou une vente.

**BR-VIS-10** — Les clients du jour sont triés du plus proche au plus loin de la position actuelle, en liste comme sur la carte. Une bascule permet d'afficher tous les clients du secteur.

---

## 11. Commandes de prévente — CMD

**BR-CMD-01** — Une commande est liée à une visite, un client et un pré-vendeur. Sa source est `PRE_SALES` (visite sur place) ou `PHONE`. Pour chaque produit, elle a au plus une ligne normale et une ligne en attente ; s'y ajoutent les lignes bonus.

**BR-CMD-02** — Statuts d'une commande :

| Code | Libellé | Signification |
|---|---|---|
| `DRAFT` | Panier | En cours de saisie, sur le téléphone |
| `CONFIRMED` | Confirmée | Modifiable ou annulable par le vendeur tant que sa journée est en cours |
| `LOCKED` | Figée | La journée du vendeur est clôturée |
| `PREPARING` | En préparation | Le superviseur a lancé la préparation |
| `READY` | Préparée | Le magasinier a validé la préparation |
| `OUT_FOR_DELIVERY` | En livraison | Chargée dans le camion, réception confirmée par le livreur |
| `DELIVERED` | Livrée | Livrée en totalité |
| `PARTIALLY_DELIVERED` | Livrée partiellement | Une partie a été refusée ou manquait |
| `FAILED` | Échouée | La livraison a échoué |
| `CANCELLED` | Annulée | Annulée par le vendeur avant la clôture |

```text
DRAFT → CONFIRMED → LOCKED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED
            │          │                                          ├→ PARTIALLY_DELIVERED
            │          └→ CONFIRMED (réouverture de la journée)   └→ FAILED
            └→ CANCELLED
```

**BR-CMD-03** — Le montant de la commande est la somme des lignes normales (quantité × prix figé). Les lignes bonus valent 0. Les lignes en attente ne comptent qu'une fois acceptées.

**BR-CMD-04** — **Réservation** : quand le serveur reçoit une commande confirmée, il réserve le stock du dépôt pour ses lignes normales.
- Si le stock disponible ne couvre pas une ligne, la partie couverte est réservée et la ligne est marquée « **rupture** ».
- Une modification de la commande ajuste la réservation ; une annulation la libère.

**BR-CMD-05** — La date de livraison prévue est le jour ouvré qui suit la date de la journée. Si le vendredi est chômé, une commande du jeudi est livrée le samedi.

**BR-CMD-06** — Pendant une visite de prévente, un produit est proposé s'il a un prix pour le type du client et si son stock disponible au dépôt était positif à la dernière synchronisation. Les quantités en stock ne sont pas affichées.

**BR-CMD-07** — Le numéro de commande est généré par le téléphone, même hors connexion : code du vendeur suivi d'un numéro séquentiel. Il est unique dans l'entreprise.

---

## 12. Préparation et chargement (prévente) — PRE

**BR-PRE-01** — Une **tournée** regroupe les commandes `LOCKED` des secteurs affectés à un livreur, pour une date de livraison. Avant le lancement, le superviseur peut changer le livreur d'un secteur, par exemple en cas d'absence.

**BR-PRE-02** — Le superviseur **lance la préparation** d'une tournée, à deux conditions :
1. aucune journée des secteurs concernés n'est encore en cours ou en attente de synchronisation. Une journée jamais démarrée, par exemple celle d'un vendeur absent, ne bloque pas **(à confirmer)** ;
2. il ne reste aucune ligne en attente à traiter sur ces commandes.

Les commandes passent alors au statut `PREPARING`.

**BR-PRE-03** — Pour chaque tournée, le magasinier voit la **liste de chargement** (total par produit) et le détail par commande. Il saisit les quantités préparées. Une quantité inférieure, en cas de rupture, réduit la ligne ; paliers et bonus sont recalculés selon BR-CAT-10.

**BR-PRE-04** — À la validation de la préparation, les commandes passent au statut `READY`. Le magasinier valide ensuite le **chargement** dans le camion du livreur : c'est un transfert du dépôt vers le camion, qui remplace la réservation.

**BR-PRE-05** — Le livreur **confirme la réception** du chargement avant sa première livraison. Un écart est signalé au superviseur, et le livreur livre ce qu'il a reçu. Les commandes passent au statut `OUT_FOR_DELIVERY`.

---

## 13. Livraison — LIV

**BR-LIV-01** — Le livreur voit les livraisons de sa tournée, triées par distance, en liste et sur la carte, avec la dette de chaque client.

**BR-LIV-02** — Une livraison se termine de trois façons :
- **livrée** : tout est livré ;
- **partielle** : le client refuse une partie, ou de la marchandise manque. Les quantités sont réduites, et paliers et bonus sont recalculés selon BR-CAT-10 ;
- **échec**, avec un motif réglable. Motifs par défaut : client absent, refus, magasin fermé, autre.

La commande prend le statut correspondant.

**BR-LIV-03** — Le paiement suit BR-PAY-03. Le bon est imprimé après le paiement (BR-IMP).

**BR-LIV-04** — À la clôture du livreur, les livraisons non traitées passent en échec « non livrée ».

**BR-LIV-05** — La marchandise non livrée (échecs, quantités refusées) reste dans le camion et revient au dépôt au déchargement (BR-STK-07).

**BR-LIV-06** — Une commande échouée n'est pas reprogrammée automatiquement : le vendeur reprend une commande lors de sa visite suivante. **(à confirmer)**

---

## 14. Cash van — CV

**BR-CV-01** — Chaque matin, chaque vendeur cash van a un **chargement**, c'est-à-dire la liste des produits et des quantités mis dans son camion.
- Le superviseur le prépare sur le Web, ou le magasinier le saisit directement.
- Le magasinier valide les quantités réellement chargées : c'est un transfert du dépôt vers le camion.
- Le vendeur confirme ensuite la réception.

Il n'y a qu'un seul chargement par jour dans le MVP. **(à confirmer)**

**BR-CV-02** — Le vendeur ne peut rien vendre avant d'avoir confirmé la réception du chargement.

**BR-CV-03** — En visite, un produit est proposé s'il a un prix pour le type du client et s'il en reste dans le camion. La quantité vendue ne peut pas dépasser le stock du camion. Comme un seul téléphone vend depuis un camion donné, ce contrôle est exact même hors connexion.

**BR-CV-04** — **Vente = livraison** : la vente (source `CASH_VAN`) est créée directement au statut `DELIVERED`, et le stock du camion baisse aussitôt. Viennent ensuite le paiement (BR-PAY-03) et l'impression du bon.

**BR-CV-05** — Une vente confirmée est **définitive** : elle ne peut être ni modifiée ni annulée. Les avoirs et les retours sont hors MVP. **(à confirmer)**

**BR-CV-06** — Après la clôture, le magasinier fait le **déchargement** (BR-STK-07) : tout le stock restant revient au dépôt chaque soir. **(à confirmer)**

**BR-CV-07** — Le vendeur cash van peut encaisser les dettes de ses clients (BR-PAY-05).

---

## 15. Stock — STK

**BR-STK-01** — Il y a deux types d'entrepôts :
- le **dépôt** (`DEPOT`), un ou plusieurs ;
- le **camion** (`TRUCK`), avec un code et une immatriculation, affecté à un livreur ou à un vendeur cash van. Cette affectation est modifiable.

**BR-STK-02** — Le stock est tenu par produit et par entrepôt, en unité de base. Il distingue le stock physique, le stock réservé (au dépôt seulement) et le stock disponible : `disponible = physique − réservé`.

**BR-STK-03** — Toute variation de stock passe par un **mouvement** daté, qui enregistre l'utilisateur, l'appareil et la cause.

| Type | Usage dans le MVP |
|---|---|
| `IN` | Entrée au dépôt (réception d'un fournisseur) |
| `OUT` | Sortie du camion à la livraison ou à la vente, bonus compris |
| `TRANSFER` | Chargement (dépôt → camion) et déchargement (camion → dépôt) |
| `RESERVATION` / `RELEASE` | Réservation et libération en prévente |
| `ADJUSTMENT` | Écart d'inventaire ou de déchargement, avec un motif |
| `RETURN` | Retours clients : hors MVP |

**BR-STK-04** — Le stock physique n'est jamais négatif : un mouvement qui le rendrait négatif est refusé.

**BR-STK-05** — Les opérations de stock sont **transactionnelles** : elles s'appliquent entièrement ou pas du tout.

**BR-STK-06** — **Inventaire du dépôt** : le magasinier saisit les quantités comptées, et chaque écart produit un mouvement `ADJUSTMENT`, audité.

**BR-STK-07** — **Déchargement d'un camion**, de livreur ou de vendeur cash van :
1. le magasinier compte le stock restant ;
2. on calcule `théorique = chargé − livré ou vendu − offert` ;
3. l'écart (théorique − compté) est enregistré en `ADJUSTMENT` et signalé au superviseur ;
4. le stock compté retourne au dépôt (`TRANSFER`), et le camion revient à zéro.

---

## 16. Paiements, dettes, versements — PAY

**BR-PAY-01** — Deux modes de paiement : espèces (`CASH`) et crédit (`CREDIT`).

**BR-PAY-02** — Chaque client a un réglage « crédit autorisé » (non par défaut) et un plafond en DA.

**BR-PAY-03** — À la livraison ou à la vente, le montant dû est le total livré.
- **Sans crédit autorisé**, le montant encaissé doit être égal au montant dû.
- **Avec crédit**, il faut encaisser au minimum `dû − (plafond − dette actuelle)`. Ce qui n'est pas encaissé s'ajoute à la dette.

Si le client ne peut pas payer le minimum, il peut réduire les quantités (livraison partielle). Sinon, la livraison est en échec avec le motif « refus ».

**BR-PAY-04** — `Dette du client = somme des restes à crédit − somme des paiements de dette`. Elle ne peut pas devenir négative : il n'y a pas d'avance client dans le MVP.

**BR-PAY-05** — **Encaissement de dette** : en espèces, pour un montant au plus égal à la dette. Il est fait par le pré-vendeur (en prévente) et par le vendeur cash van. Le livreur, lui, n'encaisse que le paiement des livraisons. Un reçu est imprimé si une imprimante est connectée. **(à confirmer)**

**BR-PAY-06** — Hors connexion, la dette affichée et le contrôle du plafond reposent sur la dette connue à la dernière synchronisation, corrigée des opérations faites depuis sur le téléphone.

**BR-PAY-07** — **Récapitulatif de journée**, pour chaque utilisateur qui a encaissé de l'argent (livreur, vendeur cash van, pré-vendeur). Il indique :
- le nombre de bons ;
- le total livré ou vendu ;
- les espèces encaissées, sur les livraisons et sur les dettes ;
- les crédits accordés ;
- le **montant attendu**, égal aux espèces encaissées.

Il s'imprime sur le téléphone et se consulte sur le Web.

**BR-PAY-08** — **Versement** : le comptable choisit la journée et saisit le montant remis. On calcule `écart = remis − attendu`. Le versement est validé et audité, et un écart non nul est signalé au superviseur. Il n'y a qu'un versement par journée dans le MVP.

---

## 17. Synchronisation — SYN

**BR-SYN-01** — Toute action terrain est d'abord enregistrée sur le téléphone, puis envoyée au serveur : automatiquement dès qu'il y a du réseau, ou par le bouton « Synchroniser ».

**BR-SYN-02** — Chaque opération porte un identifiant unique créé par le téléphone. Si elle est envoyée plusieurs fois, elle n'est appliquée qu'une seule fois.

**BR-SYN-03** — **À qui appartiennent les données** :
- **au téléphone qui les crée** : visites, commandes, ventes, livraisons, paiements, clients créés par le vendeur. Personne d'autre ne les modifie ;
- **au serveur, qui a toujours raison** : catalogue, prix, paliers, bonus, quotas, objectifs, planning, polygones, fiches clients existantes, paramètres.

**BR-SYN-04** — Données téléchargées par le téléphone :
- **vendeur** : les clients de son secteur avec leurs dettes, le catalogue, les prix des types de clients concernés, les paliers, les bonus, les quotas du jour, les objectifs du mois, les motifs, le planning et les polygones de son secteur, et la disponibilité au dépôt (en prévente) ;
- **vendeur cash van** : en plus, le stock de son camion ;
- **livreur** : sa tournée et les clients concernés, avec leurs dettes ;
- **magasinier** : les préparations, chargements et déchargements à faire, et le stock du dépôt.

**BR-SYN-05** — À la réception, le serveur peut transformer des lignes : l'excédent de quota devient « en attente » (BR-QUO-05), l'excédent de stock devient « rupture » (BR-CMD-04). Le vendeur en est informé.

**BR-SYN-06** — Le téléphone affiche en permanence l'état de la synchronisation : « synchronisé », « N opérations en attente » ou « erreur ».

**BR-SYN-07** — Un journal de synchronisation est conservé pour le diagnostic.

---

## 18. Impression — IMP

**BR-IMP-01** — L'impression se fait sur une imprimante thermique Bluetooth, en 58 ou 80 mm (BR-TEN-07).

**BR-IMP-02** — Le **bon de livraison**, ou bon de vente, contient :
- l'entreprise, le numéro du bon, la date et l'heure ;
- le livreur ou le vendeur, et le client ;
- les lignes (produit, unité, quantité, prix unitaire, montant) et les lignes « GRATUIT » ;
- le total, le montant payé, le reste à crédit et la nouvelle dette du client.

**BR-IMP-03** — Un bon peut être réimprimé. La copie porte la mention « **DUPLICATA** », et chaque réimpression est tracée.

**BR-IMP-04** — Le numéro du bon est généré par le téléphone, même hors connexion : code de l'utilisateur suivi d'un numéro séquentiel. Il est unique dans l'entreprise.

**BR-IMP-05** — L'absence d'imprimante ne bloque ni la livraison ni la vente : le bon reste imprimable plus tard.

**BR-IMP-06** — Le récapitulatif de journée (BR-PAY-07) s'imprime sur la même imprimante.

---

## 19. Notifications — NOT

**BR-NOT-01** — Canaux du MVP : notifications dans l'application, sur le Web et sur le mobile, et notifications push sur le mobile.

**BR-NOT-02** — Le superviseur est notifié pour :
- les lignes en attente à traiter ;
- un nouveau client ;
- une visite hors zone ;
- un écart de réception, de déchargement ou de versement ;
- une journée démarrée ou clôturée hors connexion.

**BR-NOT-03** — Les utilisateurs terrain sont notifiés pour :
- une journée rouverte ;
- un quota modifié ;
- des lignes en attente acceptées ou refusées ;
- un appareil révoqué.

---

## 20. Audit — AUD

**BR-AUD-01** — Sont audités, avec l'auteur, l'action, la date, l'appareil, l'ancienne et la nouvelle valeur :
- les connexions, et les associations ou révocations d'appareils ;
- le démarrage, la clôture et la réouverture des journées ;
- les modifications de prix, paliers, bonus, quotas et objectifs ;
- la modification ou la désactivation d'un client, et le forçage de sa partie ;
- les modifications des polygones et du planning ;
- le traitement des lignes en attente et le lancement de la préparation ;
- les mouvements de stock, inventaires et écarts ;
- les encaissements, versements et écarts ;
- les réimpressions.

---

## 21. Import et export — IO

**BR-IO-01** — **Import CSV des clients**, par l'admin. Un aperçu est affiché avant l'import. Les lignes valides sont importées, et les lignes en erreur sont listées avec la raison. La position est facultative : un client importé sans position reste hors partie jusqu'à ce que le superviseur le place.

**BR-IO-02** — **Import CSV des produits**, par l'admin : produits, conditionnements et prix par type de client.

**BR-IO-03** — **Exports CSV**, selon les droits de chacun : ventes, visites, objectifs, dettes et versements, filtrés par période, secteur et vendeur.

---

## 22. Exemples chiffrés

Montants fictifs, qui illustrent les règles et serviront de base aux tests.

**Fréquence (BR-PLA-02)** — Client de la partie 1 (le samedi), tous les 15 jours, date de référence le samedi 3 octobre 2026.
- Il est du jour les 3, 17 et 31 octobre.
- Il ne l'est pas les 10 et 24 octobre.

**Date de livraison (BR-CMD-05)** — Commande prise le jeudi 1er octobre 2026, vendredi chômé : livraison le samedi 3 octobre.

**Palier (BR-CAT-05)** — Thon tomate, client Détail, 5 800 DA le carton, avec le palier « à partir de 10 cartons : 5 600 DA ».
- 8 cartons → 8 × 5 800 = 46 400 DA
- 12 cartons → 12 × 5 600 = 67 200 DA

**Bonus (BR-CAT-06)** — Règle : « pour 1 carton de thon tomate, 4 triplettes de thon à l'huile offertes ».
- 3 cartons → 12 triplettes offertes
- 50 triplettes de thon tomate, soit 2,5 cartons → partie entière 2 → 8 triplettes offertes

**Quota (BR-QUO-03)** — Quota du jour de 10 cartons, dont 8 déjà vendus. Le client en veut 5 → 2 cartons en ligne normale et 3 cartons en attente.

**Objectif (BR-OBJ-03)** — Gamme Bimo : cible 3 200 000 DA, prime 12 000 DA, plafond 120 %.
- Réalisé 1 920 000 DA → taux 60 % → prime 7 200 DA
- Réalisé 4 800 000 DA → taux 150 %, plafonné à 120 % → prime 14 400 DA

**Crédit (BR-PAY-03)** — Plafond 50 000 DA, dette actuelle 42 000 DA, bon de 15 000 DA → crédit possible 8 000 DA → encaissement minimum 7 000 DA.

**Versement (BR-PAY-08)** — Encaissé : 184 500 DA sur les livraisons et 20 000 DA sur les dettes → attendu 204 500 DA. Montant remis : 204 000 DA → écart de −500 DA, signalé au superviseur.

**Déchargement (BR-STK-07)** — Chargé 40 cartons, vendu 31, offert 2 → théorique 7. Compté 6 → écart d'un carton, signalé au superviseur.
