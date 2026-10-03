import type { PhotoManifest } from '@sellwasl/validation';
import { Directory, File, Paths } from 'expo-file-system';
import { useEffect, useSyncExternalStore } from 'react';
import { API_URL, request } from '@/api/client';

/**
 * Photos du catalogue gardées sur le téléphone, pour un affichage hors connexion.
 * Après chaque connexion, toutes les photos manquantes sont téléchargées d'un coup, en tâche
 * de fond ; celles qui ont disparu du catalogue sont effacées. Un fichier ne change jamais :
 * une photo modifiée arrive sous un nouveau nom.
 */
const folder = new Directory(Paths.document, 'catalog-photos');
const indexFile = new File(Paths.document, 'catalog-photos.json');
const PARALLEL_DOWNLOADS = 4;

export interface PhotoSyncState {
  total: number;
  ready: number;
  running: boolean;
  lastError: string | null;
}

let manifest: PhotoManifest['photos'] = [];
let state: PhotoSyncState = { total: 0, ready: 0, running: false, lastError: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<PhotoSyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function loadIndex() {
  try {
    if (indexFile.exists) manifest = JSON.parse(indexFile.textSync()) as PhotoManifest['photos'];
  } catch {
    manifest = [];
  }
  const ready = manifest.filter((p) => new File(folder, p.file).exists).length;
  setState({ total: manifest.length, ready });
}
loadIndex();

/** Télécharge les photos manquantes et efface celles qui ne servent plus. */
export async function syncCatalogPhotos(): Promise<void> {
  if (state.running) return;
  setState({ running: true, lastError: null });
  try {
    const next = (await request<PhotoManifest>('/catalog/photos')).photos;
    if (!folder.exists) folder.create({ idempotent: true });

    const wanted = new Set(next.map((p) => p.file));
    for (const entry of folder.list()) {
      if (entry instanceof File && !wanted.has(entry.name)) entry.delete();
    }
    const missing = [...new Map(next.map((p) => [p.file, p])).values()].filter(
      (p) => !new File(folder, p.file).exists,
    );
    let ready = next.length - missing.length;
    setState({ total: next.length, ready });

    let failures = 0;
    const queue = [...missing];
    await Promise.all(
      Array.from({ length: PARALLEL_DOWNLOADS }, async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const url = p.url.startsWith('http') ? p.url : `${API_URL}${p.url}`;
          try {
            await File.downloadFileAsync(url, new File(folder, p.file), { idempotent: true });
            ready += 1;
            setState({ ready });
          } catch {
            failures += 1;
          }
        }
      }),
    );

    manifest = next;
    indexFile.write(JSON.stringify(next));
    setState({
      lastError:
        failures > 0 ? `${failures} photo(s) non téléchargée(s), nouvel essai plus tard` : null,
    });
  } catch {
    // Hors connexion : les photos déjà gardées restent affichées
    setState({ lastError: 'Photos non mises à jour : pas de connexion' });
  } finally {
    setState({ running: false });
  }
}

/** Adresse locale de la photo d'un article : celle du parfum, sinon celle du produit. */
export function photoUri(productId: string, variantId?: string | null): string | null {
  const own = variantId ? manifest.find((p) => p.variantId === variantId) : undefined;
  const photo = own ?? manifest.find((p) => p.productId === productId && p.variantId === null);
  if (!photo) return null;
  const file = new File(folder, photo.file);
  return file.exists ? file.uri : null;
}

/** Efface toutes les photos (appareil dissocié). */
export function clearCatalogPhotos(): void {
  if (folder.exists) folder.delete();
  if (indexFile.exists) indexFile.delete();
  manifest = [];
  setState({ total: 0, ready: 0, lastError: null });
}

export function usePhotoSyncState(): PhotoSyncState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Lance la mise à jour des photos à chaque ouverture de session. */
export function useCatalogPhotoSync(active: boolean): void {
  useEffect(() => {
    if (active) void syncCatalogPhotos();
  }, [active]);
}
