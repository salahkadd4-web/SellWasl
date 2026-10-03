'use client';

import type {
  AmbiguousPartDetails,
  CustomerDto,
  CustomerHistory,
  Page,
  ReviewReason,
  TerritoryOption,
} from '@sellwasl/validation';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Modal,
  PageTitle,
  Select,
  Toggle,
} from '@/components/ui';
import { api, ApiClientError, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, formatDateTime, FREQUENCY_LABELS } from '@/lib/labels';

interface CustomerType {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

const REVIEW_LABELS: Record<ReviewReason, string> = {
  NEW: 'Nouveau',
  OUT_OF_PART: 'Hors partie',
  CLOSED: 'Fermé définitivement ?',
};

const FREQUENCY_OPTIONS = Object.entries(FREQUENCY_LABELS).map(([value, label]) => ({
  value,
  label,
}));

interface Filters {
  q: string;
  territoryId: string;
  partId: string;
  customerTypeId: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ALL';
  toReview: boolean;
}

const EMPTY_FILTERS: Filters = {
  q: '',
  territoryId: '',
  partId: '',
  customerTypeId: '',
  status: 'ACTIVE',
  toReview: false,
};

function queryString(filters: Filters, cursor?: string | null): string {
  const params = new URLSearchParams({ limit: '50', status: filters.status });
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.territoryId) params.set('territoryId', filters.territoryId);
  if (filters.partId) params.set('partId', filters.partId);
  if (filters.customerTypeId) params.set('customerTypeId', filters.customerTypeId);
  if (filters.toReview) params.set('toReview', 'true');
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}

function placementLabel(c: CustomerDto): string {
  if (!c.territory) return 'Sans secteur';
  return c.part ? `${c.territory.code} · ${c.part.name}` : `${c.territory.code} · hors partie`;
}

