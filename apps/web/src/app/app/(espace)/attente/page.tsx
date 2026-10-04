'use client';

import type { PendingLineDto } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Field, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate } from '@/lib/labels';

/**
 * Lignes en attente (UC-60, BR-QUO-06) : quantités commandées au-delà du quota. Accepter autorise
 * le dépassement et réserve le stock ; refuser en fait une vente perdue.
 */
export default function PendingLinesPage() {
  const { can } = CompanyAuth.useAuth();
  const canDecide = can('pending_lines.process');
  const [date, setDate] = useState('');
  const [lines, setLines] = useState<PendingLineDto[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setLines(
        await api<PendingLineDto[]>('company', `/pending-lines${date ? `?date=${date}` : ''}`),
      );
      setSelected(new Set());
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(lineIds: string[], decision: 'ACCEPT' | 'REFUSE') {
    if (lineIds.length === 0) return;
    if (
      decision === 'REFUSE' &&
      !confirm(`Refuser ${lineIds.length} ligne(s) ? Elles deviennent des ventes perdues.`)
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api('company', '/pending-lines/decide', {
        method: 'POST',
        body: JSON.stringify({ lineIds, decision }),
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Lignes en attente"
        subtitle="Quantités commandées au-delà du quota, à accepter ou refuser avant la préparation."
        action={
          canDecide &&
          selected.size > 0 && (
            <span className="flex gap-2">
              <Button disabled={busy} onClick={() => void decide([...selected], 'ACCEPT')}>
                Accepter ({selected.size})
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => void decide([...selected], 'REFUSE')}
              >
                Refuser ({selected.size})
              </Button>
            </span>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      <Card className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Date de commande"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          hint="Vide : toutes les lignes à traiter."
        />
      </Card>
      {lines && (
        <Card className="flex flex-col gap-3">
          {lines.length === 0 && <p className="text-sm text-muted">Aucune ligne en attente.</p>}
          <div className="overflow-hidden rounded-xl border border-border">
            {lines.map((l) => (
              <div
                key={l.id}
                className="flex flex-col gap-2 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
              >
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 accent-[#001850]"
                    checked={selected.has(l.id)}
                    onChange={() => toggle(l.id)}
                  />
                  <span className="flex flex-col">
                    <span className="font-medium text-text-dark">
                      {l.productName}
                      {l.variantName ? ` ${l.variantName}` : ''} · {l.qty} {l.unitName}
                    </span>
                    <span className="text-xs text-muted">
                      {l.customer.name} · {l.seller.code} · {l.orderNumber} ·{' '}
                      {formatDate(l.orderDate)} · {formatDA(l.unitPrice * l.qty)}
                    </span>
                  </span>
                </label>
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={l.availableStock > 0 ? 'neutral' : 'danger'}>
                    Stock dépôt : {l.availableStock}
                  </Badge>
                  {canDecide && (
                    <>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void decide([l.id], 'ACCEPT')}
                      >
                        Accepter
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => void decide([l.id], 'REFUSE')}
                      >
                        Refuser
                      </Button>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
