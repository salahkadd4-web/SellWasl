'use client';

import { useEffect, useState } from 'react';

const IOS_HINT_KEY = 'sellwasl.iosInstallHint';

/**
 * PWA (phase 22) : enregistre le service worker en production et, sur iPhone ou iPad hors
 * application installée, explique une fois comment l'ajouter à l'écran d'accueil (Safari n'a pas
 * d'invite d'installation).
 */
export function Pwa() {
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator)
      void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    let seen = false;
    try {
      seen = localStorage.getItem(IOS_HINT_KEY) === '1';
    } catch {
      seen = true;
    }
    setIosHint(ios && !standalone && !seen);
  }, []);

  if (!iosHint) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] z-40 flex items-start gap-3 rounded-xl border border-border bg-white p-3 text-sm text-text-dark shadow-lg sm:inset-x-auto sm:right-4 sm:max-w-sm"
    >
      <span className="flex-1">
        Installez SellWasl : touchez <strong>Partager</strong> puis{' '}
        <strong>Sur l'écran d'accueil</strong>.
      </span>
      <button
        type="button"
        aria-label="Fermer"
        className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-surface"
        onClick={() => {
          try {
            localStorage.setItem(IOS_HINT_KEY, '1');
          } catch {
            // Stockage indisponible : la bannière reviendra, sans gêner
          }
          setIosHint(false);
        }}
      >
        ✕
      </button>
    </div>
  );
}
