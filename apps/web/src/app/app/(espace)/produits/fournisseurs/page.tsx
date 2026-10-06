'use client';

import type { SupplierDto } from '@sellwasl/validation';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { CatalogTabs } from '@/components/catalog-tabs';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Toggle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';

/** Fournisseurs (phase 21) : choisis à l'entrée en stock, axe de l'analyse des retours. */
export default function SuppliersPage() {
  const { can } = CompanyAuth.useAuth();
  const editable = can('products.write');
  const [suppliers, setSuppliers] = useState<SupplierDto[] | null>(null);
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSuppliers(await api<SupplierDto[]>('company', '/suppliers'));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Fournisseurs"
        subtitle="Choisis à l'entrée en stock et rattachés aux lots."
        action={
          editable && <Button onClick={() => setEditing('new')}>Ajouter un fournisseur</Button>
        }
      />
      <CatalogTabs />
      {error && <Alert>{error}</Alert>}
      {suppliers && (
        <Card className="flex flex-col gap-3">
          {suppliers.length === 0 && <p className="text-sm text-muted">Aucun fournisseur.</p>}
          {suppliers.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-border">
              {suppliers.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0 lg:flex-row lg:items-center lg:justify-between"
                >
                  <span className="flex flex-col">
                    <span className="font-medium text-text-dark">{s.name}</span>
                    <span className="text-xs text-muted">{s.phone ?? 'Sans téléphone'}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={s.isActive ? 'success' : 'neutral'}>
                      {s.isActive ? 'Actif' : 'Inactif'}
                    </Badge>
                    {editable && (
                      <Button variant="secondary" onClick={() => setEditing(s)}>
                        Modifier
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {editing && (
        <SupplierForm
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function SupplierForm({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: SupplierDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(supplier?.name ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Le nom est obligatoire.');
    setError(null);
    setBusy(true);
    try {
      await api('company', supplier ? `/suppliers/${supplier.id}` : '/suppliers', {
        method: supplier ? 'PATCH' : 'POST',
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() || null, isActive }),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={supplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
        <Field label="Nom" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field label="Téléphone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Toggle label="Actif" checked={isActive} onChange={setIsActive} />
        {error && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" disabled={busy}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}
