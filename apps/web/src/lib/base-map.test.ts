import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addBaseLayer, FAILED_TILES_LIMIT, resetMapProvider } from './base-map';

/** Fond de carte du Web : MapTiler, sinon OpenStreetMap (docs/maptiler.md). */
describe('fond de carte Leaflet', () => {
  afterEach(() => {
    resetMapProvider();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function setup(status: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status })),
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const div = document.createElement('div');
    document.body.append(div);
    const map = L.map(div, { center: [35.7, -0.63], zoom: 12 });
    const onUnavailable = vi.fn();
    return { map, onUnavailable };
  }

  const tileLayer = (map: L.Map) => {
    let found: L.TileLayer | undefined;
    map.eachLayer((l) => {
      if (l instanceof L.TileLayer) found = l;
    });
    return found;
  };

  it('clé acceptée : tuiles MapTiler et attribution MapTiler + OSM', async () => {
    const { map, onUnavailable } = setup(200);
    addBaseLayer(L, map, onUnavailable, 'cle-test');
    await vi.waitFor(() => expect(tileLayer(map)).toBeDefined());
    const layer = tileLayer(map)!;
    expect((layer as unknown as { _url: string })._url).toContain(
      'api.maptiler.com/maps/streets-v2/256',
    );
    expect(layer.options.attribution).toBe('© MapTiler © OpenStreetMap contributors');
  });

  it('clé refusée (401) ou absente : tuiles OpenStreetMap', async () => {
    const { map, onUnavailable } = setup(401);
    addBaseLayer(L, map, onUnavailable, 'mauvaise-cle');
    await vi.waitFor(() => expect(tileLayer(map)).toBeDefined());
    expect((tileLayer(map) as unknown as { _url: string })._url).toBe(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
    expect(tileLayer(map)!.options.attribution).toBe('© OpenStreetMap contributors');
    expect(console.warn).toHaveBeenCalledWith(
      '[carte] OpenStreetMap utilisé : clé MapTiler refusée (401).',
    );
  });

  it('tuiles MapTiler en échec : bascule OSM ; OSM en échec : message', async () => {
    const { map, onUnavailable } = setup(200);
    addBaseLayer(L, map, onUnavailable, 'cle-test');
    await vi.waitFor(() => expect(tileLayer(map)).toBeDefined());
    const layer = tileLayer(map)!;
    for (let i = 0; i < FAILED_TILES_LIMIT; i += 1) layer.fire('tileerror');
    expect((layer as unknown as { _url: string })._url).toBe(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    );
    expect(layer.options.attribution).toBe('© OpenStreetMap contributors');
    expect(onUnavailable).not.toHaveBeenCalled();
    for (let i = 0; i < FAILED_TILES_LIMIT; i += 1) layer.fire('tileerror');
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it('une tuile affichée : les échecs suivants ne font pas basculer', async () => {
    const { map, onUnavailable } = setup(200);
    addBaseLayer(L, map, onUnavailable, 'cle-test');
    await vi.waitFor(() => expect(tileLayer(map)).toBeDefined());
    const layer = tileLayer(map)!;
    layer.fire('tileload');
    for (let i = 0; i < FAILED_TILES_LIMIT * 2; i += 1) layer.fire('tileerror');
    expect((layer as unknown as { _url: string })._url).toContain('api.maptiler.com');
    expect(onUnavailable).not.toHaveBeenCalled();
  });
});
