# Phase 22 — Web responsive et PWA (conception)

Source : `plan_VF.md`, phase 22. Décisions de l'utilisateur : barre du bas + « Plus » sur smartphone, barre latérale sur desktop ; cache statique + page hors ligne (jamais les données de l'API) ; graphiques SVG sans dépendance ; espaces entreprise et plateforme.

## 1. Mise en page de l'espace entreprise

Un seul composant `AppShell` (`components/app-shell.tsx`), alimenté par la liste du menu actuelle (droits et modules inchangés, entrées « also » pour les onglets).

- **Desktop (≥ 1024 px)** : barre latérale fixe à gauche (logo, nom de l'entreprise, menu groupé : Pilotage, Terrain, Stock et livraison, Comptabilité et paie, Administration, Moi), repliable en icônes ; en-tête de contenu avec l'utilisateur et « Déconnexion » ; contenu jusqu'à 1 280 px.
- **Tablette (640–1023 px)** : barre latérale masquée, ouverte par un bouton dans l'en-tête (panneau superposé).
- **Smartphone (< 640 px)** : en-tête compact (logo, titre de la page, bouton menu) ; **barre de navigation en bas** fixe, 4 entrées : les trois premières entrées principales accessibles au rôle (ordre de préférence : Accueil, Suivi du jour, Commandes, Comptabilité, Stock, Ma paie), puis **Plus**, qui ouvre le menu complet en feuille plein écran. Zone de sécurité iOS respectée (`env(safe-area-inset-bottom)`), cibles tactiles ≥ 44 px.
- Fermeture du panneau au changement de page et par la touche Échap ; navigation au clavier ; `aria-current` sur l'entrée active.
- Contenu simplifié sur smartphone : tableaux larges en défilement horizontal (déjà en place), grilles en une colonne, actions des en-têtes de page en pleine largeur.
- Carte du suivi : plein écran sur smartphone (hauteur `calc(100dvh − en-têtes)`), 420 px sinon.

## 2. Espace plateforme

Même `AppShell` en variante plateforme (couleur `text-dark`, menu : Entreprises), en-tête compact et barre du bas sur smartphone.

## 3. Graphiques du dashboard

Composants SVG (`components/charts.tsx`) : `LineChart` (série par jour, axes, valeurs au survol et au focus) et `BarChart` (barres horizontales). Responsive (viewBox, largeur 100 %), couleurs du thème, texte alternatif (`role="img"`, `aria-label` résumant la série).

- Dashboard : CA par jour et commandes par jour de la période (`/reports/commercial` `byDay`, déjà existant) ; si le module des retours est actif, barres refusé, retourné, revendu, écarts.
- Aucune nouvelle route d'API.

## 4. PWA

- `app/manifest.ts` : nom « SellWasl », nom court « SellWasl », description « One Platform. Every Flow. », `start_url: /app`, `scope: /`, `display: standalone`, `orientation: any`, couleurs `#001850` (thème) et `#ffffff` (fond), langue `fr`, icônes 192, 512 et 512 « maskable ».
- Icônes carrées générées depuis `public/logo.png` par un script (`scripts/icons.mjs`, `sharp`) : `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (marge de sécurité), `apple-touch-icon.png` (180), `favicon.ico` remplacé par les PNG dans les métadonnées.
- Splash screen : Android le compose depuis le manifeste (fond, icône, nom) ; iOS : `apple-mobile-web-app-capable`, titre et barre d'état dans les métadonnées (`appleWebApp`), icône tactile.
- Service worker `public/sw.js`, enregistré en production seulement :
  - pré-cache : page hors ligne `/offline.html`, icônes, logo ;
  - fichiers statiques `/_next/static/*`, polices et icônes : cache d'abord (noms versionnés) ;
  - navigations (pages) : réseau d'abord, page hors ligne en cas d'échec ;
  - **jamais** de cache pour `/api/*` ni pour les autres requêtes (méthodes autres que GET comprises) ;
  - nouvelle version : ancien cache supprimé à l'activation.
- `next.config.ts` : en-têtes de `sw.js` (`Cache-Control: no-cache, no-store, must-revalidate`, `Content-Type` JavaScript, CSP `default-src 'self'`) ; en-têtes de sécurité globaux (`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`).
- Installation : invite native du navigateur (manifeste + HTTPS) ; sur iOS, une bannière discrète explique « Partager → Sur l'écran d'accueil » (une fois, mémorisée localement).
- La PWA ne remplace pas l'application native du terrain : la page de connexion le rappelle aux rôles terrain.

## 5. Tests

- Typecheck et build du Web (le manifeste et le service worker sont servis par le build).
- Choix des entrées de la barre du bas : fonction pure (`lib/navigation.ts`), vérifiée par un script Node exécuté pendant la phase (le Web n’a pas de framework de test) ; vérification manuelle décrite dans la documentation.
- `docs/architecture.md` : section PWA (cache, mise à jour).
