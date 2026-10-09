# PLAN VF — SellWasl, plateforme SaaS modulaire de prévente, distribution, stock et livraison

> **One Platform. Every Flow.**

Version finale consolidée de `plan.md` (V1), `plan_v2.md` (V2) et `plan_v3.md` (V3). La spécification fonctionnelle complète se trouve dans [README_vf.md](README_vf.md). Les arbitrages entre versions sont dans son **Annexe A**.

> **Phase 0 terminée (2026-10-01), complétée le 2026-10-02** : parfums des produits, règles réglables par entreprise, règles déduites validées. Le périmètre du MVP est fixé dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md), avec les [cas d'utilisation](docs/use-cases.md) et les [règles métier](docs/business-rules.md). Les tâches ajoutées par la phase 0 sont regroupées sous « **Ajouts phase 0** » dans chaque phase. Les tâches marquées « *(après le MVP)* » ne font pas partie du MVP.

---

## Vision

Construire une plateforme SaaS B2B **multi-tenant, modulaire et évolutive** pour les entreprises de vente terrain, de distribution et de logistique :

```text
Planification territoriale → Visites → Prévente → Commande → Préparation → Stock → Livraison → Encaissement → Analyse
```

La plateforme comprend :

- une **Web App** responsive/PWA : `/admin` pour la plateforme, `/app` pour les administrateurs, superviseurs et comptables. Ces rôles utilisent uniquement le Web, dans Chrome sur PC ou sur téléphone ;
- une **application mobile unique**, Android pour le MVP, pour les pré-vendeurs, livreurs, vendeurs cash van et magasiniers ;
- une **API backend centrale** (NestJS, modular monolith) ;
- **PostgreSQL + Prisma** multi-tenant ;
- la **cartographie** des secteurs, des parties (polygones) et des tournées ;
- l'**offline-first** et la synchronisation pour le terrain ;
- l'**impression Bluetooth** des bons et des récapitulatifs ;
- la **gestion SaaS** : entreprises et modes de vente ; plans et abonnements après le MVP.

### Modules et modes

```text
Socle commun (toujours actif) : entreprise, utilisateurs, rôles, appareils, clients et types de clients,
                                produits, prix, paliers, bonus, quotas, objectifs, commandes,
                                paiements, dettes, versements, notifications, audit
PRE_SALES   Prévente
DELIVERY    Livraison au jour ouvré suivant
CASH_VAN    Vente au camion (vente + livraison immédiates)
WAREHOUSE   Entrepôt / Stock (dépôts et camions)
ANALYTICS   Tableau de bord du jour, exports CSV
COMMERCIAL  Gestion commerciale avancée (après le MVP)
PRODUCTION  Futur, hors V3

Modes : Prévente = PRE_SALES + DELIVERY + WAREHOUSE + ANALYTICS
        Cash van = CASH_VAN + WAREHOUSE + ANALYTICS
        Mixte    = les deux
```

---

## Principes de réalisation

1. **Ne pas développer tous les modules en même temps.** Avancer phase par phase.
2. **Online d'abord**, avec un schéma **offline-ready** dès le départ (UUID, `version`, `updated_at`, `deleted_at`, idempotency keys). La synchronisation est activée une fois le flux métier online validé.
3. Chaque phase a des **tâches**, des **livrables** et un **critère de validation**.
4. Commencer par un **modular monolith** propre. Pas de microservices.
5. Le backend est l'autorité finale : tenant, permissions, modules, règles métier.

---

# PHASE 0 — Cahier des charges

## Objectif

Définir précisément le fonctionnement du produit avant de coder.

## Tâches

- [x] Définir les acteurs et utilisateurs
- [x] Définir les rôles plateforme et entreprise (+ `VENDEUR_CASH_VAN`, `COMPTABLE`)
- [x] Définir les cas d'utilisation (49 cas, UC-01 à UC-90 ; 50 avec UC-64, ajouté en phase 1)
- [x] Définir les modules et le socle commun (+ `CASH_VAN` ; `COMMERCIAL` reporté)
- [x] Définir les workflows : prévente et cash van
- [x] Définir le cycle de commande (journée de travail, statut `LOCKED`)
- [x] Définir le cycle de livraison (jour ouvré suivant, camion comme entrepôt)
- [x] Définir le fonctionnement des secteurs et des parties (polygones, types de clients servis)
- [x] Définir les fréquences de visite (1, 2 ou 4 semaines)
- [x] Définir les règles de stock (réservation, chargement, sortie, déchargement)
- [x] Définir le fonctionnement offline (propriété des données)
- [x] Définir les règles de gestion des appareils
- [x] Définir les permissions
- [x] Définir les statistiques nécessaires (tableau du jour, exports CSV, objectifs)
- [x] Définir les notifications
- [x] Définir la sécurité et les contraintes techniques
- [x] Définir le modèle SaaS : modes de vente ; plans et abonnements reportés après le MVP
- [x] Définir les limites du MVP
- [x] Trancher les points de l'Annexe B du README
- [x] Rendre réglables par entreprise les règles qui varient d'une entreprise à l'autre (BR-TEN-08, 2026-10-02)
- [x] Valider les valeurs par défaut des paramètres P-01 à P-10, et les 7 règles fixes (cahier des charges §10, 2026-10-02)
- [x] Ajouter les parfums des produits : stock, quota et prix éventuellement propres (2026-10-02)

## Flux principaux

```text
Prévente :
Superviseur → Secteur → Partie → Planning → Pré-vendeur : journée → visite → commande → clôture
 → Superviseur : lignes en attente → préparation → Magasinier : préparation → chargement
 → Livreur (jour ouvré suivant) : réception → livraison → encaissement → bon → clôture
 → Magasinier : déchargement → Comptable : versement

Cash van :
Chargement du camion → Vendeur : réception → visite → vente + livraison + encaissement + bon
 → clôture → Magasinier : déchargement → Comptable : versement
```

## Livrables

- [x] `docs/cahier-des-charges.md`
- [x] `docs/use-cases.md`
- [x] `docs/business-rules.md`
- [x] Diagrammes de flux (cahier des charges §4)
- [x] Liste des fonctionnalités MVP (cahier des charges §5)
- [x] Liste des fonctionnalités futures (cahier des charges §6)

---

# PHASE 1 — Architecture technique

> **Phase 1 terminée (2026-10-02).** Décisions dans [docs/architecture.md](docs/architecture.md) ; détails dans [database.md](docs/database.md), [api.md](docs/api.md), [rbac.md](docs/rbac.md) et [modules.md](docs/modules.md).

## Tâches

- [x] Valider la stack (Next.js, Expo, NestJS, PostgreSQL, Prisma)
- [x] Définir l'architecture monorepo
- [x] Définir l'architecture backend (modules NestJS)
- [x] Définir l'architecture Web (`/admin`, `/app`)
- [x] Définir l'architecture mobile (application unique multi-rôles)
- [x] Définir le système multi-tenant
- [x] Définir le système RBAC (`docs/rbac.md`)
- [x] Définir le système de modules (`CompanyModule` ; `PlanModule` après le MVP) (`docs/modules.md`)
- [x] Définir la stratégie offline et synchronisation
- [x] Définir la stratégie cartographique (Leaflet ou MapLibre, fournisseur remplaçable)
- [x] Définir le stockage des fichiers (stockage objet)
- [x] Définir les notifications (fournisseurs remplaçables)
- [x] Définir le monitoring
- [x] Définir la stratégie de sécurité
- [x] Définir le CI/CD et les environnements
- [x] Définir les conventions de code
- [x] Définir les tokens de thème à partir de l'identité visuelle (README §2)

**Ajouts phase 0** (points ouverts du cahier des charges §11)

- [x] Choisir le mécanisme d'association d'un appareil à un profil : QR code ou code de secours (ARC-04)
- [x] Fixer la version minimale d'Android (ARC-07) ; imprimantes à acheter en phase 2
- [x] Choisir la bibliothèque d'impression ESC/POS en Bluetooth pour Expo (ARC-06)
- [x] Fixer les objectifs chiffrés de performance sur le terrain (ARC-08)
- [x] Fixer la précision des montants : dinars entiers (ARC-05)
- [x] Valider le stockage des polygones en GeoJSON, avec Turf dans `packages/business-rules` (ARC-09)
- [x] Prévoir le cas du téléphone perdu avec des opérations non synchronisées (ARC-10, BR-JOU-10, BR-USR-11)

## Architecture cible

```text
Web Next.js / PWA ─┐
                   ├──→ API NestJS /api/v1 ──→ PostgreSQL + Prisma
Mobile Expo        │                      ├──→ Redis / BullMQ (optionnel)
 └─ SQLite ─ Sync ─┘                      └──→ Stockage objet
```

## Livrables

- [x] `docs/architecture.md` (architecture globale et diagramme technique), validé le 2026-10-02
- [x] Architecture des dossiers
- [x] `docs/api.md` (architecture API)
- [x] Stratégie de données (`docs/database.md`)

---

# PHASE 2 — Initialisation du monorepo

## Structure

```text
sellwasl/
├── apps/
│   ├── web/
│   ├── mobile/
│   └── api/
│       └── prisma/
├── packages/
│   ├── ui/
│   ├── types/
│   ├── config/
│   ├── validation/
│   └── business-rules/
├── docs/
├── .env.example
├── docker-compose.yml
├── package.json
├── turbo.json
└── README.md
```

## Tâches

- [x] Créer le repository GitHub
- [x] Créer le monorepo (Turborepo + pnpm)
- [x] Configurer TypeScript
- [ ] Configurer ESLint et Prettier (Prettier fait ; ESLint à ajouter)
- [x] Créer l'application Web (Next.js, Tailwind ; shadcn/ui à l'arrivée des premiers écrans)
- [x] Créer l'application mobile (Expo, Expo Router)
- [x] Créer l'API NestJS (endpoint `/api/v1/health`)
- [x] Configurer PostgreSQL (Docker)
- [x] Configurer Prisma (7, adaptateur `pg`, première migration)
- [x] Configurer Docker et `docker-compose.yml` (PostgreSQL ; stockage S3 ajouté plus tard)
- [x] Créer `.env.example`
- [ ] Configurer les environnements (development, staging, production)
- [x] Configurer les scripts de développement
- [ ] Configurer les tests (reporté : priorité au développement)
- [x] Configurer la CI (format, build, type check ; tests et lint à ajouter)
- [x] Intégrer les tokens de couleurs SellWasl dans `packages/config`

