# Fond de carte : MapTiler, OpenStreetMap en secours

> **Rédigé le 2026-10-13.** Cartes du Web (Leaflet : secteurs, suivi du jour) et du mobile (MapLibre : clients, tournée). CI/CD : [ci-cd.md](ci-cd.md). Secteurs : [territories.md](territories.md).

## 1. Fonctionnement

- **MapTiler** est le fournisseur principal, dans le style `streets-v2` : tuiles raster 256 px sur le Web, style vectoriel `style.json` sur le mobile.
- **OpenStreetMap** prend le relais automatiquement quand :
  - la clé est absente ;
  - MapTiler refuse la clé (401, 403) ou que le quota est dépassé (429) ;
  - MapTiler ne répond pas ;
  - les tuiles ne se chargent pas : sur le Web, 3 tuiles en échec avant la première affichée ; sur le mobile, un échec de chargement du style signalé par MapLibre.
- Limite sur le mobile : un quota dépassé **pendant** une session, une fois le style chargé, n'est pas signalé tuile par tuile par MapLibre. La session suivante passe sur OSM, puisque la vérification au démarrage voit le 429.
- La clé est vérifiée **une fois par session**, par une seule requête au `style.json` : une tuile chargée comme image ne donne pas le code HTTP.
- Si OpenStreetMap échoue aussi, un message discret s'affiche sur la carte, mais les tracés et les points restent visibles.
- En développement, chaque bascule est expliquée dans la console, avec des messages qui commencent par `[carte]`.
- **Attribution** sur chaque carte : « © MapTiler © OpenStreetMap contributors », ou « © OpenStreetMap contributors » en secours.
- **Politique d'usage d'OpenStreetMap** :
  - aucun préchargement de tuiles ;
  - le cache du navigateur ou de MapLibre s'applique ;
  - sur le mobile, les tuiles OSM portent un User-Agent « SellWasl/1.0 » ;
  - sur le Web, le navigateur envoie son propre User-Agent et le Referer.
- **Géocodage** : SellWasl n'en fait pas. Les adresses sont saisies, et les positions viennent du GPS ou d'un copier-coller. Il n'y a donc pas de Nominatim.

Code :

| Fichier | Rôle |
|---|---|
| `packages/config/src/maps.ts` | Partagé : style, adresses, attributions, règle de bascule (`chooseMapProvider`) |
| `apps/web/src/lib/base-map.ts` | Fond de carte Leaflet et bascule sur les tuiles en échec |
| `apps/mobile/src/map/provider.ts` | Style MapLibre, User-Agent des tuiles OSM |
| `apps/mobile/src/seller/CustomerMap.tsx` | Carte mobile : bascule sur échec de chargement, attribution |

## 2. Variables d'environnement

Une seule clé MapTiler, avec une variable par plateforme pour pouvoir séparer les clés plus tard sans toucher au code :

| Fichier | Variable |
|---|---|
| `apps/web/.env` | `NEXT_PUBLIC_MAPTILER_KEY` |
| `apps/mobile/.env` | `EXPO_PUBLIC_MAPTILER_KEY` |

- Ces deux variables sont **figées à la compilation** : la clé est visible dans le code livré, ce qui est normal pour une clé de cartes protégée par ses origines autorisées.
- Après un changement, relancez `pnpm dev`. Sur le mobile, lancez `npx expo start -c` dans `apps/mobile` pour vider le cache de Metro.
- Le fichier `.env` de la racine n'est pas concerné.

Origines autorisées sur la clé (configurées chez MapTiler) :
- `localhost` ;
- le domaine de production ;
- `?` pour le mobile, qui n'envoie pas d'en-tête Origin ;
- **à ajouter en phase 30** : le domaine de staging.

Les tests de bout en bout tournent sur `localhost:3100` et coupent Internet : ils utilisent toujours le secours.

## 3. Changer de style

Modifiez la constante `MAPTILER_STYLE` dans `packages/config/src/maps.ts`, par exemple `basic-v2`, `bright-v2` ou `outdoor-v2`. Le Web et le mobile suivent.

## 4. Tester la bascule

- **Tests automatiques** :
  - `pnpm --filter @sellwasl/config test` : clé absente, refusée (401, 403), quota (429), MapTiler injoignable ;
  - `pnpm --filter @sellwasl/web test` : tuiles en échec → OSM, puis message si OSM échoue ;
  - `pnpm --filter @sellwasl/mobile test` : style MapTiler, OSM sur 403, échec de chargement → OSM, puis message.
- **À la main** :
  1. Mettez une clé volontairement fausse dans `apps/web/.env`, ou laissez la variable vide.
  2. Ouvrez Secteurs ou Suivi du jour.
  3. La carte s'affiche avec les tuiles OSM, l'attribution « © OpenStreetMap contributors », et dans la console `[carte] OpenStreetMap utilisé : clé MapTiler refusée (403).`
  4. Remettez la bonne clé et rechargez : les tuiles viennent de `api.maptiler.com` (onglet Réseau).
  
  Faites de même sur le mobile avec `apps/mobile/.env` (Metro relancé avec `-c`).

## 5. Production

- **Web, image Docker** : secret `NEXT_PUBLIC_MAPTILER_KEY` dans les environnements GitHub `staging` et `production`. La CI le passe à la compilation de l'image ([ci-cd.md](ci-cd.md) §3).
- **Mobile, EAS** : la variable est lue à la compilation. Créez-la une fois par environnement EAS (EAS CLI 16 ou plus récent) :

```bash
cd apps/mobile
eas env:create --environment production --name EXPO_PUBLIC_MAPTILER_KEY --value <clé> --visibility sensitive
eas env:create --environment preview --name EXPO_PUBLIC_MAPTILER_KEY --value <clé> --visibility sensitive
eas env:list --environment production   # vérification
```

- Chaque profil de compilation d'`eas.json` lit l'environnement EAS du même nom : `preview` lit `preview`, `production` lit `production`.
- La version de développement, elle, lit `apps/mobile/.env` à travers Metro.
- Aucune nouvelle dépendance native : la version de développement installée suffit.
