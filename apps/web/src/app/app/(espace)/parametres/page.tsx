'use client';

import type { CompanySettings, CompanyUser } from '@sellwasl/validation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
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
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';

const TABS = [
  { key: 'general', label: 'Général' },
  { key: 'rules', label: 'Règles' },
  { key: 'types', label: 'Types de clients' },
  { key: 'holidays', label: 'Jours fériés' },
  { key: 'reasons', label: 'Motifs' },
  { key: 'warehouses', label: 'Dépôts et camions' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Paramétrage de l'entreprise (UC-82, BR-TEN-06 à 08). */
export default function SettingsPage() {
  const { can } = CompanyAuth.useAuth();
  const [tab, setTab] = useState<Tab>('general');
  const editable = can('settings.update');

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Paramètres"
        subtitle={
          editable
            ? "Règles de fonctionnement et données de référence de l'entreprise."
            : 'Consultation seule : seul l’administrateur modifie les paramètres.'
        }
      />
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-primary'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {(tab === 'general' || tab === 'rules') && <SettingsForm section={tab} editable={editable} />}
      {tab === 'types' && <CustomerTypes editable={editable} />}
      {tab === 'holidays' && <Holidays editable={editable} />}
      {tab === 'reasons' && <Reasons editable={editable} />}
      {tab === 'warehouses' && <Warehouses editable={editable} />}
    </div>
  );
}

// ---------------------------------------------------------------- Paramètres versionnés

const WEEKDAYS = [
  ['SAT', 'Samedi'],
  ['SUN', 'Dimanche'],
  ['MON', 'Lundi'],
  ['TUE', 'Mardi'],
  ['WED', 'Mercredi'],
  ['THU', 'Jeudi'],
  ['FRI', 'Vendredi'],
] as const;

/** BR-TEN-08 : libellé, effet de l'option cochée, valeur par défaut. */
const RULES: {
  key: keyof CompanySettings['rules'];
  code: string;
  label: string;
  description: string;
}[] = [
  {
    key: 'P01_workOnNonWorkingDays',
    code: 'P-01',
    label: 'Travail les jours non travaillés et fériés',
    description: 'Coché : la journée peut être démarrée, sans clients du jour.',
  },
  {
    key: 'P02_outOfProgramVisits',
    code: 'P-02',
    label: 'Visites hors programme',
    description: 'Coché : un vendeur peut visiter un client de son secteur non prévu ce jour-là.',
  },
  {
    key: 'P03_bonusConsumesQuota',
    code: 'P-03',
    label: 'Les bonus consomment le quota',
    description: 'Coché : les quantités offertes sont déduites du quota du vendeur.',
  },
  {
    key: 'P04_recalculateOnDecrease',
    code: 'P-04',
    label: 'Recalculer paliers et bonus quand les quantités baissent',
    description: 'Coché : pas de remise ni de bonus sur une marchandise non livrée.',
  },
  {
    key: 'P05_rescheduleFailedDelivery',
    code: 'P-05',
    label: 'Reprogrammer une livraison échouée',
    description: 'Coché : une fois, au jour ouvré suivant, sauf en cas de refus.',
  },
  {
    key: 'P06_fullUnload',
    code: 'P-06',
    label: 'Déchargement complet chaque soir',
    description: 'Décoché : le stock compté reste dans le camion pour le lendemain.',
  },
  {
    key: 'P07_multipleCashVanLoads',
    code: 'P-07',
    label: 'Plusieurs chargements cash van par jour',
    description: 'Coché : un vendeur qui a tout vendu peut recharger.',
  },
  {
    key: 'P08_driverCollectsOldDebts',
    code: 'P-08',
    label: 'Le livreur encaisse les anciennes dettes',
    description: 'Coché : le livreur reçoit le droit d’encaisser les dettes.',
  },
  {
    key: 'P09_newCustomerActiveImmediately',
    code: 'P-09',
    label: 'Client créé par un vendeur actif tout de suite',
    description: 'Décoché : vente au comptant seulement jusqu’à la validation du superviseur.',
  },
  {
    key: 'P10_supervisorEditsPrices',
    code: 'P-10',
    label: 'Le superviseur modifie prix, paliers et bonus',
    description: 'Décoché : seule la direction (l’admin) fixe les prix.',
  },
];

function SettingsForm({ section, editable }: { section: 'general' | 'rules'; editable: boolean }) {
  const [state, setState] = useState<{ version: number; data: CompanySettings } | null>(null);
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ version: number; data: CompanySettings }>('company', '/settings')
      .then(setState)
      .catch((err) => setMessage({ tone: 'error', text: errorMessage(err) }));
  }, []);

  if (!state)
    return message ? <Alert>{message.text}</Alert> : <p className="text-muted">Chargement…</p>;
  const data = state.data;
  const set = (patch: Partial<CompanySettings>) =>
    setState({ ...state, data: { ...data, ...patch } });

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api<{ version: number; data: CompanySettings }>('company', '/settings', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      setState(saved);
      setMessage({
        tone: 'ok',
        text: `Version ${saved.version} enregistrée. Elle s'applique aux journées démarrées à partir de maintenant.`,
      });
    } catch (err) {
      setMessage({ tone: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      {section === 'general' ? (
        <>
          <div>
            <p className="mb-2 font-semibold text-text-dark">Jours travaillés</p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map(([code, label]) => {
                const on = data.workingDays.includes(code);
                return (
                  <button
                    key={code}
                    disabled={!editable}
                    onClick={() =>
                      set({
                        workingDays: on
                          ? data.workingDays.filter((d) => d !== code)
                          : [...data.workingDays, code],
                      })
                    }
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium ${on ? 'border-primary bg-primary text-white' : 'border-border text-muted'}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              label="Distance hors zone (m)"
              type="number"
              min={10}
              value={data.outOfZoneDistanceM}
              disabled={!editable}
              onChange={(e) => set({ outOfZoneDistanceM: Number(e.target.value) })}
            />
            <Select
              label="Largeur du ticket"
              value={String(data.ticketWidthMm)}
              disabled={!editable}
              onChange={(e) => set({ ticketWidthMm: Number(e.target.value) as 58 | 80 })}
              options={[
                { value: '58', label: '58 mm' },
                { value: '80', label: '80 mm' },
              ]}
            />
            <Field
              label="Envoi de la position (min)"
              type="number"
              min={1}
              value={data.positionIntervalMin}
              disabled={!editable}
              onChange={(e) => set({ positionIntervalMin: Number(e.target.value) })}
            />
            <Field
              label="Volume minimum d'un taux de retour"
              hint="En dessous, aucun taux n'est conclu (analyse des retours)."
              type="number"
              min={1}
              value={data.returnsMinVolume}
              disabled={!editable}
              onChange={(e) => set({ returnsMinVolume: Number(e.target.value) })}
            />
          </div>
          <p className="font-semibold text-text-dark">En-tête des bons</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(['name', 'address', 'phone'] as const).map((k) => (
              <Field
                key={k}
                label={{ name: 'Nom', address: 'Adresse', phone: 'Téléphone' }[k]}
                value={data.receiptHeader[k]}
                disabled={!editable}
                onChange={(e) =>
                  set({ receiptHeader: { ...data.receiptHeader, [k]: e.target.value } })
                }
              />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          {RULES.map((r) => (
            <Toggle
              key={r.key}
              label={`${r.code} · ${r.label}`}
              description={r.description}
              checked={data.rules[r.key]}
              disabled={!editable}
              onChange={(value) => set({ rules: { ...data.rules, [r.key]: value } })}
            />
          ))}
        </div>
      )}
      <p className="text-xs text-muted">
        Version {state.version} des paramètres. Chaque enregistrement crée une nouvelle version,
        conservée.
      </p>
      {message &&
        (message.tone === 'error' ? (
          <Alert>{message.text}</Alert>
        ) : (
          <p className="rounded-lg bg-synced/10 px-3 py-2 text-sm text-synced">{message.text}</p>
        ))}
      {editable && (
        <Button onClick={() => void save()} disabled={busy} className="self-start">
          {busy ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- Listes de référence

function useList<T>(path: string) {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setItems(await api<T[]>('company', path));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };
  return { items, error, run };
}

function ListCard({ children, error }: { children: ReactNode; error: string | null }) {
  return (
    <Card className="flex flex-col gap-3">
      {error && <Alert>{error}</Alert>}
      {children}
    </Card>
  );
}

function Row({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

function InlineForm({
  onSubmit,
  children,
}: {
  onSubmit: (form: FormData) => Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <form
      className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        if (await onSubmit(new FormData(form))) form.reset();
      }}
    >
      {children}
    </form>
  );
}

const v = (form: FormData, key: string) => String(form.get(key) ?? '').trim();

function CustomerTypes({ editable }: { editable: boolean }) {
  const { items, error, run } = useList<{
    id: string;
    code: string;
    name: string;
    isActive: boolean;
  }>('/customer-types');
  return (
    <ListCard error={error}>
      <p className="text-sm text-muted">Le type d'un client détermine ses prix (BR-CAT-03).</p>
      {items?.map((t) => (
        <Row
          key={t.id}
          actions={
            editable && (
              <Button
                variant="secondary"
                onClick={() =>
                  void run(() =>
                    api('company', `/customer-types/${t.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ isActive: !t.isActive }),
                    }),
                  )
                }
              >
                {t.isActive ? 'Désactiver' : 'Activer'}
              </Button>
            )
          }
        >
          <span className="font-medium text-text-dark">{t.name}</span>
          <span className="font-mono text-sm text-muted">{t.code}</span>
          {!t.isActive && <Badge tone="danger">Inactif</Badge>}
        </Row>
      ))}
      {editable && (
        <InlineForm
          onSubmit={(f) =>
            run(() =>
              api('company', '/customer-types', {
                method: 'POST',
                body: JSON.stringify({ code: v(f, 'code'), name: v(f, 'name') }),
              }),
            )
          }
        >
          <Field label="Nom" name="name" required placeholder="Supérette" />
          <Field label="Code" name="code" required placeholder="SUPERETTE" />
          <Button type="submit">Ajouter</Button>
        </InlineForm>
      )}
    </ListCard>
  );
}

function Holidays({ editable }: { editable: boolean }) {
  const { items, error, run } = useList<{ id: string; date: string; label: string }>('/holidays');
  return (
    <ListCard error={error}>
      <p className="text-sm text-muted">Pas de clients du jour les jours fériés (BR-PLA-04).</p>
      {items?.map((h) => (
        <Row
          key={h.id}
          actions={
            editable && (
              <Button
                variant="danger"
                onClick={() =>
                  void run(() => api('company', `/holidays/${h.id}`, { method: 'DELETE' }))
                }
              >
                Supprimer
              </Button>
            )
          }
        >
          <span className="font-medium text-text-dark">
            {new Date(h.date).toLocaleDateString('fr-DZ', { dateStyle: 'full', timeZone: 'UTC' })}
          </span>
          <span className="text-muted">{h.label}</span>
        </Row>
      ))}
      {items?.length === 0 && <p className="text-sm text-muted">Aucun jour férié.</p>}
      {editable && (
        <InlineForm
          onSubmit={(f) =>
            run(() =>
              api('company', '/holidays', {
                method: 'POST',
                body: JSON.stringify({ date: v(f, 'date'), label: v(f, 'label') }),
              }),
            )
          }
        >
          <Field label="Date" name="date" type="date" required />
          <Field label="Libellé" name="label" required placeholder="Fête de l'Indépendance" />
          <Button type="submit">Ajouter</Button>
        </InlineForm>
      )}
    </ListCard>
  );
}

const REASON_KINDS: Record<string, string> = {
  NO_ORDER: 'Non-commande',
  DELIVERY_FAILURE: 'Échec de livraison',
  ADJUSTMENT: 'Écart de stock',
  FORCED_CLOSE: "Clôture d'office",
  REOPEN: 'Réouverture de journée',
  REFUSAL: 'Refus à la livraison',
};

function Reasons({ editable }: { editable: boolean }) {
  const { items, error, run } = useList<{
    id: string;
    kind: string;
    label: string;
    systemCode: string | null;
    isActive: boolean;
  }>('/reasons');
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(null);
  return (
    <ListCard error={error}>
      <p className="text-sm text-muted">
        Les motifs marqués « système » déclenchent un comportement : ils se renomment mais ne se
        désactivent pas.
      </p>
      {Object.entries(REASON_KINDS).map(([kind, title]) => (
        <div key={kind}>
          <p className="mt-2 font-semibold text-text-dark">{title}</p>
          {items
            ?.filter((r) => r.kind === kind)
            .map((r) => (
              <Row
                key={r.id}
                actions={
                  editable && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setRenaming({ id: r.id, label: r.label })}
                      >
                        Renommer
                      </Button>
                      {!r.systemCode && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void run(() =>
                              api('company', `/reasons/${r.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ isActive: !r.isActive }),
                              }),
                            )
                          }
                        >
                          {r.isActive ? 'Désactiver' : 'Activer'}
                        </Button>
                      )}
                    </>
                  )
                }
              >
                <span className="text-text-dark">{r.label}</span>
                {r.systemCode && <Badge>Système</Badge>}
                {!r.isActive && <Badge tone="danger">Inactif</Badge>}
              </Row>
            ))}
        </div>
      ))}
      {editable && (
        <InlineForm
          onSubmit={(f) =>
            run(() =>
              api('company', '/reasons', {
                method: 'POST',
                body: JSON.stringify({ kind: v(f, 'kind'), label: v(f, 'label') }),
              }),
            )
          }
        >
          <Select
            label="Type"
            name="kind"
            options={Object.entries(REASON_KINDS).map(([value, label]) => ({ value, label }))}
          />
          <Field label="Libellé" name="label" required />
          <Button type="submit">Ajouter</Button>
        </InlineForm>
      )}
      {renaming && (
        <Modal title="Renommer le motif" onClose={() => setRenaming(null)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const label = v(new FormData(e.currentTarget), 'label');
              if (
                await run(() =>
                  api('company', `/reasons/${renaming.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ label }),
                  }),
                )
              )
                setRenaming(null);
            }}
          >
            <Field label="Libellé" name="label" required defaultValue={renaming.label} />
            <Button type="submit">Enregistrer</Button>
          </form>
        </Modal>
      )}
    </ListCard>
  );
}

interface WarehouseRow {
  id: string;
  type: 'DEPOT' | 'TRUCK';
  code: string;
  name: string;
  plateNumber: string | null;
  isActive: boolean;
  assignedUser: { id: string; code: string; firstName: string; lastName: string } | null;
}

function Warehouses({ editable }: { editable: boolean }) {
  const { items, error, run } = useList<WarehouseRow>('/warehouses');
  const [drivers, setDrivers] = useState<CompanyUser[]>([]);
  const [editing, setEditing] = useState<WarehouseRow | 'new' | null>(null);

  useEffect(() => {
    api<CompanyUser[]>('company', '/users')
      .then((users) =>
        setDrivers(
          users.filter(
            (u) => u.status === 'ACTIVE' && ['LIVREUR', 'VENDEUR_CASH_VAN'].includes(u.role.code),
          ),
        ),
      )
      .catch(() => setDrivers([]));
  }, []);

  return (
    <ListCard error={error}>
      <p className="text-sm text-muted">
        Un camion est un entrepôt, confié à un livreur ou à un vendeur cash van (BR-STK-01).
      </p>
      {items?.map((w) => (
        <Row
          key={w.id}
          actions={
            editable && (
              <Button variant="secondary" onClick={() => setEditing(w)}>
                Modifier
              </Button>
            )
          }
        >
          <Badge>{w.type === 'DEPOT' ? 'Dépôt' : 'Camion'}</Badge>
          <span className="font-medium text-text-dark">{w.name}</span>
          <span className="font-mono text-sm text-muted">
            {w.code}
            {w.plateNumber ? ` · ${w.plateNumber}` : ''}
          </span>
          {w.type === 'TRUCK' && (
            <span className="text-sm text-muted">
              {w.assignedUser
                ? `→ ${w.assignedUser.firstName} ${w.assignedUser.lastName}`
                : 'non affecté'}
            </span>
          )}
          {!w.isActive && <Badge tone="danger">Inactif</Badge>}
        </Row>
      ))}
      {editable && (
        <Button className="self-start" onClick={() => setEditing('new')}>
          Ajouter un dépôt ou un camion
        </Button>
      )}
      {editing && (
        <Modal
          title={editing === 'new' ? 'Nouvel entrepôt' : `Modifier ${editing.name}`}
          onClose={() => setEditing(null)}
        >
          <WarehouseForm
            warehouse={editing === 'new' ? null : editing}
            drivers={drivers}
            onSubmit={async (body) => {
              const ok = await run(() =>
                editing === 'new'
                  ? api('company', '/warehouses', { method: 'POST', body: JSON.stringify(body) })
                  : api('company', `/warehouses/${editing.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify(body),
                    }),
              );
              if (ok) setEditing(null);
            }}
          />
          {error && (
            <div className="mt-3">
              <Alert>{error}</Alert>
            </div>
          )}
        </Modal>
      )}
    </ListCard>
  );
}

function WarehouseForm({
  warehouse,
  drivers,
  onSubmit,
}: {
  warehouse: WarehouseRow | null;
  drivers: CompanyUser[];
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [type, setType] = useState<'DEPOT' | 'TRUCK'>(warehouse?.type ?? 'TRUCK');
  const [active, setActive] = useState(warehouse?.isActive ?? true);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSubmit({
          ...(warehouse ? {} : { type }),
          code: v(f, 'code'),
          name: v(f, 'name'),
          ...(type === 'TRUCK'
            ? { plateNumber: v(f, 'plateNumber'), assignedUserId: v(f, 'assignedUserId') || null }
            : {}),
          isActive: active,
        });
      }}
    >
      {!warehouse && (
        <Select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as 'DEPOT' | 'TRUCK')}
          options={[
            { value: 'TRUCK', label: 'Camion' },
            { value: 'DEPOT', label: 'Dépôt' },
          ]}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Code"
          name="code"
          required
          defaultValue={warehouse?.code}
          placeholder={type === 'TRUCK' ? 'TRUCK-02' : 'DEPOT-2'}
        />
        <Field label="Nom" name="name" required defaultValue={warehouse?.name} />
      </div>
      {type === 'TRUCK' && (
        <>
          <Field
            label="Immatriculation"
            name="plateNumber"
            defaultValue={warehouse?.plateNumber ?? ''}
          />
          <Select
            label="Confié à"
            name="assignedUserId"
            defaultValue={warehouse?.assignedUser?.id ?? ''}
            options={[
              { value: '', label: 'Personne' },
              ...drivers.map((d) => ({
                value: d.id,
                label: `${d.firstName} ${d.lastName} (${d.code} · ${d.role.name})`,
              })),
            ]}
          />
        </>
      )}
      <Toggle label="Actif" checked={active} onChange={setActive} />
      <Button type="submit">Enregistrer</Button>
    </form>
  );
}
