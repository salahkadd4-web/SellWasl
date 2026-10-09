'use client';

import type { Page } from '@sellwasl/validation';
import { useState } from 'react';
import { Alert, Button } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

/** Première page d'une liste et le chemin qui l'a donnée (filtres compris). */
export interface Listed<T> {
  path: string;
  page: Page<T>;
}

/**
 * « Afficher plus » d'une liste paginée de l'API (phase 25) : charge la page suivante avec le
 * curseur reçu et l'ajoute à la suite. Rien à afficher à la dernière page.
 */
export function ShowMore<T>({
  list,
  onChange,
  scope = 'company',
}: {
  list: Listed<T> | null;
  onChange: (list: Listed<T>) => void;
  scope?: 'company' | 'platform';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!list?.page.nextCursor) return null;
  const { path, page } = list;
  const cursor = list.page.nextCursor;

  async function more() {
    setBusy(true);
    setError(null);
    try {
      const sep = path.includes('?') ? '&' : '?';
      const next = await api<Page<T>>(scope, `${path}${sep}cursor=${encodeURIComponent(cursor)}`);
      onChange({ path, page: { ...next, data: [...page.data, ...next.data] } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {error && <Alert>{error}</Alert>}
      <Button variant="secondary" onClick={() => void more()} disabled={busy}>
        {busy ? 'Chargement…' : 'Afficher plus'}
      </Button>
      <span className="text-xs text-muted">
        {page.data.length} sur {page.total}
      </span>
    </div>
  );
}
