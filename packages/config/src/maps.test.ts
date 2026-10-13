import { describe, expect, it, vi } from 'vitest';
import {
  chooseMapProvider,
  MAP_ATTRIBUTIONS,
  maptilerStyleUrl,
  OSM_TILE_URL,
  rasterSource,
} from './maps';

/** Fonds de carte : MapTiler, sinon OpenStreetMap (docs/maptiler.md). */
describe('choix du fond de carte', () => {
  const replying = (status: number) => vi.fn(async () => ({ status }));

  it('clé absente ou vide : OSM, sans requête', async () => {
    const fetcher = replying(200);
    expect(await chooseMapProvider(undefined, fetcher)).toEqual({
      provider: 'osm',
      reason: 'clé MapTiler absente',
    });
    expect((await chooseMapProvider('   ', fetcher)).provider).toBe('osm');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('clé acceptée : MapTiler, une seule requête au style', async () => {
    const fetcher = replying(200);
    expect(await chooseMapProvider('cle-test', fetcher)).toEqual({
      provider: 'maptiler',
      reason: null,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.maptiler.com/maps/streets-v2/style.json?key=cle-test',
    );
  });

  it('clé refusée (401, 403) ou quota dépassé (429) : OSM, avec la raison', async () => {
    expect(await chooseMapProvider('k', replying(401))).toEqual({
      provider: 'osm',
      reason: 'clé MapTiler refusée (401)',
    });
    expect((await chooseMapProvider('k', replying(403))).reason).toBe('clé MapTiler refusée (403)');
    expect((await chooseMapProvider('k', replying(429))).reason).toBe(
      'quota MapTiler dépassé (429)',
    );
    expect((await chooseMapProvider('k', replying(503))).provider).toBe('osm');
  });

  it('MapTiler injoignable : OSM', async () => {
    const failing = vi.fn(async () => {
      throw new Error('réseau');
    });
    expect(await chooseMapProvider('k', failing)).toEqual({
      provider: 'osm',
      reason: 'MapTiler injoignable',
    });
  });

  it('tuiles raster et attribution du fournisseur ; clé encodée dans les adresses', () => {
    expect(rasterSource('maptiler', 'a b')).toEqual({
      url: 'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=a%20b',
      attribution: '© MapTiler © OpenStreetMap contributors',
    });
    expect(rasterSource('osm', 'k')).toEqual({
      url: OSM_TILE_URL,
      attribution: MAP_ATTRIBUTIONS.osm,
    });
    // MapTiler choisi mais clé disparue : jamais d'adresse sans clé
    expect(rasterSource('maptiler', '').url).toBe(OSM_TILE_URL);
    expect(maptilerStyleUrl('k', 'basic-v2')).toContain('/maps/basic-v2/style.json');
  });
});
