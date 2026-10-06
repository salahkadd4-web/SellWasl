import { describe, expect, it } from 'vitest';
import { moveDeltas } from './stock';
import { netReturnCost, rate, weightedUnitPrice } from './returns';

describe('analyse des retours', () => {
  it('rate : taux en pourcentage arrondi à 0,1 au-dessus du volume minimum', () => {
    expect(rate(3, 40, 20)).toEqual({ rate: 7.5, volume: 40, insufficient: false });
    expect(rate(1, 3, 1)).toEqual({ rate: 33.3, volume: 3, insufficient: false });
  });

  it('rate : sous le volume minimum, pas de taux (aucune conclusion)', () => {
    expect(rate(5, 10, 20)).toEqual({ rate: null, volume: 10, insufficient: true });
  });

  it('rate : un dénominateur nul ne divise jamais par zéro', () => {
    expect(rate(0, 0, 0)).toEqual({ rate: null, volume: 0, insufficient: true });
  });

  it('netReturnCost : valeur retournée moins valeur revendue en tournée', () => {
    expect(netReturnCost(12000, 4500)).toBe(7500);
    expect(netReturnCost(1000, 3000)).toBe(-2000);
  });

  it('weightedUnitPrice : prix moyen par unité de base, null sans quantité', () => {
    expect(
      weightedUnitPrice([
        { qty: 24, amount: 2400 },
        { qty: 12, amount: 1440 },
      ]),
    ).toBeCloseTo(106.67, 2);
    expect(weightedUnitPrice([])).toBeNull();
    expect(weightedUnitPrice([{ qty: 0, amount: 0 }])).toBeNull();
  });

  it('WRITE_OFF : une perte sort du stock physique comme une sortie', () => {
    expect(moveDeltas({ type: 'WRITE_OFF', qty: 4, fromWarehouseId: 'T' })).toEqual([
      { warehouseId: 'T', delta: { physical: -4, reserved: 0 } },
    ]);
  });
});
