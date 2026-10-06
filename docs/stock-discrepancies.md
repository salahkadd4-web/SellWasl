# Retour du véhicule et écarts de stock

Phase 21 bis, sur le déchargement des phases 17 et 21.

## Retour du véhicule

```text
Livreur : clôture de journée = déclaration de retour au dépôt
→ Magasinier : comptage du camion (Web ou mobile)
→ Comparaison au théorique, écart avec motif, état constaté
→ Validation du contrôle = validation des écarts
```

Pour chaque article : chargé, livré ou vendu, offert, théorique (= stock du camion), compté, écart (= compté − théorique), valeur unitaire (prix moyen des ventes du jour du conducteur, sinon dernier prix vendu), valeur de l'écart. Le contrôleur et l'heure sont gardés (`validatedBy`, `validatedAt`).

## Écart

Chaque ligne à écart non nul crée un `Discrepancy` `STOCK`, statut `VALIDATED` (validé par le magasinier qui a contrôlé), avec la cause (motif d'ajustement), la quantité signée, la valeur unitaire et le montant signé (négatif : manque).

Un écart ne devient **jamais** une retenue automatiquement :

```text
VALIDATED → (UNDER_REVIEW) → décision du comptable
   ├─ pas de responsabilité → RESOLVED
   ├─ écart non fondé → REJECTED
   └─ responsabilité confirmée → DEDUCTION_PENDING (retenue créée, en attente)
          ├─ retenue approuvée → DEDUCTION_APPROVED → (paie approuvée) DEDUCTION_APPLIED
          └─ retenue refusée → RESOLVED
```

Seul un manque peut donner une retenue, d'au plus le manque ; une seule retenue par écart (contrainte unique) ; une seule décision par écart.

Droits : `discrepancies.read` (administrateur, superviseur, comptable), `discrepancies.decide` (comptable). Le magasinier et le livreur n'ont pas accès aux décisions ni aux retenues.

API : `GET /discrepancies`, `POST /discrepancies/{id}/review`, `POST /discrepancies/{id}/decide`.