/** Clients de l'entreprise (UC-53) : liste, filtres, clients à revoir, fiche et modification. */
export default function CustomersPage() {
  const { can } = CompanyAuth.useAuth();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState<Page<CustomerDto> | null>(null);
  const [reviewCount, setReviewCount] = useState<number | null>(null);
  const [types, setTypes] = useState<CustomerType[]>([]);
  const [territories, setTerritories] = useState<TerritoryOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<CustomerDto | null>(null);
  const [editing, setEditing] = useState<CustomerDto | 'new' | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [t, ter] = await Promise.all([
          api<CustomerType[]>('company', '/customer-types'),
          can('territories.read')
            ? api<TerritoryOption[]>('company', '/territories')
            : Promise.resolve([]),
        ]);
        setTypes(t);
        setTerritories(ter);
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [can]);

  // Recherche lancée 300 ms après la dernière frappe
  useEffect(() => {
    const timer = setTimeout(() => setFilters((f) => ({ ...f, q: search })), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [result, review] = await Promise.all([
        api<Page<CustomerDto>>('company', `/customers?${queryString(filters)}`),
        api<Page<CustomerDto>>('company', '/customers?toReview=true&limit=1'),
      ]);
      setPage(result);
      setReviewCount(review.total);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!page?.nextCursor) return;
    setLoadingMore(true);
    try {
      const next = await api<Page<CustomerDto>>(
        'company',
        `/customers?${queryString(filters, page.nextCursor)}`,
      );
      setPage({ ...next, data: [...page.data, ...next.data] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const parts = territories.find((t) => t.id === filters.territoryId)?.parts ?? [];

  function onSaved(customer: CustomerDto) {
    setEditing(null);
    setSelected(customer);
    void load();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Clients"
        subtitle={page ? `${page.total} client(s)` : 'Fiches clients, secteurs et parties'}
        action={
          <div className="flex flex-wrap gap-2">
            {can('imports.run') && (
              <Link
                href="/app/clients/import"
                className="inline-flex min-h-11 items-center rounded-lg border border-border bg-white px-4 font-semibold text-primary hover:bg-surface"
              >
                Importer un CSV
              </Link>
            )}
            {can('customers.create') && (
              <Button onClick={() => setEditing('new')}>Nouveau client</Button>
            )}
          </div>
        }
      />

      <div className="flex gap-1 border-b border-border">
        {[
          { review: false, label: 'Tous les clients' },
          {
            review: true,
            label: `À revoir${reviewCount !== null ? ` (${reviewCount})` : ''}`,
          },
        ].map((tab) => (
          <button
            key={tab.label}
            onClick={() => setFilters((f) => ({ ...f, toReview: tab.review }))}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              filters.toReview === tab.review
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {filters.toReview && (
        <p className="text-sm text-muted">
          Clients créés par les vendeurs, clients sans partie et clients signalés fermés
          (BR-CLI-05). Placez-les, validez-les ou désactivez-les.
        </p>
      )}

      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field
          label="Recherche"
          placeholder="Nom, code, téléphone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          label="Secteur"
          value={filters.territoryId}
          onChange={(e) => setFilters((f) => ({ ...f, territoryId: e.target.value, partId: '' }))}
          options={[
            { value: '', label: 'Tous' },
            ...territories.map((t) => ({ value: t.id, label: `${t.code} · ${t.name}` })),
          ]}
        />
        <Select
          label="Partie"
          value={filters.partId}
          onChange={(e) => setFilters((f) => ({ ...f, partId: e.target.value }))}
          options={[
            { value: '', label: 'Toutes' },
            { value: 'none', label: 'Hors partie' },
            ...parts.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <Select
          label="Type"
          value={filters.customerTypeId}
          onChange={(e) => setFilters((f) => ({ ...f, customerTypeId: e.target.value }))}
          options={[
            { value: '', label: 'Tous' },
            ...types.map((t) => ({ value: t.id, label: t.name })),
          ]}
        />
        <Select
          label="Statut"
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({ ...f, status: e.target.value as Filters['status'] }))
          }
          options={[
            { value: 'ACTIVE', label: 'Actifs' },
            { value: 'INACTIVE', label: 'Inactifs' },
            { value: 'ALL', label: 'Tous' },
          ]}
        />
      </Card>

      {error && <Alert>{error}</Alert>}
      {!page && !error && <p className="text-muted">Chargement…</p>}
      {page?.data.length === 0 && (
        <Card>
          <p className="text-muted">
            {filters.toReview ? 'Aucun client à revoir.' : 'Aucun client ne correspond.'}
          </p>
        </Card>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-white">
        {page?.data.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelected(c)}
            className="flex w-full flex-col gap-1 border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-surface sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex flex-col">
              <span className="font-semibold text-text-dark">
                {c.name}{' '}
                {c.code && (
                  <span className="font-mono text-sm font-normal text-muted">{c.code}</span>
                )}
              </span>
              <span className="text-sm text-muted">
                {c.customerType.name} · {placementLabel(c)} · {FREQUENCY_LABELS[c.frequency]}
                {c.phone ? ` · ${c.phone}` : ''}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              {c.status === 'INACTIVE' && <Badge tone="danger">Inactif</Badge>}
              {c.reviewReasons.map((r) => (
                <Badge key={r} tone="warning">
                  {REVIEW_LABELS[r]}
                </Badge>
              ))}
              {c.debtAmount > 0 && <Badge tone="neutral">Dette {formatDA(c.debtAmount)}</Badge>}
            </span>
          </button>
        ))}
      </div>
      {page?.nextCursor && (
        <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? 'Chargement…' : 'Afficher plus'}
        </Button>
      )}

      {selected && !editing && (
        <CustomerDetail
          customer={selected}
          onClose={() => setSelected(null)}
          onEdit={() => setEditing(selected)}
          onChanged={(c) => {
            setSelected(c);
            void load();
          }}
        />
      )}
      {editing && (
        <CustomerForm
          customer={editing === 'new' ? null : editing}
          types={types}
          territories={territories}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function CustomerDetail({
  customer: c,
  onClose,
  onEdit,
  onChanged,
}: {
  customer: CustomerDto;
  onClose: () => void;
  onEdit: () => void;
  onChanged: (c: CustomerDto) => void;
}) {
  const { can } = CompanyAuth.useAuth();
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<CustomerHistory>('company', `/customers/${c.id}/history`)
      .then(setHistory)
      .catch((err) => setError(errorMessage(err)));
  }, [c.id]);

  async function action(path: string, question: string | null) {
    if (question && !confirm(question)) return;
    setError(null);
    try {
      onChanged(
        await api<CustomerDto>('company', `/customers/${c.id}/${path}`, { method: 'POST' }),
      );
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const rows: [string, string][] = [
    ['Type', c.customerType.name],
    ['Secteur et partie', `${placementLabel(c)}${c.isPartForced ? ' (forcée)' : ''}`],
    ['Fréquence', FREQUENCY_LABELS[c.frequency] ?? c.frequency],
    ['Première visite prévue', formatDate(c.referenceDate)],
    ['Téléphone', c.phone ?? '—'],
    ['Adresse', c.address ?? '—'],
    [
      'Position GPS',
      c.latitude !== null && c.longitude !== null ? `${c.latitude}, ${c.longitude}` : 'Inconnue',
    ],
    [
      'Crédit',
      c.isCreditAllowed
        ? `Autorisé, plafond ${formatDA(c.creditLimitAmount)}`
        : c.isCashOnly
          ? 'Comptant seulement, en attente de validation'
          : 'Non autorisé',
    ],
    ['Dette', formatDA(c.debtAmount)],
    ['Créé le', `${formatDateTime(c.createdAt)}${c.createdBy ? ` par ${c.createdBy}` : ''}`],
  ];

  return (
    <Modal title={c.name} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={c.status === 'ACTIVE' ? 'success' : 'danger'}>
            {c.status === 'ACTIVE' ? 'Actif' : 'Inactif'}
          </Badge>
          {c.code && <Badge>{c.code}</Badge>}
          {c.reviewReasons.map((r) => (
            <Badge key={r} tone="warning">
              {REVIEW_LABELS[r]}
            </Badge>
          ))}
        </div>
        {error && <Alert>{error}</Alert>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="text-text-dark">{value}</dd>
            </div>
          ))}
        </dl>
        {c.latitude !== null && c.longitude !== null && (
          <a
            href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-deep-blue"
          >
            Voir sur la carte →
          </a>
        )}

        <div className="flex flex-wrap gap-2">
          {can('customers.update') && <Button onClick={onEdit}>Modifier</Button>}
          {can('customers.update') && c.isNew && (
            <Button variant="secondary" onClick={() => void action('validate', null)}>
              Valider le client
            </Button>
          )}
          {can('customers.disable') &&
            (c.status === 'ACTIVE' ? (
              <Button
                variant="danger"
                onClick={() =>
                  void action(
                    'disable',
                    `Désactiver ${c.name} ? Il ne sera plus planifié ni proposé à la vente ; son historique est conservé.`,
                  )
                }
              >
                Désactiver
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => void action('enable', null)}>
                Réactiver
              </Button>
            ))}
        </div>

        <section className="flex flex-col gap-2 border-t border-border pt-3">
          <h3 className="font-semibold text-text-dark">Historique</h3>
          {!history && !error && <p className="text-sm text-muted">Chargement…</p>}
          {history &&
            history.visits.length + history.orders.length + history.payments.length === 0 && (
              <p className="text-sm text-muted">Aucune visite, commande ni paiement.</p>
            )}
          {history?.orders.map((o) => (
            <p key={o.id} className="text-sm">
              {formatDate(o.date)} · commande {o.number} · {formatDA(o.totalAmount)} · {o.status}
            </p>
          ))}
          {history?.visits.map((v) => (
            <p key={v.id} className="text-sm">
              {formatDate(v.date)} · visite {v.status.toLowerCase()} · {v.user}
            </p>
          ))}
          {history?.payments.map((p) => (
            <p key={p.id} className="text-sm">
              {formatDateTime(p.date)} · paiement {p.number} · {formatDA(p.cashAmount)} encaissé
              {p.creditAmount > 0 ? `, ${formatDA(p.creditAmount)} à crédit` : ''} · {p.user}
            </p>
          ))}
        </section>
      </div>
    </Modal>
  );
}

/** « 35.6971, -0.6308 » ou « 35,6971 -0,6308 », tel que copié depuis une carte. */
function parsePosition(text: string): { latitude: number; longitude: number } | null | 'invalid' {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const numbers = trimmed.match(/-?\d+(?:[.,]\d+)?/g);
  if (!numbers || numbers.length !== 2) return 'invalid';
  const [latitude, longitude] = numbers.map((n) => Number(n.replace(',', '.'))) as [number, number];
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return 'invalid';
  return { latitude, longitude };
}

function CustomerForm({
  customer,
  types,
  territories,
  onClose,
  onSaved,
}: {
  customer: CustomerDto | null;
  types: CustomerType[];
  territories: TerritoryOption[];
  onClose: () => void;
  onSaved: (c: CustomerDto) => void;
}) {
  const [customerTypeId, setCustomerTypeId] = useState(
    customer?.customerType.id ?? types.find((t) => t.isActive)?.id ?? '',
  );
  const [partChoice, setPartChoice] = useState(
    customer?.isPartForced && customer.part ? customer.part.id : '',
  );
  const [credit, setCredit] = useState(customer?.isCreditAllowed ?? false);
  const [closed, setClosed] = useState(customer?.isClosedPermanently ?? false);
  const [error, setError] = useState<string | null>(null);
  const [ambiguous, setAmbiguous] = useState<AmbiguousPartDetails['options'] | null>(null);
  const [busy, setBusy] = useState(false);

  // Parties proposées : celles des secteurs qui servent le type choisi (BR-ORG-03)
  const partOptions = useMemo(
    () =>
      territories
        .filter((t) => t.customerTypeIds.includes(customerTypeId))
        .flatMap((t) => t.parts.map((p) => ({ value: p.id, label: `${t.code} · ${p.name}` }))),
    [territories, customerTypeId],
  );

  async function submit(form: FormData) {
    setError(null);
    const position = parsePosition(String(form.get('position') ?? ''));
    if (position === 'invalid') {
      setError(
        'Position invalide : saisissez « latitude, longitude », par exemple 35.6971, -0.6308.',
      );
      return;
    }
    const text = (name: string) => String(form.get(name) ?? '').trim();
    const body: Record<string, unknown> = {
      name: text('name'),
      code: text('code'),
      phone: text('phone'),
      address: text('address'),
      customerTypeId,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
      frequency: text('frequency'),
      isCreditAllowed: credit,
      creditLimitAmount: credit ? Number(text('creditLimitAmount').replace(/\s/g, '') || 0) : 0,
    };
    const referenceDate = text('referenceDate');
    if (referenceDate && referenceDate !== customer?.referenceDate)
      body.referenceDate = referenceDate;
    // Partie : choisie = forcée ; « automatique » libère une partie forcée
    if (partChoice) body.partId = partChoice;
    else if (customer?.isPartForced) body.partId = null;
    if (customer?.isClosedPermanently && !closed) body.isClosedPermanently = false;

    setBusy(true);
    try {
      const saved = await api<CustomerDto>(
        'company',
        customer ? `/customers/${customer.id}` : '/customers',
        { method: customer ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'AMBIGUOUS_PART') {
        setAmbiguous((err.details as unknown as AmbiguousPartDetails).options);
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={customer ? `Modifier ${customer.name}` : 'Nouveau client'} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field label="Nom" name="name" required defaultValue={customer?.name} />
          <Field label="Code" name="code" defaultValue={customer?.code ?? ''} hint="Facultatif" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Téléphone" name="phone" type="tel" defaultValue={customer?.phone ?? ''} />
          <Select
            label="Type de client"
            value={customerTypeId}
            onChange={(e) => {
              setCustomerTypeId(e.target.value);
              setPartChoice('');
              setAmbiguous(null);
            }}
            options={types
              .filter((t) => t.isActive || t.id === customer?.customerType.id)
              .map((t) => ({ value: t.id, label: t.name }))}
          />
        </div>
        <Field label="Adresse" name="address" defaultValue={customer?.address ?? ''} />
        <Field
          label="Position GPS"
          name="position"
          placeholder="35.6971, -0.6308"
          defaultValue={
            customer?.latitude != null ? `${customer.latitude}, ${customer.longitude}` : ''
          }
          hint="Latitude, longitude. Copiez-la depuis Google Maps (clic droit sur le point). Sans position, le client reste hors partie."
        />
        <Select
          label="Partie"
          value={partChoice}
          onChange={(e) => setPartChoice(e.target.value)}
          options={[{ value: '', label: 'Automatique, selon la position' }, ...partOptions]}
        />
        {ambiguous && (
          <p className="text-sm text-muted">
            Parties possibles : {ambiguous.map((o) => o.label).join(', ')}. Choisissez-en une
            ci-dessus.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Fréquence de visite"
            name="frequency"
            defaultValue={customer?.frequency ?? 'WEEKLY'}
            options={FREQUENCY_OPTIONS}
          />
          <Field
            label="Première visite"
            name="referenceDate"
            type="date"
            defaultValue={customer?.referenceDate ?? ''}
            hint="Vide : prochain jour prévu pour la partie."
          />
        </div>
        <Toggle
          label="Crédit autorisé"
          description="Le client peut payer une partie de ses bons à crédit, dans la limite du plafond."
          checked={credit}
          onChange={setCredit}
        />
        {credit && (
          <Field
            label="Plafond de crédit (DA)"
            name="creditLimitAmount"
            inputMode="numeric"
            defaultValue={customer?.creditLimitAmount ? String(customer.creditLimitAmount) : ''}
          />
        )}
        {customer?.isClosedPermanently && (
          <Toggle
            label="Signalé fermé définitivement"
            description="Décochez si le magasin est toujours ouvert. Sinon, désactivez le client."
            checked={closed}
            onChange={setClosed}
          />
        )}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Enregistrement…' : customer ? 'Enregistrer' : 'Créer le client'}
        </Button>
      </form>
    </Modal>
  );
}
