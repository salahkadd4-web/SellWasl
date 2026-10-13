'use client';

import type { SupervisorPermissionsDto } from '@sellwasl/validation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, PageTitle, Toggle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

/** Thèmes des permissions, par préfixe du code (« users.create » → Utilisateurs). */
const THEMES: Record<string, string> = {
  settings: 'Paramètres et modules',
  modules: 'Paramètres et modules',
  users: 'Utilisateurs et appareils',
  devices: 'Utilisateurs et appareils',
  audit: 'Journal et imports',
  imports: 'Journal et imports',
  products: 'Catalogue et prix',
  prices: 'Catalogue et prix',
  price_tiers: 'Catalogue et prix',
  bonuses: 'Catalogue et prix',
  territories: 'Clients et secteurs',
  customers: 'Clients et secteurs',
  quotas: 'Objectifs et quotas',
  objectives: 'Objectifs et quotas',
  workdays: 'Terrain',
  visits: 'Terrain',
  orders: 'Terrain',
  pending_lines: 'Terrain',
  stock: 'Stock et livraison',
  inventory: 'Stock et livraison',
  loads: 'Stock et livraison',
  unloads: 'Stock et livraison',
  preparation: 'Stock et livraison',
  deliveries: 'Stock et livraison',
  payments: 'Comptabilité et paie',
  settlements: 'Comptabilité et paie',
  compensation: 'Comptabilité et paie',
  payroll: 'Comptabilité et paie',
  advances: 'Comptabilité et paie',
  deductions: 'Comptabilité et paie',
  incentives: 'Comptabilité et paie',
  discrepancies: 'Comptabilité et paie',
  pay: 'Comptabilité et paie',
  reports: 'Rapports',
  returns: 'Rapports',
};
const theme = (code: string) => THEMES[code.split('.')[0]!] ?? 'Autres';

/**
 * Permissions du superviseur (docs/rbac.md §7 bis) : l'administrateur lui accorde tout ou partie de
 * ses propres permissions. Le terrain (visites, commandes, encaissements) et ce réglage lui restent
 * interdits. Effet à la requête suivante du superviseur.
 */
export default function SupervisorPermissionsPage() {
  const [data, setData] = useState<SupervisorPermissionsDto | null>(null);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const reply = await api<SupervisorPermissionsDto>('company', '/roles/supervisor/permissions');
      setData(reply);
      setGranted(new Set(reply.granted));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const byTheme = new Map<string, SupervisorPermissionsDto['delegable']>();
    for (const p of data?.delegable ?? [])
      byTheme.set(theme(p.code), [...(byTheme.get(theme(p.code)) ?? []), p]);
    return [...byTheme.entries()];
  }, [data]);

  const toggle = (code: string, on: boolean) => {
    setSaved(false);
    setGranted((current) => {
      const next = new Set(current);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  };

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const reply = await api<SupervisorPermissionsDto>(
        'company',
        '/roles/supervisor/permissions',
        {
          method: 'PUT',
          body: JSON.stringify({ permissions: [...granted] }),
        },
      );
      setData(reply);
      setGranted(new Set(reply.granted));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Permissions du superviseur"
        subtitle="Accordez au superviseur tout ou partie de vos permissions ; effet à sa prochaine action."
        action={
          data && (
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      {saved && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          Permissions enregistrées : le superviseur les a dès sa prochaine action.
        </p>
      )}
      {data && (
        <>
          <Card className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted">
              {granted.size} permission{granted.size > 1 ? 's' : ''} sur {data.delegable.length}.
              Jamais accordées : visites, commandes, livraisons, encaissements, et ce réglage.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setSaved(false);
                setGranted(new Set(data.delegable.map((p) => p.code)));
              }}
            >
              Comme l&apos;administrateur
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSaved(false);
                setGranted(new Set(data.defaults));
              }}
            >
              Par défaut
            </Button>
          </Card>
          {groups.map(([name, permissions]) => (
            <Card key={name} className="flex flex-col gap-2">
              <h2 className="font-semibold text-text-dark">{name}</h2>
              <div className="grid gap-1 sm:grid-cols-2">
                {permissions.map((p) => (
                  <Toggle
                    key={p.code}
                    label={p.description}
                    description={p.code}
                    checked={granted.has(p.code)}
                    onChange={(on) => toggle(p.code, on)}
                  />
                ))}
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
