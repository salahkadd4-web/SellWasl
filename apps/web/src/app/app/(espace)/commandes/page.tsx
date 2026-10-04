'use client';

import type { OrderDto, TerritoryDto } from '@sellwasl/validation';
import { ORDER_STATUSES } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDA, formatDate, ORDER_SOURCE_LABELS, ORDER_STATUS, todayDate } from '@/lib/labels';

/** Historique des commandes de prévente, par date, vendeur et statut. */
export default function OrdersPage() {
  const [sellers, setSellers] = useState<{ id: string; label: string }[]>([]);
  const [date, setDate] = useState(todayDate);
  const [sellerId, setSellerId] = useState('');
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState<OrderDto[] | null>(null);
  const [open, setOpen] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<TerritoryDto[]>('company', '/territories')
      .then((t) =>
        setSellers(
          t
            .filter((x) => x.seller)
            .map((x) => ({ id: x.seller!.id, label: `${x.seller!.code} · ${x.seller!.name}` })),
        ),
      )
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams({ date });
    if (sellerId) params.set('sellerId', sellerId);
    if (status) params.set('status', status);
    try {
      setOrders(await api<OrderDto[]>('company', `/orders?${params}`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [date, sellerId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = (orders ?? [])
    .filter((o) => o.status !== 'CANCELLED')
    .reduce((sum, o) => sum + o.totalAmount, 0);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Commandes" subtitle="Commandes de prévente prises par les vendeurs." />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Date de commande"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <Select
          label="Vendeur"
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
          options={[
            { value: '', label: 'Tous' },
            ...sellers.map((s) => ({ value: s.id, label: s.label })),
          ]}
        />
        <Select
          label="Statut"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'Tous' },
            ...ORDER_STATUSES.filter((s) => s !== 'DRAFT').map((s) => ({
              value: s,
              label: ORDER_STATUS[s]!.label,
            })),
          ]}
        />
      </Card>
      {orders && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-text-dark">{formatDate(date)}</h2>
            <span className="text-sm text-muted">
              {orders.length} commande(s) · {formatDA(total)} hors annulées
            </span>
          </div>
          {orders.length === 0 && <p className="text-sm text-muted">Aucune commande.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {orders.map((o) => {
              const s = ORDER_STATUS[o.status]!;
              const pending = o.lines.filter(
                (l) => l.kind === 'PENDING' && l.pendingStatus === 'TO_PROCESS',
              ).length;
              return (
                <button
                  key={o.id}
                  onClick={() => setOpen(o)}
                  className="flex w-full flex-col gap-1 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-text-dark">
                      {o.customer.name}{' '}
                      <span className="font-mono text-xs text-muted">{o.number}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {o.seller.code} · {ORDER_SOURCE_LABELS[o.source] ?? o.source} · livraison{' '}
                      {formatDate(o.deliveryDate)}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {pending > 0 && <Badge tone="warning">{pending} en attente</Badge>}
                    {o.lines.some((l) => l.isStockout) && <Badge tone="danger">Rupture</Badge>}
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <span className="font-semibold text-text-dark">{formatDA(o.totalAmount)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}
      {open && <OrderDialog order={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function OrderDialog({ order, onClose }: { order: OrderDto; onClose: () => void }) {
  const kinds = [
    { kind: 'NORMAL', title: 'Articles' },
    { kind: 'PENDING', title: 'En attente (quota)' },
    { kind: 'BONUS', title: 'Gratuit' },
  ] as const;
  return (
    <Modal title={`Commande ${order.number}`} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted">
          {order.customer.name} · {order.seller.name} · {formatDate(order.orderDate)} · livraison{' '}
          {formatDate(order.deliveryDate)}
        </p>
        {kinds.map(({ kind, title }) => {
          const lines = order.lines.filter((l) => l.kind === kind);
          if (lines.length === 0) return null;
          return (
            <div key={kind} className="flex flex-col gap-1">
              <h3 className="font-semibold text-text-dark">{title}</h3>
              {lines.map((l) => (
                <div key={l.id} className="flex justify-between gap-2">
                  <span>
                    {l.productName}
                    {l.variantName ? ` ${l.variantName}` : ''} · {l.enteredQty} {l.unitName}
                    {l.isStockout ? ' · rupture' : ''}
                    {kind === 'PENDING' && l.pendingStatus !== 'TO_PROCESS'
                      ? l.pendingStatus === 'ACCEPTED'
                        ? ' · acceptée'
                        : ' · refusée'
                      : ''}
                  </span>
                  {kind !== 'BONUS' && <span>{formatDA(l.lineAmount)}</span>}
                </div>
              ))}
            </div>
          );
        })}
        <p className="text-right text-base font-bold text-primary">
          Total : {formatDA(order.totalAmount)}
        </p>
      </div>
    </Modal>
  );
}
