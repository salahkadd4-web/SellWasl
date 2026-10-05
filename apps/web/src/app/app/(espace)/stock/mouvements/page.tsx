'use client';

import type { StockMovementDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, Field, PageTitle, Select } from '@/components/ui';
import { StockTabs } from '@/components/stock-tabs';
import { api, errorMessage } from '@/lib/api';
import { articleLabel, formatDateTime, MOVEMENT_TYPE } from '@/lib/labels';
import { useWarehouses, warehouseLabel } from '@/lib/stock';

/** Historique des mouvements de stock (BR-STK-03) : les 200 derniers selon les filtres. */
export default function MovementsPage() {
  const { warehouses, error: warehousesError } = useWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [moves, setMoves] = useState<StockMovementDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams(
      Object.entries({ warehouseId, type, from, to }).filter(([, v]) => v !== ''),
    );
    try {
      setMoves(await api<StockMovementDto[]>('company', `/stock/movements?${params}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [warehouseId, type, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Mouvements"
        subtitle="Chaque variation de stock, datée, avec l'utilisateur et la cause."
      />
      <StockTabs />
      {(error ?? warehousesError) && <Alert>{error ?? warehousesError}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Entrepôt"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          options={[
            { value: '', label: 'Tous' },
            ...warehouses.map((w) => ({ value: w.id, label: warehouseLabel(w) })),
          ]}
        />
        <Select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
          options={[
            { value: '', label: 'Tous' },
            ...Object.entries(MOVEMENT_TYPE).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Field label="Du" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Field label="Au" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Card>
      {moves && (
        <Card className="flex flex-col gap-3">
          {moves.length === 0 && <p className="text-sm text-muted">Aucun mouvement.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {moves.map((m) => (
              <div
                key={m.id}
                className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {articleLabel(m)} · {m.qty}
                  </span>
                  <span className="text-xs text-muted">
                    {formatDateTime(m.occurredAt)} · {m.from ? warehouseLabel(m.from) : '—'} →{' '}
                    {m.to ? warehouseLabel(m.to) : '—'} · {m.user.name}
                    {m.reason ? ` · ${m.reason}` : ''}
                  </span>
                </span>
                <Badge tone={m.type === 'ADJUSTMENT' ? 'warning' : 'neutral'}>
                  {MOVEMENT_TYPE[m.type] ?? m.type}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
