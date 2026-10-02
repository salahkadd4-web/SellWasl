# Architecture technique — SellWasl

> **Phase 1 — validé le 2026-10-02.**
> Ce document fixe les choix techniques du MVP et tranche les points ouverts du [cahier des charges §11](cahier-des-charges.md#11-points-ouverts-pour-les-phases-suivantes). Chaque décision porte un identifiant stable (`ARC-nn`), auquel les phases suivantes font référence.
>
> Documents liés :
> - [cahier-des-charges.md](cahier-des-charges.md) : périmètre du MVP ;
> - [business-rules.md](business-rules.md) : règles métier (`BR-XXX-nn`) ;
> - [use-cases.md](use-cases.md) : cas d'utilisation (`UC-xx`).
>
> Détails dans la même phase : [database.md](database.md), [api.md](api.md), [rbac.md](rbac.md), [modules.md](modules.md).

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Synthèse des décisions](#2-synthèse-des-décisions)
3. [Stack technique](#3-stack-technique)
4. [Monorepo](#4-monorepo)
5. [Backend](#5-backend)
6. [Multi-entreprises](#6-multi-entreprises)
7. [Permissions, modules et paramètres](#7-permissions-modules-et-paramètres)
8. [Application Web](#8-application-web)
9. [Application mobile](#9-application-mobile)
10. [Hors connexion et synchronisation](#10-hors-connexion-et-synchronisation)
11. [Appareils](#11-appareils)
12. [Cartographie et polygones](#12-cartographie-et-polygones)
13. [Impression Bluetooth](#13-impression-bluetooth)
14. [Données](#14-données)
15. [Fichiers et notifications](#15-fichiers-et-notifications)
16. [Sécurité](#16-sécurité)
17. [Supervision technique](#17-supervision-technique)
18. [Environnements, CI/CD et hébergement](#18-environnements-cicd-et-hébergement)
19. [Conventions de code](#19-conventions-de-code)
20. [Thème](#20-thème)
21. [Impacts sur les règles métier](#21-impacts-sur-les-règles-métier)
22. [Points restant ouverts](#22-points-restant-ouverts)

---

## 1. Vue d'ensemble

```text
 Web (Next.js, Chrome PC et téléphone)            Mobile Android (Expo, une seule application)
 /admin : Super Admin                             Pré-vendeur · Livreur · Vendeur cash van · Magasinier
 /app   : Admin · Superviseur · Comptable                │
        │                                          SQLite local (chiffré)
        │                                          File d'opérations (outbox)
        │                                                │
        │  HTTPS, JSON                                   │  HTTPS : /sync/push, /sync/pull, /devices/heartbeat
        └──────────────────────┬─────────────────────────┘
                               ▼
                 API NestJS /api/v1 (modular monolith)
       Contexte : utilisateur → entreprise → permission → module
                               │
          ┌────────────────────┼──────────────────────┐
          ▼                    ▼                      ▼
   PostgreSQL + Prisma   Stockage objet S3      Expo Push (FCM)
                         (imports, exports,     Sentry (erreurs)
                          logos)
```

Trois principes guident tous les choix :

1. **Un seul développeur** (cahier des charges §2) : peu de technologies, toutes en TypeScript, et des services gérés plutôt que de l'infrastructure à maintenir.
2. **Le serveur a le dernier mot** (BR-SYN-03) : le téléphone enregistre des opérations métier, et le serveur les revalide (quota, stock, crédit) avant de les appliquer.
3. **Les règles métier sont écrites une seule fois**, dans `packages/business-rules`, et exécutées à l'identique par le serveur et par le téléphone hors connexion.

---

## 2. Synthèse des décisions

Toutes ces décisions ont été validées le 2026-10-02.

| ID | Sujet | Décision proposée | Point du §11 |
|---|---|---|---|
| ARC-01 | Stack | Next.js, Expo, NestJS, PostgreSQL, Prisma, Turborepo, pnpm, tout en TypeScript | — |
| ARC-02 | Isolation des entreprises | Base et schéma partagés, colonne `company_id`, filtre automatique par une extension Prisma | — |
| ARC-03 | Synchronisation | Le téléphone envoie des **opérations métier** idempotentes et reçoit les **changements** depuis un curseur | — |
| ARC-04 | Association d'un appareil | **QR code** affiché sur le Web, avec un **code de secours** à saisir ; usage unique, valable 10 minutes | Oui |
| ARC-05 | Montants | **Dinars entiers** (`BIGINT`), sans centimes | Oui |
| ARC-06 | Impression | Bluetooth classique (SPP) avec `react-native-bluetooth-classic`, et génération ESC/POS en TypeScript | Oui |
| ARC-07 | Android | Minimum imposé par la version d'Expo retenue (aujourd'hui Android 7.0) ; téléphone de référence : Android 10, 2 Go de RAM | Oui |
| ARC-08 | Performance terrain | Objectifs chiffrés au §9.4 | Oui |
| ARC-09 | Polygones | GeoJSON en `jsonb`, avec une boîte englobante pour le pré-filtrage ; calculs avec Turf ; PostGIS seulement si besoin | Oui |
| ARC-10 | Téléphone perdu | Envoi des opérations en attente autorisé après révocation ; **clôture d'office** de la journée par le superviseur | Oui |
| ARC-11 | Numéros de bons et de commandes | Code de l'utilisateur + **série de l'appareil** + séquence | — |
| ARC-12 | Paramètres de l'entreprise | Un changement prend effet au **prochain démarrage de journée** | — |
| ARC-13 | Cartes | Leaflet et Geoman sur le Web, MapLibre sur le mobile, fournisseur de tuiles remplaçable | — |
| ARC-14 | Hébergement | Services gérés en Europe, sous réserve de la vérification juridique du §18.3 | — |

---

## 3. Stack technique

| Couche | Choix | Pourquoi |
|---|---|---|
| Langage | TypeScript partout, en mode strict | Un seul langage pour le Web, le mobile, l'API et les règles partagées |
| Gestionnaire de paquets | pnpm, avec workspaces | Rapide et économe en disque ; l'application Expo exige `node-linker=hoisted` |
| Monorepo | Turborepo | Tâches en cache (lint, tests, build) ; proposé dans le README |
| Web | Next.js (App Router), Tailwind CSS, shadcn/ui, TanStack Query, TanStack Table, react-hook-form | Écosystème mûr ; composants accessibles et thémables |
| Mobile | Expo (SDK stable le plus récent), Expo Router, expo-sqlite, Drizzle ORM, react-hook-form | Une version de développement compilée (EAS) donne accès aux modules natifs : Bluetooth, carte |
| API | NestJS, nestjs-zod, nestjs-cls, nestjs-pino, @nestjs/throttler, @nestjs/schedule | Modules clairs pour un monolithe modulaire ; validation et documentation OpenAPI à partir des mêmes schémas |
| Base de données | PostgreSQL (dernière version majeure stable) | Transactions, contraintes, `jsonb` |
| ORM | Prisma | Schéma lisible, migrations, extensions de requêtes pour le filtre par entreprise |
| Validation | Zod, dans `packages/validation` | Mêmes schémas sur le Web, le mobile et l'API |
| Calculs géographiques | Turf | Point dans un polygone et distances, sur le serveur comme sur le téléphone |
| Tâches planifiées | @nestjs/schedule, sans Redis | Le MVP n'a que quelques tâches légères ; Redis et BullMQ viendront si la charge l'exige |
| Runtime | Node.js, version LTS active | Support long |

**Ce que le MVP n'utilise pas** : Redis, BullMQ, microservices, GraphQL, PostGIS, WebSockets. Le suivi en temps réel du superviseur se fait par rafraîchissement périodique (toutes les 30 secondes) : c'est suffisant pour des positions envoyées toutes les 5 minutes (BR-TEN-07).

---

## 4. Monorepo

```text
sellwasl/
├── apps/
│   ├── api/                  # NestJS
│   │   ├── prisma/           # schéma, migrations, seed
│   │   └── src/modules/      # un dossier par module métier (§5.1)
│   ├── web/                  # Next.js : /admin et /app
│   └── mobile/               # Expo : application unique, écrans selon le rôle
├── packages/
│   ├── business-rules/       # fonctions pures : prix, paliers, bonus, quotas, fréquences, statuts, géographie
│   ├── validation/           # schémas Zod : requêtes API, opérations de synchronisation, paramètres
│   ├── types/                # types partagés, déduits des schémas Zod
│   ├── config/               # ESLint, TypeScript, Prettier, tokens du thème (§20)
│   └── ui/                   # composants Web partagés (si le besoin apparaît)
├── docs/
├── .github/workflows/
├── docker-compose.yml        # PostgreSQL et MinIO pour le développement
├── .env.example
├── turbo.json
└── pnpm-workspace.yaml
```

**Règle de dépendance** : `business-rules` ne dépend d'aucun framework, ni de la base, ni du réseau. Il reçoit des données et renvoie des résultats. C'est ce qui permet au téléphone hors connexion et au serveur de calculer exactement la même chose, et de tester toutes les règles par des tests unitaires rapides, à partir des exemples chiffrés de `business-rules.md` §22.

---

## 5. Backend

### 5.1 Modules NestJS

| Module | Contenu | Module produit (BR-TEN-03) |
|---|---|---|
| `platform` | Super Admin : entreprises, mode | — |
| `auth` | Connexion, jetons, sessions | Socle |
| `devices` | Association, révocation, blocage, signal de vie | Socle |
| `companies` | Paramètres de l'entreprise, types de clients, jours fériés, motifs | Socle |
| `users` | Utilisateurs et rôles | Socle |
| `catalog` | Produits, parfums, gammes, conditionnements, prix, paliers, bonus | Socle |
| `customers` | Clients, dettes affichées | Socle |
| `territories` | Secteurs, parties, polygones, affectations, planning | Socle (dès que `PRE_SALES` ou `CASH_VAN` est actif, BR-TEN-05) |
| `workdays` | Démarrage, clôture, réouverture, clôture d'office | Idem |
| `visits` | Visites et motifs | Idem |
| `orders` | Commandes de prévente, lignes en attente | `PRE_SALES` |
| `quotas`, `objectives` | Quotas du jour, objectifs du mois | Socle |
| `inventory` | Dépôts, camions, stock, mouvements, entrées, inventaires, chargements, déchargements | `WAREHOUSE` |
| `preparation` | Tournées, lancement, préparation | `DELIVERY` |
| `deliveries` | Livraisons, échecs, reprogrammation | `DELIVERY` |
| `cashvan` | Ventes immédiates, demandes perdues | `CASH_VAN` |
| `payments` | Paiements, dettes, récapitulatifs, versements | Socle |
| `sync` | Réception des opérations, envoi des changements | Socle |
| `notifications` | Notifications internes et push | Socle |
| `imports`, `exports` | CSV | Socle / `ANALYTICS` |
| `reports` | Tableau du jour, carte du superviseur | `ANALYTICS` |
| `audit` | Journal d'audit | Socle |

### 5.2 Couches

```text
Contrôleur  → valide l'entrée (Zod), déclare la permission et le module requis
Service     → orchestre : transaction, appel aux règles métier, audit, notifications
Règles      → packages/business-rules : calculs purs, sans base ni réseau
Accès aux données → Prisma, toujours à travers le client filtré par entreprise (§6)
```

### 5.3 Contrôles de chaque requête

Dans cet ordre, sur chaque endpoint (README §7) :

1. **Authentification** : jeton valide, session non révoquée, appareil actif pour un rôle terrain.
2. **Entreprise** : déduite de la session et placée dans le contexte de la requête (`nestjs-cls`), jamais lue dans la requête (BR-TEN-02). Entreprise suspendue → refus.
3. **Permission** : décorateur `@RequirePermission('orders.create')` vérifié par un guard.
4. **Module** : décorateur `@RequireModule('PRE_SALES')`, vérifié par un guard (BR-TEN-04).
5. **Ressource** : la ressource lue appartient à l'entreprise, ce qui est garanti par le filtre automatique (§6).

Un endpoint sans décorateur de permission est refusé par défaut. Un test automatique parcourt toutes les routes et échoue si l'une d'elles n'en déclare pas.

---

## 6. Multi-entreprises

**Modèle** : une base, un schéma, une colonne `company_id` sur chaque table métier. C'est le plus simple à exploiter pour un développeur seul, et c'est suffisant pour des entreprises de quelques dizaines d'utilisateurs.

**Filtre automatique** : une extension du client Prisma lit l'entreprise dans le contexte de la requête :
- elle ajoute `company_id = <entreprise>` à toutes les lectures, mises à jour et suppressions ;
- elle renseigne `company_id` à la création, et refuse une valeur différente ;
- elle refuse toute requête sur une table métier sans entreprise dans le contexte.

Seuls le module `platform` et les tâches planifiées utilisent un client non filtré, explicitement nommé (`platformPrisma`), pour qu'aucun usage ne passe inaperçu en revue de code.

**Index** : `company_id` est la première colonne des index composites (`company_id, customer_id`, `company_id, date`…). Les numéros et codes uniques le sont par entreprise (`UNIQUE (company_id, code)`).

**Tests d'isolation** (phase 5) : pour chaque ressource, un test crée les données de l'entreprise A et vérifie qu'un utilisateur de B ne peut ni les lire, ni les modifier, ni les deviner par leur identifiant (IDOR).

**Plus tard** : la sécurité au niveau des lignes de PostgreSQL (RLS) pourra s'ajouter comme seconde barrière. Elle n'est pas dans le MVP, parce qu'elle complique Prisma (variable de session à fixer dans chaque transaction) sans changer le modèle.

---

## 7. Permissions, modules et paramètres

### 7.1 Permissions

- Permissions au format `ressource.action` (plan, phase 6), stockées en base.
- Chaque entreprise reçoit, à sa création, les rôles du MVP avec leurs permissions par défaut. La matrice complète sera dans `rbac.md`.
- Un utilisateur a un seul rôle (BR-USR-01).
- Le mobile et le Web masquent ce que l'utilisateur n'a pas le droit de faire, mais seul le serveur décide.

### 7.2 Modules

- Table `CompanyModule`. Le mode choisi par le Super Admin active les modules (BR-TEN-03).
- Les modules actifs sont envoyés au Web à la connexion et au téléphone à chaque synchronisation.

### 7.3 Paramètres réglables (BR-TEN-08)

- Stockés dans `CompanySettings` : un document `jsonb` validé par un schéma Zod de `packages/validation`, avec un numéro de version incrémenté à chaque changement.
- Chaque paramètre a une valeur par défaut dans le schéma : une nouvelle entreprise est utilisable sans réglage.
- **P-10** (le superviseur modifie les prix) est appliqué en ajoutant ou en retirant les permissions `prices.update`, `price_tiers.update` et `bonuses.update` au rôle `SUPERVISEUR`. Le contrôle reste donc un simple contrôle de permission.
- **Prise d'effet (ARC-12)** : le téléphone télécharge les paramètres au démarrage de la journée et les garde jusqu'à la clôture. Un changement fait en cours de journée s'applique à la journée suivante. Ainsi, le téléphone hors connexion et le serveur appliquent toujours la même version. Chaque journée enregistre la version des paramètres qu'elle utilise, et le serveur valide ses opérations avec cette version.

---

## 8. Application Web

- **Next.js App Router**, deux espaces : `/admin` (Super Admin) et `/app` (entreprise).
- **Même domaine que l'API** : Next.js redirige `/api/*` vers l'API. Le jeton de rafraîchissement reste dans un cookie `HttpOnly`, `Secure`, `SameSite=Strict`, sans configuration CORS.
- Rendu principalement côté client, avec TanStack Query pour les appels à l'API. Le rendu serveur se limite à la structure des pages : les données sont propres à chaque utilisateur et n'ont pas besoin de référencement.
- **Mobile d'abord** pour les écrans du superviseur et du comptable (cahier des charges §2) : navigation inférieure sur téléphone, barre latérale sur PC.
- Carte du superviseur : Leaflet, avec Leaflet-Geoman pour dessiner et modifier les polygones (§12).
- PWA : manifeste et icône dans le MVP ; pas de mode hors connexion pour le Web.

---

## 9. Application mobile

### 9.1 Structure

- **Expo**, compilé avec EAS dans une version de développement (pas Expo Go), parce que le Bluetooth et MapLibre sont des modules natifs.
- **Expo Router** : un groupe d'écrans par rôle (`(pre-vendeur)`, `(livreur)`, `(cash-van)`, `(magasinier)`). Le rôle de l'utilisateur connecté choisit le groupe, et les modules actifs masquent ce qui ne s'applique pas.
- **Les écrans lisent la base locale**, jamais l'API directement : `expo-sqlite` avec Drizzle et ses requêtes réactives. Les écrans fonctionnent donc de la même façon avec ou sans réseau.
- **Écritures** : chaque action (démarrer la journée, confirmer une commande…) modifie la base locale **et** ajoute une opération à la file d'envoi, dans une même transaction SQLite.
- Textes de l'interface dans des fichiers de traduction (i18next) dès le départ, pour préparer l'arabe et l'affichage de droite à gauche (cahier des charges §2).

### 9.2 Android (ARC-07)

- **Version minimale** : celle imposée par la version d'Expo retenue en phase 2, aujourd'hui Android 7.0. Aucune contrainte supplémentaire de notre part.
- **Téléphone de référence pour les tests** : Android 10, 2 Go de RAM, processeur d'entrée de gamme. Les objectifs de performance (§9.4) sont mesurés sur ce téléphone.
- Les permissions Bluetooth diffèrent à partir d'Android 12 (`BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`) : elles sont demandées au premier usage de l'imprimante, pas au démarrage.
- Distribution : APK installé directement pendant le pilote, puis Play Store si besoin (plan, phase 30).

### 9.3 Position

- La position est relevée **uniquement pendant la journée**, quand l'application est ouverte (cahier des charges §7) : pas de suivi en arrière-plan.
- Elle est envoyée avec le signal de vie de l'appareil (§11.3), toutes les 5 minutes par défaut (BR-TEN-07).

### 9.4 Objectifs de performance (ARC-08)

Mesurés sur le téléphone de référence, avec un secteur de 500 clients :

| Action | Objectif |
|---|---|
| Ouverture de l'application, déjà connectée | moins de 4 s |
| Liste des clients du jour triée par distance | moins de 1 s |
| Carte avec tous les clients du secteur (marqueurs regroupés) | défilement fluide, affichage en moins de 2 s |
| Ajout d'un produit au panier, avec le calcul des paliers et des bonus | moins de 200 ms |
| Confirmation d'une commande, hors connexion | moins de 1 s |
| Impression d'un bon de 20 lignes | moins de 10 s, connexion à l'imprimante comprise |
| Synchronisation d'une journée complète en 3G | moins de 30 s |
| Première synchronisation (tout le secteur) en 3G | moins de 2 min |
| Taille de l'application installée | moins de 60 Mo |

---

## 10. Hors connexion et synchronisation

### 10.1 Principe (ARC-03)

Les données appartiennent soit au téléphone, soit au serveur (BR-SYN-03). Il n'y a donc **pas de fusion de lignes** à gérer : le téléphone n'envoie jamais « voici la nouvelle version de la ligne », mais « voici ce que l'utilisateur a fait ».

```text
Téléphone                                  Serveur
──────────                                 ───────
action → base locale + file d'opérations
                    │
         réseau ?  ─┼─► POST /sync/push   ─► pour chaque opération, dans l'ordre :
                    │                         déjà reçue ? → renvoyer le même résultat
                    │                         sinon : transaction → règles → audit
                    │                     ◄── résultat de chaque opération
                    │
                    └─► GET /sync/pull?cursor=N ─► changements depuis N, selon le rôle
                                          ◄── changements + nouveau curseur
```

### 10.2 Envoi des opérations (push)

Chaque opération contient :

| Champ | Rôle |
|---|---|
| `opId` | UUID créé par le téléphone : clé d'idempotence (BR-SYN-02) |
| `deviceSeq` | Numéro d'ordre sur l'appareil : le serveur détecte un trou et refuse d'appliquer une opération avant la précédente |
| `type` | Par exemple `workday.start`, `visit.complete`, `order.confirm`, `delivery.complete`, `payment.create`, `customer.create` |
| `payload` | Données de l'action, validées par un schéma Zod partagé |
| `occurredAt` | Date et heure de l'action sur le téléphone |
| `workdayId`, `settingsVersion` | Journée et version des paramètres en vigueur (ARC-12) |

Le serveur répond, pour chaque opération :
- `APPLIED` : appliquée telle quelle ;
- `APPLIED_WITH_CHANGES` : appliquée avec une transformation, par exemple un excédent de quota passé en attente, ou une ligne en rupture (BR-SYN-05). Le téléphone reçoit le détail et l'affiche au vendeur ;
- `REJECTED` : refusée, avec un motif. L'opération reste visible sur le téléphone et dans le journal de synchronisation ; rien n'est supprimé en silence.

Le serveur enregistre chaque `opId` reçu, avec son résultat, dans une table `SyncOperation` (`UNIQUE (company_id, op_id)`). Une opération renvoyée après une coupure réseau reçoit le même résultat, sans être appliquée deux fois.

### 10.3 Réception des changements (pull)

- Chaque table synchronisée a une colonne `change_seq`, alimentée par une séquence PostgreSQL à chaque création ou modification. Le curseur du téléphone est le dernier `change_seq` reçu.
- On n'utilise pas les dates : les horloges des téléphones et du serveur ne sont pas fiables pour ordonner des changements.
- Les suppressions sont des suppressions logiques (`deleted_at`), envoyées comme les autres changements.
- Le serveur filtre selon le rôle et le périmètre de l'utilisateur (BR-SYN-04) : les clients de son secteur, sa tournée, le stock de son camion…
- La première synchronisation télécharge tout le périmètre, page par page.

### 10.4 Déclenchement

- Automatiquement : au retour du réseau, au démarrage et à la clôture de la journée, et après chaque opération si le réseau est disponible.
- Manuellement : bouton « Synchroniser » (UC-04).
- Pas de synchronisation en arrière-plan quand l'application est fermée (cahier des charges §7).

### 10.5 Dates de la journée

La date d'une journée est celle du téléphone au démarrage. Le serveur enregistre aussi l'heure de réception, et signale au superviseur un écart de plus d'une heure entre l'heure du téléphone et la sienne : c'est le signe d'une horloge mal réglée.

---

## 11. Appareils

### 11.1 Association (ARC-04)

1. Sur le Web, le superviseur choisit l'utilisateur et clique sur « Associer un appareil ».
2. Le Web affiche un **QR code** et, en dessous, le même **code de secours de 8 caractères**. Le code est à usage unique et valable 10 minutes.
3. Sur le téléphone, l'utilisateur scanne le QR code, ou saisit le code de secours.
4. Il choisit son mot de passe, ou le saisit s'il en a déjà un.
5. Le serveur enregistre l'appareil, révoque l'ancien (BR-USR-07) et lui attribue une **nouvelle série** pour les numéros (§11.4).

Pourquoi un QR code : la saisie est impossible à rater, et le superviseur peut associer un téléphone en face à face sans dicter de code. Le code de secours couvre le cas d'un appareil photo en panne.

### 11.2 Connexion

- Les rôles terrain se connectent seulement sur leur appareil associé. Le jeton de rafraîchissement est lié à l'appareil.
- Le mot de passe est redemandé après 30 jours sans connexion au serveur, ou après une révocation.

### 11.3 Signal de vie

Pendant la journée, le téléphone envoie toutes les 5 minutes, quand le réseau le permet : la batterie, le nombre d'opérations en attente, la dernière position et la version de l'application (BR-JOU-09). Le tableau du jour du superviseur (UC-57) se construit à partir de ces signaux.

### 11.4 Numéros de bons et de commandes (ARC-11)

Format : **code de l'utilisateur + série de l'appareil + séquence**, par exemple `V07-B0042`.

- La série (`A`, `B`, `C`…) change à chaque nouvelle association d'appareil.
- Deux téléphones ne peuvent donc jamais produire le même numéro, même si l'ancien téléphone a encore des bons non synchronisés au moment du remplacement.
- Le numéro reste court et lisible sur un ticket de 58 mm.

### 11.5 Téléphone perdu ou cassé (ARC-10)

| Situation | Ce qui se passe |
|---|---|
| L'ancien téléphone est retrouvé après la révocation | Il ne peut plus rien faire de nouveau, mais il peut encore **envoyer ses opérations en attente** créées avant la révocation. Ensuite, il efface ses données locales. |
| L'ancien téléphone est perdu, et sa journée est restée ouverte | Le superviseur fait une **clôture d'office** de la journée sur le Web, avec un motif. Les visites prévues non faites passent manquées ; le récapitulatif est calculé avec les opérations reçues. L'action est auditée. |
| Des opérations de l'ancien téléphone arrivent après une clôture d'office | Elles sont acceptées, puisqu'elles ont réellement eu lieu, et signalées au superviseur. Le récapitulatif et le montant attendu sont recalculés, et le comptable est prévenu si le versement est déjà enregistré. |
| Vol du téléphone | La base locale est **chiffrée** (SQLCipher par expo-sqlite), et sa clé est gardée dans le coffre-fort d'Android (expo-secure-store). La révocation coupe l'accès à l'API. |

---

## 12. Cartographie et polygones

### 12.1 Bibliothèques (ARC-13)

| Usage | Choix | Pourquoi |
|---|---|---|
| Web : carte du superviseur, dessin des secteurs et des parties | Leaflet + Leaflet-Geoman (version gratuite) | Dessin et modification de polygones prêts à l'emploi |
| Mobile : clients du jour, tournée | MapLibre React Native | Rendu natif fluide avec des centaines de marqueurs regroupés |
| Itinéraire | Ouverture de Google Maps sur le téléphone (UC-10) | Rien à développer |

- Les tuiles viennent d'un fournisseur unique, configuré par une variable d'environnement : le fournisseur reste remplaçable (README §5). Les serveurs publics d'OpenStreetMap interdisent l'usage intensif par une application ; on utilisera un fournisseur commercial avec une offre gratuite pour le pilote (par exemple MapTiler ou Stadia Maps), puis un hébergement des tuiles si le volume le justifie.
- **Hors connexion**, la carte n'affiche pas le fond de plan, mais la **liste** des clients du jour, triée par distance, fonctionne toujours : la distance est calculée sur le téléphone.

### 12.2 Polygones (ARC-09)

- Stockés en **GeoJSON**, dans une colonne `jsonb`, avec quatre colonnes de boîte englobante (`min_lat`, `max_lat`, `min_lng`, `max_lng`) qui éliminent vite les parties trop éloignées.
- Coordonnées en WGS 84. Attention à l'ordre : GeoJSON écrit **longitude puis latitude**, Leaflet attend latitude puis longitude. La conversion se fait à un seul endroit, dans `packages/business-rules/geo`.
- Le calcul « dans quelle partie est ce client » (BR-ORG-04) utilise Turf, sur le serveur comme sur le téléphone.
- Ordre de grandeur : quelques dizaines de parties par entreprise, quelques milliers de clients. Tout tient en mémoire, et PostGIS n'apporterait rien au MVP.

---

## 13. Impression Bluetooth

### 13.1 Choix (ARC-06)

Les imprimantes thermiques portables vendues sur le marché algérien utilisent presque toutes le **Bluetooth classique** (profil série SPP) et le langage **ESC/POS**. On sépare les deux problèmes :

| Partie | Choix |
|---|---|
| Transport Bluetooth | `react-native-bluetooth-classic` : appairage, connexion SPP, envoi d'octets |
| Mise en page du ticket | Générée en TypeScript avec un encodeur ESC/POS (par exemple `@point-of-sale/receipt-printer-encoder`), dans un module `printing` de l'application |
| Modèle de ticket | Fonction pure : bon ou récapitulatif → lignes de texte de 32 caractères (58 mm) ou 48 caractères (80 mm) |

Pourquoi cette séparation : les bibliothèques qui font tout en un sont souvent abandonnées. Ici, chaque partie est remplaçable. Le modèle de ticket se teste sans imprimante, et l'impression d'une image (logo, puis textes en arabe) reste possible avec le même encodeur.

### 13.2 Tests sur imprimantes réelles (phase 2)

- Au moins **une imprimante 58 mm et une 80 mm**, achetées localement parmi les modèles les plus vendus aux distributeurs.
- Vérifier : appairage, reconnexion automatique, accents français, ticket long, coupure de la connexion pendant l'impression, et téléphone sous Android 12 ou plus récent.
- L'impression est le principal risque technique du projet : c'est pourquoi elle est testée dès la phase 2, avant tout développement métier.

---

## 14. Données

| Sujet | Décision |
|---|---|
| Identifiants | UUID v7, générés par le téléphone ou le serveur. Ils sont ordonnés dans le temps, ce qui garde les index compacts. |
| Champs des données synchronisées | `id`, `company_id`, `created_at`, `updated_at`, `deleted_at`, `version`, `change_seq`, `created_by_user_id`, `created_by_device_id` (BR-USR-09) |
| **Montants (ARC-05)** | Entiers en **dinars**, type `BIGINT`, sans centimes. Chaque unité de vente a son propre prix en DA (BR-CAT-04) : un montant est toujours une quantité entière multipliée par un prix entier, donc toujours un nombre entier de dinars. Le seul calcul qui peut donner une fraction, la prime d'objectif (BR-OBJ-03), est arrondi au dinar le plus proche. La TVA, après le MVP, demandera ses propres règles d'arrondi. |
| Quantités | Entiers en **unité de base** (BR-CAT-02). La conversion depuis les conditionnements se fait dans `business-rules`. |
| Dates et heures | Instants en UTC (`timestamptz`). Dates métier (journée, livraison, quota) en type `date`, dans le fuseau de l'entreprise (`Africa/Algiers` par défaut). |
| Stock | Le stock est un cumul de mouvements (BR-STK-03) : la table `Stock` est mise à jour dans la même transaction que chaque mouvement, et une vérification peut toujours la recalculer à partir des mouvements. Verrou de ligne (`SELECT … FOR UPDATE`) sur le stock concerné, pour que deux réservations simultanées ne vendent pas la même marchandise. |
| Prix figés | Les lignes de commande copient le prix, le palier et la règle de bonus appliqués (BR-CAT-09) : un changement de prix ne modifie pas l'historique. |
| Suppression | Logique (`deleted_at`) pour les données synchronisées ; aucune donnée métier n'est supprimée physiquement. |
| Sauvegardes | Sauvegarde quotidienne de la base, avec restauration point dans le temps si l'hébergeur le propose ; restauration testée avant le pilote. |

Le détail des tables sera dans `database.md`.

---

## 15. Fichiers et notifications

### 15.1 Fichiers

- Stockage objet compatible S3 (MinIO en développement). Dans le MVP : fichiers CSV importés, exports, logo de l'entreprise pour l'en-tête des bons.
- Chaque fichier est rangé sous `companies/<company_id>/…`, et n'est accessible que par un lien signé, valable quelques minutes, délivré par l'API après le contrôle des droits.

### 15.2 Notifications

- **Internes** : table `Notification`, lue par le Web (cloche) et par le téléphone (à la synchronisation).
- **Push sur le mobile** : Expo Push, qui s'appuie sur Firebase Cloud Messaging. Une interface `PushProvider` permet de passer à FCM direct si besoin.
- Email, SMS et WhatsApp viennent après le MVP, derrière la même interface (plan, phase 24).

---

## 16. Sécurité

| Sujet | Décision |
|---|---|
| Mots de passe | Argon2id |
| Jetons | Jeton d'accès de 15 minutes ; jeton de rafraîchissement de 30 jours, à **rotation** à chaque usage, stocké haché en base. Si un jeton déjà utilisé est présenté de nouveau, toute la session est révoquée. |
| Web | Jeton de rafraîchissement en cookie `HttpOnly` ; jeton d'accès en mémoire, jamais dans `localStorage` |
| Mobile | Jetons dans expo-secure-store ; base locale chiffrée (§11.5) |
| Force brute | Limitation par compte et par adresse IP (@nestjs/throttler) ; blocage temporaire après 5 échecs |
| Entrées | Toutes validées par Zod ; requêtes Prisma paramétrées ; taille des imports CSV limitée |
| Transport | HTTPS partout ; en-têtes de sécurité (Helmet) |
| Secrets | Variables d'environnement, jamais dans le dépôt ; `.env.example` sans valeur réelle |
| Audit | Table `AuditLog` en ajout seul : l'application n'a pas le droit de modifier ni de supprimer une ligne d'audit |
| Comptes plateforme | Table et connexion séparées pour le Super Admin (`PlatformUser`) |

Le détail sera dans `security.md` (phase 27).

---

## 17. Supervision technique

- **Erreurs** : Sentry sur l'API, le Web et le mobile, avec l'entreprise et l'utilisateur en contexte, mais sans données personnelles.
- **Journaux** : JSON structurés (pino), avec un identifiant de requête et l'entreprise.
- **Santé** : endpoint `/api/v1/health` (API et base), surveillé par un service de surveillance de disponibilité externe.
- **Synchronisation** : les opérations refusées et les appareils qui n'ont pas synchronisé depuis plus d'une journée remontent dans le journal de synchronisation (BR-SYN-07).

---

## 18. Environnements, CI/CD et hébergement

### 18.1 Environnements

| Environnement | Usage | Données |
|---|---|---|
| `development` | Poste du développeur, `docker-compose` | Seed : deux entreprises, l'une en prévente, l'autre en cash van (plan, phase 3) |
| `staging` | Recette, tests sur téléphones réels | Seed et données de démonstration |
| `production` | Entreprise pilote | Données réelles |

### 18.2 CI/CD (GitHub Actions)

```text
Pull request → installation → lint → vérification des types → tests unitaires
             → tests d'intégration (PostgreSQL en service) → build
main         → déploiement automatique en staging
tag vX.Y.Z   → déploiement en production ; build Android avec EAS
```

Branches : `main` et des branches de travail (`feature/…`, `fix/…`). Pour un développeur seul, une branche `develop` en plus de `main` n'apporte rien : le rôle de `develop` est tenu par l'environnement de staging. C'est une simplification par rapport au plan (phase 29).

### 18.3 Hébergement (ARC-14)

Proposition : des **services gérés**, pour ne pas administrer de serveurs.

| Partie | Proposition |
|---|---|
| Web | Vercel, ou l'API et le Web dans des conteneurs chez le même hébergeur |
| API | Conteneur Docker chez un hébergeur européen (Paris ou Francfort, à faible latence depuis l'Algérie) |
| PostgreSQL | Base gérée chez le même hébergeur, avec sauvegardes automatiques |
| Stockage objet | Compatible S3, chez le même hébergeur |

**À vérifier avant la mise en production** : la loi algérienne n° 18-07 du 10 juin 2018 sur la protection des données à caractère personnel encadre le transfert de ces données hors d'Algérie. Les fiches clients et les positions des employés en sont. Il faut confirmer, avec un juriste et l'entreprise pilote, si un hébergement en Europe est possible ou si un hébergeur algérien est nécessaire. L'architecture ne dépend d'aucun service propre à un hébergeur, pour garder ce choix ouvert.

---

## 19. Conventions de code

| Sujet | Convention |
|---|---|
| Langue | Code, noms de tables et commits en anglais ; interface et documentation en français |
| Formatage | Prettier ; ESLint avec les règles TypeScript strictes ; vérifiés en CI |
| Nommage | `camelCase` en TypeScript et en JSON ; `snake_case` en base (`@map` de Prisma) ; codes en `SCREAMING_SNAKE_CASE` (`PRE_SALES`, `LOCKED`) |
| API | REST, préfixe `/api/v1`, ressources au pluriel en `kebab-case` ; erreurs au format unique `{ code, message, details }` ; pagination par curseur |
| Règles métier | Chaque fonction de `business-rules` cite la règle qu'elle implémente (`// BR-CAT-06`) et a des tests qui reprennent les exemples chiffrés |
| Tests | Vitest pour `business-rules` et `validation` ; Jest pour NestJS ; tests d'intégration sur une vraie base PostgreSQL ; Playwright pour les parcours Web principaux |
| Commits | Messages au format Conventional Commits (`feat:`, `fix:`, `docs:`…) |

---

## 20. Thème

Les couleurs du logo (README §2) sont définies une seule fois dans `packages/config/theme` :

```ts
export const colors = {
  primary:     '#001850', // bleu marine : textes, boutons principaux
  textDark:    '#00043C',
  accent:      '#00BCBC', // turquoise : fonds, icônes, boutons ; jamais du texte courant (contraste 2,3:1)
  deepBlue:    '#012E8E',
  gradient:    ['#0053F6', '#01ADDC', '#01CCCD', '#37E9AB'],
  background:  '#FFFFFF',
} as const;
```

- Le Web les utilise à travers un preset Tailwind et les variables CSS de shadcn/ui.
- Le mobile les importe directement.
- S'y ajoutent des couleurs d'état communes : synchronisé, en attente, erreur, client visité (vert), client à visiter (rouge).
- Police : Poppins (licence libre OFL), chargée sur le Web et embarquée dans l'application mobile.

---

## 21. Impacts sur les règles métier

Ces décisions ont été reportées le 2026-10-02 dans `business-rules.md` et `use-cases.md` :

| Décision | Règle ou cas concerné | Changement |
|---|---|---|
| ARC-04 | BR-USR-07, UC-01, UC-59 | Association par QR code ou code de secours, à usage unique et valable 10 minutes |
| ARC-10 | BR-JOU-10, BR-USR-11, UC-64 | Nouvelle action du superviseur : **clôture d'office** d'une journée, avec un motif, auditée ; opérations tardives acceptées et signalées |
| ARC-10 | BR-USR-05 | Ajout de la clôture d'office à la liste des actions du superviseur sur les équipes |
| ARC-11 | BR-CMD-07, BR-IMP-04 | Numéro = code de l'utilisateur + série de l'appareil + séquence |
| ARC-12 | BR-TEN-08 | Un changement de paramètre prend effet au prochain démarrage de journée |
| ARC-05 | Conventions, BR-OBJ-03 | Montants en dinars entiers ; prime d'objectif arrondie au dinar |
| §10.5 | BR-JOU-11 | Écart d'horloge de plus d'une heure signalé au superviseur |

---

## 22. Points restant ouverts

| Point | Quand |
|---|---|
| Choix des imprimantes à acheter pour les tests (une 58 mm, une 80 mm) | Début de la phase 2 |
| Fournisseur de tuiles de carte | Phase 2 |
| Hébergement en Europe ou en Algérie, selon la loi 18-07 | Avant la phase 30 (déploiement) |
| Hébergeur précis | Phase 29 |
| Facturation fiscale (TVA, factures légales) | Après le MVP |
