import { describe, expect, it } from 'vitest';
import { applyMove, isLowStock, moveDeltas, releaseNewestFirst, unloadLine } from './stock';

describe('stock', () => {
  it('applyMove refuse un physique négatif ou un réservé hors de [0, physique]', () => {
    expect(applyMove({ physical: 5, reserved: 2 }, { physical: -3, reserved: 0 })).toEqual({
      physical: 2,
      reserved: 2,
    });
    expect(applyMove({ physical: 5, reserved: 2 }, { physical: -4, reserved: 0 })).toBeNull();
    expect(applyMove({ physical: 5, reserved: 2 }, { physical: 0, reserved: 4 })).toBeNull();
    expect(applyMove({ physical: 5, reserved: 2 }, { physical: 0, reserved: -3 })).toBeNull();
  });

  it('moveDeltas : effet de chaque type sur les entrepôts', () => {
    expect(moveDeltas({ type: 'IN', qty: 3, toWarehouseId: 'd' })).toEqual([
      { warehouseId: 'd', delta: { physical: 3, reserved: 0 } },
    ]);
    expect(
      moveDeltas({ type: 'TRANSFER', qty: 2, fromWarehouseId: 'd', toWarehouseId: 't' }),
    ).toEqual([
      { warehouseId: 'd', delta: { physical: -2, reserved: 0 } },
      { warehouseId: 't', delta: { physical: 2, reserved: 0 } },
    ]);
    expect(moveDeltas({ type: 'ADJUSTMENT', qty: 1, fromWarehouseId: 't' })).toEqual([
      { warehouseId: 't', delta: { physical: -1, reserved: 0 } },
    ]);
    expect(moveDeltas({ type: 'ADJUSTMENT', qty: 1, toWarehouseId: 't' })).toEqual([
      { warehouseId: 't', delta: { physical: 1, reserved: 0 } },
    ]);
    expect(moveDeltas({ type: 'RESERVATION', qty: 4, toWarehouseId: 'd' })).toEqual([
      { warehouseId: 'd', delta: { physical: 0, reserved: 4 } },
    ]);
    expect(moveDeltas({ type: 'RELEASE', qty: 4, fromWarehouseId: 'd' })).toEqual([
      { warehouseId: 'd', delta: { physical: 0, reserved: -4 } },
    ]);
    expect(moveDeltas({ type: 'OUT', qty: 1, fromWarehouseId: 't' })).toEqual([
      { warehouseId: 't', delta: { physical: -1, reserved: 0 } },
    ]);
    expect(() => moveDeltas({ type: 'TRANSFER', qty: 1, fromWarehouseId: 'd' })).toThrow();
  });

  it('unloadLine : chargé reconstitué et écart signé (BR-STK-07)', () => {
    expect(unloadLine({ theoretical: 7, delivered: 31, free: 2, counted: 6 })).toEqual({
      loaded: 40,
      gap: -1,
    });
    expect(unloadLine({ theoretical: 7, delivered: 0, free: 0, counted: 9 })).toEqual({
      loaded: 7,
      gap: 2,
    });
  });

  it('releaseNewestFirst libère depuis la commande confirmée la plus récente', () => {
    const a = { id: 'a', confirmedAt: new Date('2026-10-01T08:00:00Z'), reservedQty: 5 };
    const b = { id: 'b', confirmedAt: new Date('2026-10-02T08:00:00Z'), reservedQty: 3 };
    expect(releaseNewestFirst([a, b], 4)).toEqual([
      { line: b, release: 3 },
      { line: a, release: 1 },
    ]);
    expect(releaseNewestFirst([a, b], 0)).toEqual([]);
    expect(releaseNewestFirst([a, b], 20)).toEqual([
      { line: b, release: 3 },
      { line: a, release: 5 },
    ]);
  });

  it('isLowStock compare le disponible au seuil', () => {
    expect(isLowStock(4, 5)).toBe(true);
    expect(isLowStock(5, 5)).toBe(false);
    expect(isLowStock(0, null)).toBe(false);
  });
});
