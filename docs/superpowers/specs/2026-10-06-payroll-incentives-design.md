# Paie, primes, acomptes, retenues et écarts (conception)

Source : mission « Finaliser et compléter SellWasl » (paie et rapprochement), validée par l'utilisateur le 2026-10-06. Hors de `plan_VF.md` : ajoutée comme phase 21 bis.

## Décisions de l'utilisateur

- Toute la mission, réponses recommandées choisies d'office.
- Net **interne** : salaire de base + primes + objectifs + ajustements positifs − acomptes − retenues − ajustements négatifs. Pas de CNAS ni d'IRG (la paie légale reste hors de SellWasl).
- Tout utilisateur de l'entreprise peut avoir une rémunération ; seuls ceux qui en ont une entrent dans la paie. Pas de modèle « employé » séparé.
- Branche `feat/payroll-incentives-complete`, fusion dans `main` en local, sans push.

## Audit (existant réutilisé)

- Retour du véhicule : la **clôture de journée du livreur vaut déclaration de retour** ; le magasinier décharge (Web et mobile) : théorique, compté, écart avec motif, état constaté (phases 17 et 21). Le contrôle validé est la validation de l'écart par le magasinier.
- Versement (`Settlement`) : attendu, remis, écart, un par journée (phase 20).
- Objectifs mensuels du vendeur (`Objective`) et du livreur (`DriverObjective`) : prime estimée, décalage de versement `objectivePaymentDelayMonths` (phases 16 et 19).
- Audit (`AuditLog` : avant, après, acteur), RBAC, isolation par entreprise : réutilisés.
- Défaut corrigé : le réalisé d'un objectif mensuel multipliait la quantité livrée en unité de base par le prix de l'unité de la ligne ; il devient la somme des montants livrés (`lineAmount`).

## 1. Données

### Écarts (`Discrepancy`) [S]

- `kind` : `STOCK` (ligne de déchargement à écart non nul) ou `FINANCIAL` (versement à écart non nul).
- `status` : `VALIDATED` → (`UNDER_REVIEW`) → `RESOLVED` (pas de responsabilité) | `REJECTED` (écart non fondé) | `DEDUCTION_PENDING` → `DEDUCTION_APPROVED` → `DEDUCTION_APPLIED` ; une retenue refusée ramène l'écart à `RESOLVED`.
- Champs : `userId` (agent concerné : conducteur du camion ou agent du versement), `workdayId`, `date`, `unloadLineId?` (unique), `settlementId?` (unique), `productVariantId?`, `qty?` (signé, unité de base), `unitValue?`, `amount` (signé, DA : négatif = manque), `cause?` (motif du magasinier), `validatedByUserId`, `validatedAt`, `decisionNote?`, `decidedByUserId?`, `decidedAt?`.
- Création dans la transaction qui constate l'écart : validation du déchargement (une par ligne à écart, valeur = prix moyen des ventes du jour, comme les faits de retour) et enregistrement du versement (écart ≠ 0).
- Seul un manque (`amount < 0`) peut donner une retenue, d'au plus `|amount|`.

### Rémunération (`EmployeeCompensation`) [S]

- `userId`, `baseSalary` (DA par mois, ≥ 0), `effectiveFrom` (date), `effectiveTo?`, `note?`.
- Une nouvelle rémunération ferme la précédente (`effectiveTo` = veille) ; `effectiveFrom` postérieur à celui de la rémunération en cours ; jamais de suppression : l'historique reste.
- Salaire d'un mois = rémunération en vigueur le premier jour du mois (ou, à défaut, la première qui commence dans le mois).

### Paramètres de paie (`companySettings.payroll`)

- `enabled` (défaut `false`), `advancesEnabled` (défaut `false`), `advanceMaxPercent` (1–100, défaut 50), `weekStartsOn` (jour, défaut `SAT`), `schedule` : `[{ day: 1–31, percent: 1–100 }]`, jours croissants et uniques, somme = 100 ; défaut `[{ day: 30, percent: 100 }]`. Jour 31 ou au-delà de la fin du mois = dernier jour du mois.
- Une paie ou un acompte se crée seulement si la paie est activée ; un acompte seulement si les acomptes le sont. L'historique reste visible quand ils sont désactivés.

### Acomptes (`SalaryAdvance`) [S]

