# Rôles et permissions (RBAC) — SellWasl

> **Phase 1 — rédigé le 2026-10-02.**
> Ce document fixe les rôles, le catalogue des permissions et la matrice rôles × permissions du MVP. Il applique les règles BR-USR, BR-TEN-08 (P-08, P-10) et les décisions de l'[architecture](architecture.md) §5.3 et §7.
>
> Documents liés : [modules.md](modules.md), [database.md](database.md), [api.md](api.md).

## Sommaire

1. [Principes](#1-principes)
2. [Rôles](#2-rôles)
3. [Contrôles de chaque requête](#3-contrôles-de-chaque-requête)
4. [Catalogue des permissions](#4-catalogue-des-permissions)
5. [Matrice rôles × permissions](#5-matrice-rôles--permissions)
6. [Périmètre des données](#6-périmètre-des-données)
7. [Permissions qui dépendent des paramètres](#7-permissions-qui-dépendent-des-paramètres)
8. [Interdits absolus](#8-interdits-absolus)
9. [Affichage sur le Web et le mobile](#9-affichage-sur-le-web-et-le-mobile)
10. [Tests](#10-tests)

---

## 1. Principes

1. **Le serveur décide.** Le Web et le mobile masquent ce qui n'est pas permis, mais seul le serveur accorde ou refuse (plan, règles de développement 3 et 4).
2. **Un utilisateur a un seul rôle** (BR-USR-01).
3. **Refus par défaut.** Un endpoint qui ne déclare aucune permission est refusé, et un test le détecte (architecture §5.3).
4. **Permissions stockées en base**, par entreprise (`Role`, `RolePermission`), et non codées en dur dans le Web ou le mobile. À la création d'une entreprise, chaque rôle reçoit les permissions de la matrice du §5.
5. **Pas d'éditeur de rôles dans le MVP.** Les permissions d'un rôle ne changent que par un paramètre de l'entreprise (§7). Les rôles personnalisés viendront après le MVP.

---

## 2. Rôles

### 2.1 Plateforme

| Rôle | Outil | Ce qu'il fait |
|---|---|---|
| `SUPER_ADMIN` | Web `/admin` | Crée les entreprises et leur administrateur, choisit leur mode, suspend ou réactive une entreprise (UC-90) |

Les comptes plateforme sont dans une table à part (`PlatformUser`), avec leur propre connexion. Un Super Admin n'a **aucun accès** aux données métier d'une entreprise dans le MVP. Les rôles `SUPPORT`, `FINANCE` et `TECH_ADMIN` viennent après le MVP.

### 2.2 Entreprise

| Rôle | Canal | Ce qu'il fait |
|---|---|---|
| `COMPANY_ADMIN` | Web | Tout ce que font le superviseur et le comptable, plus les utilisateurs, les prix, les paramètres et les imports (BR-USR-03) |
| `SUPERVISEUR` | Web | Organisation du terrain, clients, produits et parfums, quotas, objectifs, suivi, journées, appareils, lignes en attente, préparation, chargements cash van, exports |
| `COMPTABLE` | Web | Versements, dettes et paiements, exports |
| `PRE_VENDEUR` | Mobile | Journée, visites, commandes, création de clients, encaissement des dettes |
| `VENDEUR_CASH_VAN` | Mobile | Journée, visites, ventes, demandes perdues, encaissements, réception des chargements |
| `LIVREUR` | Mobile | Journée, réception du chargement, livraisons, encaissements |
| `MAGASINIER` | Mobile | Entrées, préparation, chargement, déchargement, inventaire |

Le **canal** est une propriété du rôle (`Role.channel`). Une session Web n'est acceptée que pour un rôle `WEB`, et une session mobile que pour un rôle `MOBILE` sur son appareil associé (BR-USR-02).

---

## 3. Contrôles de chaque requête

```text
1. Session valide, non révoquée                        → sinon 401
2. Canal de la session = canal du rôle                 → sinon 403 WRONG_CHANNEL
3. Appareil actif (rôles mobiles)                      → sinon 403 DEVICE_REVOKED
4. Entreprise active                                   → sinon 403 COMPANY_SUSPENDED
5. Permission déclarée par l'endpoint                  → sinon 403 FORBIDDEN
6. Module de la permission actif (modules.md)          → sinon 403 MODULE_DISABLED
7. Ressource dans le périmètre de l'utilisateur (§6)   → sinon 404 (on ne révèle pas son existence)
```

Le contrôle 7 renvoie 404 et non 403 : un utilisateur ne doit pas pouvoir deviner l'existence d'une ressource qui n'est pas à lui (protection contre l'IDOR).

Un appareil révoqué garde un seul droit : envoyer ses opérations en attente, créées avant sa révocation (BR-USR-11). L'endpoint `POST /sync/push` l'accepte dans ce cas précis, et seulement lui.

---

## 4. Catalogue des permissions

Format `ressource.action`. Le suffixe `.own` signifie « sur ses propres données » : ses visites, ses commandes, sa journée, sa tournée. Les permissions de lecture d'un rôle mobile sont limitées à son périmètre (§6).

### 4.1 Plateforme

| Permission | Description |
|---|---|
| `companies.read` | Lister et consulter les entreprises |
| `companies.create` | Créer une entreprise, son administrateur et son mode |
| `companies.update` | Modifier une entreprise et son mode |
| `companies.suspend` | Suspendre et réactiver une entreprise |
| `platform.audit.read` | Consulter l'audit plateforme |

### 4.2 Entreprise

| Groupe | Permission | Description | Module |
|---|---|---|---|
| Administration | `settings.read` | Consulter les paramètres de l'entreprise | Socle |
| | `settings.update` | Paramètres, P-01 à P-10, types de clients, jours fériés, motifs, dépôts et camions | Socle |
| | `modules.read` | Voir les modules actifs | Socle |
| | `users.read` | Lister et consulter les utilisateurs | Socle |
| | `users.create`, `users.update`, `users.disable` | Gérer les utilisateurs | Socle |
| | `devices.read` | Voir les appareils et leur état | Socle |
| | `devices.associate` | Générer un code d'association (ARC-04) | Socle |
| | `devices.revoke` | Révoquer une session, bloquer ou réactiver un appareil | Socle |
| | `audit.read` | Consulter l'audit de l'entreprise | Socle |
| | `imports.run` | Importer des clients et des produits en CSV | Socle |
| Catalogue | `products.read` | Consulter le catalogue, sans les prix | Socle |
| | `products.write` | Créer et modifier produits, parfums, gammes, catégories, unités | Socle |
| | `prices.read` | Voir les prix, paliers et bonus | Socle |
| | `prices.update` | Modifier les prix | Socle |
| | `price_tiers.update` | Modifier les paliers | Socle |
| | `bonuses.update` | Modifier les règles de bonus | Socle |
| Terrain | `territories.read` | Secteurs, parties, planning, affectations | Terrain* |
| | `territories.update` | Dessiner les polygones, affecter, planifier | Terrain* |
| | `customers.read` | Consulter les clients et leur dette | Socle |
| | `customers.create` | Créer un client | Socle |
| | `customers.update` | Modifier un client, forcer sa partie, valider un nouveau client | Socle |
| | `customers.disable` | Désactiver un client | Socle |
| | `customers.reschedule` | Reprogrammer une visite (UC-54) | Terrain* |
| | `quotas.read`, `quotas.update` | Quotas du jour | Socle |
| | `objectives.read`, `objectives.update` | Objectifs du mois | Socle |
| Journées et visites | `workdays.read` | Consulter les journées de tous | Terrain* |
| | `workdays.own` | Démarrer et clôturer sa journée | Terrain* |
| | `workdays.reopen` | Rouvrir une journée (UC-58) | Terrain* |
| | `workdays.force_close` | Clôturer d'office une journée (UC-64) | Terrain* |
| | `visits.read` | Consulter les visites de tous | Terrain* |
| | `visits.own` | Faire ses visites | Terrain* |
| Ventes | `orders.read` | Consulter les commandes et ventes de tous | Socle |
| | `orders.own` | Prendre, modifier, annuler ses commandes de prévente | `PRE_SALES` |
| | `pending_lines.process` | Accepter ou refuser les lignes en attente (UC-60) | `PRE_SALES` |
| | `sales.own` | Vendre depuis son camion | `CASH_VAN` |
| | `lost_demands.own` | Enregistrer une demande perdue | `CASH_VAN` |
| Stock | `stock.read` | Consulter le stock | `WAREHOUSE` |
| | `stock.receive` | Enregistrer une entrée au dépôt | `WAREHOUSE` |
| | `inventory.count` | Faire l'inventaire du dépôt | `WAREHOUSE` |
| | `loads.read` | Consulter les chargements et déchargements | `WAREHOUSE` |
| | `loads.plan` | Préparer le chargement d'un vendeur cash van (UC-62) | `CASH_VAN` |
| | `loads.load` | Valider un chargement dans un camion | `WAREHOUSE` |
| | `loads.receive` | Confirmer la réception de son chargement | `WAREHOUSE` |
| | `unloads.validate` | Décharger un camion | `WAREHOUSE` |
| Livraison | `preparation.launch` | Lancer la préparation d'une tournée (UC-61) | `DELIVERY` |
| | `preparation.do` | Préparer une tournée (UC-41) | `DELIVERY` |
| | `deliveries.read` | Consulter les livraisons de tous | `DELIVERY` |
| | `deliveries.own` | Livrer sa tournée | `DELIVERY` |
| Argent | `payments.read` | Consulter les paiements et les dettes | Socle |
| | `payments.collect_delivery` | Encaisser une livraison ou une vente | Socle |
| | `payments.collect_debt` | Encaisser une dette | Socle |
| | `settlements.read` | Consulter les versements | Socle |
| | `settlements.create` | Enregistrer un versement (UC-70) | Socle |
| Analyse | `reports.read` | Tableau du jour, carte du superviseur, fiches en consultation | `ANALYTICS` |
| | `reports.export` | Exports CSV (UC-63) | `ANALYTICS` |

\* **Terrain** : actif dès que `PRE_SALES` ou `CASH_VAN` est actif (BR-TEN-05).

Chacun lit et marque comme lues ses propres notifications sans permission particulière, et imprime les bons des opérations qu'il a faites.

---

## 5. Matrice rôles × permissions

✓ : accordée · ✓ᵖ : accordée sur son périmètre (§6) · ⚙ : selon un paramètre (§7) · — : refusée

| Permission | Admin | Superviseur | Comptable | Pré-vendeur | Cash van | Livreur | Magasinier |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `settings.read` | ✓ | ✓ | ✓ | ✓ᵖ | ✓ᵖ | ✓ᵖ | ✓ᵖ |
| `settings.update` | ✓ | — | — | — | — | — | — |
| `modules.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `users.read` | ✓ | ✓ | ✓ | — | — | — | — |
| `users.create`, `users.update`, `users.disable` | ✓ | — | — | — | — | — | — |
| `devices.read` | ✓ | ✓ | — | — | — | — | — |
| `devices.associate`, `devices.revoke` | ✓ | ✓ | — | — | — | — | — |
| `audit.read` | ✓ | — | — | — | — | — | — |
| `imports.run` | ✓ | — | — | — | — | — | — |
| `products.read` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `products.write` | ✓ | ✓ | — | — | — | — | — |
| `prices.read` | ✓ | ✓ | ✓ | ✓ᵖ | ✓ᵖ | ✓ᵖ | — |
| `prices.update`, `price_tiers.update`, `bonuses.update` | ✓ | ⚙ P-10 | — | — | — | — | — |
| `territories.read` | ✓ | ✓ | — | ✓ᵖ | ✓ᵖ | ✓ᵖ | — |
| `territories.update` | ✓ | ✓ | — | — | — | — | — |
| `customers.read` | ✓ | ✓ | ✓ | ✓ᵖ | ✓ᵖ | ✓ᵖ | — |
| `customers.create` | ✓ | ✓ | — | ✓ | ✓ | — | — |
| `customers.update`, `customers.disable` | ✓ | ✓ | — | — | — | — | — |
| `customers.reschedule` | ✓ | ✓ | — | — | — | — | — |
| `quotas.read` | ✓ | ✓ | — | ✓ᵖ | ✓ᵖ | — | — |
| `quotas.update` | ✓ | ✓ | — | — | — | — | — |
| `objectives.read` | ✓ | ✓ | ✓ | ✓ᵖ | ✓ᵖ | — | — |
| `objectives.update` | ✓ | ✓ | — | — | — | — | — |
| `workdays.read` | ✓ | ✓ | ✓ | — | — | — | — |
| `workdays.own` | — | — | — | ✓ | ✓ | ✓ | — |
| `workdays.reopen`, `workdays.force_close` | ✓ | ✓ | — | — | — | — | — |
| `visits.read` | ✓ | ✓ | — | — | — | — | — |
| `visits.own` | — | — | — | ✓ | ✓ | — | — |
| `orders.read` | ✓ | ✓ | ✓ | ✓ᵖ | ✓ᵖ | ✓ᵖ | ✓ᵖ |
| `orders.own` | — | — | — | ✓ | — | — | — |
| `pending_lines.process` | ✓ | ✓ | — | — | — | — | — |
| `sales.own`, `lost_demands.own` | — | — | — | — | ✓ | — | — |
| `stock.read` | ✓ | ✓ | — | — | ✓ᵖ | ✓ᵖ | ✓ |
| `stock.receive`, `inventory.count` | — | — | — | — | — | — | ✓ |
| `loads.read` | ✓ | ✓ | ✓ | — | ✓ᵖ | ✓ᵖ | ✓ |
| `loads.plan` | ✓ | ✓ | — | — | — | — | — |
| `loads.load`, `unloads.validate` | — | — | — | — | — | — | ✓ |
| `loads.receive` | — | — | — | — | ✓ | ✓ | — |
| `preparation.launch` | ✓ | ✓ | — | — | — | — | — |
| `preparation.do` | — | — | — | — | — | — | ✓ |
| `deliveries.read` | ✓ | ✓ | ✓ | — | — | — | — |
| `deliveries.own` | — | — | — | — | — | ✓ | — |
| `payments.read` | ✓ | ✓ | ✓ | ✓ᵖ | ✓ᵖ | ✓ᵖ | — |
| `payments.collect_delivery` | — | — | — | — | ✓ | ✓ | — |
| `payments.collect_debt` | — | — | — | ✓ | ✓ | ⚙ P-08 | — |
| `settlements.read` | ✓ | ✓ | ✓ | — | — | — | — |
| `settlements.create` | ✓ | — | ✓ | — | — | — | — |
| `reports.read` | ✓ | ✓ | ✓ | — | — | — | — |
| `reports.export` | ✓ | ✓ | ✓ | — | — | — | — |

**Remarques**
- L'admin n'a aucune permission `.own`, comme le superviseur et le comptable : il ne fait jamais une visite, une commande ou une livraison (BR-USR-05). « Tout ce que fait le superviseur » (BR-USR-03) concerne la gestion, pas le terrain.
- Le superviseur n'a pas `settlements.create` : seul le comptable, ou l'admin, enregistre un versement.
- Le magasinier lit les commandes de son périmètre (les tournées à préparer), mais pas les prix : la préparation se fait en quantités.
- Les mobiles reçoivent la plupart de leurs lectures par la synchronisation, filtrée par le même périmètre.

---

## 6. Périmètre des données

Les rôles Web voient **toute l'entreprise** : il n'y a pas de découpage par équipe dans le MVP (BR-USR-04).

Les rôles mobiles voient leur **périmètre**, appliqué par le serveur en plus de la permission :

| Rôle | Périmètre |
|---|---|
| Pré-vendeur | Son secteur et ses clients ; ses journées, visites, commandes et paiements ; ses quotas et objectifs |
| Vendeur cash van | Idem, plus son camion, ses chargements et déchargements |
| Livreur | Les secteurs qui lui sont affectés ; sa tournée, ses clients et leurs dettes ; son camion, ses chargements et déchargements ; ses journées et paiements |
| Magasinier | Les dépôts ; les tournées à préparer ; les chargements, déchargements et inventaires |

Le détail des données téléchargées est dans [database.md §17](database.md#17-données-téléchargées-par-le-téléphone).

---

## 7. Permissions qui dépendent des paramètres

Deux paramètres de BR-TEN-08 changent des permissions. Le serveur applique le changement aux permissions du rôle, dans la même transaction que la nouvelle version des paramètres. Le contrôle reste donc un simple contrôle de permission (architecture §7.3).

| Paramètre | Effet |
|---|---|
| **P-08** (le livreur encaisse les anciennes dettes) | Oui : `payments.collect_debt` est ajoutée au rôle `LIVREUR`. Non : elle lui est retirée |
| **P-10** (le superviseur modifie prix, paliers et bonus) | Oui : `prices.update`, `price_tiers.update` et `bonuses.update` sont ajoutées au rôle `SUPERVISEUR`. Non : elles lui sont retirées |

Comme tous les paramètres, le changement prend effet au prochain démarrage de journée pour les rôles mobiles (ARC-12). Pour les rôles Web, il prend effet à la prochaine requête.

Les autres paramètres (P-01 à P-07, P-09) ne changent pas qui peut faire quoi, mais comment une opération est traitée. Ils sont lus par les règles métier, pas par les guards.

---

## 8. Interdits absolus

Ces permissions ne peuvent **jamais** être accordées à ces rôles, quels que soient les paramètres ou un futur éditeur de rôles. Le serveur refuse de les enregistrer, et un test vérifie la liste.

| Rôles | Ne peuvent jamais avoir | Règle |
|---|---|---|
| `COMPANY_ADMIN`, `SUPERVISEUR`, `COMPTABLE` | Toute permission `.own`, `payments.collect_*` | BR-USR-05 : la gestion ne crée ni ne modifie une commande, une vente, une visite, une livraison ou un paiement |
| `PRE_VENDEUR`, `VENDEUR_CASH_VAN`, `LIVREUR`, `MAGASINIER` | `settings.update`, `users.*` sauf lecture de soi, `prices.update`, `price_tiers.update`, `bonuses.update`, `customers.update`, `customers.disable`, `workdays.reopen`, `workdays.force_close` | Un utilisateur terrain ne modifie ni les règles ni les données de référence (BR-CLI-04) |
| Tous les rôles d'entreprise | Toute permission plateforme | Le Super Admin est séparé des rôles d'entreprise (plan, règle 14) |

---

## 9. Affichage sur le Web et le mobile

- À la connexion, l'API renvoie le rôle, la liste des permissions effectives et les modules actifs (endpoint `GET /me`, voir [api.md](api.md)).
- Le **Web** masque un menu, un bouton ou une page sans la permission requise. Une URL tapée à la main affiche « Accès refusé », et l'API refuse de toute façon.
- Le **mobile** choisit son groupe d'écrans selon le rôle (architecture §9.1), puis masque les actions sans permission. Il reçoit ses permissions à chaque synchronisation.
- Une action masquée n'est jamais seulement grisée sans explication : si elle est visible mais indisponible (par exemple « quota atteint »), la raison est affichée.

---

## 10. Tests

| Test | Ce qu'il vérifie |
|---|---|
| Couverture des endpoints | Chaque route déclare une permission ; aucune n'est publique par oubli |
| Matrice | Pour chaque rôle et chaque endpoint, l'appel est accepté ou refusé conformément au §5 |
| Périmètre | Un pré-vendeur ne lit ni les clients, ni les commandes d'un autre secteur (réponse 404) |
| Canal | Un superviseur ne peut pas ouvrir de session mobile ; un livreur ne peut pas ouvrir de session Web |
| Interdits | Le §8 est respecté par les permissions par défaut, et le serveur refuse de les accorder |
| Paramètres | Basculer P-08 et P-10 ajoute ou retire bien les permissions concernées |
| Appareil révoqué | Seul `POST /sync/push` reste accepté, pour les opérations antérieures à la révocation |
