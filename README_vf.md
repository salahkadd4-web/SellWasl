<p align="center">
  <img src="Logo.png" alt="SellWasl" width="420">
</p>

# SellWasl — Plateforme SaaS de prévente, distribution, stock et livraison

> **One Platform. Every Flow.**

Plateforme SaaS B2B **multi-tenant et modulaire** destinée aux entreprises qui gèrent la vente terrain, la distribution, les commandes, les stocks, la préparation et la livraison.

Le produit est conçu dès le départ pour être **vendu à plusieurs entreprises sans modifier le code source pour chaque client**. Il doit être professionnel, sécurisé, évolutif, maintenable et réellement déployable en production.

Ce document est la **version finale consolidée** du cahier des charges. Il fusionne `README_v1.md` (spécification détaillée) et `README.md` (version V3 modulaire). Le plan de réalisation se trouve dans [plan_VF.md](plan_VF.md).

> **Phase 0 terminée (2026-10-01).** Le périmètre du MVP et toutes les règles détaillées sont dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md), [docs/use-cases.md](docs/use-cases.md) et [docs/business-rules.md](docs/business-rules.md). Ce README garde la vision d'ensemble ; **en cas de différence, les documents de `docs/` priment.**

---

## Table des matières

1. [Présentation](#1-présentation)
2. [Identité visuelle](#2-identité-visuelle)
3. [Modules](#3-modules)
4. [Architecture générale](#4-architecture-générale)
5. [Stack technique](#5-stack-technique)
6. [Monorepo](#6-monorepo)
7. [Multi-tenant](#7-multi-tenant)
8. [Rôles](#8-rôles)
9. [RBAC et permissions](#9-rbac-et-permissions)
10. [Workflows](#10-workflows)
11. [Territoires : zones, secteurs, parties](#11-territoires--zones-secteurs-parties)
12. [Planification et génération des visites](#12-planification-et-génération-des-visites)
13. [Visites](#13-visites)
14. [Commandes](#14-commandes)
15. [Entrepôt et stock](#15-entrepôt-et-stock)
16. [Préparation](#16-préparation)
17. [Livraison et tournées](#17-livraison-et-tournées)
18. [Application mobile](#18-application-mobile)
19. [Application Web](#19-application-web)
20. [Super Admin](#20-super-admin)
21. [Gestion des appareils](#21-gestion-des-appareils)
22. [Offline-first et synchronisation](#22-offline-first-et-synchronisation)
23. [Notifications](#23-notifications)
24. [Analytics et rapports](#24-analytics-et-rapports)
25. [Modèle de données](#25-modèle-de-données)
26. [API](#26-api)
27. [Sécurité](#27-sécurité)
28. [Audit](#28-audit)
29. [SaaS et commercialisation](#29-saas-et-commercialisation)
30. [Expérience utilisateur](#30-expérience-utilisateur)
31. [Extensibilité et évolutions futures](#31-extensibilité-et-évolutions-futures)
32. [Règles d'architecture et de développement](#32-règles-darchitecture-et-de-développement)
33. [Livrables avant implémentation](#33-livrables-avant-implémentation)
34. [Annexe A — Arbitrages entre les versions](#annexe-a--arbitrages-entre-les-versions)
35. [Annexe B — Points à valider (tranchés en phase 0)](#annexe-b--points-à-valider-tranchés-en-phase-0)

---

## 1. Présentation

### Contexte

Les entreprises cibles utilisent des équipes de **pré-vendeurs, livreurs, magasiniers et superviseurs** pour gérer leurs activités commerciales et de distribution. Certaines travaillent avec prévente, d'autres reçoivent leurs commandes directement (téléphone, WhatsApp, site, ERP) et ne font que préparer et livrer.

### Ce que la plateforme centralise

- les entreprises et leurs abonnements ;
- les utilisateurs, rôles et permissions ;
- les équipes : gérants, superviseurs, pré-vendeurs, livreurs, magasiniers ;
- les clients, contacts et adresses ;
- les produits, catégories et prix ;
- les secteurs géographiques et leurs parties ;
- les fréquences et la planification des visites ;
- les visites clients et leurs preuves ;
- les commandes, quelle que soit leur source ;
- les entrepôts, stocks et mouvements ;
- la préparation des commandes ;
- les livraisons et tournées ;
- les encaissements ;
- la géolocalisation ;
- les appareils mobiles des employés ;
- la synchronisation offline/online ;
- les statistiques et rapports.

### Positionnement

> Plateforme SaaS modulaire de gestion commerciale, prévente, distribution, logistique et livraison.

L'objectif n'est pas une simple application de prise de commandes, mais un véritable **système d'exploitation SaaS pour les entreprises de prévente et de distribution** :

```text
Planification → Visite → Prévente → Commande → Préparation → Stock → Livraison → Encaissement → Suivi → Analyse
```

---

## 2. Identité visuelle

Couleurs extraites de `Logo.png` :

| Rôle | Couleur | Hex |
|---|---|---|
| Primaire (texte « Sell ») | Bleu marine | `#001850` |
| Texte foncé (slogan) | Marine très foncé | `#00043C` |
| Accent (texte « Wasl ») | Turquoise | `#00BCBC` |
| Dégradé de marque (symbole « SW ») | Bleu vif → bleu ciel → cyan → menthe | `#0053F6` → `#01ADDC` → `#01CCCD` → `#37E9AB` |
| Ombre / bleu profond | Bleu profond | `#012E8E` |
| Fond | Blanc | `#FFFFFF` |

- **Police** : sans-serif géométrique arrondie (type Poppins / Montserrat), gras pour les titres.
- **Slogan** : *One Platform. Every Flow.*
- **Contraste** : le turquoise `#00BCBC` sur fond blanc donne environ 2,3:1. Il est réservé aux boutons, icônes, fonds et éléments graphiques, **jamais au texte courant**. Le texte utilise le marine.
- Les couleurs sont définies **une seule fois** comme tokens (`packages/config` / thème Tailwind et shadcn/ui), partagés entre le Web et le mobile.

---

## 3. Modules

### 3.1 Socle commun (toujours actif)

Le socle est indispensable à toutes les configurations :

- entreprise et paramètres (jours travaillés, jours fériés, motifs) ;
- utilisateurs, rôles, permissions ;
- appareils et sessions ;
- clients et types de clients ;
- produits, conditionnements, prix par type de client, paliers, bonus ;
- quotas et objectifs ;
- commandes et ventes ;
- paiements, dettes et versements ;
- notifications ;
- audit.

### 3.2 Modules activables

| Code | Module | Contenu |
|---|---|---|
| `PRE_SALES` | **Prévente** | prise de commande par le pré-vendeur, livrée au jour ouvré suivant |
| `DELIVERY` | **Livraison** | tournées de livraison, réception du chargement, livraison, encaissement, impression du bon, application livreur |
| `CASH_VAN` | **Vente au camion** | stock du camion, vente et livraison immédiates, encaissement, impression, application vendeur cash van |
| `WAREHOUSE` | **Entrepôt / Stock** | dépôts et camions, stock physique/réservé/disponible, mouvements, préparation, chargement, déchargement, inventaire, application magasinier |
| `ANALYTICS` | **Analytics** | tableau de bord du jour, exports CSV |
| `COMMERCIAL` | *Gestion commerciale avancée* | **Après le MVP** : promotions complexes, conditions commerciales, saisie de commandes au bureau. Les prix, paliers et bonus sont dans le socle. |
| `PRODUCTION` | *Production industrielle* | **Hors périmètre V3**, réservé pour une version future (voir §31) |

Secteurs, parties, polygones, planning, fréquences, journée de travail et visites sont **communs à `PRE_SALES` et `CASH_VAN`**.

### 3.3 Système de modules

```text
Entreprise
 → Plan SaaS
 → Modules autorisés par le plan
 → Modules activés (CompanyModule)
 → Permissions
 → Fonctionnalités / routes / API
```

Table :

```text
CompanyModule
- id
- company_id
- module_code
- status
- activated_at
- config
- created_at
- updated_at
```

Un module désactivé doit être :

- masqué dans l'UI Web et mobile ;
- inaccessible par les routes ;
- inaccessible par l'API ;
- refusé par les guards backend, **même si quelqu'un appelle l'API directement**.

Un rôle ne donne jamais accès à un module désactivé.

### 3.4 Modes de vente

Le Super Admin choisit le **mode** de l'entreprise, et les modules en découlent :

| Mode | Modules |
|---|---|
| Prévente | `PRE_SALES` + `DELIVERY` + `WAREHOUSE` + `ANALYTICS` |
| Cash van | `CASH_VAN` + `WAREHOUSE` + `ANALYTICS` |
| Mixte | `PRE_SALES` + `DELIVERY` + `CASH_VAN` + `WAREHOUSE` + `ANALYTICS` |

Tous les modes incluent le socle commun. Les configurations avec `COMMERCIAL` viendront après le MVP.

---

## 4. Architecture générale

La plateforme est composée de trois parties.

### A. Application Web

Destinée au **Super Admin** (`/admin`) et aux **administrateurs, superviseurs et comptables d'entreprise** (`/app`). Ces rôles n'utilisent **que le Web**, dans Chrome sur PC ou sur téléphone.

- fonctionne sur ordinateur, tablette et navigateur mobile ;
- responsive, avec une interface de type application native sur téléphone ;
- PWA lorsque c'est pertinent ;
- accessible depuis un navigateur mobile sans installer l'application native.

### B. Application mobile

**Une seule application mobile**, Android uniquement pour le MVP. Elle affiche des fonctionnalités différentes selon le rôle (RBAC) et les modules activés :

- pré-vendeur ;
- livreur ;
- vendeur cash van ;
- magasinier.

Seuls ces rôles terrain utilisent l'application mobile.

### C. Backend / API

Backend centralisé, **API-first**, servant l'application Web, l'application mobile et, à terme, des systèmes externes.

Architecture backend : **modular monolith** au départ (pas de microservices).

```text
                         SELLWASL
                            │
           ┌────────────────┴────────────────┐
           │                                 │
     APPLICATION WEB                  APPLICATION MOBILE
     Next.js / PWA                    React Native / Expo
           │                                 │
   Super Admin                         Pré-vendeur
   Admin                               Livreur
   Superviseur                         Vendeur cash van
   Comptable                           Magasinier
           │                                 │
           │                            SQLite local
           │                          Outbox / Sync Engine
           │                                 │
           └────────────────┬────────────────┘
                            ▼
                     REST API /api/v1
                         NestJS
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
     PostgreSQL       Redis / BullMQ     Stockage objet
       Prisma          (optionnel)    (photos, signatures)
```

---

## 5. Stack technique

| Couche | Technologies |
|---|---|
| Web | Next.js, TypeScript, Tailwind CSS, shadcn/ui, PWA |
| Mobile | React Native, Expo, TypeScript, SQLite, GPS, caméra, notifications push |
| Backend | NestJS, TypeScript, REST API, Swagger / OpenAPI |
| Données | PostgreSQL, Prisma ORM |
| Cache / jobs | Redis + BullMQ (optionnel : cache, files de tâches, génération des visites, notifications) |
| Fichiers | Stockage objet (photos, signatures, preuves, imports) |
| Cartographie | OpenStreetMap + Leaflet ou MapLibre. Le fournisseur doit rester **remplaçable**. |
| Monorepo | Turborepo |
| Infrastructure | Git / GitHub, Docker, variables d'environnement, CI/CD |
| Environnements | development → staging → production |

**Authentification** : JWT avec refresh tokens (ou session sécurisée), RBAC, gestion des appareils, révocation des sessions, protection contre les accès inter-entreprises, MFA éventuellement.

---

## 6. Monorepo

```text
sellwasl/
├── apps/
│   ├── web/              # Next.js : /admin et /app
│   ├── mobile/           # Expo : application unique multi-rôles
│   └── api/              # NestJS
│       └── prisma/       # schéma, migrations, seed
├── packages/
│   ├── ui/               # composants partagés
│   ├── types/            # types TypeScript partagés
│   ├── config/           # ESLint, TS, tokens de thème
│   ├── validation/       # schémas de validation partagés
│   └── business-rules/   # règles métier pures (fréquences, stock, statuts)
├── docs/
├── .env.example
├── docker-compose.yml
├── package.json
├── turbo.json
└── README.md
```

---

## 7. Multi-tenant

C'est une exigence fondamentale.

```text
Plateforme
│
├── Entreprise A
│   ├── Utilisateurs
│   ├── Clients
│   ├── Produits
│   ├── Commandes
│   ├── Stocks
│   └── Secteurs
│
├── Entreprise B
│   └── ...
│
└── Entreprise C
```

- Toutes les données métier sont liées à `company_id`.
- Un utilisateur de l'entreprise A ne peut **jamais** lire, modifier ou supprimer des données de l'entreprise B.
- L'isolation est appliquée au niveau de l'API, des services backend, des requêtes Prisma, des permissions et des fichiers/stockages.
- **Ne jamais faire confiance au `company_id` envoyé par le client.** Le backend le déduit du contexte authentifié.

Chaque requête métier contrôle, dans l'ordre :

```text
Identité (User)
 ↓
Tenant (Company)
 ↓
Rôle et permissions
 ↓
Module activé
 ↓
Accès à la ressource
```

---

## 8. Rôles

### 8.1 Rôles plateforme

Ils appartiennent à la plateforme, **pas à une entreprise**. Ce sont des comptes distincts des utilisateurs d'entreprise.

| Code | Rôle |
|---|---|
| `SUPER_ADMIN` | Administrateur global : crée et gère les entreprises, plans, abonnements, comptes plateforme, paramètres |
| `SUPPORT` | Assistance aux entreprises, accès temporaire **audité**, lecture seule de préférence |
| `FINANCE` | Plans, abonnements, facturation |
| `TECH_ADMIN` | Monitoring, logs, état des services |

Dans le MVP, seul `SUPER_ADMIN` existe, avec un rôle minimal : créer une entreprise, son administrateur, et choisir son mode. `SUPPORT`, `FINANCE` et `TECH_ADMIN` viendront après le MVP.

### 8.2 Rôles entreprise

Chaque utilisateur a un seul rôle. Les quatre rôles terrain utilisent uniquement l'application mobile ; les rôles de gestion utilisent uniquement le Web.

**`COMPANY_ADMIN`** (Web) : administrateur de l'entreprise.

- a tous les droits du superviseur et du comptable ;
- gère les utilisateurs, superviseurs compris ;
- gère le catalogue, les prix, les paliers et les bonus ;
- gère les paramètres : types de clients, jours travaillés et fériés, motifs, distance hors zone, ticket, dépôts et camions ;
- importe les clients et les produits.

**`SUPERVISEUR`** (Web)

- dessine les secteurs et leurs parties, et définit le planning ;
- affecte les vendeurs, les livreurs et les camions ;
- gère les clients et traite la liste « clients à revoir » ;
- fixe les quotas du jour et les objectifs du mois ;
- suit toutes les équipes en temps réel (pas de découpage par équipe dans le MVP) ;
- traite les lignes en attente et lance la préparation ;
- rouvre une journée, change l'appareil d'un profil, révoque une session, bloque un appareil ;
- exporte en CSV.

Il ne crée, ne modifie et ne supprime **jamais** une commande, une vente, une visite ou un paiement.

**`COMPTABLE`** (Web)

- enregistre les versements et voit les écarts ;
- consulte les dettes et les paiements ;
- exporte en CSV.

**`PRE_VENDEUR`** (application mobile)

- démarre et clôture sa journée ;
- voit sa partie du jour et ses clients du jour, triés par distance ;
- crée un client, sans pouvoir le modifier ni le supprimer ;
- fait ses visites, sur place ou par téléphone ;
- prend et modifie ses commandes jusqu'à la clôture ;
- encaisse les dettes ;
- consulte ses objectifs ;
- travaille hors connexion et synchronise.

**`VENDEUR_CASH_VAN`** (application mobile)

- confirme la réception du chargement de son camion ;
- démarre et clôture sa journée, et fait ses visites comme le pré-vendeur ;
- vend et livre immédiatement depuis le stock du camion ;
- encaisse et imprime les bons ;
- encaisse les dettes ;
- consulte ses objectifs.

**`LIVREUR`** (application mobile)

- confirme la réception du chargement ;
- démarre et clôture sa journée ;
- voit sa tournée ;
- livre en totalité, en partie, ou déclare un échec avec un motif ;
- encaisse et imprime ou réimprime les bons ;
- imprime son récapitulatif de journée.

**`MAGASINIER`** (application mobile)

- enregistre les entrées de stock ;
- prépare les tournées et signale les ruptures ;
- charge et décharge les camions ;
- fait l'inventaire du dépôt.

Les fonctionnalités réellement disponibles dépendent des **modules activés**.

---

## 9. RBAC et permissions

Les permissions suivent le format `ressource.action` et sont **toujours contrôlées côté backend**. Les rôles et leurs permissions sont configurables (pas codés en dur dans le frontend).

```text
# Plateforme
companies.read        companies.create      companies.update      companies.suspend
subscriptions.read    subscriptions.update
platform.monitoring.read   platform.audit.read   platform.support

# Entreprise
users.read            users.create          users.update          users.disable
devices.read          devices.update
modules.read          modules.update
customers.read        customers.create      customers.update      customers.delete
products.read         products.create       products.update
territories.read      territories.update
visits.read           visits.create         visits.update
orders.read           orders.create         orders.update
inventory.read        inventory.update
deliveries.read       deliveries.update
workdays.read         workdays.reopen
quotas.read           quotas.update
objectives.read       objectives.update
loads.read            loads.create          loads.confirm
payments.read         payments.create
settlements.read      settlements.create
reports.read          reports.export
```

Une matrice rôles × permissions est livrée dans `docs/rbac.md`.

---

## 10. Workflows

### Avec prévente

```text
Superviseur
 → Secteur
 → Partie géographique
 → Planification
 → Pré-vendeur
 → Visite
 → Commande
 → Entrepôt / Préparation
 → Livraison
 → Client
```

Le pré-vendeur prend les commandes le jour J. À la clôture, elles sont figées, préparées et chargées, puis livrées le **jour ouvré suivant**.

### Cash van (sans pré-vendeur)

```text
Chargement du camion au dépôt (le matin)
 → Visite du client par le vendeur cash van
 → Vente + livraison immédiate depuis le camion
 → Encaissement + impression du bon
 → Déchargement du stock restant (le soir)
 → Versement au comptable
```

Une commande **ne dépend pas obligatoirement** d'une visite, et une livraison **ne dépend pas obligatoirement** d'un pré-vendeur. La saisie de commandes au bureau (site, téléphone, WhatsApp, ERP, API) par un opérateur viendra après le MVP.

### Cycle complet

```text
                    ENTREPRISE
                         │
                    SUPERVISEUR
              ┌──────────┼──────────┐
          SECTEURS    ÉQUIPES     CLIENTS
              │
          PARTIES
              │
        PLANIFICATION
              │
         PRÉ-VENDEUR
              │
           VISITE
              │
          COMMANDE
              │
          MAGASINIER
              │
          PRÉPARATION
              │
           LIVREUR
              │
          LIVRAISON
              │
     CLIENT / ENCAISSEMENT
```

---

## 11. Territoires : zones, secteurs, parties

```text
ZONE
 └── SECTEUR (Territory)
       ├── PARTIE 1 (TerritoryPart)
       ├── PARTIE 2
       ├── ...
       └── PARTIE N
```

- Le **nombre de parties n'est pas codé en dur** : le superviseur choisit par exemple 5 ou 6 parties.
- Les parties sont de **vraies zones géographiques**, définies par des **polygones** dessinés ou modifiés sur la carte.
- Chaque client est associé à une zone, un secteur et une partie.

Exemple :

```text
Secteur Oran Est

┌──────────────┬──────────────┐
│   Partie 1   │   Partie 2   │
├──────────────┼──────────────┤
│   Partie 3   │   Partie 4   │
├──────────────┼──────────────┤
│   Partie 5   │   Partie 6   │
└──────────────┴──────────────┘
```

Le superviseur peut :

- créer une zone et un secteur ;
- définir le nombre de parties ;
- dessiner, modifier et supprimer les polygones ;
- affecter les clients aux parties ;
- affecter les pré-vendeurs ;
- visualiser clients, pré-vendeurs, livreurs et itinéraires sur la carte.

**Règles du MVP** (détail dans `docs/business-rules.md`, BR-ORG) :

- Un secteur a un code libre (ex. `3101`), **un vendeur**, et la liste des **types de clients qu'il sert**. Des secteurs de types différents peuvent se superposer : par exemple un secteur « Supérette » qui couvre toute la ville, par-dessus les secteurs 3101 à 3110 du détail.
- Le client est **affecté automatiquement** à la partie dont le polygone contient sa position, parmi les secteurs qui servent son type. S'il n'est dans aucune, il est « hors partie ». Le superviseur peut toujours forcer la partie.
- Quand un vendeur crée un client, celui-ci est rattaché au secteur du vendeur, et sa partie est calculée sur le téléphone, même hors connexion.

---

## 12. Planification et génération des visites

### Affectation et planning

Chaque vendeur (pré-vendeur ou cash van) est affecté à **un secteur**. Le système détermine automatiquement sa partie du jour. Par défaut, les jours travaillés vont du samedi au jeudi (vendredi chômé), et ils restent réglables par entreprise.

```text
Pré-vendeur : Ahmed
Secteur : 3101

Samedi     → Partie 1
Dimanche   → Partie 2
Lundi      → Partie 3
Mardi      → Partie 4
Mercredi   → Partie 5
Jeudi      → Partie 6
```

Le superviseur peut modifier les jours, les parties, les affectations, les pré-vendeurs et les calendriers.

### Fréquences

```text
WEEKLY          → chaque semaine
BIWEEKLY        → tous les 15 jours
EVERY_4_WEEKS   → toutes les 4 semaines
```

« Toutes les 4 semaines » remplace « chaque mois » : la visite tombe ainsi toujours sur le jour de la partie du client. Chaque client a une **date de référence**, celle de sa première visite, qui fixe sa semaine dans le cycle. L'architecture doit permettre d'ajouter d'autres fréquences plus tard.

```text
Client : Épicerie ABC       Secteur : 3101   Partie : 3   Fréquence : WEEKLY
Client : Supermarché XYZ    Secteur : 3101   Partie : 6   Fréquence : BIWEEKLY       Référence : jeudi 8 octobre
Client : Commerce DEF       Secteur : 3101   Partie : 1   Fréquence : EVERY_4_WEEKS  Référence : samedi 3 octobre
```

### Génération automatique

Le moteur détermine les clients à visiter en tenant compte de :

- secteur, partie et jour ;
- fréquence de visite et date de référence ;
- statut du client ;
- jours fériés ;
- reprogrammations décidées par le superviseur.

```text
Vendeur → Secteur → Partie du jour → Clients de la partie → Fréquence due ce jour ?
 → + clients reprogrammés → Liste du jour
```

Une visite non faite à la clôture de la journée est **manquée**. Elle n'est pas reportée automatiquement, mais le superviseur peut la reprogrammer. Le téléphone sait calculer la liste du jour hors connexion.

Exemple de résultat pour Ahmed, Oran Est, partie 3 :

```text
1. Épicerie ABC
2. Mini Market XYZ
3. Alimentation 123
4. Superette DEF
5. Commerce GHI
```

Le superviseur consulte la même liste depuis le Web et peut modifier, annuler ou reprogrammer une visite.

---

## 13. Visites

### Client ≠ Visite ≠ Commande

Un client peut être visité sans commande, et une commande peut exister sans visite.

```text
Customer
   └── Visits
          ├── Visit 1 ── Order
          ├── Visit 2 ── (pas de commande)
          └── Visit 3 ── Order
```

### Données d'une visite

```text
Visit
- id
- company_id
- customer_id
- user_id (pré-vendeur)
- territory_part_id
- scheduled_at
- started_at
- ended_at
- latitude
- longitude
- status
- outcome_reason_id
- comment
- proof (photo éventuelle)
- order_id (optionnel)
```

### Statuts

```text
PLANNED → IN_PROGRESS → COMPLETED
PLANNED → MISSED   (non visité à la clôture de la journée)
```

### Preuve de visite

Au début de la visite, le vendeur choisit le **mode** :

- **Sur place** : l'application calcule la distance au client. Au-delà de la distance réglée par l'entreprise (100 m par défaut), la visite est signalée « **hors zone** » au superviseur, mais **jamais bloquée**.
- **Par téléphone**, en prévente uniquement : pas de contrôle de distance, et la commande porte la source `PHONE`. Le superviseur voit la part de visites par téléphone de chaque vendeur.

```text
Client ABC
Distance : 32 mètres
[ COMMENCER LA VISITE ]
```

La visite enregistre le GPS, la date, l'heure, l'utilisateur, le client, le mode et le statut.

### Résultat de la visite

```text
Visite terminée
☑ Commande créée
☐ Pas de commande
☐ Client absent
☐ Client a encore du stock
☐ Magasin fermé
☐ Fermé définitivement
☐ Refus
☐ Autre
```

Les **motifs sont configurables** par entreprise. Le motif « fermé définitivement » ajoute le client à la liste « clients à revoir » du superviseur.

---

## 14. Commandes

### Sources (`Order.source`)

```text
MVP          : PRE_SALES (visite sur place)   PHONE (visite par téléphone)   CASH_VAN
Après le MVP : WEBSITE   WHATSAPP   ERP   MANUAL   API
```

### Saisie

Client → Visite → Produits disponibles (avec les prix du type du client) → Unité + quantité → Panier (paliers et bonus automatiques) → Total → Confirmation.

- **Prix** : un prix par type de client (Détail, Supérette, Gros…) et par unité (pièce, carton…), avec des **paliers** de quantité.
- **Bonus cumulatifs**, ajoutés automatiquement à prix 0. Exemple : 1 carton de thon tomate acheté donne 4 triplettes de thon à l'huile offertes.
- **Quotas** facultatifs, par jour, par produit et par vendeur. Au-delà, en prévente, la ligne passe **« en attente »** et le superviseur l'accepte ou la refuse ; en cash van, le produit est grisé et le vendeur peut noter une **demande perdue**.
- Les prix sont **figés** dans la commande à la confirmation.

### Statuts (prévente)

```text
DRAFT              panier, sur le téléphone
 ↓
CONFIRMED          ← réservation du stock ; modifiable par le vendeur jusqu'à la clôture
 ↓
LOCKED             ← journée clôturée (retour à CONFIRMED si le superviseur rouvre la journée)
 ↓
PREPARING          ← préparation lancée par le superviseur
 ↓
READY
 ↓
OUT_FOR_DELIVERY   ← chargée dans le camion, réception confirmée par le livreur
 ↓
DELIVERED / PARTIALLY_DELIVERED / FAILED
```

`CANCELLED` : annulée par le vendeur avant la clôture, ce qui libère le stock réservé.

Une vente cash van est créée directement au statut `DELIVERED`. Les retours clients après livraison (`RETURNED`) viendront après le MVP.

Une commande peut être associée à une visite et à un pré-vendeur, sans que ce soit obligatoire.

---

## 15. Entrepôt et stock

### Structure

```text
Warehouse (type DEPOT ou TRUCK)
 ├── Locations (emplacements, après le MVP)
 └── Stock
```

Le **camion est un entrepôt**, en prévente comme en cash van :

- le chargement est un transfert du dépôt vers le camion ;
- la livraison ou la vente sort la marchandise du camion ;
- le soir, le déchargement compte le stock restant, enregistre l'écart et rend le stock au dépôt.

### Physique, réservé, disponible

```text
Stock
- product_id
- warehouse_id
- quantity            (physique)
- reserved_quantity   (réservé)
- available_quantity  (= physique − réservé)
```

Exemple :

```text
Produit : Coca 1L
Stock physique   : 120
Stock réservé    :  30
Stock disponible :  90
```

À la confirmation d'une commande de 10 unités, le disponible passe de 120 à 110 (réservation).

### Mouvements

```text
IN            entrée au dépôt (réception fournisseur)
OUT           sortie du camion (livraison ou vente, bonus compris)
TRANSFER      chargement (dépôt → camion) et déchargement (camion → dépôt)
ADJUSTMENT    écart d'inventaire ou de déchargement, avec motif
RESERVATION   réservation au dépôt (commande confirmée)
RELEASE       libération (commande annulée ou modifiée)
RETURN        retours clients après livraison — après le MVP
```

L'inventaire produit des mouvements `ADJUSTMENT`. Le stock physique n'est jamais négatif.

- Le stock est **basé sur des mouvements traçables**.
- Les opérations de stock utilisent des **transactions** pour éviter les incohérences.
- Les mouvements importants sont audités.
- Des alertes de stock faible sont générées.

---

## 16. Préparation

```text
Journées des pré-vendeurs clôturées (commandes figées)
 ↓
Superviseur : traite les lignes en attente, puis lance la préparation de chaque tournée
 ↓
Magasinier : liste de chargement (total par produit) + détail par commande
 ↓
Quantités préparées (rupture signalée si inférieure)
 ↓
Prête
 ↓
Chargement dans le camion du livreur
 ↓
Livraison le jour ouvré suivant
```

Le magasinier travaille sur l'application mobile. La lecture de codes-barres viendra après le MVP.

---

## 17. Livraison et tournées

En prévente, le livreur livre les commandes des pré-vendeurs le jour ouvré suivant. En cash van, le vendeur livre lui-même au moment de la vente (§10).

### Flux

```text
Commande prête → Chargement du camion → Réception confirmée par le livreur → Tournée → Livrée
```

### Résultat d'une livraison (MVP)

```text
DELIVERED    livrée en totalité
PARTIAL      partiellement livrée (refus d'une partie, ou manque)
FAILED       échec (motif réglable : client absent, refus, fermé, autre)
```

Les livraisons non traitées à la clôture de la journée sont en échec « non livrée », et leur marchandise revient au dépôt au déchargement. Les statuts intermédiaires « en route » et « arrivé » viendront après le MVP.

### Encaissement et preuves

- Paiement en **espèces**, ou à **crédit** si le client y a droit et dans la limite de son **plafond** ; la dette du client est suivie.
- Le **bon de livraison** est imprimé sur une **imprimante thermique Bluetooth** (58 ou 80 mm). Une réimpression porte la mention « DUPLICATA ».
- Le soir, le **récapitulatif de journée** donne le montant attendu, et le **comptable** enregistre le versement et l'écart.
- Photo et signature viendront après le MVP.

### Tournées (`Route`)

```text
Route
 ├── Delivery 1
 ├── Delivery 2
 ├── Delivery 3
 └── Delivery 4
```

Une tournée porte l'ordre de passage, la distance, le statut, le livreur, la date, le départ et la fin.

---

## 18. Application mobile

Une seule application (Android), avec des menus selon le rôle et les modules activés. Les cas d'utilisation détaillés sont dans `docs/use-cases.md`.

### Journée de travail

Le pré-vendeur, le livreur et le vendeur cash van **démarrent** leur journée, et le bouton devient alors « **Clôturer la journée** ».

- Hors journée en cours, ils peuvent seulement consulter.
- La clôture fige les commandes de prévente.
- Le superviseur peut **rouvrir** une journée, avec un motif, tant que l'étape suivante (préparation ou déchargement) n'a pas commencé.
- La position n'est envoyée que pendant la journée : à chaque action, et toutes les 5 minutes.

### Pré-vendeur

```text
Login · Tableau de bord · Clients du jour (liste / carte) · Fiche client · Visite · Commande · Commandes du jour · Objectifs · Catalogue · Synchronisation · Profil
```

Tableau de bord :

```text
[ DÉMARRER LA JOURNÉE ]   ou   [ CLÔTURER LA JOURNÉE ]
[ SYNCHRONISER ]   🟢 Synchronisé
Clients du jour : 12 / 20   (+1 hors programme)
Commandes du jour : 9       CA du jour : 184 500 DA
Objectifs : Bimo 62 %   ·   Tango 48 %
```

- **Clients du jour** triés du plus proche au plus loin, avec une bascule vers **tout le secteur**, en liste comme sur la carte.
- **Carte** : marqueurs rouges, qui passent au vert après la visite. Un appui sur un client affiche trois boutons : itinéraire (Google Maps), fiche du client, commencer la visite.
- **Fiche client** : informations, dette, historique, commencer la visite, ouvrir sur la carte, appeler.
- **Ajouter un client** : formulaire avec une icône de localisation GPS et le choix de la fréquence. Le client est actif tout de suite et marqué « nouveau » pour le superviseur.
- **Visite** :
  1. le vendeur appuie sur un produit, choisit l'unité et la quantité, et le produit passe dans le panier ;
  2. bonus et paliers s'appliquent automatiquement ;
  3. il confirme la commande, ou indique un motif s'il n'y a pas de commande.
- **Catalogue** consultable sans les prix hors visite. En visite, seuls les produits disponibles s'affichent.

### Vendeur cash van

```text
Login · Tableau de bord · Réception du chargement · Clients du jour · Visite · Vente · Encaissement · Impression · Stock du camion · Objectifs · Récapitulatif · Synchronisation · Profil
```

Mêmes écrans de journée, de clients et de visite que le pré-vendeur. En plus, les produits proposés sont ceux du camion, la vente vaut livraison, et le vendeur encaisse et imprime le bon immédiatement.

### Livreur

```text
Login · Tableau de bord · Réception du chargement · Ma tournée (liste / carte) · Livraison · Encaissement · Impression · Historique · Récapitulatif · Synchronisation · Profil
```

Actions : confirmer la réception, naviguer, livrer en totalité ou en partie, déclarer un échec avec motif, encaisser (espèces ou crédit), imprimer ou réimprimer le bon, imprimer le récapitulatif.

### Magasinier

```text
Login · Tableau de bord · Entrées · Préparations · Chargements · Déchargements · Inventaire · Stock · Synchronisation · Profil
```

---

## 19. Application Web

### Routes Super Admin

```text
/admin/dashboard
/admin/companies
/admin/companies/[id]
/admin/plans
/admin/subscriptions
/admin/users
/admin/devices
/admin/monitoring
/admin/logs
/admin/support
/admin/settings
```

### Routes entreprise

```text
/app/dashboard
/app/modules
/app/users
/app/customers
/app/products
/app/territories
/app/visits
/app/orders
/app/inventory
/app/deliveries
/app/routes
/app/reports
/app/devices
/app/settings
```

Les écrans des modules inactifs sont **masqués** et **protégés côté API**.

Pages ajoutées par la phase 0 : quotas, objectifs, lignes en attente, préparation et chargements, versements (comptable), dettes, clients à revoir, import CSV.

### Dashboard entreprise

```text
Chiffre d'affaires          Commandes
Visites planifiées/réalisées  Clients non visités / retards
Taux de conversion          Pré-vendeurs actifs
Livreurs actifs             Commandes en préparation
Commandes en livraison      Échecs de livraison
Stock faible / ruptures
```

Filtres : date, pré-vendeur, livreur, secteur, partie, client, produit.

### Carte du superviseur

Elle affiche les secteurs, parties, clients, pré-vendeurs, livreurs et éventuellement les itinéraires.

```text
Secteur Oran Est              Ahmed
Partie 1 : 35 clients         Secteur : Oran Est
Partie 2 : 42 clients         Partie actuelle : 3
Partie 3 : 28 clients         Visites : 12 / 20
...                           Dernière position connue
                              Dernière synchronisation : 14:32
```

Suivi des équipes :

```text
Ahmed     🟢 En tournée   12 / 20 visites
Mohamed   🟢 En tournée    8 / 17 visites
Youcef    🔴 Hors ligne   Dernière sync : 14:32
```

### Responsive et PWA

- **Desktop** : sidebar, dashboard, tableaux, cartes, graphiques.
- **Mobile** : header, contenu adapté, navigation inférieure, cartes plein écran, boutons tactiles.
- **PWA** : manifest, icône, splash screen, installation sur l'écran d'accueil, mode standalone, cache approprié.

La PWA **ne remplace pas** l'application mobile native pour le terrain (GPS en continu, offline avancé, caméra).

---

## 20. Super Admin

Le Super Admin distingue l'**administration globale du SaaS** de l'administration d'une entreprise.

> **MVP** : le Super Admin se limite à créer une entreprise, son administrateur, et choisir son mode (Prévente, Cash van ou Mixte). Tout le reste de cette section vient après le MVP.

**Menu** : Dashboard · Entreprises · Utilisateurs plateforme · Plans · Abonnements · Appareils · Monitoring · Logs & Audit · Support · Paramètres.

**Dashboard plateforme** : entreprises totales, actives et suspendues ; utilisateurs, pré-vendeurs, livreurs ; commandes et visites ; stockage ; erreurs API ; synchronisations échouées ; notifications échouées ; état des services.

**Entreprises** : créer, consulter, modifier, activer, suspendre, réactiver ; gérer les modules ; consulter le plan, l'utilisation, les utilisateurs, les appareils et l'activité.

**Monitoring** : API, temps de réponse, erreurs, base de données, stockage, notifications, synchronisation, jobs.

**Support** : accès temporaire à une entreprise ou un utilisateur, **audité**, en lecture seule de préférence.

---

## 21. Gestion des appareils

Chaque utilisateur mobile peut avoir un ou plusieurs appareils.

```text
Device
- id
- user_id
- company_id
- device_name
- device_model
- platform (OS)
- app_version
- status
- last_seen (dernière connexion)
- last_sync
- battery_level (si disponible)
- push_token
- created_at
```

Actions (superviseur ou administrateur autorisé, Super Admin pour la vue plateforme) :

- associer ou désassocier un appareil ;
- voir les appareils actifs, la dernière connexion, la dernière synchronisation ;
- révoquer une session ;
- bloquer ou réactiver un appareil ;
- forcer une nouvelle authentification.

> Cette fonction contrôle **l'accès et les sessions de l'application métier**, pas le téléphone Android/iOS lui-même. Un contrôle complet du terminal nécessiterait une solution MDM.

---

## 22. Offline-first et synchronisation

Le pré-vendeur et le livreur doivent pouvoir travailler avec une connexion faible ou absente.

```text
Internet disponible → Synchronisation → SQLite local → Travail
Internet coupé      → Commandes / visites enregistrées localement
Internet revient    → Synchronisation automatique
```

### Architecture

```text
Mobile → SQLite → Outbox / Sync Queue → Sync Engine → API /api/v1/sync → PostgreSQL
```

### Données disponibles offline

Clients affectés, produits, prix, planning des visites, visites, commandes, livraisons.

### Champs de chaque donnée synchronisable

```text
id (UUID généré côté client)
created_at
updated_at
deleted_at
version
sync_status
```

### États de synchronisation

```text
PENDING   SYNCING   SYNCED   FAILED   CONFLICT
```

### Exigences

- UUID côté client ;
- idempotency keys : une opération rejouée ne crée pas de doublon ;
- retries automatiques ;
- synchronisation différentielle ;
- **gestion explicite des conflits**, sans jamais écraser silencieusement les données ;
- journal de synchronisation et des erreurs ;
- indicateur visible pour l'utilisateur :

```text
🟢 Synchronisé
🟠 3 commandes en attente de synchronisation
```

---

## 23. Notifications

Canaux : in-app, push, email, puis SMS et WhatsApp. Les **fournisseurs sont remplaçables**.

Événements :

```text
Nouvelle commande         Commande validée / prête
Livraison affectée        Livraison terminée
Échec de livraison        Stock faible
Visite prévue / en retard Synchronisation terminée / échouée
Appareil révoqué
```

---

## 24. Analytics et rapports

| Domaine | Indicateurs |
|---|---|
| Commercial | commandes, chiffre d'affaires, produits, clients |
| Prévente | visites planifiées/réalisées, retards, taux de conversion, activité des pré-vendeurs, performances territoriales |
| Livraison | livraisons, délais, échecs, activité des livreurs |
| Stock | disponibilité, mouvements, alertes, ruptures, rotation |

- **Filtres** : période, secteur, partie, utilisateur, client, produit.
- **Exports** : CSV, Excel, PDF éventuellement.

---

## 25. Modèle de données

### Entités

```text
# Plateforme
PlatformUser
SubscriptionPlan
PlanModule              (modules autorisés par plan)
Subscription
PlatformAuditLog

# Entreprise, identité, accès
Company
CompanyModule
User
Role
Permission
RolePermission
UserRole
Team
Session
Device

# Territoires et prévente
Zone
Territory               (secteur)
TerritoryPart           (partie)
SalesRepAssignment      (pré-vendeur ↔ secteur)
PartSchedule            (jour → partie)
VisitSchedule           (fréquence par client)
Visit
VisitOutcomeReason      (motifs configurables)

# Commercial
Customer
CustomerContact
CustomerAddress
Product
ProductCategory
ProductPrice
Promotion

# Commandes
Order
OrderItem

# Entrepôt
Warehouse
WarehouseLocation
Stock
StockMovement

# Livraison
Delivery
DeliveryItem
Route
Payment

# Transverse
Attachment              (photos, signatures, preuves)
Notification
SyncLog
AuditLog
```

**Entités ajoutées par la phase 0** (le schéma précis sera fait en phase 3) :

```text
Holiday                 (jours fériés de l'entreprise)
CustomerType            (Détail, Supérette, Gros…)
ProductPackaging        (conditionnements : carton = 20 unités de base)
PriceTier               (paliers de quantité)
BonusRule               (pour Q de X acheté, N de Y offert)
WorkDay                 (journée de travail d'un utilisateur)
Quota                   (vendeur × produit × jour)
LostDemand              (demandes perdues et lignes refusées)
Objective               (vendeur × gamme × mois, prime, plafond)
Load / Unload           (chargement et déchargement d'un camion)
Settlement              (versement au comptable)
```

Les « lignes en attente » sont des lignes de commande (`OrderItem`) avec un statut particulier.

### Hiérarchie

```text
Platform
├── PlatformUser
├── SubscriptionPlan ── PlanModule
├── Subscription
├── PlatformAuditLog
└── Company
    ├── CompanyModule
    ├── User ── UserRole ── Role ── RolePermission ── Permission
    ├── Team
    ├── Device / Session
    ├── Zone
    │   └── Territory
    │       └── TerritoryPart
    ├── Customer ── Contacts / Addresses / VisitSchedule
    ├── Product ── Category / Price / Promotion
    ├── Warehouse ── Location / Stock ── StockMovement
    ├── Visit
    ├── Order ── OrderItem
    ├── Delivery ── DeliveryItem
    ├── Route
    ├── Payment
    ├── Notification
    └── AuditLog
```

### Règles

- `Customer ≠ Visit ≠ Order` : un client a plusieurs visites et plusieurs commandes, et une commande peut venir d'un système externe sans visite.
- Toutes les données métier portent `company_id`.
- Les entités synchronisées portent les champs offline (§22).
- Les relations sont définies proprement dans le schéma Prisma.
- Le modèle reste extensible pour un futur module `PRODUCTION`, sans dépendance dans le MVP.

---

## 26. API

API REST versionnée, documentée avec **OpenAPI / Swagger**.

```text
/api/v1/auth
/api/v1/admin
/api/v1/companies
/api/v1/users
/api/v1/devices
/api/v1/plans
/api/v1/subscriptions
/api/v1/modules
/api/v1/customers
/api/v1/products
/api/v1/territories
/api/v1/visits
/api/v1/orders
/api/v1/inventory
/api/v1/deliveries
/api/v1/routes
/api/v1/reports
/api/v1/notifications
/api/v1/sync
```

- Chaque endpoint applique **isolation tenant + permissions + contrôle du module**.
- Validation des entrées, pagination, filtres, tri, gestion homogène des erreurs, rate limiting.

---

## 27. Sécurité

La sécurité est une priorité. Le backend est l'**autorité finale** pour les permissions et l'isolation des tenants.

- HTTPS ;
- hash sécurisé des mots de passe ;
- JWT, refresh tokens, expiration, rotation, révocation ;
- gestion des sessions, réinitialisation du mot de passe, MFA éventuellement ;
- RBAC avec guards backend ;
- isolation stricte par `company_id` et protection IDOR ;
- validation backend des entrées et des uploads ;
- protection contre les injections ;
- rate limiting et protection brute force ;
- secrets uniquement dans les variables d'environnement, chiffrés ;
- chiffrement des données sensibles lorsque nécessaire ;
- contrôle d'accès aux fichiers ;
- audit logs ;
- sauvegardes, monitoring, alertes.

---

## 28. Audit

```text
AuditLog
- id
- company_id
- user_id (actor)
- action
- entity (target)
- entity_id
- metadata
- ip
- user_agent
- created_at
```

Exemple :

```text
Ahmed a modifié la commande #1458 — 30/09/2026 14:32
```

À tracer :

- connexion et déconnexion ;
- création, modification, suppression ;
- changements de statut, de stock, de prix, de rôle et d'affectation ;
- activation et désactivation de module ;
- révocation d'appareil ;
- actions du support ;
- opérations importantes de stock.

Les actions plateforme vont dans `PlatformAuditLog`.

---

## 29. SaaS et commercialisation

### Statuts d'une entreprise

```text
TRIAL   ACTIVE   SUSPENDED   CANCELLED   DELETED
```

### Statuts d'un abonnement

```text
TRIAL   ACTIVE   PAST_DUE   SUSPENDED   CANCELLED   EXPIRED
```

### Plans

Les plans sont **configurables** depuis le Super Admin. Exemples : Starter, Pro, Business, Enterprise.

Paramètres d'un plan :

- modules autorisés ;
- utilisateurs, pré-vendeurs, livreurs, magasins/entrepôts maximum ;
- clients et commandes maximum ;
- espace de stockage ;
- fonctionnalités ;
- prix ;
- durée d'essai.

Les limites sont appliquées par le backend, **jamais codées en dur dans le frontend**.

```text
Company → Subscription → SubscriptionPlan → Modules autorisés → CompanyModule
```

Un abonnement couvre le plan, les dates, le statut, la période d'essai, la consommation, l'historique, l'upgrade/downgrade et le renouvellement. L'architecture de facturation est prévue dès le départ, même si le paiement en ligne n'est pas dans la première version.

---

## 30. Expérience utilisateur

**Utilisateurs terrain (mobile)** :

- gros boutons, peu de texte ;
- navigation rapide, utilisable à une main ;
- informations essentielles immédiatement visibles ;
- faible consommation de données ;
- état offline et synchronisation toujours clairs.

**Superviseurs et gérants (Web)** : tableaux, filtres, cartes, graphiques, statistiques, alertes.

L'interface reste professionnelle et simple, et respecte l'identité visuelle (§2).

---

## 31. Extensibilité et évolutions futures

### Extensions prévues

L'architecture ne doit pas rendre difficiles :

- ERP, comptabilité, facturation, CRM, e-commerce, API externes ;
- scanner de codes-barres et QR code ;
- imprimantes Bluetooth ;
- signature et paiement électroniques ;
- intelligence artificielle ;
- optimisation automatique des tournées.

### À ne pas développer au démarrage

IA complexe, optimisation avancée d'itinéraires, prédiction des ventes, géofencing avancé, facturation automatique complexe, WhatsApp, intégrations ERP/comptabilité, MDM, microservices.

### Module PRODUCTION (futur)

La production industrielle **n'est pas développée en V3**. Un futur module `PRODUCTION` pourra couvrir : matières premières, nomenclatures, ordres de fabrication, consommation, produits finis, lots, qualité, planification.

Ce futur module ne doit créer **aucune dépendance** dans le MVP.

---

## 32. Règles d'architecture et de développement

1. Toutes les données métier sont isolées par `company_id`.
2. Ne jamais faire confiance au `company_id` (ni à aucune donnée de sécurité) envoyé par le frontend.
3. Le frontend ne décide jamais seul des permissions : le backend valide les règles critiques.
4. Toujours vérifier le tenant, les permissions et le module.
5. Un module désactivé est bloqué côté backend.
6. Séparer l'UI et la logique métier : pas de logique métier importante dans les composants.
7. Centraliser les types, validations et règles métier partagés (`packages/`).
8. Une commande ne nécessite pas obligatoirement une visite.
9. Une livraison ne nécessite pas obligatoirement un pré-vendeur.
10. Le stock est basé sur des mouvements traçables, avec des transactions pour les opérations critiques.
11. Le mobile doit fonctionner hors connexion, et les opérations offline sont idempotentes.
12. Les opérations sensibles sont auditées.
13. Le Super Admin est séparé des rôles d'entreprise.
14. Ne pas coder en dur les secteurs, parties, fréquences, rôles, motifs ou limites de plan qui doivent être configurables.
15. Aucune donnée fictive codée en dur lorsqu'elle doit venir de PostgreSQL. Le seed sert uniquement au développement et aux tests.
16. Chaque fonctionnalité importante a des tests.
17. Documenter et versionner l'API.
18. Commencer par un modular monolith propre et éviter la sur-architecture du MVP.
19. Valider le flux online avant d'activer la synchronisation offline, mais concevoir le schéma offline-ready dès le départ.
20. La production industrielle n'est pas implémentée en V3.

---

## 33. Livrables avant implémentation

Avant d'écrire le code, produire :

1. l'architecture globale et le choix technologique ;
2. l'organisation du monorepo et des dossiers ;
3. le diagramme des entités et leurs relations ;
4. le schéma PostgreSQL/Prisma ;
5. la matrice des permissions (RBAC) ;
6. le fonctionnement multi-tenant ;
7. le système de modules ;
8. le système de secteurs et de carte ;
9. le moteur de planification des visites ;
10. le flux de synchronisation offline ;
11. le système de gestion des appareils ;
12. l'architecture API ;
13. la stratégie de sécurité ;
14. les flux métier complets ;
15. le roadmap de développement par étapes.

Pour chaque décision importante, expliquer brièvement pourquoi elle est retenue et quelles sont ses conséquences. Identifier les incohérences ou décisions techniques manquantes **avant** l'implémentation.

Documents attendus dans `docs/` :

```text
docs/
├── cahier-des-charges.md
├── use-cases.md
├── business-rules.md
├── architecture.md
├── database.md
├── api.md
├── rbac.md
├── modules.md
├── offline-sync.md
├── territories.md
├── super-admin.md
├── subscription.md
├── security.md
├── testing.md
├── deployment.md
└── roadmap.md
```

---

## Annexe A — Arbitrages entre les versions

Les versions précédentes se contredisaient sur certains points. Voici ce qui a été retenu à la consolidation. Les lignes marquées **(révisé en phase 0)** ont ensuite été modifiées ; la décision en vigueur est dans `docs/`.

| Sujet | Versions précédentes | Choix final | Raison |
|---|---|---|---|
| Clients, produits, commandes vs module `COMMERCIAL` | V3 rend `COMMERCIAL` optionnel, mais la configuration « sans prévendeur » (sans `COMMERCIAL`) a besoin de clients et commandes | Clients, produits et commandes de base dans un **socle commun toujours actif**. **(révisé en phase 0)** : prix, paliers, bonus, quotas et dettes passent aussi dans le socle ; `COMMERCIAL` est reporté après le MVP | Résout l'incohérence sans casser les configurations cibles |
| Statuts de commande | V1 : 6 statuts. V2 : + SUBMITTED, CANCELLED. V3 : + FAILED, RETURNED | **(révisé en phase 0)** : DRAFT, CONFIRMED, LOCKED, PREPARING, READY, OUT_FOR_DELIVERY, DELIVERED, PARTIALLY_DELIVERED, FAILED, CANCELLED (BR-CMD-02). RETURNED vient après le MVP | La journée de travail impose l'état « figée » (LOCKED) |
| Statuts de livraison | README_v1 mélange préparation et livraison | **(révisé en phase 0)** : DELIVERED, PARTIAL, FAILED (+ motif) dans le MVP ; « en route » et « arrivé » après | « À préparer / Prête » relèvent de la commande. Absent/refus deviennent des motifs d'échec |
| Statuts de visite | V1 : absent, fermé, refus comme statuts. V3 : PLANNED…CANCELLED | **(révisé en phase 0)** : PLANNED, IN_PROGRESS, COMPLETED, MISSED. Absent/fermé/refus deviennent des **motifs configurables**, et le report est remplacé par la reprogrammation | Sépare état de la visite et résultat |
| Mouvements de stock | Trois listes différentes | **(révisé en phase 0)** : IN, OUT, TRANSFER, ADJUSTMENT, RESERVATION, RELEASE dans le MVP ; l'inventaire produit des ADJUSTMENT ; RETURN après le MVP | Union des trois, ramenée aux besoins du MVP |
| États de sync | Avec ou sans SYNCING | PENDING, SYNCING, SYNCED, FAILED, CONFLICT | Plus précis pour l'indicateur |
| Format des permissions | V2 `customers.read`, V3 `CUSTOMER_READ` | `ressource.action` | Lisible, groupable par ressource |
| Plans | STARTER/PRO/ENTERPRISE ou + Business | Plans configurables, 4 exemples | Les plans sont des données, pas du code |
| Hiérarchie territoriale | V1/V2 Zone → Secteur → Partie, V3 Territory → Part | Zone → Territory (secteur) → TerritoryPart | Conserve le niveau Zone |
| Offline | README_v1 « essentiel », plan V1 « après validation online » | Schéma offline-ready dès le départ, sync activée après validation du flux online | Concilie les deux exigences |
| Cartographie | Leaflet ou Leaflet/MapLibre | Leaflet ou MapLibre, fournisseur remplaçable | |
| Nom du monorepo | `prevente/`, `prevente-saas/` | `sellwasl/` | Nom du produit |

**Entités ajoutées** lors de la consolidation, absentes des listes d'origine mais nécessaires aux fonctionnalités décrites : `Zone`, `Team`, `Session`, `PlatformUser`, `PlatformAuditLog`, `PlanModule`, `RolePermission`, `SalesRepAssignment`, `PartSchedule`, `VisitOutcomeReason`, `WarehouseLocation`, `Promotion`, `Attachment`, `SyncLog`.

---

## Annexe B — Points à valider (tranchés en phase 0)

| # | Point | Décision | Référence |
|---|---|---|---|
| 1 | Moment de la sortie de stock | Réservation au dépôt à la confirmation ; transfert vers le camion au chargement ; sortie à la livraison ; retour au dépôt au déchargement | BR-CMD-04, BR-PRE-04, BR-STK-07 |
| 2 | Encaissement | Le livreur et le vendeur cash van encaissent à la livraison ; le pré-vendeur et le vendeur cash van encaissent les dettes ; nouveau rôle `COMPTABLE` pour les versements. L'encaissement fait partie du socle | BR-PAY |
| 3 | Périmètre de `COMMERCIAL` | Prix, paliers, bonus, quotas et dettes dans le socle ; `COMMERCIAL` reporté après le MVP | §3 |
| 4 | Rayon GPS | Jamais bloquant ; « hors zone » au-delà d'une distance réglable (100 m par défaut) ; mode « par téléphone » | BR-VIS-02, BR-VIS-03 |
| 5 | Conflits hors connexion | Chaque donnée a un propriétaire : le téléphone (visites, commandes, paiements) ou le serveur (catalogue, prix, quotas). L'excédent de quota devient « en attente », l'excédent de stock « rupture » | BR-SYN-03, BR-SYN-05 |
| 6 | Fournisseur de paiement | Sans objet pour le MVP : pas de facturation SaaS | `docs/cahier-des-charges.md` §6 |

Les nouvelles décisions de la phase 0 et les règles encore à confirmer sont dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md), aux §9 et §10.
