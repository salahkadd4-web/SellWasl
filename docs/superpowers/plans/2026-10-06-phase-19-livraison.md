# Phase 19 — Livraison, tournées et objectifs du livreur : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer depuis le téléphone du livreur (réception, tournée, livraison, échec, encaissement), suivre les tournées sur le Web, et calculer l'objectif du livreur selon des règles réglées par l'entreprise.

**Architecture:** Module `apps/api/src/delivery/` : opérations du téléphone enregistrées dans `SyncHandlers` (comme les commandes), lectures `/me/*`, recalcul partagé avec la préparation (`OrderRepricer`), registre de stock pour les sorties du camion. Objectifs du livreur dans `supervision/`. Écrans `apps/mobile/app/driver/*`.

**Tech Stack:** NestJS 11, Prisma 7, Zod 4, Vitest ; Next.js ; Expo Router.

**Spec:** `docs/superpowers/specs/2026-10-06-phase-19-livraison-design.md`

## Global Constraints

- Sorties de stock par `StockLedger.apply` (`OUT`, source `DELIVERY`).
- Montants en DA entiers (`BigInt` en base) ; quantités en unité de base, saisies dans l'unité de la ligne.
- Opérations : `opId` idempotent, `deviceSeq`, `sendOperation` côté mobile ; `isSameAction` : champs générés `deliveryId`, `number`.
- Tests d'intégration : dates réservées (`2027-03-*`), journées et tournées closes, commandes annulées en fin de suite.
- Web et mobile : mêmes modèles que les phases 17 et 18.

## Review Focus

1. Deux confirmations simultanées de la même livraison : une seule (verrou sur la commande) — test tâche 5.
2. Vente ajoutée d'un article absent du camion : refus, rien écrit — test tâche 5.
3. Client sans crédit qui paie moins que le dû : refus — test tâche 5.
4. Livraison échouée reprogrammée puis déchargement : réservation refaite au dépôt — test tâche 6.
5. Taux de retour sans aucun chargement dans le mois : score du taux 0, pas de division par zéro — test tâche 8.

---

### Task 1: Règles pures (paiement, reprogrammation, objectif du livreur)
`packages/business-rules/src/delivery.ts` (+ tests) : `minimumCash`, `shouldReschedule`, `returnRate`, `tierScore`, `driverScore`, `driverBonus`.

### Task 2: Schémas, DTO, paramètres
`packages/validation/src/delivery.ts` : payloads `loadReceivePayload`, `deliveryConfirmPayload`, `deliveryFailPayload`, `deliveryPreviewSchema`, `driverObjectivesSettingsSchema`, `putDriverObjectivesSchema`, DTO (`DriverRouteDto`, `DeliveryPreviewDto`, `TruckStockDto`, `DriverObjectiveDto`, `RouteProgress`). `OPERATION_TYPES` + `load.receive`, `delivery.confirm`, `delivery.fail`. `companySettingsSchema.driverObjectives`. `business-rules/sync.ts` : champs générés.

### Task 3: Données
Migration : table `driver_objective` ; motif `DELIVERY_FAILURE` « Non livrée » existe déjà. Prisma generate.

### Task 4: Recalcul partagé et réception du chargement
`OrderRepricer` extrait de `PreparationService` (prix, bonus plafonnés) ; `delivery/load-receive.service.ts` (`load.receive`) ; tests : réception avec manquant → ajustement, commandes `OUT_FOR_DELIVERY`.

### Task 5: Livraison confirmée, aperçu, lectures du livreur
`delivery/delivery.service.ts` (`delivery.confirm`, aperçu), `delivery/driver-route.service.ts` (`/me/route`, `/me/truck-stock`), contrôleur. Tests : totale, partielle (palier), ajoutée, crédit, minimum refusé, article absent du camion, concurrence.

### Task 6: Échec, reprogrammation, clôture, déchargement
`delivery.fail` ; crochet de clôture (`WorkdayService.onClose`) ; `UnloadsService` (livré, offert, réservation des reprogrammées). Tests.

### Task 7: Avancement des tournées
`RoutesService` : `progress` des tournées lancées. Test.

### Task 8: Objectifs du livreur (serveur)
`supervision/driver-objectives.service.ts`, routes, `/me/driver-objectives`. Tests.

### Task 9: Web — avancement et objectifs des livreurs
Tournées (avancement) ; `components/objectives-tabs.tsx` ; page `/app/objectifs/livreurs`.

### Task 10: Mobile — livreur : socle, journée, réception
Routage du rôle `LIVREUR` → `driver` ; tableau de bord, réception, profil.

### Task 11: Mobile — tournée, livraison, échec, objectifs
Liste triée par distance et carte, livraison avec aperçu et encaissement, échec, objectifs.

### Task 12: Documentation, vérification, fusion
`docs/api.md`, `plan_VF.md` ; CI locale ; fusion dans `main`, push.
