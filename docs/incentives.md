# Primes (incentives)

Phase 21 bis. Les objectifs mensuels existants (`Objective`, `DriverObjective`) restent inchangés et entrent dans la paie ; les règles de prime les complètent.

## Règles de prime

| Type | Calcul | Exemple |
|---|---|---|
| `PER_UNIT` | quantité × montant | 120 cartons × 20 DA = 2 400 DA |
| `PERCENT_REVENUE` | CA × % | 2 % de 150 000 DA = 3 000 DA |
| `THRESHOLD` | montant si quantité ≥ seuil | 2 000 DA dès 100 cartons |
| `TIERED` | quantité × montant du palier atteint | 0–49 → 0 ; 50–99 → 10 DA ; 100+ → 20 DA par carton |
| `REVENUE_TARGET` | montant si CA ≥ seuil | 10 000 DA si CA ≥ 1 000 000 DA |

Une règle cible un employé ou un rôle (pré-vendeurs, vendeurs cash van, livreurs), un produit (facultatif pour les primes sur le CA) et une unité de comptage (défaut : unité de base). Fréquence : semaine (début réglable, samedi par défaut) ou mois. Les objectifs d'équipe ne sont pas implémentés ; une règle par rôle s'en approche et le modèle peut accueillir une cible d'équipe plus tard.

## Ventes valides

Lignes payantes livrées (livraison non en échec), au jour de la livraison :

- livreur : les livraisons qu'il a faites ;
- pré-vendeur, vendeur cash van : les commandes dont il est le vendeur.

Une commande annulée ou en échec n'est jamais livrée, donc jamais comptée.

## Cycle

1. Fin de période : le comptable lance le calcul (`POST /incentives/calculate { date, frequency }`).
2. Une prime par règle, employé et période (contrainte unique) ; ses ventes sources sont gardées (commande, bon, quantité, montant).
3. Recalcul : seules les primes `CALCULATED` sont mises à jour ; une prime validée, refusée ou appliquée ne bouge plus.
4. Validation ou refus par le comptable ; une prime validée entre dans la paie du mois où sa période se termine, puis passe `APPLIED` à l'approbation de la paie.

Droits : `incentives.read` (administrateur, superviseur, comptable), `incentives.manage` (administrateur), `incentives.validate` (comptable).
