'use client';

import type { ImportPreview } from '@sellwasl/validation';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { Alert, Badge, Button, Card, PageTitle } from '@/components/ui';
import { api, errorMessage, getAccessToken } from '@/lib/api';

/** Import CSV en deux temps (BR-IO-01, BR-IO-02) : aperçu avec les erreurs, puis confirmation. */
export function ImportPanel({
  kind,
  title,
  backHref,
  backLabel,
  templateName,
  help,
  unit,
}: {
  kind: 'CUSTOMERS' | 'PRODUCTS';
  title: string;
  backHref: string;
  backLabel: string;
  templateName: string;
  help: ReactNode;
  /** Ce qui est importé, au pluriel : « client(s) », « ligne(s) ». */
  unit: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', file);
      setPreview(await api<ImportPreview>('company', '/imports', { method: 'POST', body: form }));
    } catch (err) {
      setError(errorMessage(err, 'Lecture du fichier impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      setPreview(
        await api<ImportPreview>('company', `/imports/${preview.id}/confirm`, { method: 'POST' }),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    // Le modèle demande une session : téléchargement par l'API, puis enregistrement local
    const path = kind === 'PRODUCTS' ? 'products' : 'customers';
    const response = await fetch(`/api/v1/imports/templates/${path}`, {
      headers: { Authorization: `Bearer ${getAccessToken('company') ?? ''}` },
    });
    if (!response.ok) {
      setError('Téléchargement du modèle impossible.');
      return;
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = templateName;
    link.click();
    URL.revokeObjectURL(url);
  }

  const imported = preview?.status === 'IMPORTED';

  return (
    <div className="flex flex-col gap-4">
      <PageTitle
        title={title}
        subtitle="Fichier CSV exporté d'Excel, séparateur « ; » ou « , », 5 Mo et 10 000 lignes au plus."
        action={
          <Link href={backHref} className="font-semibold text-deep-blue">
            ← {backLabel}
          </Link>
        }
      />

      <Card className="flex flex-col gap-3">
        <div className="text-sm text-text-dark">{help}</div>
        <div>
          <Button variant="secondary" onClick={() => void downloadTemplate()}>
            Télécharger le modèle
          </Button>
        </div>
        {!imported && (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="Fichier CSV"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
              }}
              className="text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-surface file:px-4 file:font-semibold file:text-primary"
            />
            <Button onClick={() => void upload()} disabled={!file || busy}>
              {busy && !preview ? 'Lecture…' : 'Vérifier le fichier'}
            </Button>
          </div>
        )}
      </Card>

      {error && <Alert>{error}</Alert>}

      {preview && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-text-dark">{preview.filename}</span>
            <Badge>{preview.totalRows} ligne(s)</Badge>
            <Badge tone="success">{preview.validRows} valide(s)</Badge>
            {preview.errors.length > 0 && (
              <Badge tone="danger">{preview.errors.length} en erreur</Badge>
            )}
          </div>

          {imported ? (
            <p className="rounded-xl border border-synced/30 bg-synced/10 p-3 text-sm text-synced">
              {preview.importedRows} ligne(s) importée(s).{' '}
              <Link href={backHref} className="font-semibold underline">
                {backLabel}
              </Link>
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted">
                Rien n'est encore importé. Seules les lignes valides le seront ; corrigez les autres
                dans le fichier pour les importer ensuite.
              </p>
              <div>
                <Button
                  onClick={() => void confirmImport()}
                  disabled={busy || preview.validRows === 0}
                >
                  {busy ? 'Import…' : `Importer ${preview.validRows} ${unit}`}
                </Button>
              </div>
            </div>
          )}

          {preview.errors.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold text-text-dark">Lignes en erreur</h2>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
                {preview.errors.map((e, i) => (
                  <p
                    key={`${e.line}-${i}`}
                    className="border-b border-border px-3 py-2 text-sm last:border-0"
                  >
                    <span className="font-mono text-muted">Ligne {e.line}</span> · {e.message}
                  </p>
                ))}
              </div>
            </section>
          )}

          {preview.sample.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="font-semibold text-text-dark">Aperçu</h2>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Ligne</th>
                      {preview.columns.map((c) => (
                        <th key={c} className="px-3 py-2 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((r) => (
                      <tr key={r.line} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-muted">{r.line}</td>
                        {r.values.map((v, i) => (
                          <td key={i} className="px-3 py-2">
                            {v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </Card>
      )}
    </div>
  );
}
