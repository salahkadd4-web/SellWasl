'use client';

import type {
  CustomerDto,
  Page,
  PlanningCalendarDay,
  PlanningDay,
  RescheduleDto,
  TerritoryDto,
} from '@sellwasl/validation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Field, Modal, PageTitle, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDA, formatDate, FREQUENCY_LABELS } from '@/lib/labels';

const DAYS = 14;

function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const shortDay = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('fr-DZ', { weekday: 'short', day: 'numeric' });

/** Clients du jour des vendeurs et reprogrammations (UC-10 vu du Web, UC-54). */
export default function PlanningPage() {
  const { can } = CompanyAuth.useAuth();
  const [territories, setTerritories] = useState<TerritoryDto[]>([]);
  const [sellerId, setSellerId] = useState('');
  const [from, setFrom] = useState(today);
  const [date, setDate] = useState(today);
  const [calendar, setCalendar] = useState<PlanningCalendarDay[] | null>(null);
  const [day, setDay] = useState<PlanningDay | null>(null);
  const [reschedules, setReschedules] = useState<RescheduleDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState<{ id: string; name: string } | 'pick' | null>(
    null,
  );

  useEffect(() => {
    void api<TerritoryDto[]>('company', '/territories')
      .then((t) => {
        const withSeller = t.filter((x) => x.seller);
        setTerritories(withSeller);
        setSellerId((current) => current || withSeller[0]?.seller?.id || '');
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const load = useCallback(async () => {
    if (!sellerId) return;
    setError(null);
    try {
      const [c, d, r] = await Promise.all([
        api<PlanningCalendarDay[]>(
          'company',
          `/planning/calendar?userId=${sellerId}&from=${from}&days=${DAYS}`,
        ),
        api<PlanningDay>('company', `/planning/day?userId=${sellerId}&date=${date}`),
        api<RescheduleDto[]>('company', `/planning/reschedules?userId=${sellerId}`),
      ]);
      setCalendar(c);
      setDay(d);
      setReschedules(r);
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [sellerId, from, date]);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancel(r: RescheduleDto) {
    if (!confirm(`Annuler la visite de ${r.customer.name} le ${formatDate(r.date)} ?`)) return;
    try {
      await api('company', `/customers/${r.customer.id}/reschedules/${r.date}`, {
        method: 'DELETE',
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const territory = territories.find((t) => t.seller?.id === sellerId);
  const canReschedule = can('customers.reschedule');

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Planning"
        subtitle="Clients du jour de chaque vendeur, calculés comme sur son téléphone."
        action={
          canReschedule &&
          territory && (
            <Button onClick={() => setRescheduling('pick')}>Reprogrammer un client</Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}

      <Card className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Select
          label="Vendeur"
          value={sellerId}
          onChange={(e) => setSellerId(e.target.value)}
          options={territories.map((t) => ({
            value: t.seller!.id,
            label: `${t.seller!.code} · ${t.seller!.name} — ${t.code} ${t.name}`,
          }))}
        />
        <Field
          label="Aller au"
          type="date"
          value={date}
          onChange={(e) => {
            if (!e.target.value) return;
            setDate(e.target.value);
            setFrom(e.target.value);
          }}
        />
      </Card>
      {territories.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Aucun secteur n'a de vendeur : affectez les vendeurs dans la page Secteurs.
          </p>
        </Card>
      )}

      {calendar && (
        <div className="flex items-stretch gap-2">
          <Button
            variant="secondary"
            onClick={() => setFrom(addDays(from, -DAYS))}
            aria-label="Jours précédents"
          >
            ‹
          </Button>
          <div className="grid flex-1 grid-cols-7 gap-1.5 lg:grid-cols-14">
            {calendar.map((d) => {
              const off = d.status !== 'WORKING';
              return (
                <button
                  key={d.date}
                  onClick={() => setDate(d.date)}
                  className={`flex flex-col items-center rounded-xl border px-1 py-2 text-xs ${
                    d.date === date
                      ? 'border-primary bg-primary text-white'
                      : off
                        ? 'border-border bg-surface text-muted'
                        : 'border-border bg-white text-text-dark hover:border-primary'
                  }`}
                >
                  <span className="font-semibold capitalize">{shortDay(d.date)}</span>
                  <span className="truncate">
                    {off ? (d.holiday ? 'Férié' : 'Chômé') : d.partName}
                  </span>
                  <span className="text-base font-bold">{off ? '—' : d.count}</span>
                  {d.rescheduledCount > 0 && <span>+{d.rescheduledCount} reprog.</span>}
                </button>
              );
            })}
          </div>
          <Button
            variant="secondary"
            onClick={() => setFrom(addDays(from, DAYS))}
            aria-label="Jours suivants"
          >
            ›
          </Button>
        </div>
      )}

      {day && (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-text-dark">
              {formatDate(day.date)} · {day.seller.name}
            </h2>
            <span className="text-sm text-muted">
              {day.status === 'WORKING'
                ? `${day.part?.name ?? 'Aucune partie prévue'} · ${day.customers.length} client(s)`
                : day.status === 'HOLIDAY'
                  ? `Férié : ${day.holiday}`
                  : 'Jour non travaillé'}
            </span>
          </div>
          {day.status === 'WORKING' && !day.part && (
            <Alert>
              Aucune partie n'est prévue ce jour-là : complétez le planning du secteur dans la page
              Secteurs.
            </Alert>
          )}
          {day.customers.length === 0 && day.status === 'WORKING' && day.part && (
            <p className="text-sm text-muted">Aucun client à visiter ce jour-là.</p>
          )}
          <div className="overflow-hidden rounded-xl border border-border">
            {day.customers.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-text-dark">
                    {c.name}{' '}
                    {c.code && <span className="font-mono text-xs text-muted">{c.code}</span>}
                  </span>
                  <span className="text-xs text-muted">
                    {c.partName ?? 'hors partie'} · {FREQUENCY_LABELS[c.frequency]}
                    {c.phone ? ` · ${c.phone}` : ''}
                    {c.debtAmount > 0 ? ` · dette ${formatDA(c.debtAmount)}` : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {c.reason === 'RESCHEDULED' && <Badge tone="warning">Reprogrammé</Badge>}
                  {c.latitude !== null && (
                    <a
                      className="text-sm font-semibold text-deep-blue"
                      href={`https://www.google.com/maps?q=${c.latitude},${c.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Carte
                    </a>
                  )}
                  {canReschedule && (
                    <Button
                      variant="secondary"
                      onClick={() => setRescheduling({ id: c.id, name: c.name })}
                    >
                      Reprogrammer
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <h2 className="font-semibold text-text-dark">Reprogrammations à venir</h2>
        {reschedules.length === 0 && <p className="text-sm text-muted">Aucune.</p>}
        {reschedules.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              <strong>{formatDate(r.date)}</strong> · {r.customer.name}
              {r.createdBy ? <span className="text-muted"> · par {r.createdBy}</span> : null}
            </span>
            {canReschedule && (
              <Button variant="danger" onClick={() => void cancel(r)}>
                Annuler
              </Button>
            )}
          </div>
        ))}
      </Card>

      {rescheduling && territory && (
        <RescheduleDialog
          territoryId={territory.id}
          customer={rescheduling === 'pick' ? null : rescheduling}
          onClose={() => setRescheduling(null)}
          onSaved={(d) => {
            setRescheduling(null);
            setDate(d);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Ajoute un client aux clients du jour d'une date, sans changer sa fréquence (BR-PLA-05). */
function RescheduleDialog({
  territoryId,
  customer,
  onClose,
  onSaved,
}: {
  territoryId: string;
  customer: { id: string; name: string } | null;
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState(customer?.id ?? '');
  const [date, setDate] = useState(() => addDays(today(), 1));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (customer) return;
    const q = search.trim() ? `&q=${encodeURIComponent(search.trim())}` : '';
    const timer = setTimeout(() => {
      void api<Page<CustomerDto>>(
        'company',
        `/customers?territoryId=${territoryId}&limit=50${q}`,
      ).then((p) => setCustomers(p.data));
    }, 250);
    return () => clearTimeout(timer);
  }, [customer, territoryId, search]);

  const options = useMemo(
    () =>
      customers.map((c) => ({ value: c.id, label: `${c.name}${c.code ? ` (${c.code})` : ''}` })),
    [customers],
  );

  async function save() {
    setError(null);
    try {
      await api('company', `/customers/${customerId}/reschedules`, {
        method: 'POST',
        body: JSON.stringify({ date }),
      });
      onSaved(date);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal
      title={customer ? `Reprogrammer ${customer.name}` : 'Reprogrammer un client'}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        {!customer && (
          <>
            <Field
              label="Rechercher"
              placeholder="Nom, code, téléphone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              label="Client"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              options={[{ value: '', label: 'Choisissez un client' }, ...options]}
            />
          </>
        )}
        <Field
          label="Date de la visite"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <p className="text-xs text-muted">
          Le client s'ajoute aux clients du jour du vendeur à cette date. Sa fréquence ne change
          pas.
        </p>
        {error && <Alert>{error}</Alert>}
        <Button onClick={() => void save()} disabled={!customerId || !date}>
          Reprogrammer
        </Button>
      </div>
    </Modal>
  );
}
