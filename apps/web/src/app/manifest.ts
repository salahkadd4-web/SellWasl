import type { MetadataRoute } from 'next';

/** Manifeste de la PWA (phase 22) : installation sur l'écran d'accueil, ouverture en plein écran. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SellWasl',
    short_name: 'SellWasl',
    description: 'One Platform. Every Flow.',
    lang: 'fr',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#001850',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
