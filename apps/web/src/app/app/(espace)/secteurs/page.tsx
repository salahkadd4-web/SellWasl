'use client';

import dynamic from 'next/dynamic';

// Leaflet a besoin du navigateur : la page est rendue côté client seulement
const TerritoriesView = dynamic(() => import('./view'), {
  ssr: false,
  loading: () => <p className="text-muted">Chargement de la carte…</p>,
});

export default function TerritoriesPage() {
  return <TerritoriesView />;
}
