# Versements et rapprochement financier

Phases 20 et 21 bis.

## Versement

Après la clôture de sa journée, l'agent remet l'argent au comptable :

```text
Écart = montant remis − montant attendu
Montant attendu = espèces des livraisons et ventes + espèces des dettes encaissées
```

Un seul versement par journée (`409` sinon), avec une justification facultative (`note`), audité. Un écart non nul crée un `Discrepancy` `FINANCIAL` relié au versement, analysé comme un écart de stock (voir `docs/stock-discrepancies.md`) : sans responsabilité, non fondé, ou retenue à approuver.

## Détail d'un versement

`GET /settlements/{workdayId}/detail` donne au comptable de quoi relier un écart à son origine :

- attendu, remis, écart, justification ;
- ventes (total livré ou vendu), espèces des ventes, espèces des dettes, crédit accordé (impayés), nombre de bons ;
- valeur des retours au déchargement ;
- écarts de marchandise de la journée (avec leur statut) et écart de caisse.

Droits : `settlements.read`, `settlements.create` (comptable, administrateur).
