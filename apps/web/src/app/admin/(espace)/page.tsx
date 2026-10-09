'use client';

import type { CreateCompanyResponse, Page, PlatformCompany } from '@sellwasl/validation';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Modal,
  PageTitle,
  Select,
  TemporaryPassword,
} from '@/components/ui';
import { type Listed, ShowMore } from '@/components/show-more';
import { api, ApiClientError, errorMessage } from '@/lib/api';
import { COMPANY_STATUS, MODE_LABELS, MODULE_LABELS } from '@/lib/labels';

const MODE_OPTIONS = Object.entries(MODE_LABELS).map(([value, label]) => ({ value, label }));

/** Entreprises de la plateforme (UC-90, phase 8). */
export default function PlatformCompaniesPage() {
  const [list, setList] = useState<Listed<PlatformCompany> | null>(null);
  const companies = list?.page.data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateCompanyResponse | null>(null);
  const [modeFor, setModeFor] = useState<PlatformCompany | null>(null);

  const load = useCallback(async () => {
    try {
      setList({
        path: '/platform/companies',
        page: await api<Page<PlatformCompany>>('platform', '/platform/companies'),
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function toggleStatus(c: PlatformCompany) {
    const suspend = c.status !== 'SUSPENDED';
    if (
      !confirm(
        suspend
          ? `Suspendre ${c.name} ? Plus personne ne pourra se connecter.`
          : `Réactiver ${c.name} ?`,
      )
    )
      return;
    try {
      await api('platform', `/platform/companies/${c.id}/${suspend ? 'suspend' : 'reactivate'}`, {
        method: 'POST',
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Entreprises"
        subtitle="Création, mode de vente et accès des entreprises clientes."
        action={<Button onClick={() => setCreating(true)}>Nouvelle entreprise</Button>}
      />
      {error && <Alert>{error}</Alert>}
      {!companies && !error && <p className="text-muted">Chargement…</p>}
      <div className="grid gap-3">
        {companies?.map((c) => (
          <Card
            key={c.id}
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-text-dark">
                {c.name} <span className="font-mono text-sm font-normal text-muted">{c.code}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={COMPANY_STATUS[c.status]?.tone}>
                  {COMPANY_STATUS[c.status]?.label ?? c.status}
                </Badge>
                <span className="text-muted">
                  {MODE_LABELS[c.mode]} · {c.users} utilisateur{c.users > 1 ? 's' : ''}
                </span>
              </div>
              <p className="text-xs text-muted">
                {c.modules.map((m) => MODULE_LABELS[m] ?? m).join(' · ')}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setModeFor(c)}>
                Changer le mode
              </Button>
              <Button
                variant={c.status === 'SUSPENDED' ? 'secondary' : 'danger'}
                onClick={() => void toggleStatus(c)}
              >
                {c.status === 'SUSPENDED' ? 'Réactiver' : 'Suspendre'}
              </Button>
            </div>
          </Card>
        ))}
      </div>
      <ShowMore list={list} onChange={setList} scope="platform" />

      {creating && (
        <CreateCompanyDialog
          onClose={() => setCreating(false)}
          onCreated={(result) => {
            setCreating(false);
            setCreated(result);
            void load();
          }}
        />
      )}
      {created && (
        <Modal title={`${created.company.name} est créée`} onClose={() => setCreated(null)}>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Connexion de l'administrateur sur l'espace entreprise : code entreprise{' '}
              <strong>{created.company.code}</strong>, identifiant{' '}
              <strong>{created.admin.email ?? created.admin.code}</strong>.
            </p>
            <TemporaryPassword
              who={created.admin.code}
              password={created.admin.temporaryPassword}
            />
            <Button onClick={() => setCreated(null)}>J'ai noté le mot de passe</Button>
          </div>
        </Modal>
      )}
      {modeFor && (
        <ChangeModeDialog
          company={modeFor}
          onClose={() => setModeFor(null)}
          onDone={() => {
            setModeFor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function CreateCompanyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (r: CreateCompanyResponse) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const value = (k: string) => String(form.get(k) ?? '').trim();
    try {
      onCreated(
        await api<CreateCompanyResponse>('platform', '/platform/companies', {
          method: 'POST',
          body: JSON.stringify({
            name: value('name'),
            code: value('code'),
            mode: value('mode'),
            admin: {
              firstName: value('firstName'),
              lastName: value('lastName'),
              email: value('email'),
              code: value('adminCode') || 'ADMIN',
            },
          }),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nouvelle entreprise" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <Field label="Nom de l'entreprise" name="name" required />
        <Field
          label="Code de l'entreprise"
          name="code"
          required
          hint="Saisi à la connexion. Lettres, chiffres et tirets, ex. DISTRI-ORAN."
        />
        <Select label="Mode de vente" name="mode" options={MODE_OPTIONS} defaultValue="PRE_SALES" />
        <p className="mt-2 font-semibold text-text-dark">Administrateur de l'entreprise</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prénom" name="firstName" required />
          <Field label="Nom" name="lastName" required />
        </div>
        <Field label="Email" name="email" type="email" />
        <Field label="Code de connexion" name="adminCode" placeholder="ADMIN" />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Création…' : "Créer l'entreprise"}
        </Button>
      </form>
    </Modal>
  );
}

function ChangeModeDialog({
  company,
  onClose,
  onDone,
}: {
  company: PlatformCompany;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState(company.mode);
  const [error, setError] = useState<string | null>(null);
  const [blockers, setBlockers] = useState<{ reason: string; count: number }[]>([]);

  async function submit() {
    setError(null);
    setBlockers([]);
    try {
      await api('platform', `/platform/companies/${company.id}/mode`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError && Array.isArray(err.details?.blockers)) {
        setBlockers(err.details.blockers as { reason: string; count: number }[]);
      }
    }
  }

  return (
    <Modal title={`Mode de ${company.name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <Select
          label="Mode de vente"
          value={mode}
          onChange={(e) => setMode(e.target.value as PlatformCompany['mode'])}
          options={MODE_OPTIONS}
        />
        <p className="text-sm text-muted">
          Ajouter un module est toujours possible. Retirer un module est refusé tant qu'il reste du
          travail en cours ; les données restent conservées.
        </p>
        {error && <Alert>{error}</Alert>}
        {blockers.length > 0 && (
          <ul className="list-disc pl-5 text-sm text-text-dark">
            {blockers.map((b) => (
              <li key={b.reason}>
                {b.count} {b.reason}
              </li>
            ))}
          </ul>
        )}
        <Button onClick={() => void submit()} disabled={mode === company.mode}>
          Appliquer
        </Button>
      </div>
    </Modal>
  );
}