- `userId`, `month` (mois de paie où il sera déduit), `amount` (> 0), `reason?`, `status` : `REQUESTED` → `APPROVED` | `REJECTED` ; `APPROVED` → `PAID` ; `PAID` → `DEDUCTED` (à l'approbation de la paie du mois). Auteurs et dates de chaque décision.
- Approbation refusée si le total des acomptes non refusés du mois dépasse `advanceMaxPercent` % du salaire du mois, ou si l'employé n'a pas de rémunération ce mois-là.
- Seuls les acomptes `PAID` sont déduits.

### Retenues (`PayrollDeduction`) [S]

- `userId`, `amount` (> 0), `reason`, `sourceType` : `STOCK_DISCREPANCY`, `FINANCIAL_DISCREPANCY`, `OTHER` ; `discrepancyId?` (unique : un écart ne donne qu'une retenue), `status` : `PENDING` → `APPROVED` | `REJECTED` ; `APPROVED` → `APPLIED` (approbation de la paie), `month?` (mois de paie visé, défaut : premier mois non approuvé), auteurs et dates.
- Une retenue n'est jamais appliquée sans approbation explicite (`PENDING` → `APPROVED`).

### Primes (`IncentiveRule`, `Incentive`) [S]

- Règle : `name`, `kind` (`PER_UNIT`, `PERCENT_REVENUE`, `THRESHOLD`, `TIERED`, `REVENUE_TARGET`), `frequency` (`WEEKLY`, `MONTHLY`), `productId?`, `unitId?` (unité de comptage, défaut unité de base), `amount?` (DA : par unité, ou prime fixe), `percentBp?` (centièmes de %), `threshold?` (quantité ou DA), `tiers?` (`[{ minQty, unitAmount }]` croissants), cible `userId?` ou `roleCode?` (l'une des deux), `isActive`, `validFrom`, `validTo?`.
- Ventes valides : lignes payantes (`NORMAL`) livrées (livraison non en échec) dans la période, au jour de la livraison. Attribution : un livreur ← les livraisons qu'il a faites ; les autres ← les commandes dont ils sont le vendeur. Une commande annulée ou en échec n'est jamais livrée, donc jamais comptée.
- Calcul : `PER_UNIT` = quantité × montant ; `PERCENT_REVENUE` = CA × % ; `THRESHOLD` = montant si quantité ≥ seuil ; `TIERED` = quantité × montant unitaire du palier atteint ; `REVENUE_TARGET` = montant si CA ≥ seuil. Quantités dans l'unité de la règle (arrondi à l'unité inférieure).
- Résultat `Incentive` : `ruleId`, `userId`, `periodStart`, `periodEnd`, `quantity`, `revenue`, `unitAmount?`, `amount`, `details` (lignes sources : commande, livraison, quantité), `status` : `CALCULATED` → `VALIDATED` | `REJECTED` ; `VALIDATED` → `APPLIED`. Unique `(ruleId, userId, periodStart)` : une vente n'est comptée qu'une fois par règle et par période. Un recalcul ne touche jamais une prime validée, refusée ou appliquée.
- Fin de semaine : le comptable lance le calcul de la semaine (à la demande, pas de tâche planifiée), vérifie, valide.

### Paie

- `PayrollPeriod` [S] : `month` (unique par entreprise), `status` : `OPEN` → `CALCULATED` → `APPROVED` → `PAID` → `CLOSED`. Recalcul permis en `OPEN` et `CALCULATED`. Auteurs et dates de chaque étape.
- `PayrollEntry` [S] : une par employé rémunéré ce mois-là ; `baseSalary`, `earnings`, `advances`, `deductions`, `net` (≥ 0 attendu ; négatif refusé à l'approbation).
- `PayrollLine` [S] : `kind` (`BASE_SALARY`, `INCENTIVE`, `OBJECTIVE_BONUS`, `DRIVER_BONUS`, `ADJUSTMENT`, `ADVANCE`, `DEDUCTION`), `label`, `amount` signé, `sourceType`, `sourceId` : chaque montant remonte à sa source.
- `PayrollPayment` [S] : une par échéance du calendrier, `amount` (net × % ; la dernière absorbe l'arrondi), `dueDate`, `paidAt?`, `paidByUserId?` ; unique `(entryId, installment)`.
- `PayrollAdjustment` [S] : correction contrôlée (`amount` signé, `reason`, `month`), prise dans la paie du mois tant qu'elle n'est pas approuvée ; une paie clôturée se corrige par un ajustement du mois suivant.
- Calcul (dans une transaction, période verrouillée) : salaire du mois, primes `VALIDATED` dont la période se termine dans le mois, objectifs du mois `M − objectivePaymentDelayMonths` (vendeur et livreur), ajustements du mois, acomptes `PAID` du mois, retenues `APPROVED` du mois (ou sans mois). Approbation : primes `APPLIED`, acomptes `DEDUCTED`, retenues `APPLIED`, écarts `DEDUCTION_APPLIED`, ajustements rattachés, échéances créées. Paiement d'une échéance : une seule fois ; toutes payées → `PAID`. Clôture : `PAID` → `CLOSED`, plus aucune modification.

### Droits (nouveaux, module CORE)

- `compensation.read`, `compensation.update`, `payroll.read`, `payroll.manage`, `advances.manage`, `deductions.manage`, `incentives.read`, `incentives.manage` (règles), `incentives.validate`, `discrepancies.read`, `discrepancies.decide`, `pay.own`.
- Administrateur : `compensation.*`, `payroll.read`, `incentives.read`, `incentives.manage`, `discrepancies.read` (+ paramètres existants).
- Comptable : `compensation.read`, `payroll.*`, `advances.manage`, `deductions.manage`, `incentives.read`, `incentives.validate`, `discrepancies.*`.
- Superviseur : `discrepancies.read`, `incentives.read`.
- Tous les rôles : `pay.own` (leurs seules données).
- Le magasinier valide l'écart en validant le déchargement (droit existant) ; il ne touche ni aux salaires ni aux retenues.

## 2. API

| Méthode | Chemin | Droit |
|---|---|---|
| `GET`, `POST` | `/compensations?userId`, `/compensations` | `compensation.read`, `compensation.update` — historique ; `{ userId, baseSalary, effectiveFrom, note? }` |
| `GET` | `/compensations/current` | `compensation.read` — rémunération en vigueur de chaque utilisateur |
| `GET`, `PUT` | `/payroll/settings` | `payroll.read`, `settings.update` |
| `GET` | `/discrepancies?status&kind&from&to&userId` | `discrepancies.read` |
| `POST` | `/discrepancies/{id}/review` | `discrepancies.decide` — `VALIDATED` → `UNDER_REVIEW` |
| `POST` | `/discrepancies/{id}/decide` | `discrepancies.decide` — `{ decision: 'NO_LIABILITY' \| 'REJECT' \| 'LIABILITY', amount?, note }` ; `LIABILITY` crée la retenue `PENDING` |
| `GET` | `/settlements/{workdayId}/detail` | `settlements.read` — attendu, remis, écart, ventes, paiements, impayés, retours, écarts marchandises, justification |
| `GET`, `POST` | `/deductions`, `/deductions` | `deductions.manage` — retenue `OTHER` |
| `POST` | `/deductions/{id}/approve`, `/deductions/{id}/reject` | `deductions.manage` |
| `GET`, `POST` | `/advances`, `/advances` | `advances.manage` |
| `POST` | `/advances/{id}/approve`, `/reject`, `/pay` | `advances.manage` |
| `GET`, `POST`, `PATCH` | `/incentive-rules` | `incentives.read`, `incentives.manage` |
| `POST` | `/incentives/calculate` | `incentives.validate` — `{ periodStart, frequency }` |
| `GET` | `/incentives?periodStart&status&userId` | `incentives.read` |
| `POST` | `/incentives/{id}/validate`, `/reject` | `incentives.validate` |
| `GET`, `POST` | `/payroll/periods`, `/payroll/periods` | `payroll.read`, `payroll.manage` — `{ month }` |
| `GET` | `/payroll/periods/{id}` | `payroll.read` — entrées, lignes avec leurs sources, échéances |
| `POST` | `/payroll/periods/{id}/calculate`, `/approve`, `/close` | `payroll.manage` |
| `POST` | `/payroll/payments/{id}/pay` | `payroll.manage` — une seule fois |
| `GET`, `POST` | `/payroll/adjustments`, `/payroll/adjustments` | `payroll.manage` |
| `GET` | `/payroll/dashboard?month` | `payroll.read` — salaires, acomptes, retenues, primes, net, employés |
| `GET` | `/me/pay?month` | `pay.own` — rémunération (historique), primes, acomptes, retenues, entrée de paie et paiements |

Erreurs : statut incompatible → `409` (`CONFLICT`) ; règle métier → `422` ; paie ou acomptes désactivés → `422`.

## 3. Web

- Menu « Comptabilité » (onglets) : Versements (détail d'origine), Dettes et paiements, Écarts, Retenues, Acomptes, Primes, Paie.
- « Rémunérations » (administrateur, comptable en lecture) : salaire en vigueur, historique, nouveau salaire.
- Paramètres : section Paie (activée, acomptes, plafond, début de semaine, calendrier).
- « Ma paie » (`pay.own`).
- Déchargements : valeur unitaire, valeur de l'écart, contrôleur.
- Accueil : bloc paie du mois (comptable, administrateur).

## 4. Mobile

- Livreur : la clôture de journée est présentée comme la déclaration de retour au dépôt.
- Magasinier : valeur de l'écart au déchargement.
- Tous : écran « Ma paie ».

## 5. Tests

- `business-rules` : calendrier (somme 100, jours), échéances et arrondi, primes de chaque type (120 × 20 = 2 400), net (60 000 − 10 000 = 50 000 ; 60 000 − 2 000 = 58 000 ; 60 000 + 2 400 − 10 000 − 2 000 = 50 400), semaine.
- API : scénario E2E Ahmed (100 cartons chargés, 80 vendus, 18 comptés, écart −2 × 1 000 DA, retenue 2 000, acompte 10 000, prime 80 × 20 = 1 600, net 49 600, échéances 24 800 + 24 800, chaque ligne avec sa source) ; refus des doubles opérations (paiement, validation, retenue d'un même écart, prime d'une même période) ; paie clôturée non modifiable ; acomptes désactivés ; employé limité à ses données ; isolation entre entreprises ; objectif mensuel au montant livré.
