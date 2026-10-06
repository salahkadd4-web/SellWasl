# Paie interne

Phase 21 bis. Spécification : `docs/superpowers/specs/2026-10-06-payroll-incentives-design.md`.

SellWasl calcule un **net interne** : ce que l'entreprise doit à l'employé après primes, acomptes et retenues. Les cotisations légales (CNAS, IRG) n'y sont pas : la paie légale reste faite par le comptable avec son outil habituel.

## Règles

- Tout utilisateur peut avoir une rémunération ; seuls ceux qui en ont une le mois entrent dans la paie.
- Rémunération : salaire mensuel, date d'effet. Un nouveau salaire ferme le précédent la veille ; l'historique n'est jamais effacé. Salaire d'un mois = celui en vigueur le 1er (sinon le premier qui commence dans le mois).
- Paramètres (`companySettings.payroll`) : `enabled` (défaut non), `advancesEnabled` (défaut non), `advanceMaxPercent` (défaut 50), `weekStartsOn` (défaut samedi), `schedule` (défaut 30 → 100 %). La somme des échéances doit faire 100 %, jours croissants ; un jour après la fin du mois devient le dernier jour.
- Le calcul est fait par le serveur seul (`business-rules/payroll.ts`).

## Calcul d'une fiche

```text
Net = salaire de base
    + primes validées dont la période se termine dans le mois
    + objectifs mensuels (vendeur, livreur) du mois M − décalage de versement
    + ajustements positifs
    − acomptes payés du mois
    − retenues approuvées (du mois, ou sans mois)
    − ajustements négatifs
```

Chaque ligne garde sa source (`sourceType`, `sourceId`) : `EmployeeCompensation`, `Incentive`, `Objective`, `DriverObjective`, `PayrollAdjustment`, `SalaryAdvance`, `PayrollDeduction`. Une retenue née d'un écart remonte à l'écart, puis à la ligne de déchargement ou au versement.

## Cycle d'une paie

| Statut | Passage | Effet |
|---|---|---|
| `OPEN` | création du mois (paie activée) | — |
| `CALCULATED` | calcul ou recalcul | fiches remplacées |
| `APPROVED` | approbation | primes `APPLIED`, acomptes `DEDUCTED`, retenues `APPLIED`, écarts `DEDUCTION_APPLIED`, ajustements rattachés, échéances créées ; refusée si un net est négatif ou si une source a changé |
| `PAID` | dernière échéance payée | chaque échéance une seule fois |
| `CLOSED` | clôture | plus aucune modification |

Une paie approuvée ou clôturée ne se recalcule pas et n'accepte plus d'ajustement : on corrige par un ajustement du mois suivant. Toutes les étapes verrouillent la période (`FOR UPDATE`) et écrivent dans l'audit.

## Acomptes

`REQUESTED` → `APPROVED` (employé rémunéré ce mois, total ≤ plafond, paie du mois non approuvée) → `PAID` → `DEDUCTED`. Refus possible tant qu'il n'est pas payé. Acomptes désactivés : aucune création, historique visible.

## Exemple (scénario E2E, `apps/api/test/payroll.test.ts`)

```text
Salaire              60 000
+ Prime               1 600   (80 cartons × 20 DA, semaine du 07/08/2027)
- Acompte            10 000
- Retenue             2 000   (écart de 2 cartons × 1 000 DA, responsabilité confirmée)
-----------------------------
Net                  49 600 DA   payé 24 800 le 15 et 24 800 le 30
```

## Droits

| Droit | Rôles |
|---|---|
| `compensation.read` | administrateur, comptable |
| `compensation.update` | administrateur |
| `payroll.read` | administrateur, comptable |
| `payroll.manage` | comptable |
| `advances.manage`, `deductions.manage` | comptable |
| `pay.mine` | tous (ses seules données) |

Paramètres de paie : `settings.update` (administrateur).
