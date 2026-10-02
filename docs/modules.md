# Modes et modules — SellWasl

> **Phase 1 — rédigé le 2026-10-02.**
> Ce document précise le système de modules du MVP : ce que contient chaque module, comment le mode d'une entreprise les active, et comment le serveur, le Web et le mobile appliquent un module inactif. Il applique BR-TEN-03 à BR-TEN-05.
>
> Documents liés : [rbac.md](rbac.md), [database.md](database.md), [api.md](api.md), [architecture.md](architecture.md).

## Sommaire

1. [Principes](#1-principes)
2. [Socle commun](#2-socle-commun)
3. [Modules du MVP](#3-modules-du-mvp)
4. [Modes de vente](#4-modes-de-vente)
5. [Rôles et modules](#5-rôles-et-modules)
6. [Paramètres et modules](#6-paramètres-et-modules)
7. [Application d'un module inactif](#7-application-dun-module-inactif)
8. [Changement de mode](#8-changement-de-mode)
9. [Après le MVP](#9-après-le-mvp)
10. [Tests](#10-tests)

---

## 1. Principes

1. **Le mode décide des modules.** Dans le MVP, le Super Admin choisit le mode de l'entreprise : Prévente, Cash van ou Mixte. Les modules actifs en découlent (BR-TEN-03). Il n'y a pas d'activation module par module.
2. **Le socle commun est toujours actif.** Il contient tout ce dont les deux modes ont besoin.
3. **Un module inactif n'existe pas pour l'entreprise** : invisible sur le Web et le mobile, refusé par l'API (BR-TEN-04).
4. **Un module ne supprime jamais de données.** Désactiver un module masque ses données sans les effacer ; les réactiver les rend de nouveau visibles.
5. **Modules et permissions sont deux contrôles distincts.** Une permission dit *qui* peut agir ; un module dit *si la fonction existe* dans l'entreprise. Un rôle ne donne jamais accès à un module inactif (plan, phase 7).

---

## 2. Socle commun

Toujours actif, quel que soit le mode. Code : `CORE` (il n'a pas de ligne dans `CompanyModule`).

| Domaine | Contenu |
|---|---|
| Entreprise | Paramètres, P-01 à P-10, types de clients, jours travaillés et fériés, motifs |
| Accès | Utilisateurs, rôles, appareils, sessions |
| Catalogue | Produits, parfums, gammes, catégories, unités, prix, paliers, bonus |
| Clients | Fiches, dettes, création par le vendeur, clients à revoir, imports CSV |
| Quotas et objectifs | Quotas du jour, objectifs du mois |
| Argent | Paiements, dettes, récapitulatifs de journée, versements |
| Système | Synchronisation, notifications, audit, impression |

**Fonctions terrain partagées.** Les secteurs, parties, planning, journées de travail et visites sont actifs **dès que `PRE_SALES` ou `CASH_VAN` est actif** (BR-TEN-05). Comme toute entreprise du MVP a l'un des deux, ces fonctions sont en pratique toujours présentes. Dans le code, elles sont rattachées au groupe `FIELD`, pour qu'un futur mode sans vente terrain puisse les désactiver.

---

## 3. Modules du MVP

| Code | Nom | Contenu | Modules NestJS (architecture §5.1) | Écrans Web | Écrans mobiles |
|---|---|---|---|---|---|
| `PRE_SALES` | Prévente | Commandes de prévente, visites par téléphone, lignes en attente, ventes perdues, date de livraison au jour ouvré suivant | `orders` | Commandes, lignes en attente | Pré-vendeur : commande, commandes du jour |
| `DELIVERY` | Livraison | Tournées, lancement et préparation, livraison, échecs, reprogrammation (P-05) | `preparation`, `deliveries` | Préparation, tournées, livraisons | Livreur ; magasinier : préparation |
| `CASH_VAN` | Cash van | Ventes immédiates depuis le camion, demandes perdues, chargement préparé par le superviseur, rechargements (P-07) | `cashvan` | Chargements cash van | Vendeur cash van |
| `WAREHOUSE` | Entrepôt et stock | Dépôts, camions, stock, mouvements, entrées, inventaires, chargements, déchargements | `inventory` | Stock, mouvements, inventaires | Magasinier : entrées, chargements, déchargements, inventaire |
| `ANALYTICS` | Analyse | Tableau du jour, carte du superviseur, fiches en consultation, statistiques des ventes et demandes perdues, exports CSV | `reports`, `exports` | Tableau de bord, carte, exports | — |

**Dépendances** : `DELIVERY` suppose `PRE_SALES` et `WAREHOUSE` ; `CASH_VAN` suppose `WAREHOUSE`. Les modes du §4 les respectent toujours.

**Ce qui n'est dans aucun module du MVP** : `COMMERCIAL` (gestion commerciale avancée, saisie de commandes au bureau, promotions complexes) vient après le MVP. `PRODUCTION` est hors V3 (plan, phase 32).

---

## 4. Modes de vente

| Mode | `PRE_SALES` | `DELIVERY` | `CASH_VAN` | `WAREHOUSE` | `ANALYTICS` |
|---|:-:|:-:|:-:|:-:|:-:|
| **Prévente** | ✓ | ✓ | — | ✓ | ✓ |
| **Cash van** | — | — | ✓ | ✓ | ✓ |
| **Mixte** | ✓ | ✓ | ✓ | ✓ | ✓ |

En mode Mixte, un même client peut être servi en prévente par un secteur et en cash van par un autre, si ces secteurs servent des types de clients différents (BR-ORG-03). Chaque vendeur reste dans un seul mode, celui de son rôle.

À la création de l'entreprise (UC-90), le serveur crée dans une même transaction :
- les lignes `CompanyModule` du mode ;
- les rôles et leurs permissions (rbac.md §5), y compris ceux des modules inactifs, pour qu'un changement de mode n'ait rien à créer ;
- la première version des paramètres, avec les valeurs par défaut ;
- les motifs système (database.md §5) et le type de client « Détail ».

---

## 5. Rôles et modules

Un rôle mobile n'a de sens que si son module est actif.

| Rôle | Module requis |
|---|---|
| `PRE_VENDEUR` | `PRE_SALES` |
| `LIVREUR` | `DELIVERY` |
| `VENDEUR_CASH_VAN` | `CASH_VAN` |
| `MAGASINIER` | `WAREHOUSE` |
| `COMPANY_ADMIN`, `SUPERVISEUR`, `COMPTABLE` | Socle |

- Le Web ne propose pas un rôle dont le module est inactif à la création d'un utilisateur (UC-80), et l'API le refuse.
- Si le module d'un rôle devient inactif (§8), ses utilisateurs ne peuvent plus se connecter. Ils ne sont pas désactivés : ils retrouvent leur accès si le module revient.

---

## 6. Paramètres et modules

Chaque paramètre réglable ne s'affiche que si le module qu'il concerne est actif.

| Paramètre | Module |
|---|---|
| P-01 travail les jours non travaillés, P-02 visites hors programme, P-09 nouveau client | Fonctions terrain (`FIELD`) |
| P-03 bonus et quota, P-04 recalcul, P-10 prix par le superviseur | Socle |
| P-05 livraison échouée, P-08 dettes par le livreur | `DELIVERY` |
| P-06 fin de journée du camion | `WAREHOUSE` (camions de livreur ou de vendeur cash van) |
| P-07 rechargements | `CASH_VAN` |

---

## 7. Application d'un module inactif

| Couche | Comportement |
|---|---|
| **API** | Guard `ModuleGuard` : chaque contrôleur ou endpoint de module porte `@RequireModule('CASH_VAN')`. Module inactif → `403 MODULE_DISABLED`, même pour un appel direct (BR-TEN-04). Les modules actifs sont lus dans le contexte de la requête, mis en cache 60 secondes par entreprise, et le cache est vidé à chaque changement de mode |
| **Synchronisation** | Une opération d'un module inactif est refusée (`REJECTED`, code `MODULE_DISABLED`). Le serveur n'envoie pas au téléphone les données d'un module inactif |
| **Web** | Les menus, pages et widgets d'un module inactif n'apparaissent pas. Une URL tapée à la main affiche « Fonction non disponible pour votre entreprise » |
| **Mobile** | Les écrans d'un module inactif n'existent pas dans la navigation. Les modules actifs arrivent avec chaque synchronisation |
| **Rapports et exports** | Ils ne montrent pas les données d'un module inactif |

Un test parcourt toutes les routes de l'API et vérifie que chaque route d'un module déclare `@RequireModule` (§10).

---

## 8. Changement de mode

Seul le Super Admin change le mode d'une entreprise (`companies.update`). L'action est inscrite dans l'audit plateforme et dans l'audit de l'entreprise.

| Changement | Conditions et effets |
|---|---|
| Ajout de modules (Prévente → Mixte, Cash van → Mixte) | Toujours possible. Les nouveaux rôles deviennent utilisables, les écrans apparaissent à la prochaine synchronisation |
| Retrait de modules (Mixte → Prévente, Mixte → Cash van, Prévente ↔ Cash van) | **Refusé** tant qu'il reste du travail en cours dans les modules retirés : journées ouvertes des rôles concernés, tournées non clôturées, chargements non reçus, déchargements non validés, versements non enregistrés. Le Super Admin voit la liste de ce qui bloque |
| Après un retrait | Les données restent en base, masquées. Les utilisateurs des rôles concernés ne peuvent plus se connecter (§5) ; leurs appareils restent associés |

---

## 9. Après le MVP

```text
Plan SaaS → modules autorisés (PlanModule) → modules choisis par l'entreprise (CompanyModule) → permissions → routes et API
```

- Les plans et abonnements définiront les modules autorisés. L'entreprise activera elle-même les modules de son plan, depuis `/app/modules`.
- Le module `COMMERCIAL` ajoutera la saisie de commandes au bureau (sources `WHATSAPP`, `MANUAL`…), les promotions complexes et les rapports commerciaux détaillés.
- La structure du MVP (`CompanyModule`, `ModuleGuard`, `@RequireModule`) reste la même : seule la façon de remplir `CompanyModule` change.

---

## 10. Tests

| Test | Ce qu'il vérifie |
|---|---|
| Couverture | Chaque route d'un module déclare `@RequireModule` |
| Appel direct | Une entreprise en mode Cash van reçoit `403 MODULE_DISABLED` sur toutes les routes de `PRE_SALES` et `DELIVERY`, même avec un rôle qui a la permission |
| Synchronisation | Une opération `order.confirm` envoyée par une entreprise en mode Cash van est refusée |
| Changement de mode | Le retrait d'un module est refusé tant qu'une journée ou une tournée est en cours ; les données sont masquées puis retrouvées après réactivation |
| Rôles | Impossible de créer un livreur dans une entreprise en mode Cash van |
