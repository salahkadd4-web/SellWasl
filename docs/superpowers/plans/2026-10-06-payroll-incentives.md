# Paie, primes, acomptes, retenues et écarts : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaîne complète écart → retenue, acompte, prime, paie mensuelle avec échéances, traçable jusqu'à la source.

**Architecture:** Règles pures dans `business-rules/payroll.ts` ; modèles Prisma nouveaux, reliés aux existants (ligne de déchargement, versement, utilisateur) ; modules Nest `discrepancies`, `payroll` (rémunération, acomptes, retenues, primes, paie) ; le backend calcule seul les montants.

**Tech Stack:** NestJS 11, Prisma 7, Zod 4, Next.js, Expo, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-payroll-incentives-design.md`

## Global Constraints

- Montants entiers en DA (BigInt en base) ; jamais calculés par le Web ou le mobile.
- Statuts incompatibles → `409` ; règle métier → `422` ; données d'une autre entreprise → `404`.
- Chaque opération financière écrit dans `AuditLog` (avant, après) dans sa transaction.
- Opérations à plusieurs écritures : une transaction ; période de paie verrouillée (`FOR UPDATE`) pendant calcul, approbation, paiement, clôture.
- Tables nouvelles [S] : colonnes standard et déclencheur `sync_row_change`.
- Tests : base partagée, jours et mois réservés, remise en état en fin de suite.

## Review Focus

- Double approbation, double paiement d'une échéance, double retenue d'un même écart, double prime d'une même période : refusés (`409` ou contrainte unique).
- Paie clôturée ou approuvée : recalcul, ajustement et paiement hors règle refusés.
- Acompte au-delà du plafond, acomptes désactivés, employé sans rémunération : `422`.
- Calendrier dont la somme ≠ 100 % : `400`.
- Employé : `/me/pay` ne rend que ses propres données ; autre entreprise : `404`.

---

### Task 1: Règles pures, droits, paramètres, schémas de validation
- `business-rules/src/payroll.ts` + tests : `validateSchedule`, `installments(net, schedule, month)`, `incentiveAmount(rule, { quantity, revenue })`, `netPay(lines)`, `weekStart(date, weekStartsOn)`, `advanceAllowed`.
- Droits et rôles ; `companySettings.payroll` ; schémas et DTO dans `validation/src/payroll.ts`.

### Task 2: Schéma Prisma et migration
- `Discrepancy`, `EmployeeCompensation`, `SalaryAdvance`, `PayrollDeduction`, `IncentiveRule`, `Incentive`, `PayrollPeriod`, `PayrollEntry`, `PayrollLine`, `PayrollPayment`, `PayrollAdjustment` ; `Settlement.note` ; droits ajoutés aux rôles existants.

### Task 3: Écarts et rapprochement
- Écarts créés au déchargement et au versement ; revue, décision (retenue `PENDING`) ; détail d'un versement ; valeur unitaire et valeur de l'écart au déchargement ; correction du réalisé des objectifs mensuels.

### Task 4: Rémunération et paramètres de paie

### Task 5: Acomptes et retenues

### Task 6: Primes (règles, calcul hebdomadaire ou mensuel, validation)

### Task 7: Paie (périodes, calcul, approbation, échéances, clôture, ajustements, tableau de bord, `/me/pay`)

### Task 8: Scénario E2E Ahmed et isolation entre entreprises

### Task 9: Web

### Task 10: Mobile

### Task 11: Documentation, CI, fusion locale
- `docs/payroll.md`, `docs/incentives.md`, `docs/stock-discrepancies.md`, `docs/settlements.md`, `docs/api.md`, `plan_VF.md` (phase 21 bis).
