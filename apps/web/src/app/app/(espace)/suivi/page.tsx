'use client';

import type { SupervisorMapDto, TodayRowDto } from '@sellwasl/validation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDA, formatDateTime } from '@/lib/labels';

const SupervisorMap = dynamic(() => import('./map'), {
  ssr: false,
  loading: () => <p className="text-muted">Chargement de la carte…</p>,
});

/** Rafraîchissement du tableau du jour (architecture §3). */
const REFRESH_MS = 30_000;

const WORKDAY: Record<TodayRowDto['workday'], { label: string; tone: 'success' | 'neutral' }> = {
  NOT_STARTED: { label: 'Non démarrée', tone: 'neutral' },
  IN_PROGRESS: { label: 'En cours', tone: 'success' },
  CLOSED: { label: 'Clôturée', tone: 'neutral' },
};

/** Suivi en temps réel (UC-57, UC-63) : tableau du jour et carte du superviseur. */
export default function LivePage() {
  const [rows, setRows] = useState<TodayRowDto[] | null>(null);
  const [map, setMap] = useState<SupervisorMapDto | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [today, positions] = await Promise.all([
        api<TodayRowDto[]>('company', '/reports/today'),
        api<SupervisorMapDto>('company', '/reports/map'),
      ]);
      setRows(today);
      setMap(positions);
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Suivi du jour"
        subtitle={`Équipes de terrain, actualisé toutes les 30 secondes${updatedAt ? ` · ${formatDateTime(updatedAt)}` : ''}.`}
      />
      {error && <Alert>{error}</Alert>}
      {rows && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Tableau du jour</h2>
          {rows.length === 0 && <p className="text-sm text-muted">Aucun utilisateur de terrain.</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Utilisateur</th>
                  <th className="py-2 pr-3 font-medium">Journée</th>
                  <th className="py-2 pr-3 font-medium">Clients</th>
                  <th className="py-2 pr-3 font-medium">Hors zone</th>
                  <th className="py-2 pr-3 font-medium">Téléphone</th>
                  <th className="py-2 pr-3 font-medium">Commandes</th>
                  <th className="py-2 pr-3 font-medium">CA</th>
                  <th className="py-2 pr-3 font-medium">Dernier signal</th>
                  <th className="py-2 pr-3 font-medium">Batterie</th>
                  <th className="py-2 pr-3 font-medium">En attente</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.user.id} className="border-t border-border">
                    <td className="py-1.5 pr-3">
                      <Link
                        href={`/app/suivi/${r.user.id}`}
                        className="font-medium text-deep-blue hover:underline"
                      >
                        {r.user.name}
                      </Link>{' '}
                      <span className="font-mono text-xs text-muted">{r.user.code}</span>
                      <span className="block text-xs text-muted">{r.user.role}</span>
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={WORKDAY[r.workday].tone}>{WORKDAY[r.workday].label}</Badge>
                    </td>
                    <td className="py-1.5 pr-3">
                      {r.visited} / {r.planned}
                    </td>
                    <td className="py-1.5 pr-3">{r.outOfZone}</td>
                    <td className="py-1.5 pr-3">{r.byPhone}</td>
                    <td className="py-1.5 pr-3">{r.orders}</td>
                    <td className="py-1.5 pr-3">{formatDA(r.revenue)}</td>
                    <td className="py-1.5 pr-3">
                      <Badge tone={r.online ? 'success' : 'danger'}>
                        {r.online ? 'En ligne' : 'Hors ligne'}
                      </Badge>
                      <span className="block text-xs text-muted">
                        {formatDateTime(r.lastSyncAt ?? r.lastPosition?.at ?? null)}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">{r.battery === null ? '—' : `${r.battery} %`}</td>
                    <td className="py-1.5 pr-3">
                      {r.pendingOps > 0 ? <Badge tone="warning">{r.pendingOps}</Badge> : 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {map && (
        <Card className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-text-dark">Carte</h2>
          <p className="text-sm text-muted">
            Parties du jour, clients visités en vert et à visiter en rouge, dernière position des
            équipes.
          </p>
          <SupervisorMap data={map} />
        </Card>
      )}
    </div>
  );
}
