'use client';

import type { CompanyUser, TemporaryPasswordResponse } from '@sellwasl/validation';
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
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/labels';

interface RoleOption {
  code: string;
  name: string;
  channel: 'WEB' | 'MOBILE';
  available: boolean;
}

/** Utilisateurs de l'entreprise (UC-80). */
export default function UsersPage() {
  const { me, can } = CompanyAuth.useAuth();
  const [users, setUsers] = useState<CompanyUser[] | null>(null);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CompanyUser | 'new' | null>(null);
  const [password, setPassword] = useState<TemporaryPasswordResponse | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, r] = await Promise.all([
        api<CompanyUser[]>('company', '/users'),
        api<RoleOption[]>('company', '/roles'),
      ]);
      setUsers(u);
      setRoles(r);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function action(user: CompanyUser, path: string, question: string) {
    if (!confirm(question)) return;
    setError(null);
    try {
      const result = await api<CompanyUser | TemporaryPasswordResponse>(
        'company',
        `/users/${user.id}/${path}`,
        { method: 'POST' },
      );
      if ('temporaryPassword' in result) setPassword(result);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Utilisateurs"
        subtitle="Un rôle par utilisateur. Les rôles terrain utilisent l'application mobile, les autres le Web."
        action={
          can('users.create') && (
            <Button onClick={() => setEditing('new')}>Nouvel utilisateur</Button>
          )
        }
      />
      {error && <Alert>{error}</Alert>}
      {!users && !error && <p className="text-muted">Chargement…</p>}

      <div className="grid gap-3">
        {users?.map((u) => (
          <Card
            key={u.id}
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <p className="font-semibold text-text-dark">
                {u.firstName} {u.lastName}{' '}
                <span className="font-mono text-sm font-normal text-muted">{u.code}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{u.role.name}</Badge>
                <span className="text-muted">{u.role.channel === 'MOBILE' ? 'Mobile' : 'Web'}</span>
                {u.status === 'DISABLED' && <Badge tone="danger">Désactivé</Badge>}
                {u.mustChangePassword && u.status === 'ACTIVE' && (
                  <Badge tone="warning">Mot de passe provisoire</Badge>
                )}
              </div>
              <p className="text-xs text-muted">
                {[u.email, u.phone].filter(Boolean).join(' · ')}
                {(u.email || u.phone) && ' · '}Dernière connexion : {formatDateTime(u.lastLoginAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {can('users.update') && (
                <>
                  <Button variant="secondary" onClick={() => setEditing(u)}>
                    Modifier
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      void action(
                        u,
                        'reset-password',
                        `Donner un nouveau mot de passe provisoire à ${u.firstName} ?`,
                      )
                    }
                  >
                    Mot de passe
                  </Button>
                </>
              )}
              {can('users.disable') && u.id !== me?.user.id && (
                <Button
                  variant={u.status === 'ACTIVE' ? 'danger' : 'secondary'}
                  onClick={() =>
                    void action(
                      u,
                      u.status === 'ACTIVE' ? 'disable' : 'enable',
                      u.status === 'ACTIVE'
                        ? `Désactiver ${u.firstName} ? Il ne pourra plus se connecter.`
                        : `Réactiver ${u.firstName} ?`,
                    )
                  }
                >
                  {u.status === 'ACTIVE' ? 'Désactiver' : 'Réactiver'}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      {editing && (
        <UserDialog
          user={editing === 'new' ? null : editing}
          roles={roles}
          isSelf={editing !== 'new' && editing.id === me?.user.id}
          onClose={() => setEditing(null)}
          onSaved={(result) => {
            setEditing(null);
            if (result) setPassword(result);
            void load();
          }}
        />
      )}
      {password && (
        <Modal title="Mot de passe provisoire" onClose={() => setPassword(null)}>
          <div className="flex flex-col gap-3">
            <TemporaryPassword
              who={`${password.user.firstName} ${password.user.lastName} (${password.user.code})`}
              password={password.temporaryPassword}
            />
            <Button onClick={() => setPassword(null)}>J'ai noté le mot de passe</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function UserDialog({
  user,
  roles,
  isSelf,
  onClose,
  onSaved,
}: {
  user: CompanyUser | null;
  roles: RoleOption[];
  isSelf: boolean;
  onClose: () => void;
  onSaved: (result: TemporaryPasswordResponse | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(form: FormData) {
    setBusy(true);
    setError(null);
    const body = Object.fromEntries(
      ['code', 'firstName', 'lastName', 'role', 'phone', 'email'].map((k) => [
        k,
        String(form.get(k) ?? '').trim(),
      ]),
    );
    if (isSelf) delete body.role;
    try {
      if (user) {
        await api('company', `/users/${user.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...body, version: user.version }),
        });
        onSaved(null);
      } else {
        onSaved(
          await api<TemporaryPasswordResponse>('company', '/users', {
            method: 'POST',
            body: JSON.stringify(body),
          }),
        );
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={user ? `Modifier ${user.firstName}` : 'Nouvel utilisateur'} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(new FormData(e.currentTarget));
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prénom" name="firstName" required defaultValue={user?.firstName} />
          <Field label="Nom" name="lastName" required defaultValue={user?.lastName} />
        </div>
        <Field
          label="Code"
          name="code"
          required
          defaultValue={user?.code}
          hint="Libre et unique, ex. V07. Sert d'identifiant."
        />
        <Select
          label="Rôle"
          name="role"
          defaultValue={user?.role.code ?? 'PRE_VENDEUR'}
          disabled={isSelf}
          options={roles.map((r) => ({
            value: r.code,
            label: `${r.name} (${r.channel === 'MOBILE' ? 'mobile' : 'Web'})${r.available ? '' : ' — module inactif'}`,
            disabled: !r.available,
          }))}
        />
        {isSelf && (
          <p className="text-xs text-muted">Vous ne pouvez pas changer votre propre rôle.</p>
        )}
        <Field label="Téléphone" name="phone" type="tel" defaultValue={user?.phone ?? ''} />
        <Field
          label="Email"
          name="email"
          type="email"
          defaultValue={user?.email ?? ''}
          hint="Facultatif ; permet de se connecter au Web avec l'email."
        />
        {user && (
          <p className="text-xs text-muted">
            Changer le rôle ferme les sessions en cours de cet utilisateur.
          </p>
        )}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Enregistrement…' : user ? 'Enregistrer' : 'Créer'}
        </Button>
      </form>
    </Modal>
  );
}
