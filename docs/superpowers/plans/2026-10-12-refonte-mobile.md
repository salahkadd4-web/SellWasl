# Refonte UX/UI du mobile : plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** le mobile du vendeur et du livreur suit les maquettes (accueil, navigation du bas, clients à glisser, carte MapPin, commande et livraison par glissement), sans changer les règles métier ni l'API.

**Architecture:** composants partagés dans `apps/mobile/src/components/` ; navigation par onglets (`(tabs)` d'expo-router, URL inchangées) ; données et règles existantes (`useFieldCustomers`, `useCart`, `todayView`, `driverRouteView`, opérations hors connexion).

**Tech Stack:** Expo 57, expo-router (Tabs), react-native-gesture-handler (ReanimatedSwipeable), react-native-reanimated, @expo/vector-icons (Feather), MapLibre (couche de symboles).

**Spec:** `docs/superpowers/specs/2026-10-12-refonte-mobile-design.md`

## Global Constraints

- Aucun nouvel accès à l'API, aucun champ en base, aucune donnée fictive.
- Les URL des écrans restent les mêmes (les liens existants et les notifications continuent de marcher).
- Aucun module natif nouveau à compiler : seulement des bibliothèques déjà compilées ou en JavaScript.
- Une visite ne démarre jamais à l'ouverture d'un écran ; une livraison partielle n'est jamais déclarée complète.
- Fusion locale dans `main`, sans push ; CI locale verte.

## Review Focus

1. Le glissement horizontal ne bloque pas le défilement vertical de la liste.
2. ✕ n'altère ni les autres produits du panier ni une commande déjà enregistrée.
3. Localiser sans coordonnées ni adresse : message, aucune URL invalide ouverte.
4. Couleur des punaises : statut réel (visite pour le vendeur, livraison pour le livreur), jamais l'inconnu en vert.
5. Entrées du menu et du « + » filtrées par rôle, droits et modules.

---

### Task 1: Socle (dépendances, couleurs, composants)
- [ ] `@expo/vector-icons`, gesture-handler, reanimated ; `coral` dans la palette ; `src/components/` : AppHeader, TabBar, ActionSheet, SwipeRow, QuantityStepper, StatTile, Segmented, Chips, MapPinLegend ; actions client (`customerActions`).

### Task 2: Navigation par onglets (vendeur, livreur) et menu
### Task 3: Accueil vendeur et livreur
### Task 4: Visites (liste des clients, filtres, glissement, « ⋯ »)
### Task 5: Map (MapPin, filtres, panneau)
### Task 6: Commande (liste glissable, quantité, récapitulatif)
### Task 7: Livraison (quantités livrées par glissement)
### Task 8: Tests d'écrans, documentation, CI
