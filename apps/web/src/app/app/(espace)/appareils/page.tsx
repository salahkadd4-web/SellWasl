'use client';

import type { ActivationCodeResponse } from '@sellwasl/validation';
import QRCode from 'qrcode';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { api, ApiClientError } from '@/lib/api';
import { CompanyAuth } from '@/lib/auth';

interface FieldUserDevice {
  userId: string;
  code: string;
  name: string;
  role: string;
  device: {
    id: string;
    series: string;
    status: string;
    model: string | null;
    lastSeenAt: string | null;
    pendingOps: number;
  } | null;
}

function formatDate(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString('fr-DZ', { dateStyle: 'short', timeStyle: 'short' })
    : 'jamais';
}

/** Association des téléphones (UC-59, ARC-04). */
export default function DevicesPage() {
  const { can } = CompanyAuth.useAuth();
  const [users, setUsers] = useState<FieldUserDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activation, setActivation] = useState<{
    user: FieldUserDevice;
    data: ActivationCodeResponse;
    qr: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await api<FieldUserDevice[]>('company', '/devices'));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function associate(user: FieldUserDevice) {
    if (
      user.device?.status === 'ACTIVE' &&
      !confirm(`Remplacer le téléphone actuel de ${user.name} ? L'ancien sera révoqué.`)
    )
      return;
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
      setError(err instanceof ApiClientError ? err.message : 'Création du code impossible.');
    }
  }

  async function revoke(user: FieldUserDevice) {
    if (
      !user.device ||
      !confirm(`Révoquer le téléphone de ${user.name} ? Il devra être associé de nouveau.`)
    )
      return;
    try {
      await api('company', `/devices/${user.device.id}/revoke`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Révocation impossible.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-primary">Appareils</h1>
        <p className="text-muted">
          Un seul téléphone actif par utilisateur terrain. Associer un nouveau téléphone révoque
          l'ancien.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {!users && !error && <p className="text-muted">Chargement…</p>}

      <div className="grid gap-3">
        {users?.map((u) => (
          <Card
            key={u.userId}
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-semibold text-text-dark">
                {u.name} <span className="font-normal text-muted">· {u.code}</span>
              </p>
              <p className="text-sm text-muted">{u.role}</p>
              <p className="mt-1 text-sm">
                {u.device ? (
                  <span className={u.device.status === 'ACTIVE' ? 'text-synced' : 'text-error'}>
                    {u.device.status === 'ACTIVE' ? 'Appareil actif' : 'Appareil bloqué'} · série{' '}
                    {u.device.series}
                    {u.device.model ? ` · ${u.device.model}` : ''} · vu{' '}
                    {formatDate(u.device.lastSeenAt)}
                  </span>
                ) : (
                  <span className="text-pending">Aucun appareil associé</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              {can('devices.associate') && (
                <Button onClick={() => void associate(u)}>
                  {u.device ? 'Changer de téléphone' : 'Associer un téléphone'}
                </Button>
              )}
              {u.device && can('devices.revoke') && (
                <Button variant="danger" onClick={() => void revoke(u)}>
                  Révoquer
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

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
    <div
      className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center">
        <h2 className="text-lg font-bold text-primary">Associer le téléphone de {name}</h2>
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
    </div>
  );
}
