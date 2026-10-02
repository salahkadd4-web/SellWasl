# Cahier des charges — SellWasl

> **Phase 0 — validé le 2026-10-01.**
> **Mis à jour le 2026-10-02** : parfums des produits ; règles réglables par entreprise.
> Ce document fixe le périmètre du **MVP**. Il complète [README_vf.md](../README_vf.md), qui décrit la vision d'ensemble. En cas de différence, les documents de `docs/` priment.
>
> Documents liés :
> - [use-cases.md](use-cases.md) : cas d'utilisation (`UC-xx`) ;
> - [business-rules.md](business-rules.md) : règles métier (`BR-XXX-nn`).

## Sommaire

1. [Contexte et objectif](#1-contexte-et-objectif)
2. [Hypothèses et contraintes](#2-hypothèses-et-contraintes)
3. [Acteurs et outils](#3-acteurs-et-outils)
4. [Modes de vente et modules](#4-modes-de-vente-et-modules)
5. [Périmètre fonctionnel du MVP](#5-périmètre-fonctionnel-du-mvp)
6. [Hors MVP](#6-hors-mvp)
7. [Exigences non fonctionnelles](#7-exigences-non-fonctionnelles)
8. [Critères de réussite](#8-critères-de-réussite)
9. [Décisions de la phase 0](#9-décisions-de-la-phase-0)
10. [Règles déduites à confirmer](#10-règles-déduites-à-confirmer)
11. [Points ouverts pour les phases suivantes](#11-points-ouverts-pour-les-phases-suivantes)
12. [Glossaire](#12-glossaire)

---

## 1. Contexte et objectif

SellWasl est une plateforme SaaS multi-entreprises pour les entreprises de distribution qui travaillent avec des équipes terrain : pré-vendeurs, livreurs, vendeurs au camion (cash van) et magasiniers.

Ce cahier des charges s'appuie sur l'expérience directe du porteur du projet, ancien pré-vendeur dans une entreprise de distribution algérienne, et sur les manques de l'application qu'il utilisait.

| Constat sur le terrain | Réponse de SellWasl |
|---|---|
| Les quotas du jour arrivent par WhatsApp | Le superviseur saisit les quotas, et l'application les applique |
| Quand le quota d'un produit est atteint, le produit disparaît, même si d'autres clients le veulent | Lignes « en attente », que le superviseur accepte ou refuse |
| Les objectifs et les primes du mois arrivent par WhatsApp | Objectifs et progression visibles dans l'application |
| Le livreur passe par le service informatique pour imprimer son récapitulatif avant de verser l'argent | Récapitulatif imprimé depuis le téléphone ; versement enregistré par le comptable |
| Les commandes prises par téléphone se confondent avec des visites suspectes | Mode de visite « par téléphone », distinct du contrôle « hors zone » |

**Objectif du MVP** : qu'une entreprise réelle fasse tourner **tout son cycle de vente** dans SellWasl, en prévente ou en cash van, y compris sans réseau.

---

## 2. Hypothèses et contraintes

| Sujet | Décision |
|---|---|
| Marché | Algérie uniquement pour le MVP ; montants en dinars (DA) |
| Langue | Français uniquement ; l'arabe (affichage de droite à gauche) viendra plus tard |
| Jours travaillés | Réglables par entreprise ; par défaut du samedi au jeudi, vendredi chômé |
| Mobile | Android uniquement ; une seule application pour tous les rôles terrain |
| Web | Chrome, sur PC et sur téléphone : le Web doit être pleinement utilisable sur mobile |
| Réseau | Le mobile fonctionne hors connexion |
| Équipe | Un développeur, assisté par Claude : le MVP reste resserré |
| Multi-entreprises | Isolation des données dès la première version, même avec un seul client |

**Ordre de grandeur** d'une entreprise type :
- une dizaine de vendeurs ;
- 6 parties par secteur ;
- quelques centaines de clients par secteur ;
- quelques dizaines de visites par vendeur et par jour.

---

## 3. Acteurs et outils

| Outil | Rôle | Ce qu'il fait |
|---|---|---|
| **Application mobile** (une seule, Android) | `PRE_VENDEUR` | Journée, visites, commandes, encaissement des dettes |
| | `LIVREUR` | Tournée du lendemain, livraison, encaissement, impression |
| | `VENDEUR_CASH_VAN` | Visite, vente et livraison immédiate depuis le camion, encaissement, impression |
| | `MAGASINIER` | Entrées, préparation, chargement et déchargement des camions, inventaire |
| **Web** (Chrome, PC ou téléphone) | `COMPANY_ADMIN` | Tout ce que fait le superviseur et le comptable, plus les utilisateurs (superviseurs compris), le catalogue, les prix et les paramètres |
| | `SUPERVISEUR` | Secteurs, planning, clients, produits et parfums, quotas, objectifs, suivi en temps réel, réouverture de journée, changement d'appareil, lignes en attente, lancement de la préparation, exports |
| | `COMPTABLE` | Versements, écarts, dettes et paiements |
| | `SUPER_ADMIN` | Crée une entreprise et son administrateur, et choisit son mode |

**Ce que chacun ne peut pas faire**
- Le superviseur ne crée, ne modifie et ne supprime **jamais** une commande, une vente, une visite ou un paiement (BR-USR-05).
- Le vendeur peut créer un client, mais ni le modifier ni le supprimer (BR-CLI-04).
- Les rôles Web n'utilisent pas l'application mobile, et les rôles terrain n'utilisent pas le Web (BR-USR-02).

---

## 4. Modes de vente et modules

### Socle commun (toujours actif)

- utilisateurs, appareils, audit ;
- clients et types de clients ;
- produits, conditionnements, prix, paliers, bonus ;
- quotas et objectifs ;
- commandes et ventes ;
- paiements, dettes et versements ;
- jours travaillés et paramètres.

### Modules

| Module | Contenu |
|---|---|
| `PRE_SALES` | Prise de commande en prévente |
| `DELIVERY` | Tournées de livraison au jour ouvré suivant |
| `CASH_VAN` | Stock du camion, vente et livraison immédiates |
| `WAREHOUSE` | Dépôt, entrées, préparation, chargement, déchargement, inventaire |
| `ANALYTICS` | Tableau de bord du jour, exports CSV |

Secteurs, parties, planning, journée de travail et visites sont **communs** à `PRE_SALES` et `CASH_VAN` (BR-TEN-05).

`COMMERCIAL` n'est pas un module du MVP : ses fonctions de base (prix, paliers, bonus) sont dans le socle, et le code est réservé pour des fonctions avancées plus tard.

### Modes

Le Super Admin choisit le **mode**, et les modules en découlent (BR-TEN-03).

| Mode | Modules |
|---|---|
| Prévente | `PRE_SALES` + `DELIVERY` + `WAREHOUSE` + `ANALYTICS` |
| Cash van | `CASH_VAN` + `WAREHOUSE` + `ANALYTICS` |
| Mixte | les cinq modules |

### Les deux cycles

```text
PRÉVENTE                                        CASH VAN
Jour J                                          Matin
  Pré-vendeur : journée → visites → commandes     Superviseur ou magasinier : chargement du camion
  Clôture → commandes figées                      Vendeur : confirme la réception
Soir J                                          Journée
  Superviseur : lignes en attente → préparation   Vendeur : visites → vente + livraison + encaissement
  Magasinier : préparation → chargement camion             → impression du bon
Jour ouvré suivant                              Soir
  Livreur : réception → livraisons                Clôture → déchargement (comptage, écart)
          → encaissement → impression             Récapitulatif → versement au comptable
  Clôture → déchargement des retours
  Récapitulatif → versement au comptable
```

---

## 5. Périmètre fonctionnel du MVP

### 5.1 Organisation du terrain

- Un **secteur** a un code libre, la liste des types de clients qu'il sert, et un vendeur. Exemple : les secteurs 3101 à 3110 servent le détail, et un secteur « Supérette » sert les supérettes de toute la ville.
- Le secteur est découpé en **parties**, dessinées en **polygones** sur la carte par le superviseur ou l'admin.
- Le client est **affecté automatiquement** à sa partie selon sa position, et le superviseur peut forcer la partie.
- Le **planning** associe une partie à chaque jour travaillé.
- **Fréquences** : chaque semaine, tous les 15 jours, toutes les 4 semaines.
- Les visites non faites sont **manquées** et ne sont pas reportées ; le superviseur peut **reprogrammer** une visite.

*UC-50 à UC-54 · BR-ORG, BR-PLA*

### 5.2 Clients

- **Fiche client** : type, position, partie, fréquence, crédit autorisé, plafond, dette.
- **Création par le vendeur**, avec la position GPS : le client est actif tout de suite et marqué « nouveau ».
- **Modification et désactivation** par le superviseur seulement.
- Une liste « **clients à revoir** » regroupe les clients nouveaux, hors partie et fermés définitivement.

*UC-11, UC-12, UC-53 · BR-CLI*

### 5.3 Catalogue et prix

- Les produits sont classés par **gamme** et ont des **conditionnements** (1 carton = 20 triplettes).
- Un produit peut avoir des **parfums**. Le superviseur ou l'admin choisit de les regrouper dans un même produit ou d'en faire des produits distincts. Stock, quotas et lignes de commande sont tenus **par parfum**.
- Un parfum a le prix de son produit, ou **son propre prix** quand il est différent.
- **Types de clients** configurables, avec un **prix par type de client et par unité**.
- **Paliers de quantité.**
- **Bonus cumulatifs** : pour Q de X acheté, N de Y offert.
- Les **prix sont figés** dans la commande au moment de la confirmation.
- Hors visite, le catalogue s'affiche **sans les prix**.

*UC-21, UC-81 · BR-CAT*

### 5.4 Quotas et objectifs

- **Quotas** facultatifs, par jour, par article (parfum, ou produit sans parfum) et par vendeur.
  - En prévente, l'excédent devient une **ligne en attente**, que le superviseur accepte ou refuse avant la préparation.
  - En cash van, le produit est grisé, et le vendeur peut enregistrer une **demande perdue**.
- **Objectifs** mensuels par vendeur et par gamme, calculés sur le chiffre d'affaires **livré**. La prime est proportionnelle, avec un **plafond réglable par objectif** (ex. 120 %).

*UC-18, UC-20, UC-55, UC-56, UC-60 · BR-QUO, BR-OBJ*

### 5.5 Journée de travail

- **Démarrer** puis **Clôturer** : hors journée en cours, l'utilisateur peut seulement consulter.
- La clôture fige les commandes.
- Le superviseur peut **rouvrir** une journée, avec un motif, tant que l'étape suivante n'a pas commencé.

*UC-03, UC-05, UC-58 · BR-JOU*

### 5.6 Visites

- **Mode sur place**, avec contrôle de distance : une visite trop loin est signalée « **hors zone** », jamais bloquée.
- **Mode par téléphone**, en prévente.
- **Motifs de non-commande** réglables.
- **Visites hors programme** autorisées.
- Carte avec marqueurs rouges et verts, et liste triée par distance.

*UC-10, UC-13, UC-16 · BR-VIS*

### 5.7 Prévente : de la commande à la livraison

- **Commande** : saisie avec unités, prix, paliers, bonus et quotas. Elle reste modifiable jusqu'à la clôture, et le stock est réservé.
- **Préparation** : lancée par le superviseur une fois les journées clôturées et les lignes en attente traitées. Le magasinier prépare, puis charge le camion.
- **Livraison** : elle a lieu le **jour ouvré suivant**. Le livreur confirme la réception du chargement, puis livre en totalité, en partie ou en échec, encaisse et imprime le bon.

*UC-14, UC-17, UC-30 à UC-33, UC-41, UC-42, UC-60, UC-61 · BR-CMD, BR-PRE, BR-LIV*

### 5.8 Cash van

- **Le matin** : le camion est chargé, et le vendeur confirme la réception.
- **La journée** : il vend et livre immédiatement depuis le stock du camion, encaisse et imprime le bon.
- **Le soir** : déchargement, avec comptage et écart.

*UC-15, UC-18, UC-30, UC-42, UC-43, UC-62 · BR-CV*

### 5.9 Stock

- Deux types d'entrepôts : **dépôts** et **camions**.
- Stock physique, réservé et disponible.
- **Mouvements tracés** : entrée, sortie, transfert, réservation, libération, ajustement.
- Inventaire du dépôt.
- Le stock n'est jamais négatif.

*UC-40, UC-43, UC-44 · BR-STK*

### 5.10 Encaissements, dettes, versements

- **Paiement** en espèces, ou à **crédit** si le client y a droit, dans la limite de son plafond.
- La **dette** de chaque client est suivie. Le pré-vendeur et le vendeur cash van encaissent les dettes.
- Le **récapitulatif de journée** est imprimable et donne le montant attendu.
- Le **comptable enregistre le versement**, et l'écart est signalé au superviseur.

*UC-19, UC-32, UC-35, UC-70, UC-71 · BR-PAY*

### 5.11 Supervision Web

- **Tableau du jour**, pour chaque utilisateur : état de la journée, x/N, hors zone, par téléphone, commandes, chiffre d'affaires, dernière position et dernière synchronisation, batterie.
- **Carte** : polygones, clients, positions des équipes.
- **Actions limitées** : rouvrir une journée, changer d'appareil, révoquer, bloquer.

*UC-57 à UC-59 · BR-USR-04, BR-USR-05, BR-JOU-09*

### 5.12 Administration

- **Admin** : utilisateurs, catalogue, prix, paramètres de l'entreprise, dont les **règles réglables** de BR-TEN-08 (types de clients, jours travaillés et fériés, motifs, distance hors zone, largeur du ticket, dépôts et camions), import CSV.
- **Super Admin**, minimal : création d'une entreprise, de son administrateur et choix de son mode.

*UC-80 à UC-83, UC-90 · BR-TEN, BR-USR*

### 5.13 Offline et synchronisation

- Chaque action est enregistrée d'abord sur le téléphone, puis synchronisée automatiquement ou à la demande.
- Une même opération n'est jamais appliquée deux fois.
- Chaque donnée a un propriétaire clair, téléphone ou serveur, ce qui évite les conflits.
- L'état de synchronisation est toujours visible.

*UC-04 · BR-SYN*

### 5.14 Impression

- Imprimante thermique **Bluetooth**, en 58 ou 80 mm.
- **Bon de livraison ou de vente**, réimpression marquée « DUPLICATA », **récapitulatif de journée**.

*UC-34, UC-35 · BR-IMP*

### 5.15 Notifications, exports, imports, audit

- **Notifications** dans l'application (Web et mobile) et en push sur mobile.
- **Exports CSV** : ventes, visites, objectifs, dettes, versements.
- **Import CSV** des clients et des produits.
- **Audit** des actions sensibles.

*UC-63, UC-83 · BR-NOT, BR-IO, BR-AUD*

---

## 6. Hors MVP

- Plans, abonnements, facturation SaaS ; Super Admin avancé (monitoring, support, suspension).
- Rôles plateforme `SUPPORT`, `FINANCE`, `TECH_ADMIN`.
- Module `COMMERCIAL` avancé : promotions complexes, conditions commerciales.
- Saisie de commandes au bureau (téléphone, WhatsApp, site, ERP, API) par un opérateur.
- Facturation fiscale : TVA, factures légales.
- Avoirs, retours clients après livraison, reprogrammation d'une livraison échouée.
- Plusieurs chargements par jour pour un camion, et stock laissé dans le camion la nuit.
- Transferts entre dépôts, emplacements dans un dépôt, lecture des codes-barres.
- Photo et signature à la livraison ou à la visite.
- Niveau « Zone » au-dessus des secteurs, et équipes rattachées à un superviseur.
- Notifications par email, SMS ou WhatsApp.
- Intégrations ERP et comptabilité.
- Langue arabe et iOS.
- Suivi GPS en arrière-plan, optimisation des itinéraires, géofencing avancé.
- IA, prédiction des ventes, MDM, microservices.
- Module `PRODUCTION`.

---

## 7. Exigences non fonctionnelles

| Domaine | Exigence |
|---|---|
| **Hors connexion** | Toutes les fonctions mobiles marchent sans réseau. Seules l'activation de l'appareil et la première synchronisation exigent une connexion. |
| **Fiabilité des données** | Une opération synchronisée plusieurs fois n'est appliquée qu'une fois. Les opérations de stock sont transactionnelles. Aucune perte silencieuse. |
| **Sécurité** | Isolation stricte entre entreprises. Permissions et modules contrôlés par le serveur. Audit des actions sensibles. |
| **Vie privée** | La position d'un employé n'est enregistrée que pendant sa journée en cours (BR-JOU-09). |
| **Batterie et données mobiles** | Pas de suivi en arrière-plan. Synchronisations légères. |
| **Rapidité sur le terrain** | Les écrans du vendeur (liste du jour, carte, panier) restent fluides sur un téléphone Android d'entrée de gamme, avec quelques centaines de clients par secteur. Les objectifs chiffrés sont à fixer en phase 1. |
| **Ergonomie terrain** | Gros boutons, peu de texte, utilisable à une main ; état de la journée et de la synchronisation toujours visible. |
| **Web** | Utilisable dans Chrome sur PC comme sur téléphone (responsive). |
| **Impression** | Imprimantes thermiques Bluetooth courantes, en 58 et 80 mm. Exige une version de l'application compilée par nos soins plutôt qu'Expo Go (phase 2). |
| **Identité visuelle** | Couleurs et typographie du logo (README_vf §2). |

---

## 8. Critères de réussite

Le MVP est réussi quand **deux entreprises isolées l'une de l'autre**, l'une en prévente et l'autre en cash van, réalisent chacune le cycle complet ci-dessous, avec des passages hors connexion, sans perte de données et sans intervention technique.

**Entreprise en prévente**

1. Le Super Admin crée l'entreprise en mode Prévente (UC-90).
2. L'admin importe les clients et les produits, puis règle les prix, les paliers et les bonus (UC-81, UC-83).
3. Le superviseur dessine les secteurs et les parties, affecte les équipes et définit le planning (UC-50 à UC-52).
4. Il fixe les quotas et les objectifs (UC-55, UC-56).
5. Le pré-vendeur démarre sa journée, visite ses clients du jour, prend des commandes (dont une ligne en attente), puis clôture (UC-03, UC-10 à UC-14, UC-05).
6. Le superviseur traite les lignes en attente et lance la préparation (UC-60, UC-61).
7. Le magasinier prépare et charge le camion (UC-41, UC-42).
8. Le livreur confirme la réception, livre (dont une livraison partielle et un échec), encaisse (dont une vente à crédit), imprime et clôture (UC-30 à UC-35).
9. Le magasinier décharge les retours, et le comptable enregistre le versement (UC-43, UC-70).
10. Le superviseur voit les résultats du jour et exporte les CSV (UC-57, UC-63).

**Entreprise en cash van**

1. Création de l'entreprise en mode Cash van, puis paramétrage comme ci-dessus.
2. Chargement du camion, puis confirmation de la réception par le vendeur (UC-62, UC-42, UC-30).
3. Visites, ventes avec bonus, demande perdue, encaissement d'une dette, impression des bons (UC-13, UC-15, UC-18, UC-19, UC-34).
4. Clôture, déchargement avec écart, récapitulatif, versement (UC-05, UC-43, UC-35, UC-70).

---

## 9. Décisions de la phase 0

### Points de l'Annexe B du README_vf

| # | Sujet | Décision | Règles |
|---|---|---|---|
| 1 | Moment de la réservation et de la sortie du stock | Réservation au dépôt quand la commande est confirmée ; transfert vers le camion au chargement ; sortie à la livraison ; retour au dépôt au déchargement | BR-CMD-04, BR-PRE-04, BR-STK-07 |
| 2 | Qui encaisse | Le livreur et le vendeur cash van encaissent à la livraison ; le pré-vendeur et le vendeur cash van encaissent les dettes ; le comptable enregistre les versements | BR-PAY-03, BR-PAY-05, BR-PAY-08 |
| 3 | Périmètre du module `COMMERCIAL` | Prix, paliers, bonus, quotas et dettes vont dans le socle ; `COMMERCIAL` est reporté après le MVP | §4 |
| 4 | Rayon GPS | Jamais bloquant ; « hors zone » au-delà d'une distance réglable (100 m par défaut) ; mode « par téléphone » | BR-VIS-02, BR-VIS-03 |
| 5 | Conflits hors connexion | Chaque donnée a un propriétaire, le téléphone ou le serveur ; l'excédent de quota devient « en attente », l'excédent de stock « rupture » | BR-SYN-03, BR-SYN-05 |
| 6 | Fournisseur de paiement | Sans objet pour le MVP : pas de facturation SaaS | §6 |

### Changements par rapport au README_vf

- **Nouveau mode cash van**, avec le module `CASH_VAN` et le rôle `VENDEUR_CASH_VAN`.
- **Nouveau rôle `COMPTABLE`.** Le magasinier passe sur mobile. Les rôles Web n'utilisent que le Web.
- **Notion de journée de travail** : démarrer, clôturer, rouvrir.
- **Quotas, lignes en attente, demandes perdues, objectifs et primes.**
- **Prix** par type de client, paliers, bonus cumulatifs.
- **Fréquence « toutes les 4 semaines »**, à la place du mois civil.
- **Secteurs par type de clients**, et affectation automatique par polygone. Les polygones font partie du MVP.
- **Statuts de commande** revus (BR-CMD-02) ; la livraison est simplifiée en livrée, partielle ou échec.
- **Camion traité comme un entrepôt**, en prévente comme en cash van.
- **Android uniquement** pour le MVP.
- **Parfums des produits**, avec stock, quota et prix éventuellement propres à chaque parfum (ajout du 2026-10-02).
- **Règles réglables par entreprise** (BR-TEN-08) : chaque entreprise adapte dix règles de fonctionnement à sa façon de travailler (ajout du 2026-10-02).

---

## 10. Règles déduites à confirmer

Ces règles ont été ajoutées pendant la rédaction pour que le document ne laisse aucun cas ambigu.

### Règles devenues réglables par entreprise

Pour que chaque entreprise garde ses propres règles, la plupart sont devenues des **paramètres** ([BR-TEN-08](business-rules.md#1-entreprise-et-modules--ten)) ou des réglages de chaque palier et bonus (BR-CAT-15). La valeur par défaut favorise les ventes et protège la marge ; l'admin peut la changer.

| # | Sujet | Défaut | Réglage |
|---|---|---|---|
| 2 | Travail les jours non travaillés et fériés | Autorisé, sans clients du jour | P-01 |
| 3 | Visites hors programme | Autorisées | P-02 |
| 4 | Les bonus consomment le quota | Non | P-03 |
| 5 | Paliers et bonus quand les quantités baissent | Recalculés | P-04 |
| 6 | Livraison échouée | Reprogrammée une fois, sauf refus | P-05 |
| 8 | Fin de journée d'un camion | Déchargement complet | P-06 |
| 9 | Chargements cash van par jour | Plusieurs | P-07 |
| 10 | Le livreur encaisse les anciennes dettes | Oui | P-08 |
| — | Client créé par un vendeur | Actif tout de suite | P-09 |
| 16 | Le superviseur modifie prix, paliers et bonus | Non | P-10 |
| 17 | Seuil d'un palier avec des parfums | Total des parfums | Sur chaque palier |
| 18 | Achat d'un bonus avec des parfums | Tous parfums cumulés | Sur chaque bonus |
| 19 | Parfum offert | Automatique : le plus en stock | Sur chaque bonus |

### Règles fixes, communes à toutes les entreprises

Ces règles restent identiques partout, parce qu'elles protègent la fiabilité des données ou parce que les rendre réglables compliquerait le MVP sans gain réel. Elles restent à confirmer.

| # | Règle | Choix retenu | Pourquoi elle est fixe |
|---|---|---|---|
| 1 | BR-ORG-03 | Les secteurs de types de clients différents peuvent se superposer ; ceux d'un même type, non | Sinon, un client serait affecté à deux vendeurs à la fois |
| 7 | BR-CV-05 | Une vente cash van est définitive ; avoirs et retours hors MVP | Évite les annulations frauduleuses après encaissement |
| 11 | BR-USR-01 | Un utilisateur a un seul rôle | Droits simples et vérifiables |
| 12 | BR-USR-06 | Un utilisateur terrain a un seul appareil actif | Garantit des numéros de bons uniques et un stock du camion exact hors connexion |
| 13 | §6 | Prix saisis TTC, sans facturation fiscale dans le MVP | La facturation fiscale vient après le MVP |
| 14 | BR-CLI-02 | Un client créé par un vendeur est rattaché au secteur de ce vendeur ; s'il est hors des parties, il reste visitable | Le client doit toujours avoir un vendeur responsable |
| 15 | BR-PRE-02 | La journée jamais démarrée d'un vendeur absent ne bloque pas le lancement de la préparation | Sinon, une absence bloquerait toute la livraison du lendemain |

---|---|---|
| 1 | BR-ORG-03 | Les secteurs de types de clients différents peuvent se superposer ; ceux d'un même type, non |
| 2 | BR-PLA-04, BR-JOU-03 | Pas de journée ni de visites les jours non travaillés et fériés |
| 3 | BR-VIS-07 | Visites hors programme autorisées, comptées à part du x/N |
| 4 | BR-CAT-08 | Les bonus ne consomment pas de quota |
| 5 | BR-CAT-10 | Paliers et bonus recalculés quand les quantités baissent (préparation ou livraison partielle) |
| 6 | BR-LIV-06 | Pas de reprogrammation automatique d'une livraison échouée |
| 7 | BR-CV-05 | Une vente cash van est définitive ; avoirs et retours hors MVP |
| 8 | BR-CV-06 | Le camion est entièrement déchargé chaque soir |
| 9 | BR-CV-01 | Un seul chargement par jour pour un camion cash van |
| 10 | BR-PAY-05 | Le livreur n'encaisse pas les anciennes dettes, seulement ses livraisons |
| 11 | BR-USR-01 | Un utilisateur a un seul rôle |
| 12 | BR-USR-06 | Un utilisateur terrain a un seul appareil actif |
| 13 | §6 | Prix saisis TTC, sans facturation fiscale dans le MVP |
| 14 | BR-CLI-02 | Un client créé par un vendeur est rattaché au secteur de ce vendeur (seuls les types de clients de son secteur sont proposés) ; s'il est hors des parties, il reste visitable tout de suite |
| 15 | BR-PRE-02 | La journée jamais démarrée d'un vendeur absent ne bloque pas le lancement de la préparation |
| 16 | BR-CAT-12 | Le superviseur crée et modifie les produits et les parfums ; les prix, paliers et bonus restent à l'admin |
| 17 | BR-CAT-15 | Le seuil d'un palier se calcule sur le total des parfums qui ont le prix du produit |
| 18 | BR-CAT-15 | Un bonus sur un produit compte l'achat de tous ses parfums cumulés |
| 19 | BR-CAT-15 | Si le bonus offre un produit qui a des parfums, le vendeur choisit les parfums offerts parmi ceux en stock |

---

## 11. Points ouverts pour les phases suivantes

| Point | Phase |
|---|---|
| Mécanisme d'association d'un appareil (code d'activation, QR code…) | 1 et 4 |
| Version minimale d'Android ; modèles d'imprimantes testés | 1 |
| Objectifs chiffrés de performance sur le terrain | 1 |
| Précision des montants (centimes ou dinar entier) | 1 et 3 |
| Téléphone perdu ou cassé avec des opérations non synchronisées, journée impossible à clôturer | 4 et 23 |
| Stockage des polygones : GeoJSON avec Turf dans le MVP, PostGIS si besoin | 1 et 13 |
| Facturation fiscale : TVA, factures légales | Après le MVP |
| Fournisseur de paiement pour les abonnements | Après le MVP |

---

## 12. Glossaire

| Terme | Définition |
|---|---|
| **Article** | Ce qui a un stock, un quota et une ligne de commande : un parfum, ou un produit sans parfum |
| **Bonus** | Quantité offerte selon une règle « pour Q de X acheté, N de Y offert » ; ligne « GRATUIT » à prix 0 |
| **Cash van** | Vente au camion : le vendeur vend et livre immédiatement depuis le stock de son camion |
| **Chargement** | Transfert de marchandise du dépôt vers un camion, confirmé par le livreur ou le vendeur |
| **Client du jour** | Client prévu à la visite ce jour-là, selon sa partie et sa fréquence |
| **Conditionnement** | Unité de vente qui regroupe plusieurs unités de base (ex. carton de 20 triplettes) |
| **Déchargement** | Comptage du stock restant dans un camion et retour au dépôt, avec calcul de l'écart |
| **Demande perdue** | Quantité voulue par un client mais non vendue (quota épuisé ou ligne refusée) |
| **DUPLICATA** | Mention imprimée sur un bon réimprimé |
| **Gamme** | Famille de produits d'une marque, servant de base aux objectifs (ex. Bimo) |
| **Hors partie** | Client dont la position n'est dans aucune partie d'un secteur qui sert son type |
| **Hors zone** | Visite sur place faite trop loin de la position enregistrée du client |
| **Journée de travail** | Période entre « Démarrer » et « Clôturer », pendant laquelle le terrain peut agir |
| **Ligne en attente** | Quantité commandée au-delà du quota, soumise à l'accord du superviseur |
| **Palier** | Prix unitaire réduit à partir d'une certaine quantité |
| **Parfum** | Déclinaison d'un produit (ex. chocolat, fraise), avec son propre stock, son quota et, parfois, son propre prix |
| **Partie** | Zone géographique d'un secteur (polygone), visitée un jour donné de la semaine |
| **Quota** | Quantité maximale d'un produit qu'un vendeur peut vendre un jour donné |
| **Récapitulatif de journée** | Résumé des bons, des encaissements et du montant attendu, à remettre au comptable |
| **Secteur** | Territoire d'un vendeur, identifié par un code libre (ex. 3101), découpé en parties |
| **Tournée** | Ensemble des commandes qu'un livreur doit livrer à une date donnée |
| **Type de client** | Catégorie de client (Détail, Supérette, Gros…) qui détermine les prix |
| **Versement** | Remise de l'argent encaissé au comptable, avec calcul de l'écart |
