# Phase 20 — Cash van, pointage, impression, versements : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendre en cash van depuis le camion, pointer le camion au démarrage, imprimer les bons, et enregistrer les versements au comptable.

**Architecture:** Opérations du téléphone dans `SyncHandlers` (`truck.check`, `sale.confirm`, `lost_demand.create`, `receipt.reprint`) ; lectures `/me/*` ; services `delivery/` (pointage, vente) et `accounting/` (versements, dettes) ; écrans Expo et pages Next.

**Tech Stack:** NestJS 11, Prisma 7, Zod 4, Vitest ; Next.js ; Expo Router ; ESC/POS sur Bluetooth.

**Spec:** `docs/superpowers/specs/2026-10-06-phase-20-cash-van-design.md`

## Global Constraints

- Variations de stock par `StockLedger.apply` ; sorties du camion source `DELIVERY`.
- Paiement : `minimumCash` (BR-PAY-03), dette par `CustomerDebtEntry`.
- Tests : dates réservées `2027-05-*`, journées et tournées closes en fin de suite.
- Ne pas pousser : fusion locale dans `main`.

## Review Focus

1. Vente avant le pointage : refusée — test tâche 5.
2. Vente au-delà du stock du camion : refusée, rien écrit — test tâche 5.
3. Deux versements pour la même journée : un seul — test tâche 7.
4. Pointage d'un camion vide sans chargement : accepté, rien à ajuster — test tâche 3.
5. Réimpression d'un numéro inconnu : refus — test tâche 6.

---

### Task 1: Règles pures — `daySummary`, `settlementGap` (+ tests)
### Task 2: Schémas et DTO — payloads, opérations, DTO (bons, récapitulatif, versements, dettes)
### Task 3: Pointage du camion — `truck.check`, `GET /me/truck-check`, garde « pointé » sur livraison et vente ; `/me/truck-stock` en `stock.read`
### Task 4: Chargement cash van préparé puis validé — `/loads/plan`, `/loads/planned`, `/loads/:id/validate`, `/loads/last`
### Task 5: Vente cash van — catalogue du camion, `sale.confirm`, `lost_demand.create`
### Task 6: Bons, récapitulatif, réimpression — `/me/receipts`, `/me/day-summary`, `/workdays/:id/summary`, `receipt.reprint`
### Task 7: Comptabilité — `/settlements`, `/debtors`, `/payments`, export CSV
### Task 8: Web — chargement cash van (préparer, valider) ; Versements ; Dettes et paiements ; récapitulatif
### Task 9: Mobile — pointage (livreur, cash van), stock du camion du cash van, position du livreur
### Task 10: Mobile — vente cash van, demande perdue
### Task 11: Mobile — impression (imprimante, bons, dette, historique, duplicata, récapitulatif)
### Task 12: Documentation, vérification, fusion locale
