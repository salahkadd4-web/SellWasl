# Secteurs, parties et carte — SellWasl

> **Phase 13 — rédigé le 2026-10-04.**
> Comment l'entreprise découpe son terrain, comment un client trouve sa partie, et ce que fait la carte du superviseur. Règles : BR-ORG-01 à BR-ORG-07, BR-PLA-02, BR-PLA-03, BR-CLI-05.
>
> Documents liés : [business-rules.md](business-rules.md), [api.md](api.md) §5.3, [architecture.md](architecture.md) §12.

## 1. Vocabulaire

| Terme | Définition |
|---|---|
| **Secteur** | Territoire d'un vendeur : un code libre (ex. `3101`), un nom, les types de clients servis, un vendeur, un livreur, un nombre de parties prévu. Un vendeur a un seul secteur (BR-ORG-01). |
| **Partie** | Polygone dessiné sur la carte, numéroté de 1 à N. Les parties d'un même secteur ne se chevauchent pas ; elles peuvent partager un bord (BR-ORG-02). |
| **Planning** | Partie visitée chaque jour travaillé ; une partie peut avoir plusieurs jours (BR-ORG-07). |
| **Hors partie** | Client dont la position n'est dans aucune partie d'un secteur qui sert son type. Il n'est jamais planifié et apparaît dans « clients à revoir » (BR-ORG-05). |
| **Partie forcée** | Partie choisie par le superviseur. Elle ne change plus quand les polygones changent (BR-ORG-04). |

Il n'y a pas de niveau « zone » au-dessus du secteur dans le MVP.

## 2. Superposition de secteurs (BR-ORG-03)

Deux secteurs qui servent des types de clients différents peuvent se superposer : un secteur « Supérette » peut couvrir toute la ville, par-dessus les secteurs du détail. Deux secteurs qui servent un même type ne doivent pas se superposer :

- à l'enregistrement des parties, la superposition est **signalée** dans l'aperçu, sans bloquer ;
- la page Secteurs affiche en permanence la liste des superpositions (`GET /territories/overlaps`).

Deux parties d'un **même** secteur qui se chevauchent sont **refusées** (`422`).

## 3. Partie d'un client (BR-ORG-04)

1. On garde les parties des secteurs actifs qui servent le type du client.
2. On retient celle dont le polygone contient sa position (un point sur un bord compte comme dedans).
3. Une seule : le client y est placé. Aucune : il est hors partie. Plusieurs (secteurs superposés) : le superviseur choisit ; lors d'une réaffectation, la partie actuelle est gardée si elle convient, sinon le client passe à revoir.

Un client créé par un vendeur est cherché seulement dans les parties du secteur de ce vendeur, et reste rattaché à ce secteur même hors partie (BR-CLI-02).

Le calcul est dans `packages/business-rules/geo`, sans dépendance, pour tourner aussi sur le téléphone hors connexion.

## 4. Modification des parties (BR-ORG-06)

`PUT /territories/{id}/parts` reçoit **toutes** les parties du secteur :

- une partie garde son identifiant, son planning et ses clients tant que son numéro reste ;
- une partie absente est supprimée ; ses clients, même forcés, sont réaffectés ;
- tous les clients non forcés concernés (ceux du secteur et ceux d'un type qu'il sert) sont recalculés ;
- un client qui change de partie reçoit une nouvelle date de référence : le prochain jour prévu pour sa nouvelle partie (BR-PLA-03).

Avec `?dryRun=true`, rien n'est enregistré : la réponse liste les clients qui changeraient de partie, les superpositions et les parties supprimées. La carte Web montre cet aperçu avant la confirmation.

## 5. Planning (BR-ORG-07, BR-PLA-03)

`PUT /territories/{id}/schedule` associe une partie à chaque jour. Quand les jours d'une partie changent, la date de référence de ses clients passe au premier nouveau jour **de la même semaine** : un client « tous les 15 jours » garde sa semaine de passage.

## 6. Carte du superviseur

| Élément | Affichage |
|---|---|
| Parties | Polygones de la couleur du secteur ; le secteur sélectionné est en gras ; un secteur inactif est en pointillé |
| Clients | Points de la couleur du secteur ; rouge : hors partie ; contour foncé : partie forcée. Un clic ouvre le placement du client |
| Sélection | Rectangle tracé sur la carte : les clients dedans sont placés ensemble dans une partie, ou rendus au calcul automatique |
| Équipes | Étiquette du code du vendeur ou du livreur, à sa dernière position (moins de 24 h, journée en cours) |

Dessin : Leaflet et Leaflet-Geoman. Les sommets s'aimantent aux sommets voisins (15 pixels), ce qui permet de dessiner des parties qui partagent exactement un bord.

## 7. Fond de carte

Le fond de carte vient de `NEXT_PUBLIC_MAP_TILE_URL` (Web). Sans cette variable, l'application utilise les tuiles publiques d'OpenStreetMap, réservées au développement par leur règlement. Pour le pilote, un fournisseur avec une offre gratuite, comme MapTiler ; l'attribution se règle avec `NEXT_PUBLIC_MAP_ATTRIBUTION`.

## 8. Tests

| Test | Ce qu'il vérifie |
|---|---|
| `business-rules` : `territories.test.ts` | Polygone normalisé, parties voisines sans chevauchement, chevauchement réel, décalage de la date de référence |
| API : `territories.test.ts` | Liste, vendeur unique, aperçu puis enregistrement des parties, parties qui se chevauchent refusées, superposition signalée, partie forcée conservée, planning et dates de référence, placement par sélection |
