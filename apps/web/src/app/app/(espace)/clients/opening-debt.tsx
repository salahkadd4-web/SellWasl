'use client';

import type { OpeningDebtState } from '@sellwasl/validation';
import { useEffect, useState } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatDA } from '@/lib/labels';

/**
 * Solde d'ouverture de la fiche client (BR-PAY-09), pour qui a `debts.opening` : modifiable tant
 * que le client n'a ni vente à crédit ni encaissement de dette.
 */
export function OpeningDebt({
  customerId,
  onSaved,
}: {
  customerId: string;
  /** Nouvelle dette du client, pour mettre la fiche à jour. */
  onSaved: (debtAmount: number) => void;
}) {
  const [state, setState] = useState<OpeningDebtState | null>(null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<OpeningDebtState>('company', `/customers/${customerId}/opening-debt`)
      .then(setState)
      .catch((err) => setError(errorMessage(err)));
  }, [customerId]);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const next = await api<OpeningDebtState>('company', `/customers/${customerId}/opening-debt`, {
        method: 'PUT',
        body: JSON.stringify({ amount: Number(amount.replace(/\s/g, '')) }),
      });
      setState(next);
      setEditing(false);
      onSaved(next.debtAmount);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-3">
      <h3 className="font-semibold text-text-dark">Solde d’ouverture</h3>
      {error && <Alert>{error}</Alert>}
      {!state && !error && <p className="text-sm text-muted">Chargement…</p>}
      {state && !editing && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm">
            <span className="text-text-dark">{formatDA(state.openingDebtAmount)}</span>
            <span className="text-muted">
              {state.openingDebtEditable
                ? ' · dette reprise de l’ancien système'
                : ' · figé, le client a des opérations de dette'}
            </span>
          </p>
          {state.openingDebtEditable && (
            <Button
              variant="secondary"
              onClick={() => {
                setAmount(String(state.openingDebtAmount));
                setEditing(true);
              }}
            >
              Modifier
            </Button>
          )}
        </div>
      )}
      {editing && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field
            label="Solde d’ouverture (DA)"
            inputMode="numeric"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            hint="Dette du client dans l’ancien système, le jour du passage à SellWasl."
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