**Ajouts phase 0**

- [x] Cibler Android uniquement pour le MVP
- [x] Mettre en place une version de développement compilée de l'application (EAS, `eas.json`), à la place d'Expo Go : elle est nécessaire pour le module natif d'impression Bluetooth
- [ ] Vérifier qu'une impression de test fonctionne sur une imprimante thermique réelle (écran « Tester l'imprimante » prêt ; reste à l'essayer avec les imprimantes)

## Critère de validation

```text
Web    → démarre
Mobile → démarre
API    → démarre
DB     → accessible
CI     → verte
```

---

# PHASE 3 — Base de données (PostgreSQL + Prisma)

## Premières entités (fondation)

```text
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
PlatformUser
SubscriptionPlan
PlanModule
Subscription
PlatformAuditLog
AuditLog
```

## Entités métier

```text
Zone
Territory
TerritoryPart
SalesRepAssignment
PartSchedule
Customer
CustomerContact
CustomerAddress
Product
ProductCategory
ProductVariant     (parfum)
ProductPrice
Promotion
VisitSchedule
Visit
VisitOutcomeReason
Order
OrderItem
Warehouse
WarehouseLocation
Stock
StockMovement
Delivery
DeliveryItem
Route
Payment
Attachment
Notification
SyncLog
```

**Ajouts phase 0**

```text
Holiday            CustomerType       ProductPackaging   PriceTier
BonusRule          WorkDay            Quota              LostDemand
Objective          Load / Unload      Settlement
```

Le camion est un `Warehouse` de type `TRUCK`. Le stock, les quotas et les lignes de commande pointent vers un article : un parfum (`ProductVariant`), ou un produit sans parfum (BR-CAT-13). Les lignes en attente sont des `OrderItem` avec un statut particulier. Plusieurs entités de la liste ci-dessus ne serviront qu'après le MVP (`Zone`, `Promotion`, `WarehouseLocation`, `SubscriptionPlan`, `Subscription`…) : on ne les crée dans le schéma que si une phase du MVP en a besoin.

## Règles

```text
Toutes les données métier → company_id
Entités synchronisables  → id UUID, created_at, updated_at, deleted_at, version
Customer ≠ Visit ≠ Order
```

## Tâches

- [x] Écrire le schéma Prisma (61 tables, `apps/api/prisma/schema.prisma`)
- [x] Définir les relations et index (`company_id` en tête des index composites)
- [x] Ajouter les champs offline-ready sur les entités synchronisables (triggers `change_seq` et `version`)
- [x] Créer les migrations
- [x] Créer un seed de développement : 2 entreprises minimum pour tester l'isolation, une en prévente et une en cash van, avec les données des exemples chiffrés de `docs/business-rules.md` §22
- [x] Rédiger `docs/database.md` avec le diagramme des entités (phase 1, 2026-10-02)

## Critère de validation

- [x] Migrations applicables sur une base vide
- [x] Seed fonctionnel (invariants de stock et de dette vérifiés)
- [ ] Diagramme des entités validé (Figma, page « 01 · Base de données »)

---

# PHASE 4 — Authentification

## Tâches

