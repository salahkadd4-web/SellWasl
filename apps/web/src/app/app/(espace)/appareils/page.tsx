'use client';

import type {
  ActivationCodeResponse,
  DeviceSummary,
  FieldUserDevice,
  UserDevicesResponse,
} from '@sellwasl/validation';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Modal, PageTitle } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/labels';

const DEVICE_STATUS: Record<
  DeviceSummary['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  ACTIVE: { label: 'Actif', tone: 'success' },
  BLOCKED: { label: 'Bloqué', tone: 'warning' },
  REVOKED: { label: 'Révoqué', tone: 'danger' },
};

/** Un téléphone silencieux depuis plus de 15 minutes est signalé. */
const SILENT_AFTER_MS = 15 * 60 * 1000;

function deviceLine(d: DeviceSummary): string {
  return [
    `Série ${d.series}`,
    d.model,
    d.appVersion ? `appli ${d.appVersion}` : null,
    d.batteryLevel !== null ? `batterie ${d.batteryLevel} %` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Appareils des utilisateurs terrain (UC-59, BR-USR-06 à BR-USR-08). */
export default function DevicesPage() {
  const { can } = CompanyAuth.useAuth();
  const [users, setUsers] = useState<FieldUserDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detailOf, setDetailOf] = useState<FieldUserDevice | null>(null);
  const [activation, setActivation] = useState<{
    user: FieldUserDevice;
    data: ActivationCodeResponse;
    qr: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api<FieldUserDevice[]>('company', '/devices'));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(question: string | null, path: string, done: string) {
    if (question && !confirm(question)) return;
    setError(null);
    setNotice(null);
    try {
      await api('company', path, { method: 'POST' });
      setNotice(done);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function associate(user: FieldUserDevice) {
    const d = user.device;
    if (d) {
      // BR-USR-08 : avertir avant de remplacer un téléphone qui a du travail non envoyé
      const warning =
        d.pendingOps > 0
          ? `\n\nAttention : ce téléphone avait ${d.pendingOps} opération(s) non synchronisée(s) lors de son dernier contact (${formatDateTime(d.lastSeenAt)}). S'il est retrouvé, il pourra encore les envoyer.`
          : '';
      if (!confirm(`Remplacer le téléphone de ${user.name} ? L'ancien sera révoqué.${warning}`))
        return;
    }
    setError(null);
    try {
      const data = await api<ActivationCodeResponse>(
        'company',
        `/users/${user.userId}/activation-codes`,
        { method: 'POST' },
      );
      const qr = await QRCode.toDataURL(data.qrPayload, {
        width: 280,
        margin: 1,
        color: { dark: '#001850' },
      });
      setActivation({ user, data, qr });
    } catch (err) {
      setError(errorMessage(err, 'Création du code impossible.'));
    }
  }

  const canRevoke = can('devices.revoke');

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title="Appareils"
        subtitle="Un seul téléphone en service par utilisateur terrain. Associer un nouveau téléphone révoque l'ancien."
      />
      {error && <Alert>{error}</Alert>}
      {notice && (
        <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
          {notice}
        </p>
      )}
      {!users && !error && <p className="text-muted">Chargement…</p>}
      {users?.length === 0 && (
        <Card>
          <p className="text-muted">
            Aucun utilisateur terrain. Créez-les dans la page Utilisateurs.
          </p>
        </Card>
      )}

      <div className="grid gap-3">
        {users?.map((u) => {
          const d = u.device;
          const silent =
            d?.status === 'ACTIVE' &&
            (!d.lastSeenAt || Date.now() - Date.parse(d.lastSeenAt) > SILENT_AFTER_MS);
          return (
            <Card key={u.userId} className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                  <p className="font-semibold text-text-dark">
                    {u.name} <span className="font-mono font-normal text-muted">{u.code}</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>{u.role}</span>
                    {u.userStatus === 'DISABLED' && <Badge tone="danger">Compte désactivé</Badge>}
                    {d ? (
                      <Badge tone={DEVICE_STATUS[d.status].tone}>
                        Téléphone {DEVICE_STATUS[d.status].label.toLowerCase()}
                      </Badge>
                    ) : (
                      <Badge tone="warning">Aucun téléphone</Badge>
                    )}
                    {d && d.pendingOps > 0 && (
                      <Badge tone="warning">{d.pendingOps} opération(s) en attente</Badge>
                    )}
                  </div>
                  {d && (
                    <>
                      <p className="text-sm text-text-dark">{deviceLine(d)}</p>
                      <p className={`text-xs ${silent ? 'text-error' : 'text-muted'}`}>
                        Dernier signal : {formatDateTime(d.lastSeenAt)} · dernière synchronisation :{' '}
                        {formatDateTime(d.lastSyncAt)} · {u.activeSessions} session(s) ouverte(s)
                      </p>
                    </>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {can('devices.associate') && u.userStatus === 'ACTIVE' && (
                    <Button onClick={() => void associate(u)}>
                      {d ? 'Changer de téléphone' : 'Associer un téléphone'}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setDetailOf(u)}>
                    Historique
                  </Button>
                </div>
              </div>

              {d && canRevoke && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {u.activeSessions > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void run(
                          `Déconnecter ${u.name} ? Il devra saisir de nouveau son mot de passe sur son téléphone.`,
                          `/users/${u.userId}/sessions/revoke`,
                          `${u.name} est déconnecté.`,
                        )
                      }
                    >
                      Forcer la reconnexion
                    </Button>
                  )}
                  {d.status === 'ACTIVE' ? (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void run(
                          `Bloquer le téléphone de ${u.name} ? Il ne pourra plus rien faire jusqu'à sa réactivation.`,
                          `/devices/${d.id}/block`,
                          `Téléphone de ${u.name} bloqué.`,
                        )
                      }
                    >
                      Bloquer
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void run(
                          null,
                          `/devices/${d.id}/unblock`,
                          `Téléphone de ${u.name} réactivé : il peut se reconnecter.`,
                        )
                      }
                    >
                      Débloquer
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    onClick={() =>
                      void run(
                        `Révoquer définitivement le téléphone de ${u.name} ? Il devra être associé de nouveau.`,
                        `/devices/${d.id}/revoke`,
                        `Téléphone de ${u.name} révoqué.`,
                      )
                    }
                  >
                    Révoquer
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {detailOf && (
        <HistoryDialog
          user={detailOf}
          canRevoke={canRevoke}
          onClose={() => {
            setDetailOf(null);
            void load();
          }}
        />
      )}
      {activation && (
        <ActivationDialog
          name={activation.user.name}
          data={activation.data}
          qr={activation.qr}
          onClose={() => {
            setActivation(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

/** Tous les téléphones d'un utilisateur et ses sessions ouvertes. */
function HistoryDialog({
  user,
  canRevoke,
  onClose,
}: {
  user: FieldUserDevice;
  canRevoke: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<UserDevicesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<UserDevicesResponse>('company', `/users/${user.userId}/devices`));
    } catch (err) {
      setError(errorMessage(err, 'Chargement impossible.'));
    }
  }, [user.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function closeSession(id: string) {
    if (!confirm('Fermer cette session ? Le téléphone demandera le mot de passe.')) return;
    try {
      await api('company', `/sessions/${id}/revoke`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Modal title={`Téléphones de ${user.name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        {!data && !error && <p className="text-muted">Chargement…</p>}
        {data && (
          <>
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold text-text-dark">Sessions ouvertes</h3>
              {data.sessions.length === 0 && (
                <p className="text-sm text-muted">Aucune session ouverte.</p>
              )}
              {data.sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
                >
                  <div className="text-sm">
                    <p className="text-text-dark">
                      {s.deviceSeries ? `Téléphone série ${s.deviceSeries}` : 'Web'}
                    </p>
                    <p className="text-xs text-muted">
                      Ouverte le {formatDateTime(s.createdAt)} · utilisée le{' '}
                      {formatDateTime(s.lastUsedAt)}
                    </p>
                  </div>
                  {canRevoke && (
                    <Button variant="secondary" onClick={() => void closeSession(s.id)}>
                      Fermer
                    </Button>
                  )}
                </div>
              ))}
            </section>
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold text-text-dark">Historique des téléphones</h3>
              {data.devices.length === 0 && (
                <p className="text-sm text-muted">Aucun téléphone associé.</p>
              )}
              {data.devices.map((d) => (
                <div key={d.id} className="flex flex-col gap-1 rounded-xl border border-border p-3">
                  <div className="flex items-center gap-2">
                    <Badge tone={DEVICE_STATUS[d.status].tone}>
                      {DEVICE_STATUS[d.status].label}
                    </Badge>
                    <span className="text-sm text-text-dark">{deviceLine(d)}</span>
                  </div>
                  <p className="text-xs text-muted">
                    Associé le {formatDateTime(d.activatedAt)}
                    {d.revokedAt ? ` · révoqué le ${formatDateTime(d.revokedAt)}` : ''} · dernier
                    signal {formatDateTime(d.lastSeenAt)}
                    {d.pendingOps > 0 ? ` · ${d.pendingOps} opération(s) en attente` : ''}
                  </p>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function ActivationDialog({
  name,
  data,
  qr,
  onClose,
}: {
  name: string;
  data: ActivationCodeResponse;
  qr: string;
  onClose: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Date.parse(data.expiresAt) - Date.now());
  useEffect(() => {
    const timer = setInterval(() => setRemaining(Date.parse(data.expiresAt) - Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data.expiresAt]);
  const expired = remaining <= 0;
  const minutes = Math.max(0, Math.floor(remaining / 60000));
  const seconds = Math.max(0, Math.floor((remaining % 60000) / 1000));

  return (
    <Modal title={`Associer le téléphone de ${name}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted">
          Dans l'application SellWasl, scannez ce QR code ou saisissez le code.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={qr}
          alt="QR code d'association"
          width={280}
          height={280}
          className={expired ? 'opacity-20' : ''}
        />
        <p className="font-mono text-3xl font-bold tracking-widest text-primary">{data.code}</p>
        <p className={`text-sm ${expired ? 'text-error' : 'text-muted'}`}>
          {expired
            ? 'Code expiré : générez-en un nouveau.'
            : `Valable encore ${minutes} min ${String(seconds).padStart(2, '0')} s · usage unique`}
        </p>
        {data.previousDevicePendingOps > 0 && (
          <Alert>
            L'ancien téléphone avait {data.previousDevicePendingOps} opération(s) non
            synchronisée(s). S'il est retrouvé, il pourra encore les envoyer.
          </Alert>
        )}
        <Button variant="secondary" onClick={onClose} className="w-full">
          Fermer
        </Button>
      </div>
    </Modal>
  );
}
