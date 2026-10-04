'use client';

import type {
  CompanyUser,
  CustomerPosition,
  FieldPosition,
  PartsChangeResult,
  TerritoryDto,
  TerritoryOverlap,
} from '@sellwasl/validation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TERRITORY_COLORS,
  TerritoryMap,
  type TerritoryMapHandle,
} from '@/components/territory-map';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { WEEKDAY_LABELS } from '@/lib/labels';

interface CustomerType {
  id: string;
  name: string;
  isActive: boolean;
}

/** Secteurs, parties, planning et carte (UC-50 à UC-53). */
export default function TerritoriesView() {
  const { can } = CompanyAuth.useAuth();
  const editable = can('territories.update');
  const mapRef = useRef<TerritoryMapHandle>(null);
  const [territories, setTerritories] = useState<TerritoryDto[]>([]);
  const [customers, setCustomers] = useState<CustomerPosition[]>([]);
  const [fieldUsers, setFieldUsers] = useState<FieldPosition[]>([]);
  const [overlaps, setOverlaps] = useState<TerritoryOverlap[]>([]);
  const [types, setTypes] = useState<CustomerType[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [drawn, setDrawn] = useState<number[]>([]);
  const [showCustomers, setShowCustomers] = useState(true);
  const [form, setForm] = useState<TerritoryDto | 'new' | null>(null);
  const [scheduling, setScheduling] = useState<TerritoryDto | null>(null);
  const [preview, setPreview] = useState<PartsChangeResult | null>(null);
  const [customer, setCustomer] = useState<CustomerPosition | null>(null);
  const [selection, setSelection] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, c, f, o] = await Promise.all([
        api<TerritoryDto[]>('company', '/territories'),
        api<CustomerPosition[]>('company', '/map/customers'),
        api<FieldPosition[]>('company', '/map/field-users'),
        api<TerritoryOverlap[]>('company', '/territories/overlaps'),
      ]);
      setTerritories(t);
      setCustomers(c);
      setFieldUsers(f);
      setOverlaps(o);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
    void api<CustomerType[]>('company', '/customer-types').then(setTypes);
    void api<{ data: { workingDays: string[] } }>('company', '/settings').then((s) =>
      setWorkingDays(s.data.workingDays),
    );
    if (can('users.read')) void api<CompanyUser[]>('company', '/users').then(setUsers);
  }, [load, can]);

  const selected = territories.find((t) => t.id === selectedId) ?? null;
  const editing = territories.find((t) => t.id === editingId) ?? null;
  const colorOf = (id: string) =>
    TERRITORY_COLORS[territories.findIndex((t) => t.id === id) % TERRITORY_COLORS.length]!;
  const partLabel = useMemo(() => {
    const labels = new Map<string, string>();
    for (const t of territories) for (const p of t.parts) labels.set(p.id, `${t.code} · ${p.name}`);
    return labels;
  }, [territories]);

  async function checkParts() {
    if (!editing || !mapRef.current) return;
    setError(null);
    const parts = mapRef.current.editedParts().map((p) => ({
      ...p,
      name: editing.parts.find((x) => x.number === p.number)?.name ?? `Partie ${p.number}`,
    }));
    try {
      setPreview(
        await api<PartsChangeResult>('company', `/territories/${editing.id}/parts?dryRun=true`, {
          method: 'PUT',
          body: JSON.stringify({ parts }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function saveParts() {
    if (!editing || !mapRef.current) return;
    const parts = mapRef.current.editedParts().map((p) => ({
      ...p,
      name: editing.parts.find((x) => x.number === p.number)?.name ?? `Partie ${p.number}`,
    }));
    try {
      const result = await api<PartsChangeResult>('company', `/territories/${editing.id}/parts`, {
        method: 'PUT',
        body: JSON.stringify({ parts }),
      });
      setPreview(null);
      setEditingId(null);
      setNotice(
        `Parties de ${editing.code} enregistrées : ${result.moved.length} client(s) déplacé(s).`,
      );
      await load();
    } catch (err) {
      setPreview(null);
      setError(errorMessage(err));
    }
  }

  async function assign(customerIds: string[], partId: string | null) {
    setError(null);
    try {
      const result = await api<{ updated: number; skipped: { name: string; reason: string }[] }>(
        'company',
        '/customers/assign-part',
        { method: 'POST', body: JSON.stringify({ customerIds, partId }) },
      );
      setNotice(
        `${result.updated} client(s) placé(s).` +
          (result.skipped.length > 0
            ? ` Non placés : ${result.skipped.map((s) => `${s.name} (${s.reason})`).join(' ; ')}`
            : ''),
      );
      setCustomer(null);
      setSelection(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  /** Parties où un client de ce type peut être placé : secteurs qui servent son type. */
  const partOptionsFor = (customerTypeIds: string[]) =>
    territories
      .filter((t) => t.isActive && customerTypeIds.every((id) => t.customerTypeIds.includes(id)))
      .flatMap((t) => t.parts.map((p) => ({ value: p.id, label: `${t.code} · ${p.name}` })));

  const sameTypeOverlaps = overlaps.filter((o) => o.kind === 'SAME_CUSTOMER_TYPE');

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Secteurs"
        subtitle="Secteurs, parties dessinées sur la carte, planning des visites."
        action={
          editable && !editing && <Button onClick={() => setForm('new')}>Nouveau secteur</Button>
        }
      />
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          {notice}
        </p>
      )}
      {sameTypeOverlaps.length > 0 && (
        <Alert>
          Secteurs superposés pour un même type de clients (BR-ORG-03) :{' '}
          {sameTypeOverlaps
            .map(
              (o) =>
                `${o.a.territoryCode} ${o.a.partName} et ${o.b.territoryCode} ${o.b.partName} (${o.customerTypes.join(', ')})`,
            )
            .join(' ; ')}
          .
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-3 lg:max-h-[75vh] lg:overflow-y-auto">
          {editing ? (
            <Card className="flex flex-col gap-3">
              <h2 className="font-semibold text-text-dark">
                Parties de {editing.code} · {editing.name}
              </h2>
              <p className="text-xs text-muted">
                Cliquez sur « Dessiner », puis placez les points sur la carte et cliquez sur le
                premier point pour fermer la partie. Faites glisser les sommets pour ajuster. Les
                parties voisines peuvent partager un bord, mais pas se chevaucher.
              </p>
              {Array.from({ length: editing.partCount }, (_, i) => i + 1).map((n) => (
                <div key={n} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    Partie {n}{' '}
                    {drawn.includes(n) ? (
                      <Badge tone="success">dessinée</Badge>
                    ) : (
                      <Badge tone="warning">à dessiner</Badge>
                    )}
                  </span>
                  <span className="flex gap-2">
                    <Button variant="secondary" onClick={() => mapRef.current?.drawPart(n)}>
                      {drawn.includes(n) ? 'Redessiner' : 'Dessiner'}
                    </Button>
                    {drawn.includes(n) && (
                      <Button variant="danger" onClick={() => mapRef.current?.removePart(n)}>
                        Effacer
                      </Button>
                    )}
                  </span>
                </div>
              ))}
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <Button onClick={() => void checkParts()}>Vérifier et enregistrer</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    mapRef.current?.cancelDrawing();
                    setEditingId(null);
                    setDrawn([]);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </Card>
          ) : (
            <>
              {territories.length === 0 && (
                <Card>
                  <p className="text-sm text-muted">Aucun secteur.</p>
                </Card>
              )}
              {territories.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedId(t.id === selectedId ? null : t.id);
                    mapRef.current?.fitTo(t.id);
                  }}
                  className={`flex flex-col gap-1 rounded-2xl border bg-white p-3 text-left ${
                    t.id === selectedId ? 'border-primary ring-2 ring-primary/20' : 'border-border'
                  }`}
                >
                  <span className="flex items-center gap-2 font-semibold text-text-dark">
                    <span
                      className="inline-block size-3 rounded-full"
                      style={{ background: colorOf(t.id) }}
                    />
                    {t.code} · {t.name}
                    {!t.isActive && <Badge tone="danger">Inactif</Badge>}
                  </span>
                  <span className="text-xs text-muted">
                    {t.customerTypes.map((c) => c.name).join(', ')} · vendeur{' '}
                    {t.seller?.name ?? 'non affecté'}
                    {t.deliveryUser ? ` · livreur ${t.deliveryUser.name}` : ''}
                  </span>
                  <span className="text-xs text-muted">
                    {t.parts.length}/{t.partCount} parties · {t.customerCount} client(s)
                    {t.outOfPartCount > 0 && (
                      <span className="text-error"> · {t.outOfPartCount} hors partie</span>
                    )}
                  </span>
                </button>
              ))}
            </>
          )}

          {selected && !editing && (
            <Card className="flex flex-col gap-3">
              <h2 className="font-semibold text-text-dark">
                {selected.code} · {selected.name}
              </h2>
              <div className="flex flex-col gap-1 text-sm">
                {selected.parts.map((p) => {
                  const days = selected.schedule
                    .filter((s) => s.partId === p.id)
                    .map((s) => WEEKDAY_LABELS.find(([c]) => c === s.weekday)?.[1])
                    .join(', ');
                  return (
                    <span key={p.id}>
                      {p.name} · {p.customerCount} client(s) ·{' '}
                      <span className={days ? 'text-muted' : 'text-pending'}>
                        {days || 'aucun jour'}
                      </span>
                    </span>
                  );
                })}
                {selected.parts.length === 0 && (
                  <span className="text-muted">Aucune partie dessinée.</span>
                )}
              </div>
              {editable && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => setForm(selected)}>Modifier</Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setEditingId(selected.id);
                      setNotice(null);
                      mapRef.current?.fitTo(selected.id);
                    }}
                  >
                    Dessiner les parties
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setScheduling(selected)}
                    disabled={selected.parts.length === 0}
                  >
                    Planning
                  </Button>
                </div>
              )}
            </Card>
          )}

          <Card className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-[#001850]"
                checked={showCustomers}
                onChange={(e) => setShowCustomers(e.target.checked)}
              />
              Afficher les clients ({customers.length})
            </label>
            <p className="text-xs text-muted">
              Point de la couleur du secteur ; rouge : hors partie ; contour foncé : partie forcée.
              Cliquez sur un client pour le placer.
              {fieldUsers.length > 0 && ' Les étiquettes sont les vendeurs et livreurs en journée.'}
            </p>
            {can('customers.update') && !editing && (
              <Button variant="secondary" onClick={() => mapRef.current?.startSelection()}>
                Sélectionner des clients sur la carte
              </Button>
            )}
          </Card>
        </div>

        <div className="isolate h-[75vh] overflow-hidden rounded-2xl border border-border">
          <TerritoryMap
            ref={mapRef}
            territories={territories}
            customers={customers}
            fieldUsers={fieldUsers}
            selectedId={selectedId}
            editingId={editingId}
            showCustomers={showCustomers}
            onCustomerClick={setCustomer}
            onSelection={(ids) => setSelection(ids)}
            onPartsEdited={setDrawn}
          />
        </div>
      </div>

      {form && (
        <TerritoryForm
          territory={form === 'new' ? null : form}
          types={types}
          users={users}
          onClose={() => setForm(null)}
          onSaved={(t) => {
            setForm(null);
            setSelectedId(t.id);
            void load();
          }}
        />
      )}
      {scheduling && (
        <ScheduleDialog
          territory={scheduling}
          workingDays={workingDays}
          onClose={() => setScheduling(null)}
          onSaved={() => {
            setScheduling(null);
            void load();
          }}
        />
      )}
      {preview && (
        <Modal title="Vérification des parties" onClose={() => setPreview(null)}>
          <div className="flex flex-col gap-3 text-sm">
            <p>
              <strong>{preview.moved.length}</strong> client(s) changeront de partie (BR-ORG-06).
              Les clients dont la partie est forcée ne bougent pas.
            </p>
            {preview.moved.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
                {preview.moved.slice(0, 200).map((m) => (
                  <p
                    key={m.customerId}
                    className="border-b border-border px-3 py-1.5 last:border-0"
                  >
                    {m.name} : {m.from} → <strong>{m.to}</strong>
                  </p>
                ))}
              </div>
            )}
            {preview.removedParts.length > 0 && (
              <Alert>Parties supprimées : {preview.removedParts.join(', ')}.</Alert>
            )}
            {preview.overlaps.length > 0 && (
              <Alert>
                Superposition avec d'autres secteurs qui servent le même type de clients :{' '}
                {preview.overlaps
                  .map(
                    (o) => `${o.b.territoryCode} ${o.b.partName} (${o.customerTypes.join(', ')})`,
                  )
                  .join(' ; ')}
                . Les clients de cette zone pourront hésiter entre deux parties.
              </Alert>
            )}
            <div className="flex gap-2">
              <Button onClick={() => void saveParts()}>Confirmer</Button>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                Revenir au dessin
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {customer && (
        <AssignDialog
          title={customer.name}
          current={customer.partId ? (partLabel.get(customer.partId) ?? '?') : 'hors partie'}
          forced={customer.isPartForced}
          options={partOptionsFor([customer.customerTypeId])}
          onClose={() => setCustomer(null)}
          onAssign={(partId) => void assign([customer.id], partId)}
        />
      )}
      {selection && (
        <AssignDialog
          title={`${selection.length} client(s) sélectionné(s)`}
          current={null}
          forced={false}
          options={partOptionsFor([
            ...new Set(
              customers.filter((c) => selection.includes(c.id)).map((c) => c.customerTypeId),
            ),
          ])}
          onClose={() => setSelection(null)}
          onAssign={(partId) => void assign(selection, partId)}
        />
      )}
    </div>
  );
}