- [x] Login / logout (Web, mobile, Super Admin)
- [x] Hash sécurisé des mots de passe (Argon2id)
- [x] Access token et refresh token
- [x] Expiration et rotation des tokens (réutilisation d'un ancien jeton → session révoquée)
- [x] Révocation
- [x] Sessions
- [x] Liaison session ↔ appareil
- [ ] Réinitialisation du mot de passe et récupération de compte (changement de mot de passe fait ; réinitialisation par l'admin en phase 9)
- [ ] Activation et désactivation d'un utilisateur
- [x] Authentification séparée des comptes plateforme (`PlatformUser`)
- [ ] MFA éventuellement *(après le MVP)*

**Ajouts phase 0**

- [x] Un seul appareil actif par utilisateur terrain ; associer un nouvel appareil révoque l'ancien (BR-USR-06, BR-USR-07)
- [x] Le superviseur associe un profil à un appareil depuis le Web, par QR code ou code de secours (UC-01, UC-59)
- [x] Les rôles terrain n'ont accès qu'au mobile, et les rôles de gestion qu'au Web (BR-USR-02)
- [ ] Chaque opération enregistre l'utilisateur **et** l'appareil (BR-USR-09)

## Contexte authentifié

```text
user_id
company_id (scope tenant) ou scope plateforme
roles
permissions
modules actifs
```

## Critère de validation

- [x] Authentification fonctionnelle (Web et mobile)
- [x] Refresh et révocation testés (parcours vérifiés sur l'API et dans un navigateur)

---

# PHASE 5 — Multi-tenant

## Contrôle de chaque requête métier

```text
User → Company → Permission → Module → Resource
```

## Tâches

- [x] Déduire `company_id` du contexte authentifié, **jamais du client**
- [x] Filtrage tenant systématique dans les services et requêtes Prisma (client filtré `TENANT_PRISMA`)
- [x] Protection IDOR (accès par id d'une autre entreprise)
- [ ] Isolation des fichiers et du stockage par entreprise (avec le stockage objet)

## Test critique

```text
Company A → accès aux données de Company B
=> DENIED
```

## Critère de validation

- [x] Tests automatisés d'isolation multi-tenant (client filtré et API ; à compléter avec chaque nouvelle ressource)

---

# PHASE 6 — RBAC

## Rôles

```text
Plateforme : SUPER_ADMIN   (SUPPORT, FINANCE, TECH_ADMIN après le MVP)
Entreprise Web    : COMPANY_ADMIN   SUPERVISEUR   COMPTABLE
Entreprise mobile : PRE_VENDEUR     LIVREUR       VENDEUR_CASH_VAN   MAGASINIER
```

Un utilisateur a un seul rôle. Le superviseur ne modifie jamais une commande, une vente, une visite ou un paiement (BR-USR-05).

## Permissions (format `ressource.action`)

```text
companies.read  companies.create  companies.update  companies.suspend
users.read  users.create  users.update  users.disable
devices.read  devices.update
modules.read  modules.update
customers.read  customers.create  customers.update  customers.delete
products.read  products.create  products.update
territories.read  territories.update
visits.read  visits.create  visits.update
orders.read  orders.create  orders.update
inventory.read  inventory.update
deliveries.read  deliveries.update
workdays.read  workdays.reopen
quotas.read  quotas.update
objectives.read  objectives.update
loads.read  loads.create  loads.confirm
payments.read  payments.create
settlements.read  settlements.create
reports.read  reports.export
subscriptions.read  subscriptions.update
platform.monitoring.read  platform.audit.read  platform.support
```

## Tâches

- [x] Rôles et permissions configurables (non codés en dur)
- [x] Guards NestJS d'autorisation (refus par défaut, interdits absolus, P-08 et P-10)
- [x] Matrice rôles × permissions (`docs/rbac.md` §5)
- [x] Masquage des écrans selon les permissions (Web et mobile)

## Livrable

- [x] `docs/rbac.md`

## Critère de validation

- [x] Tests RBAC : chaque rôle n'accède qu'à ses permissions

---

# PHASE 7 — Système de modules

C'est une partie fondamentale de la V3.

```text
MVP          : Mode choisi par le Super Admin → CompanyModule → Permissions → Routes / API
Après le MVP : Plan SaaS → Modules autorisés (PlanModule) → CompanyModule → …
```

## Tâches

- [x] Table `CompanyModule` (id, company_id, module_code, status, activated_at, config, created_at, updated_at)
- [x] Modes Prévente, Cash van et Mixte, et modules qui en découlent (BR-TEN-03)
- [x] Fonctions communes à `PRE_SALES` et `CASH_VAN` (secteurs, planning, journée, visites) actives dès que l'un des deux l'est (BR-TEN-05)
- [x] Guard backend « module actif » sur chaque endpoint de module (module déduit de la permission)
- [ ] Masquage des menus et routes Web des modules inactifs (avec les premiers écrans de module)
- [ ] Masquage des écrans mobiles des modules inactifs (avec les premiers écrans de module)
- [x] Audit de l'activation et de la désactivation (changement de mode)
- [x] Définir précisément le périmètre du socle commun et du module `COMMERCIAL` (phase 0)
- [ ] Table `PlanModule` et écran `/app/modules` *(après le MVP)*

Un module désactivé doit être :

- [ ] masqué dans l'UI ;
- [ ] inaccessible par les routes ;
- [x] inaccessible par l'API ;
- [x] refusé par les guards backend.

## Livrable

- [x] `docs/modules.md`

## Critère de validation

- [x] Appel API direct à un module désactivé → refusé
- [x] Un rôle ne donne jamais accès à un module désactivé

---

# PHASE 8 — Super Admin / administration plateforme

Cette phase distingue l'administration globale du SaaS de l'administration d'une entreprise.

**Périmètre du MVP** (UC-90) : uniquement les tâches suivantes. Tout le reste de la phase vient *après le MVP*.

- [x] Connexion du Super Admin (phase 4)
- [x] Liste des entreprises
- [x] Création d'une entreprise : nom, code, mode (Prévente, Cash van ou Mixte), paramètres par défaut, rôles, motifs système, type de client « Détail »
- [x] Création du compte administrateur de l'entreprise (mot de passe provisoire, à changer à la première connexion)
- [x] Changement de mode, refusé tant que du travail est en cours dans un module retiré (modules.md §8)
- [x] Suspension et réactivation d'une entreprise (sessions refusées, `COMPANY_SUSPENDED`)

## Routes

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

## Dashboard plateforme

- [ ] Entreprises totales, actives et suspendues
- [ ] Utilisateurs, pré-vendeurs, livreurs
- [ ] Commandes et visites
- [ ] Stockage
- [ ] Erreurs API
- [ ] Synchronisations échouées
- [ ] Notifications échouées
- [ ] État des services

## Entreprises

- [ ] Créer, consulter, modifier *(création et consultation faites ; modification du nom après le MVP)*
- [x] Activer, suspendre, réactiver
- [ ] Gérer les modules
- [ ] Consulter le plan et l'utilisation
- [ ] Consulter les utilisateurs, les appareils et l'activité
- [ ] Statuts : `TRIAL`, `ACTIVE`, `SUSPENDED`, `CANCELLED`, `DELETED`

## Plans et abonnements

- [ ] Plans configurables (ex. Starter, Pro, Business, Enterprise)
- [ ] Paramètres : modules, utilisateurs, pré-vendeurs, livreurs, magasins, clients, commandes, stockage, fonctionnalités, prix, durée d'essai
- [ ] Abonnements : plan, dates, statut, essai, consommation, historique
- [ ] Statuts : `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED`, `EXPIRED`

## Utilisateurs plateforme

- [ ] Gérer `SUPER_ADMIN`, `SUPPORT`, `FINANCE`, `TECH_ADMIN` (indépendants des utilisateurs d'entreprise)

## Monitoring, logs, support

- [ ] Monitoring : API, temps de réponse, erreurs, base, stockage, notifications, synchronisation, jobs
- [ ] Logs et audit plateforme *(l'audit est écrit à chaque action depuis la phase 4 ; l'écran vient après le MVP)* (actor, action, target, timestamp, IP, user agent, company, metadata)
- [ ] Accès support temporaire, audité, en lecture seule de préférence

## Livrables

- [ ] `docs/super-admin.md`
- [ ] `docs/subscription.md`

---

# PHASE 9 — Entreprises, utilisateurs et équipes

## Routes entreprise

```text
/app/dashboard   /app/modules     /app/users       /app/customers
/app/products    /app/territories /app/visits      /app/orders
/app/inventory   /app/deliveries  /app/routes      /app/reports
/app/devices     /app/settings
```

## COMPANY_ADMIN

- [x] Informations et paramètres de l'entreprise (`/app/parametres`)
- [x] Utilisateurs et rôles (`/app/utilisateurs`) ; permissions fixées par le rôle et P-08, P-10
- [ ] Équipes *(après le MVP)*
- [ ] Secteurs *(phase 13)*
- [x] Appareils (phase 4)

## Utilisateurs

- [x] Créer, modifier, désactiver, réactiver ; réinitialiser le mot de passe
- [x] Modifier le rôle (sessions fermées ; jamais son propre rôle ; toujours un administrateur actif)
- [ ] Affecter à une équipe *(après le MVP)*
- [x] Voir les sessions, les appareils (page Appareils), la dernière connexion

## SUPERVISEUR

- [ ] Voir toutes les équipes de l'entreprise (pas de découpage par équipe dans le MVP)
- [ ] Voir ses secteurs

**Ajouts phase 0** (UC-80, UC-82)

- [x] Code libre et unique par utilisateur (BR-USR-10)
- [x] Paramètres : types de clients, jours travaillés, jours fériés, motifs de non-commande et d'échec, distance hors zone, largeur du ticket, en-tête des bons
- [x] Règles réglables P-01 à P-10, avec leurs valeurs par défaut ; lues par le serveur et le mobile à chaque opération (BR-TEN-08)
- [x] Dépôts et camions (un camion est confié à un livreur ou un vendeur cash van actif)
- [x] Rôle `COMPTABLE`

---

# PHASE 10 — Appareils et connexions

## Entité

```text
Device
├── id
├── user_id
├── company_id
├── device_name
├── device_model
├── platform
├── app_version
├── status
├── last_seen
├── last_sync
├── battery_level
├── push_token
└── created_at
```

## Fonctionnalités

- [x] Enregistrer un appareil (association par QR code ou code de secours, phase 4)
- [x] Associer et désassocier appareil / utilisateur
- [x] Voir les appareils actifs, avec batterie, version et opérations en attente
- [x] Voir la dernière connexion et la dernière synchronisation *(la date de synchronisation sera remplie par la phase de synchronisation)*
- [x] Révoquer une session
- [x] Bloquer et réactiver un appareil
- [x] Forcer une nouvelle authentification
- [ ] Vue plateforme des appareils (`/admin/devices`) *(après le MVP)*

**Ajouts phase 0** (UC-59)

- [x] Changer l'appareil d'un profil (remplacement d'un vendeur), avec un avertissement si l'ancien appareil a des opérations non synchronisées
- [x] Envoi régulier, pendant la journée, de la batterie et du nombre d'opérations en attente (BR-JOU-09) ; la position sera envoyée par le téléphone avec la journée de travail

Limite : ce n'est pas un MDM. Cette fonction contrôle l'accès à l'application, pas le téléphone.

---

# PHASE 11 — Clients

## Entités

```text
Customer
├── id
├── company_id
├── name
├── phone
├── category
├── latitude / longitude
├── zone_id
├── territory_id
├── territory_part_id
├── status
CustomerContact
CustomerAddress
VisitSchedule (fréquence, jour)
```

## Tâches

- [x] CRUD clients (Web : superviseur et admin) ; supprimer = désactiver (BR-CLI-04)
- [ ] Contacts et adresses multiples *(après le MVP)*
- [x] Import CSV des clients, avec aperçu et liste des erreurs (UC-83, BR-IO-01) ; fichiers sur le disque du serveur (`STORAGE_DIR`) en attendant le stockage S3
- [x] Recherche et filtres, pagination par curseur
- [x] Position GPS (saisie ou collée depuis une carte ; la carte des clients vient avec la phase 13)
- [x] Affectation au secteur et à la partie (BR-ORG-04 : calcul partagé avec le mobile, partie forcée, choix si plusieurs parties)
- [x] Fréquence de visite et date de référence (BR-PLA-03)
- [x] Historique des visites, commandes et paiements (rempli par les phases 15 à 20)

**Ajouts phase 0** (UC-11, UC-12, UC-53)

- [x] Type de client, crédit autorisé et plafond (BR-CLI-01, BR-PAY-02)
- [x] Création par le vendeur sur mobile, avec la position GPS et la fréquence ; client actif tout de suite et marqué « nouveau » (BR-CLI-02, BR-CLI-03) — *écran mobile fait en phase 15, en ligne ; hors connexion avec la phase 23*
- [x] Liste « clients à revoir » : nouveaux, hors partie, fermés définitivement (BR-CLI-05)
- [x] Dette du client sur sa fiche (BR-PAY-04)

---

# PHASE 12 — Produits

## Entités

```text
Product (reference, name, unit, tax, active)
ProductCategory
ProductPrice
Promotion
```

## Tâches

- [x] Catalogue (CRUD) ; supprimer = désactiver
- [x] Catégories
- [x] Références et unités
- [x] Prix TTC (DA) ; taxes et facturation fiscale *(après le MVP)*
- [ ] Promotions complexes (module `COMMERCIAL`) *(après le MVP)*
- [ ] Disponibilité *(le stock vient avec la phase 17 ; un article sans prix pour un type de client ne lui est pas proposé)*
- [x] Activation et désactivation (produits, parfums, conditionnements, gammes, catégories)
- [x] Photos des produits et des parfums (Cloudinary), gardées sur le téléphone pour un affichage hors connexion (ajout du 2026-10-04)

**Ajouts phase 0** (UC-81, UC-83)

- [x] Gammes (ex. Bimo), qui servent de base aux objectifs (BR-CAT-01)
- [x] Unité de base et conditionnements convertibles : 1 carton = 20 triplettes (BR-CAT-01, BR-CAT-02)
- [x] Types de clients, et prix par type de client et par unité (BR-CAT-03, BR-CAT-04)
- [x] Paliers de quantité (BR-CAT-05)
- [x] Règles de bonus cumulatives « pour Q de X, N de Y offert », avec dates de validité (BR-CAT-06, BR-CAT-07)
- [x] Calcul des prix, paliers et bonus dans `packages/business-rules`, testé avec les exemples de `docs/business-rules.md` §22
- [x] Import CSV des produits, parfums, conditionnements et prix (BR-IO-02)

**Ajouts du 2026-10-02** (parfums)

- [x] Parfums d'un produit, ou un produit distinct par parfum, au choix du superviseur ou de l'admin (BR-CAT-12)
- [x] Stock, quotas et lignes tenus par article : parfum, ou produit sans parfum (BR-CAT-13)
- [x] Prix propre d'un parfum, qui remplace le prix du produit (BR-CAT-14)
- [x] Paliers et bonus calculés sur le total des parfums ; choix du parfum offert (BR-CAT-15) — et simulateur de panier sur le Web
- [ ] Saisie d'une quantité par parfum dans la commande et la vente (BR-CAT-16) *(écran de commande, phases 15 et 16 ; le calcul est prêt)*

---

# PHASE 13 — Secteurs, parties et carte

## Hiérarchie

```text
Zone → Secteur (Territory) → Partie (TerritoryPart) → Clients
```

Dans le MVP, il n'y a pas de niveau Zone : le secteur est le niveau le plus haut.

## Tâches

- [ ] Créer une zone *(après le MVP)*
- [x] Créer un secteur
- [x] Définir le nombre de parties (configurable, non codé en dur)
- [x] Afficher la carte (OpenStreetMap + Leaflet sur le Web ; MapLibre sur le téléphone avec la phase 15)
- [x] Dessiner les polygones du secteur et des parties
- [x] Modifier et supprimer les polygones et les parties
- [x] Afficher les clients sur la carte
- [x] Affecter les clients aux parties (clic ou sélection de zone)
- [x] Affecter les pré-vendeurs aux secteurs (champ vendeur du secteur)
- [x] Afficher le nombre de clients par partie
- [x] Afficher les pré-vendeurs et livreurs (dernière position connue ; envoyée par le téléphone avec la journée de travail)
- [ ] Afficher les itinéraires *(après le MVP)*

**Ajouts phase 0** (UC-50, UC-51)

- [x] Code libre du secteur (ex. `3101`) ; un vendeur par secteur (BR-ORG-01)
- [x] Types de clients servis par secteur : des secteurs de types différents peuvent se superposer, et le chevauchement d'un même type est signalé (BR-ORG-03)
- [x] Affectation automatique d'un client à sa partie selon sa position, partie forcée possible, état « hors partie » (BR-ORG-04, BR-ORG-05)
- [x] Réaffectation après modification d'un polygone, avec le nombre de clients déplacés (BR-ORG-06)
- [x] Même calcul sur le téléphone, hors connexion (GeoJSON dans `packages/business-rules`, sans Turf)
- [x] Affecter les livreurs aux secteurs, et les camions aux livreurs et aux vendeurs cash van (camions : phase 9)

## Exemple

```text
Secteur Oran Est
+-------------+-------------+
|  Partie 1   |  Partie 2   |
+-------------+-------------+
|  Partie 3   |  Partie 4   |
+-------------+-------------+
|  Partie 5   |  Partie 6   |
+-------------+-------------+
```

## Livrable

- [x] `docs/territories.md`

---

# PHASE 14 — Planification des visites

## Fréquences

```text
WEEKLY          chaque semaine
BIWEEKLY        tous les 15 jours
EVERY_4_WEEKS   toutes les 4 semaines
```

Architecture extensible pour d'autres fréquences.

## Planning des parties

```text
Samedi → Partie 1   Dimanche → Partie 2   Lundi → Partie 3
Mardi → Partie 4    Mercredi → Partie 5   Jeudi → Partie 6     (vendredi chômé)
```

## Algorithme

```text
Vendeur → Secteur → Partie du jour → Clients de la partie
 → Fréquence due ce jour ? (semaines depuis la date de référence) → + reprogrammés → Liste du jour
```

## Tâches

- [x] Planning jour → partie par secteur (`PartSchedule`) (BR-ORG-07)
- [x] Fréquence et date de référence pour chaque client (BR-PLA-01, BR-PLA-03)
- [x] Calcul des clients du jour, partagé entre le serveur et le mobile (BR-PLA-02, BR-PLA-07)
- [x] Jours travaillés et jours fériés : pas de clients du jour ces jours-là (BR-PLA-04)
- [x] Visites manquées à la clôture de la journée, sans report automatique (BR-PLA-06) — *enregistrées à la clôture de la journée (phase 15)*
- [x] Reprogrammer un client à une date précise (BR-PLA-05, UC-54)
- [x] Modification manuelle du planning par le superviseur (planning des parties, date de référence d'un client, reprogrammations)
- [x] Vue Web de la liste du jour d'un vendeur, avec un calendrier de 14 jours
- [x] Règles de fréquence dans `packages/business-rules`, avec tests unitaires (exemple §22)

---

# PHASE 15 — Module Prévente : mobile pré-vendeur et visites

## Tableau de bord

```text
[ DÉMARRER LA JOURNÉE ]   ou   [ CLÔTURER LA JOURNÉE ]
[ SYNCHRONISER ]   🟢 Synchronisé
Clients du jour : 12 / 20   (+1 hors programme)
Commandes du jour : 9       CA du jour : 184 500 DA
Objectifs : Bimo 62 %
```

## Écrans

```text
Login · Tableau de bord · Clients du jour (liste / carte) · Fiche client · Ajouter un client · Visite · Commande
 · Commandes du jour · Objectifs · Catalogue · Synchronisation · Profil
```

## Fonctionnalités

- [x] Animation du logo à l'ouverture, icône et écran de démarrage SellWasl (ajout du 2026-10-04)
- [x] Réception des opérations du téléphone (`POST /sync/push` : idempotence, ordre, refus sans blocage), envoyées en ligne ; la file hors connexion et `/sync/pull` viennent avec la phase 23
- [x] Connexion et profil (écrans du vendeur : tableau de bord, profil, routage par rôle)
- [x] **Journée de travail** : démarrer et clôturer ; hors journée, consultation seulement (BR-JOU, UC-03, UC-05) — *en ligne ; démarrer et clôturer sans réseau (BR-JOU-04, BR-JOU-06) avec la phase 23*
- [x] Secteur et partie du jour
- [x] Liste des clients du jour **triée par distance**, avec une bascule vers **tout le secteur** (BR-VIS-10, UC-10)
- [x] Carte : marqueurs rouges puis verts ; appui sur un client → itinéraire Google Maps, fiche, commencer la visite (UC-10)
- [x] Fiche client : informations, dette, historique, appeler, ouvrir sur la carte (UC-11)
- [x] Ajouter un client avec la position GPS (UC-12)
- [x] Démarrer une visite : **sur place** (distance calculée, « hors zone » signalé mais non bloquant) ou **par téléphone** (BR-VIS-02, BR-VIS-03)
- [x] Clore une visite sans commande avec un motif configurable (UC-16)
- [x] Prendre une commande depuis la visite (UC-14, réalisée en phase 16)
- [x] Modifier ou annuler ses commandes jusqu'à la clôture (UC-17, réalisée en phase 16)
- [x] Encaisser une dette (UC-19) — *impression du reçu avec la phase 20 ; numérotation déjà en place (ARC-11)*
- [x] Objectifs : cible, réalisé, taux, prime estimée (UC-20) — *réalisé à 0 tant qu'aucune livraison n'existe (phases 19-20)*
- [x] Catalogue sans prix (UC-21)
- [ ] Photo de visite *(après le MVP)*

## Statuts de visite

```text
PLANNED   IN_PROGRESS   COMPLETED   MISSED
```

Motifs par défaut (configurables) : client absent, client a encore du stock, magasin fermé, fermé définitivement, refus, autre.

---

# PHASE 16 — Commandes

## Sources (`Order.source`)

```text
MVP          : PRE_SALES   PHONE   CASH_VAN
Après le MVP : WEBSITE   WHATSAPP   ERP   MANUAL   API
```

## Statuts

```text
DRAFT → CONFIRMED → LOCKED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED / PARTIALLY_DELIVERED / FAILED
CANCELLED (avant la clôture) ; LOCKED → CONFIRMED si le superviseur rouvre la journée
```

## Tâches

- [x] Créer un panier (téléphone, pendant la visite)
- [x] Ajouter des produits (unité au choix) et modifier les quantités ; le produit ajouté quitte la liste
- [x] Calculer le total : prix par type de client, paliers, bonus automatiques (BR-CAT) — *sur le téléphone, recalculé et figé par le serveur*
- [x] Valider et confirmer une commande ; prix figés (BR-CAT-09)
- [x] Annuler une commande avant la clôture (et la modifier)
- [x] Associer la commande à une visite et un pré-vendeur
- [ ] Saisie au bureau de commandes sans visite (téléphone, WhatsApp…) *(après le MVP)*
- [x] Réserver le stock à la confirmation ; « rupture » si le stock est insuffisant (BR-CMD-04) — *dépôt actif de l'entreprise*
- [x] Historique (Web : page Commandes ; téléphone : commandes du jour)
- [x] Machine à états des statuts dans `packages/business-rules` (BR-CMD-02)

**Ajouts phase 0**

- [x] Commandes figées à la clôture de la journée (`LOCKED`) ; réouverture par le superviseur (BR-JOU-07, BR-JOU-08), et clôture d'office (BR-JOU-10)
- [x] **Quotas** par jour, article (parfum ou produit) et vendeur ; saisie Web par le superviseur (BR-QUO-01, UC-55)
- [x] Ligne scindée et **ligne en attente** au-delà du quota ; produit grisé « quota atteint » (BR-QUO-03)
- [x] Excédent de quota transformé en « en attente » à la synchronisation (BR-QUO-05) — *le serveur recalcule le quota à la réception ; notification au vendeur avec la phase 24*
- [x] Traitement des lignes en attente par le superviseur ; refus = vente perdue (BR-QUO-06, UC-60)
- [x] Date de livraison = jour ouvré suivant (BR-CMD-05)
- [x] Numéro de commande unique généré par le téléphone (BR-CMD-07) — *hors connexion avec la phase 23*
- [x] **Objectifs** mensuels par vendeur et par gamme, sur le CA livré, prime plafonnée (BR-OBJ, UC-56)

---

# PHASE 17 — Entrepôt et stock

## Structure

```text
Warehouse (DEPOT ou TRUCK)
 ├── Locations (après le MVP)
 └── Stock (product_id, warehouse_id, quantity, reserved_quantity, available_quantity)
```

## Mouvements

```text
MVP          : IN   OUT   TRANSFER   ADJUSTMENT   RESERVATION   RELEASE
Après le MVP : RETURN (retours clients)
```

## Règle

```text
Stock physique − Stock réservé = Stock disponible
```

## Tâches

- [x] Dépôts et camions (`TRUCK`) ; emplacements *(après le MVP)*
- [x] Stock par produit et entrepôt, en unité de base
- [x] Entrées au dépôt (UC-40)
- [x] Chargement (dépôt → camion) et déchargement (camion → dépôt), écart signé avec motif, P-06 et P-07
- [x] Réservation à la confirmation, libération à l'annulation (mouvements tracés)
- [x] Sortie du camion à la livraison ou à la vente (mouvement `OUT` prêt, branché aux phases 19 et 20)
- [x] Inventaire du dépôt et ajustements (UC-44)
- [x] Transactions pour toutes les opérations de stock ; stock jamais négatif (BR-STK-04, BR-STK-05)
- [x] Alertes de stock faible (seuil par article ; notifications en phase 24)
- [x] Traçabilité et audit des mouvements importants
- [ ] Transferts entre dépôts *(après le MVP)*

---

# PHASE 18 — Préparation et mobile magasinier

## Flux

```text
Journées clôturées → Superviseur : lignes en attente traitées → lance la préparation de la tournée
 → Magasinier : liste de chargement + détail → quantités préparées → Prête
 → Chargement du camion → Réception confirmée par le livreur
```

## Écrans (mobile)

```text
Login · Tableau de bord · Entrées · Préparations · Chargements · Déchargements · Inventaire · Stock · Synchronisation · Profil
```

## Fonctionnalités

- [x] Lancement de la préparation par tournée sur le Web, désactivé tant que des journées sont encore en cours ou en attente de synchronisation, ou que des lignes en attente ne sont pas traitées (BR-PRE-01, BR-PRE-02, UC-61)
- [x] Changer le livreur d'un secteur avant le lancement (BR-PRE-01)
- [x] Liste de chargement (total par produit) et détail par commande (BR-PRE-03, UC-41)
- [x] Saisir les quantités préparées ; une rupture réduit la ligne, avec recalcul des paliers et bonus (BR-CAT-10)
- [x] Valider la préparation
- [x] Charger le camion du livreur (UC-42)
- [x] Décharger un camion : comptage, écart, retour au dépôt (BR-STK-07, UC-43)
- [x] Consulter le stock
- [x] Effectuer un inventaire
- [ ] Lecture des codes-barres *(après le MVP)*

---

# PHASE 19 — Module Livraison et tournées

En prévente, le livreur livre les commandes des pré-vendeurs **le jour ouvré suivant**. En cash van, la livraison se fait au moment de la vente (phase 20).

## Flux

```text
Commande prête → Chargement du camion → Réception confirmée → Tournée → Livrée / partielle / échec
```

## Résultats d'une livraison (MVP)

```text
DELIVERED   PARTIAL   FAILED (+ motif)
Après le MVP : IN_TRANSIT   ARRIVED   CANCELLED
```

## Tournées

- [x] Tournée = commandes figées des secteurs du livreur, pour une date de livraison (BR-PRE-01)
- [x] Affecter un livreur à des secteurs
- [x] Liste triée par distance, carte, itinéraire Google Maps (BR-LIV-01)
- [ ] Ordre de passage optimisé *(après le MVP)*

## Tâches

- [x] Mise à jour de la commande selon la livraison : livrée, partielle (avec recalcul), échec (BR-LIV-02)
- [x] Livraisons non traitées en échec à la clôture (BR-LIV-04)
- [x] Reprogrammation d'une livraison échouée au jour ouvré suivant, selon P-05 (BR-LIV-06)
- [x] Marchandise non livrée rendue au dépôt au déchargement (BR-LIV-05)
- [x] Preuves : GPS et heure ; signature et photo *(après le MVP)*
- [x] Encaissement (`Payment`) : espèces, ou crédit dans la limite du plafond (BR-PAY-03)
- [x] Vente des produits refusés : le livreur ajoute la marchandise refusée (retour d'un client) aux commandes existantes d'autres clients de sa tournée, sans créer de client : prix et paliers du type du client, pas de quota, plafond de crédit respecté
- [x] Objectif du livreur : paliers du taux de retour (quantité retournée au déchargement ÷ quantité chargée, sur le mois) et critères notés sur 10 et pondérés (propreté du camion, etc.), réglés par l'admin ou le superviseur, avec une prime

---

# PHASE 20 — Mobile livreur, cash van, encaissements et impression

## Écrans du livreur

```text
Login · Tableau de bord · Réception du chargement · Ma tournée (liste / carte) · Livraison · Encaissement
 · Impression · Historique · Récapitulatif · Synchronisation · Profil
```

## Fonctionnalités du livreur

- [x] Journée de travail : démarrer et clôturer (UC-03, UC-05)
- [x] Confirmer la réception du chargement ou signaler un écart (UC-30)
- [x] Liste des livraisons du jour, carte, itinéraire (UC-31)
- [x] Détail de la commande et dette du client
- [x] Confirmer une livraison, totale ou partielle (UC-32)
- [x] Échec avec motif : client absent, refus, fermé, autre (UC-33)
- [x] Encaissement en espèces ou à crédit (BR-PAY-03)
- [x] Géolocalisation pendant la journée (BR-JOU-09)
- [ ] Photo et signature *(après le MVP)*

## Vendeur cash van (UC-15, UC-18, UC-62)

- [x] Chargement du matin préparé sur le Web ou saisi par le magasinier, puis réception confirmée par le vendeur (BR-CV-01, BR-CV-02)
- [x] Mêmes journée, clients du jour, carte et visites que le pré-vendeur (phase 15) ; visite toujours sur place
- [x] Produits proposés = stock du camion, avec un contrôle exact hors connexion (BR-CV-03)
- [x] Vente = livraison immédiate, statut `DELIVERED`, stock du camion mis à jour (BR-CV-04)
- [x] Vente définitive, sans modification ni annulation (BR-CV-05)
- [x] Quota épuisé → produit grisé et demande perdue (BR-QUO-04)
- [x] Encaissement des dettes (BR-CV-07)
- [x] Déchargement du soir : comptage, écart, retour au dépôt ou stock gardé dans le camion selon P-06 (BR-CV-06, BR-STK-07)
- [x] Rechargement en cours de journée, selon P-07 (BR-CV-01)

## Impression Bluetooth (UC-34, UC-35)

- [x] Imprimante thermique 58 ou 80 mm (paramètre de l'entreprise) (BR-IMP-01)
- [x] Bon de livraison ou de vente : entreprise, client, lignes, « GRATUIT », total, payé, reste, dette (BR-IMP-02)
- [x] Réimpression marquée « DUPLICATA » et tracée (BR-IMP-03)
- [x] Numéro de bon unique généré hors connexion (BR-IMP-04)
- [x] Livraison jamais bloquée sans imprimante (BR-IMP-05)
- [x] Récapitulatif de journée imprimé (BR-IMP-06)

## Dettes et versements (UC-19, UC-70, UC-71)

- [x] Dette par client, plafond, encaissement des dettes par le pré-vendeur et le vendeur cash van (BR-PAY-04, BR-PAY-05)
- [x] Récapitulatif de journée avec le montant attendu (BR-PAY-07)
- [x] Web comptable : saisie du versement, calcul de l'écart (BR-PAY-08) ; notification au superviseur en phase 24
- [x] Web comptable : dettes et paiements, exports

---

# PHASE 21 — Dashboard et analytics

## Dashboard entreprise

- [x] Chiffre d'affaires
- [x] Commandes
- [x] Visites planifiées et réalisées
- [x] Clients non visités et retards
- [x] Taux de conversion
- [x] Pré-vendeurs et livreurs actifs
- [x] Commandes en préparation et en livraison
- [x] Échecs de livraison
- [x] Stock faible et ruptures
- [x] Commandes refusées : nombre, valeur, taux de refus
- [x] Retours au déchargement : quantité, valeur, taux de retour
- [x] Reventes en tournée : valeur récupérée
- [x] Coût net des retours (valeur retournée − valeur revendue)
- [x] Écarts au déchargement (stock théorique vs stock compté)
- [ ] Diagnostics ouverts *(après le MVP)*

## Suivi temps réel

```text
Ahmed     🟢 En tournée   12 / 20 visites
Mohamed   🟢 En tournée    8 / 17 visites
Youcef    🔴 Hors ligne   Dernière sync : 14:32
```

## Rapports (module `ANALYTICS`)

- [x] Commercial : commandes, CA, produits, clients *(rapports détaillés après le MVP)*
- [x] Prévente : visites, commandes, activité des pré-vendeurs, secteurs
- [x] Livraison : livraisons, délais, échecs, activité des livreurs
- [ ] Stock : disponibilité, mouvements, alertes, rotation *(après le MVP)*
- [x] Retours : refus, retours au déchargement, reventes en tournée, écarts, coût net
- [x] Filtres : période, secteur, partie, utilisateur, client, produit, livreur, lot, fournisseur, motif de refus, état constaté *(tous dans l'API ; le Web filtre par période et secteur)*
- [x] Exports : CSV dans le MVP ; Excel et PDF *(après le MVP)*

## Analyse des retours (module `RETURNS_ANALYSIS`, activable par entreprise)

**Données attendues des autres phases**

- Livraison : quantités réellement livrées, un motif de refus par commande, reventes en tournée
- Déchargement : quantités comptées par produit et par lot, état constaté par le magasinier (remis en stock, défectueux, périmé, cassé), photo pour les défectueux
- Commande : pré-vendeur et livreur enregistrés séparément

**Indicateurs par axe**

- [x] Par produit et par lot : quantités vendues et retournées, taux de retour, répartition par état constaté
- [x] Par fournisseur : taux de retour et part de défectueux sur ses produits
- [x] Par pré-vendeur : commandes refusées (nombre, valeur, taux), répartition par motif
- [x] Par livreur : refus déclarés, reventes en tournée, écarts de stock et de caisse au déchargement *(écarts de caisse : page Versements)*
- [x] Par client : commandes refusées totalement ou partiellement, taux, motifs, refus contestés
- [x] Par secteur et par tournée : taux de refus et de retour
- [x] Par motif de refus : fréquence et valeur
- [x] Vue croisée à deux axes au choix (produit × livreur, client × pré-vendeur, produit × secteur…)
- [x] Accès depuis chaque chiffre à la liste des commandes et des retours concernés
- [x] Indicateurs de retours sur les fiches produit, client, pré-vendeur et livreur

**Analyse des causes** *(après le MVP)*

- [ ] Taux de retour normal par produit, calculé sur l'historique ou sur la catégorie
- [ ] Indice d'excès de chaque entité : retours observés / retours attendus pour ses propres produits
- [ ] Contre-épreuve : vérifier que l'excès n'est pas concentré sur un autre axe avant de conclure
- [ ] Cause attribuée à chaque retour en excès : produit, pré-vendeur, livreur, tournée, client, normal ou indéterminé
- [ ] Diagnostics : cause, niveau de confiance, preuves, coût, action proposée, statut
- [ ] Réponse de la personne concernée et correction de la cause par le superviseur
- [ ] Alerte qualité produit avec blocage du lot
- [ ] Vue d'ensemble : répartition des retours par cause, en quantité et en valeur
- [ ] Paramètres par entreprise : axes analysés, fenêtre, seuils
- [ ] Score de risque client, calculé uniquement sur les retours attribués au client *(optionnel)*

**Règles**

- Plusieurs clients distincts qui retournent le même produit ou lot : la cause est le produit, aucun client n'est pénalisé
- Un retour n'est attribué qu'à une seule cause
- Aucune conclusion en dessous d'un volume minimum
- Un retour « indéterminé » ne pèse sur personne
- Le motif déclaré par le livreur est un indice, pas une preuve
- Les indicateurs par pré-vendeur et par livreur restent internes à l'entreprise
- Exports CSV : refus, retours au déchargement, reventes en tournée, écarts, diagnostics

**Ajouts phase 0** (UC-57, UC-63)

- [x] Tableau du jour, par utilisateur : état de la journée, x/N, hors zone, par téléphone, commandes, CA, dernière position et dernière synchronisation, batterie, opérations en attente
- [x] Carte du superviseur : polygones, clients rouges ou verts, positions des équipes
- [x] Fiche d'un vendeur ou d'un livreur en consultation seule
- [x] Exports CSV : ventes, visites, objectifs, dettes, versements (BR-IO-03)
- [x] Statistiques des ventes perdues et des demandes perdues

---

# PHASE 21 bis — Paie, primes, acomptes, retenues et écarts

Ajoutée le 2026-10-06 (mission de finalisation). Net **interne** : sans CNAS ni IRG. Documents : `docs/payroll.md`, `docs/incentives.md`, `docs/stock-discrepancies.md`, `docs/settlements.md`.

## Retour du véhicule et écarts

- [x] Clôture de journée du livreur = déclaration de retour ; contrôle du camion par le magasinier (Web et mobile)
- [x] Théorique, compté, écart, valeur unitaire, valeur de l'écart, cause, contrôleur, date
- [x] Écart enregistré à la validation du contrôle ; analyse et décision du comptable (sans responsabilité, non fondé, responsabilité confirmée)
- [x] Jamais de retenue automatique : retenue créée en attente, approuvée explicitement

## Rapprochement financier

- [x] Versement avec justification ; écart de caisse enregistré et analysé comme un écart de stock
- [x] Détail d'un versement : ventes, paiements, impayés, retours, écarts de marchandise, justification

## Rémunération, acomptes, retenues

- [x] Rémunération avec historique (date d'effet, jamais effacée)
- [x] Paramètres : paie activée, acomptes activés, plafond, calendrier des échéances (somme 100 %)
- [x] Acomptes : demande, approbation dans le plafond, paiement, déduction à la paie
- [x] Retenues : nées d'un écart (référence gardée) ou libres, approuvées, appliquées une seule fois

## Primes

- [x] Règles par unité, pourcentage du CA, seuil, paliers, objectif de CA ; hebdomadaires ou mensuelles ; par employé ou par rôle
- [x] Calcul à la demande sur les ventes livrées, une prime par règle, employé et période, ventes sources tracées
- [x] Validation par le comptable avant la paie
- [x] Calcul automatique chaque nuit (primes de la semaine et du mois, brouillon de paie à jour) ; validation humaine
- [x] Progression en direct pour l'employé (Web et mobile) ; règles modifiables et désactivables
- [ ] Objectifs d'équipe *(architecture prête, non implémentés)*

## Paie

- [x] Périodes mensuelles : brouillon, calculée, approuvée, payée, clôturée
- [x] Calcul centralisé : salaire + primes + objectifs mensuels + ajustements − acomptes − retenues, chaque ligne avec sa source
- [x] Échéances selon le calendrier, payées une seule fois ; clôture sans retour ; correction par ajustement du mois suivant
- [x] Tableau de bord de la paie ; « Ma paie » (Web et mobile) limitée à l'employé
- [x] Audit de chaque opération financière ; isolation entre entreprises testée ; scénario E2E (net 49 600 DA)
- [ ] Cotisations légales (CNAS, IRG) *(hors périmètre, choix de l'entreprise)*

---

# PHASE 22 — Application Web responsive / PWA

Fonctionne sur desktop, tablette et smartphone.

## Desktop

- [x] Sidebar (repliable), dashboard, tableaux, cartes, graphiques (SVG, sans dépendance)

## Mobile

- [x] Header, navigation inférieure (selon le rôle, + « Plus »), boutons tactiles, carte plein écran, contenu simplifié

## PWA

- [x] Manifest
- [x] Icône (logo SellWasl)
- [x] Splash screen
- [x] Installation sur l'écran d'accueil
- [x] Mode standalone
- [x] Cache approprié : fichiers statiques et page hors ligne seulement, jamais les données de l'API

La Web mobile ne remplace pas l'application native pour le terrain.

---

# PHASE 23 — Offline-first et synchronisation

Ne pas activer la synchronisation avant d'avoir validé le flux online. Le schéma est déjà offline-ready (Phase 3).

## Étape 1 — Online

```text
Mobile → API → PostgreSQL
```

## Étape 2 — Offline

```text
Mobile → SQLite → Outbox / Sync Queue → Sync Engine → API /api/v1/sync → PostgreSQL
```

## Tâches

- [x] SQLite local
- [x] Données téléchargées selon le rôle (BR-SYN-04) : clients du secteur avec dettes, catalogue, prix, paliers, bonus, quotas, objectifs, planning, polygones, tournée, stock du camion
- [x] Outbox locale
- [x] Enregistrement offline des journées, visites, commandes, ventes, livraisons, paiements et clients créés
- [x] Endpoint `/api/v1/sync`
- [x] Synchronisation automatique au retour du réseau, et bouton « Synchroniser »
- [x] Synchronisation différentielle
- [x] Idempotency keys (BR-SYN-02)
- [x] Retry
- [x] Règle de propriété des données : téléphone ou serveur (BR-SYN-03)
- [x] Transformations à la réception : excédent de quota → « en attente », excédent de stock → « rupture », avec information du vendeur (BR-SYN-05)
- [x] Journal de synchronisation et des erreurs (`SyncLog`)
- [x] Indicateur de synchronisation dans l'application (BR-SYN-06)
- [x] Démarrage et clôture de journée hors connexion (BR-JOU-04, BR-JOU-06)

## États

```text
PENDING   SYNCING   SYNCED   FAILED   CONFLICT
```

## Livrable

- [x] `docs/offline-sync.md`

## Critère de validation

- [x] Une commande créée sans réseau est synchronisée une seule fois au retour du réseau
- [x] Un quota baissé pendant que le téléphone était hors connexion transforme l'excédent en « en attente », sans perte ni écrasement silencieux
- [x] Une journée complète de cash van se déroule sans réseau, puis se synchronise

---

# PHASE 24 — Notifications

Commencer par :

- [x] Notifications internes (in-app)
- [x] Push notifications

Puis, *après le MVP* :

- [ ] Email
- [ ] SMS — écarté (décision du 2026-10-07 : push seulement)
- [ ] WhatsApp — écarté (décision du 2026-10-07 : push seulement)

## Événements du MVP (BR-NOT)

Superviseur :

- [x] Lignes en attente à traiter
- [x] Nouveau client
- [x] Visite hors zone
- [x] Écart de réception, de déchargement ou de versement
- [x] Journée démarrée ou clôturée hors connexion

Terrain :

- [x] Journée rouverte
- [x] Quota modifié
- [x] Lignes en attente acceptées ou refusées
- [x] Appareil révoqué

*Après le MVP* : nouvelle commande, commande prête, livraison terminée, stock faible, synchronisation échouée.

Fournisseurs remplaçables (interface d'abstraction) : `PushProvider` ([notifications.md](docs/notifications.md)).

---

# PHASE 25 — API et intégrations

## Routes

```text
/api/v1/auth           /api/v1/admin          /api/v1/companies
/api/v1/users          /api/v1/devices        /api/v1/plans
/api/v1/subscriptions  /api/v1/modules        /api/v1/customers
/api/v1/products       /api/v1/territories    /api/v1/visits
/api/v1/orders         /api/v1/inventory      /api/v1/deliveries
/api/v1/routes         /api/v1/reports        /api/v1/notifications
/api/v1/sync

Ajouts phase 0 :
/api/v1/workdays       /api/v1/quotas         /api/v1/objectives
/api/v1/loads          /api/v1/payments       /api/v1/settlements
/api/v1/imports        /api/v1/exports
```

## Tâches

- [x] REST API versionnée
- [x] Validation des entrées
- [x] Swagger / OpenAPI — généré depuis le code, `/api/docs` hors production (api.md §1.1)
- [x] Pagination, filtres, tri — 12 listes qui grossissent (api.md §1.2)
- [x] Gestion homogène des erreurs — testée pour 400, 401, 403, 404, 409, 422 et 429
- [x] Rate limiting
- [x] Isolation tenant, permissions et contrôle de module sur chaque endpoint
- [x] Idempotence des créations d'argent et de stock (api.md §1.3)
- [x] Conflit de version sur les fiches modifiées depuis le Web (api.md §1.4)

Intégrations futures : ERP, CRM, comptabilité, e-commerce, facturation, systèmes externes — après le MVP (décision du 2026-10-07).

---

# PHASE 26 — Audit

## Entité

```text
AuditLog
├── id
├── company_id
├── user_id (actor)
├── action
├── entity (target)
├── entity_id
├── metadata
├── ip
├── user_agent
└── created_at
```

## À tracer

- [ ] Connexion et déconnexion
- [ ] Création, modification, suppression
- [ ] Changement de statut
- [ ] Changement de stock et opérations importantes de stock
- [ ] Changement de prix
- [ ] Changement de rôle
- [ ] Affectation de secteur
- [ ] Activation et désactivation de module
- [ ] Révocation d'appareil
- [ ] Actions du support (`PlatformAuditLog`) *(après le MVP)*

**Ajouts phase 0** (BR-AUD-01)

- [ ] Association d'un appareil à un profil
- [ ] Démarrage, clôture et réouverture de journée
- [ ] Prix, paliers, bonus, quotas et objectifs
- [ ] Forçage de la partie d'un client, polygones et planning
- [ ] Traitement des lignes en attente et lancement de la préparation
- [ ] Écarts de réception, de déchargement et d'inventaire
- [ ] Encaissements, versements et écarts
- [ ] Réimpressions de bons

---

# PHASE 27 — Sécurité

## Authentification

- [ ] Hash sécurisé des mots de passe
- [ ] JWT / sessions
- [ ] Refresh tokens, expiration, rotation, révocation
- [ ] Réinitialisation du mot de passe
- [ ] Protection brute force

## API

- [ ] Validation des données et des uploads
- [ ] Guards RBAC et modules
- [ ] Rate limiting
- [ ] Protection contre les injections
- [ ] Protection IDOR
- [ ] Contrôle tenant systématique
- [ ] HTTPS

## Données

- [ ] Secrets dans les variables d'environnement, chiffrés
- [ ] Chiffrement des données sensibles lorsque nécessaire
- [ ] Contrôle d'accès aux fichiers
- [ ] Sauvegardes
- [ ] Monitoring et alertes

## Livrable

- [ ] `docs/security.md`

---

# PHASE 28 — Tests

## Backend

- [ ] Unitaires
- [ ] Intégration
- [ ] API
- [ ] RBAC
- [ ] Multi-tenant (`Company A ≠ Company B`)
- [ ] Modules désactivés
- [ ] Stock (réservation, libération, concurrence)
- [ ] Commandes (machine à états)
- [ ] Planification (fréquences)

## Web

- [ ] Composants
- [ ] Navigation et guards
- [ ] Formulaires
- [ ] E2E : login, dashboard, clients, produits, secteurs, carte, visites, commandes, stock, livraisons

## Mobile

- [ ] Connexion et navigation
- [ ] Carte et GPS
- [ ] Visites
- [ ] Commandes
- [ ] Livraisons
- [ ] Stock
- [ ] Offline et synchronisation
- [ ] Notifications

## Livrable

- [ ] `docs/testing.md`

---

# PHASE 29 — CI/CD

## Pipeline

```text
Git push → Pull Request → Lint → Type check → Tests → Build → Deploy
```

## Branches

```text
main   develop   feature/*   fix/*
```

## Environnements

```text
development → staging → production
```

---

# PHASE 30 — Déploiement

## Production

- [ ] Frontend Web (Vercel ou équivalent)
- [ ] API (VPS, cloud ou containers)
- [ ] PostgreSQL (managé ou serveur dédié)
- [ ] Redis si nécessaire
- [ ] Stockage objet
- [ ] Monitoring et logs
- [ ] Backups

## Mobile

- [ ] APK Android de test
- [ ] Android App Bundle
- [ ] Configuration des notifications
- [ ] Publication sur les stores si nécessaire
- [ ] iOS ultérieurement

## Livrable

- [ ] `docs/deployment.md`

---

# PHASE 31 — SaaS, abonnements et facturation

> **Toute cette phase vient après le MVP.** Dans le MVP, le Super Admin crée l'entreprise et choisit son mode (phase 8).

```text
Company → Subscription → SubscriptionPlan → Modules autorisés → CompanyModule
```

## Tâches

- [ ] Plans
- [ ] Abonnements
- [ ] Période d'essai
- [ ] Limites appliquées côté backend
- [ ] Onboarding d'une entreprise
- [ ] Consommation
- [ ] Upgrade / downgrade
- [ ] Activation, suspension, renouvellement
- [ ] Historique
- [ ] Facturation (fournisseur de paiement à choisir)

---

# PHASE 32 — Production industrielle (FUTURE, hors V3)

Réservé pour une version future : module `PRODUCTION`, avec matières premières, nomenclatures, ordres de fabrication, consommation, produits finis, lots, qualité, planification.

**Aucune dépendance dans le MVP.**

---

# Ordre de développement

```text
MVP
 1. Cahier des charges                          ✅ phase 0 terminée
 2. Architecture                               ✅ phase 1 terminée
 3. Monorepo + version Android compilée + test d'impression Bluetooth
 4. PostgreSQL / Prisma
 5. Authentification + association des appareils
 6. Multi-tenant
 7. RBAC
 8. Modes et modules
 9. Super Admin minimal
10. Utilisateurs et paramètres de l'entreprise
11. Catalogue : produits, conditionnements, prix, paliers, bonus + import CSV
12. Clients et types de clients + import CSV
13. Secteurs, parties (polygones), carte, affectations
14. Planning et fréquences
15. Mobile vendeur : journée, clients du jour, carte, visites
16. Commandes de prévente, quotas, lignes en attente
17. Stock : dépôts et camions
18. Préparation et chargement (magasinier)
19. Livraison, encaissement, impression (livreur)
20. Cash van
21. Dettes, récapitulatifs, versements (comptable)
22. Objectifs
23. Supervision en temps réel et exports CSV
24. Offline et synchronisation
25. Notifications
26. Audit (consolidation)
27. Sécurité avancée
28. Tests de bout en bout des deux scénarios de réussite
29. CI/CD
30. Déploiement chez une entreprise pilote

APRÈS LE MVP
31. Plans SaaS, abonnements, facturation
32. Module COMMERCIAL avancé, saisie de commandes au bureau
33. Optimisation
34. Production — FUTURE
```

> Les tests, l'audit et la sécurité de base sont écrits **au fil de chaque phase**. Les étapes 26 à 28 en sont la consolidation.

---

# MVP

Périmètre détaillé : [docs/cahier-des-charges.md](docs/cahier-des-charges.md) §5. Le MVP couvre **les deux modes de vente**, prévente et cash van.

## Super Admin (Web)

- [ ] Login
- [ ] Liste des entreprises
- [ ] Création d'une entreprise, de son administrateur, et choix du mode

## Administrateur (Web)

- [ ] Utilisateurs (tous les rôles, superviseurs compris)
- [ ] Catalogue : produits, parfums, gammes, conditionnements, prix par type de client, paliers, bonus
- [ ] Paramètres : types de clients, jours travaillés et fériés, motifs, distance hors zone, ticket, dépôts et camions
- [ ] Import CSV des clients et des produits

## Superviseur (Web)

- [ ] Secteurs et parties en polygones, carte, affectations
- [ ] Planning et fréquences, reprogrammation
- [ ] Clients et liste « à revoir »
- [ ] Produits et parfums (sans les prix)
- [ ] Quotas et objectifs
- [ ] Suivi en temps réel : tableau du jour et carte
- [ ] Réouverture de journée, changement d'appareil
- [ ] Lignes en attente et lancement de la préparation
- [ ] Chargements cash van
- [ ] Exports CSV

## Comptable (Web)

- [ ] Versements et écarts
- [ ] Dettes et paiements

## Mobile (Android)

- [ ] Connexion sur un appareil associé
- [ ] **Pré-vendeur** : journée, clients du jour, carte, création de client, visites (sur place ou par téléphone), commandes avec paliers, bonus et quotas, encaissement des dettes, objectifs
- [ ] **Vendeur cash van** : réception du chargement, journée, visites, vente avec livraison immédiate, encaissement, impression, demande perdue, objectifs
- [ ] **Livreur** : réception du chargement, journée, tournée, livraison totale ou partielle, échec, encaissement, impression, récapitulatif
- [ ] **Magasinier** : entrées, préparation, chargement, déchargement, inventaire
- [ ] Offline et synchronisation
- [ ] Impression Bluetooth

## Backend

- [ ] Auth et appareils
- [ ] Multi-tenant
- [ ] RBAC
- [ ] Modes et modules
- [ ] API : clients, produits, prix, secteurs, planning, journées, visites, commandes, quotas, objectifs, stock, chargements, livraisons, paiements, versements, imports, exports, sync

Les plans et abonnements, la facturation, les notifications externes (email, SMS, WhatsApp), la saisie de commandes au bureau, la facturation fiscale et les intégrations ERP viennent **après validation du MVP**.

---

# Critères de réussite du MVP

Deux entreprises isolées l'une de l'autre, l'une en prévente et l'autre en cash van, réalisent chacune leur cycle complet, avec des passages hors connexion, sans perte de données et sans intervention technique. Le détail, étape par étape avec les cas d'utilisation, est dans le cahier des charges §8.

## Scénario prévente

```text
 1. Le Super Admin crée l'entreprise en mode Prévente
 2. L'admin importe les clients et les produits, puis règle les prix, les paliers et les bonus
 3. Le superviseur dessine les secteurs et les parties, affecte les équipes, définit le planning
 4. Il fixe les quotas et les objectifs
 5. Le pré-vendeur démarre sa journée, visite ses clients du jour (même hors connexion),
    prend des commandes (dont une ligne en attente), puis clôture
 6. Le superviseur traite les lignes en attente et lance la préparation
 7. Le magasinier prépare et charge le camion
 8. Le livreur confirme la réception, livre (dont une livraison partielle et un échec),
    encaisse (dont une vente à crédit), imprime les bons, puis clôture
 9. Le magasinier décharge les retours ; le comptable enregistre le versement
10. Le superviseur voit les résultats du jour et exporte les CSV
```

## Scénario cash van

```text
1. Le Super Admin crée l'entreprise en mode Cash van ; paramétrage comme ci-dessus
2. Le camion est chargé ; le vendeur confirme la réception
3. Le vendeur fait ses visites et ses ventes (avec bonus), enregistre une demande perdue,
   encaisse une dette et imprime les bons, en partie hors connexion
4. Il clôture ; le magasinier décharge (avec un écart) ; le comptable enregistre le versement
```

## Le produit est fonctionnel lorsque

- [ ] plusieurs entreprises peuvent être créées, chacune avec son mode ;
- [ ] leurs données sont isolées ;
- [ ] une entreprise n'accède qu'à ses modules activés ;
- [ ] un superviseur gère les secteurs et les parties en polygones ;
- [ ] un vendeur reçoit sa partie et ses clients du jour selon leur fréquence ;
- [ ] une visite est enregistrée, avec le contrôle hors zone ou le mode par téléphone ;
- [ ] prix, paliers, bonus et quotas s'appliquent correctement ;
- [ ] une commande de prévente est préparée, chargée et livrée le jour ouvré suivant ;
- [ ] une vente cash van est livrée et imprimée immédiatement ;
- [ ] le stock du dépôt et des camions est exact après le déchargement ;
- [ ] les dettes et les versements sont justes, et les écarts signalés ;
- [ ] les actions importantes sont auditées ;
- [ ] le mobile fonctionne hors connexion, et les données se synchronisent sans doublon.

---

# Fonctionnalités à repousser

Ne pas commencer par :

- IA complexe ;
- optimisation avancée d'itinéraires ;
- prédiction des ventes ;
- géofencing avancé ;
- facturation automatique complexe ;
- WhatsApp ;
- intégrations ERP / comptabilité ;
- MDM ;
- microservices ;
- production industrielle.

La liste complète des fonctions hors MVP, issue de la phase 0, est dans le [cahier des charges §6](docs/cahier-des-charges.md#6-hors-mvp).

---

# Documents techniques

```text
docs/
├── cahier-des-charges.md     ✅ phase 0
├── use-cases.md              ✅ phase 0
├── business-rules.md         ✅ phase 0
├── architecture.md          ✅ phase 1
├── database.md              ✅ phase 1
├── api.md                   ✅ phase 1
├── rbac.md                  ✅ phase 1
├── modules.md               ✅ phase 1
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

# Règles de développement

1. Toutes les données métier sont isolées par `company_id`.
2. Ne jamais faire confiance au `company_id` envoyé par le frontend.
3. Le frontend ne décide jamais seul des permissions.
4. Toujours vérifier le tenant, les permissions et le module.
5. Un module désactivé est bloqué côté backend.
6. Séparer l'UI et la logique métier.
7. Centraliser les types, validations et règles métier partagés.
8. Une commande ne nécessite pas obligatoirement une visite.
9. Une livraison ne nécessite pas obligatoirement un pré-vendeur.
10. Le stock est basé sur des mouvements traçables.
11. Utiliser des transactions pour les opérations critiques.
12. Le mobile doit fonctionner hors connexion, et les opérations offline sont idempotentes.
13. Les opérations sensibles sont auditées.
14. Le Super Admin est séparé des rôles d'entreprise.
15. Ne pas coder en dur les secteurs, fréquences, rôles, motifs ou limites configurables.
16. Pas de données fictives en dur : seed uniquement pour le développement et les tests.
17. Commencer online, puis ajouter le offline après validation du flux métier.
18. Chaque fonctionnalité importante a des tests.
19. Documenter et versionner l'API.
20. Éviter la sur-architecture du MVP, mais préparer l'évolution future.
21. La production industrielle n'est pas implémentée en V3.

---

# Prochaine étape

1. ~~Trancher les points de l'Annexe B du README_vf.~~ Fait en phase 0.
2. ~~Valider les valeurs par défaut des paramètres P-01 à P-10 et les 7 règles fixes.~~ Fait le 2026-10-02.
3. ~~**Phase 1** : trancher les points ouverts du cahier des charges §11, rédiger `docs/architecture.md`, `docs/database.md`, `docs/api.md`, `docs/rbac.md` et `docs/modules.md`.~~ Fait le 2026-10-02.
4. **Avant la phase 2** : acheter une imprimante thermique 58 mm et une 80 mm (architecture §13.2).
5. **Phase 2** : commencer l'implémentation par :

**Monorepo (+ version Android compilée et test d'impression) → PostgreSQL / Prisma → Auth et appareils → Multi-tenant → RBAC → Modes et modules.**

# FIN DU PLAN VF