function AssignDialog({
  title,
  current,
  forced,
  options,
  onClose,
  onAssign,
}: {
  title: string;
  current: string | null;
  forced: boolean;
  options: { value: string; label: string }[];
  onClose: () => void;
  onAssign: (partId: string | null) => void;
}) {
  const [partId, setPartId] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <div className="flex flex-col gap-3 text-sm">
        {current && (
          <p>
            Partie actuelle : <strong>{current}</strong>
            {forced ? ' (forcée)' : ''}
          </p>
        )}
        {options.length === 0 ? (
          <Alert>
            Aucun secteur ne sert ce type de client : placez-le après avoir créé un secteur.
          </Alert>
        ) : (
          <Select
            label="Placer dans"
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            options={[{ value: '', label: 'Automatique, selon la position' }, ...options]}
          />
        )}
        <p className="text-xs text-muted">
          Une partie choisie est forcée : elle ne change plus quand les polygones sont modifiés.
        </p>
        <Button onClick={() => onAssign(partId || null)}>Enregistrer</Button>
      </div>
    </Modal>
  );
}

function TerritoryForm({
  territory,
  types,
  users,
  onClose,
  onSaved,
}: {
  territory: TerritoryDto | null;
  types: CustomerType[];
  users: CompanyUser[];
  onClose: () => void;
  onSaved: (t: TerritoryDto) => void;
}) {
  const [typeIds, setTypeIds] = useState<string[]>(territory?.customerTypeIds ?? []);
  const [active, setActive] = useState(territory?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const sellers = users.filter(
    (u) => u.status === 'ACTIVE' && ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'].includes(u.role.code),
  );
  const drivers = users.filter((u) => u.status === 'ACTIVE' && u.role.code === 'LIVREUR');
  const person = (u: CompanyUser) => ({
    value: u.id,
    label: `${u.firstName} ${u.lastName} (${u.code})`,
  });

  async function submit(form: FormData) {
    setError(null);
    const body = {
      code: form.get('code'),
      name: form.get('name'),
      partCount: Number(form.get('partCount')),
      customerTypeIds: typeIds,
      sellerUserId: form.get('sellerUserId') || null,
      deliveryUserId: form.get('deliveryUserId') || null,
      isActive: active,
    };
    try {
      onSaved(
        await api<TerritoryDto>(
          'company',
          territory ? `/territories/${territory.id}` : '/territories',
          {
            method: territory ? 'PATCH' : 'POST',
            body: JSON.stringify(body),
          },
        ),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal title={territory ? `Modifier ${territory.code}` : 'Nouveau secteur'} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field
            label="Code"
            name="code"
            required
            defaultValue={territory?.code}
            placeholder="3101"
          />
          <Field
            label="Nom"
            name="name"
            required
            defaultValue={territory?.name}
            placeholder="Oran Est"
          />
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-text-dark">Types de clients servis</legend>
          <div className="flex flex-wrap gap-3">
            {types
              .filter((t) => t.isActive || typeIds.includes(t.id))
              .map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-[#001850]"
                    checked={typeIds.includes(t.id)}
                    onChange={(e) =>
                      setTypeIds((ids) =>
                        e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id),
                      )
                    }
                  />
                  {t.name}
                </label>
              ))}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Vendeur"
            name="sellerUserId"
            defaultValue={territory?.seller?.id ?? ''}
            options={[{ value: '', label: 'Aucun' }, ...sellers.map(person)]}
          />
          <Select
            label="Livreur"
            name="deliveryUserId"
            defaultValue={territory?.deliveryUser?.id ?? ''}
            options={[{ value: '', label: 'Aucun' }, ...drivers.map(person)]}
          />
        </div>
        <Field
          label="Nombre de parties"
          name="partCount"
          type="number"
          min={1}
          max={30}
          required
          defaultValue={territory?.partCount ?? 6}
          hint="En général une partie par jour travaillé."
        />
        {territory && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[#001850]"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Secteur actif
          </label>
        )}
        {error && <Alert>{error}</Alert>}
        <Button type="submit">{territory ? 'Enregistrer' : 'Créer le secteur'}</Button>
      </form>
    </Modal>
  );
}

function ScheduleDialog({
  territory,
  workingDays,
  onClose,
  onSaved,
}: {
  territory: TerritoryDto;
  workingDays: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [days, setDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(territory.schedule.map((s) => [s.weekday, s.partId])),
  );
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await api('company', `/territories/${territory.id}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({
          days: WEEKDAY_LABELS.map(([weekday]) => ({ weekday, partId: days[weekday] || null })),
        }),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal title={`Planning de ${territory.code}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">
          Partie visitée chaque jour (BR-ORG-07). Si les jours d'une partie changent, la première
          visite de ses clients passe au nouveau jour de la même semaine.
        </p>
        {WEEKDAY_LABELS.filter(([code]) => workingDays.includes(code) || days[code]).map(
          ([code, label]) => (
            <Select
              key={code}
              label={label}
              value={days[code] ?? ''}
              onChange={(e) => setDays((d) => ({ ...d, [code]: e.target.value }))}
              options={[
                { value: '', label: 'Aucune partie' },
                ...territory.parts.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          ),
        )}
        {error && <Alert>{error}</Alert>}
        <Button onClick={() => void save()}>Enregistrer le planning</Button>
      </div>
    </Modal>
  );
}
