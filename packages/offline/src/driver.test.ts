import type { DriverRouteDto } from '@sellwasl/validation';
import { describe, expect, it } from 'vitest';
import { applyOps } from './effects';
import { DATE, op, sellerRows } from './fixtures';
import { loadState } from './local-state';
import { customerView } from './views/seller';
import { truckStockView } from './views/truck';
import { deliveryPreviewView, driverRouteView } from './views/driver';

/** Livreur : une commande de 12 cartons de thon (palier à 10) à livrer à c1. */
function driverState() {
  const day: DriverRouteDto = {
    date: DATE,
    workday: null,
    loadToReceive: null,
    route: { id: 'r1', status: 'IN_PROGRESS', truckCode: 'TRUCK-01' },
    deliveries: [
      {
        orderId: 'o9',
        number: 'V07-B0009',
        status: 'OUT_FOR_DELIVERY',
        totalAmount: 12 * 5600,
        customerTypeId: 'DETAIL',
        orderDate: DATE,
        customer: {
          id: 'c1',
          name: 'Épicerie Amine',
          phone: null,
          address: 'Rue 1',
          latitude: 35.7,
          longitude: -0.6,
          debtAmount: 1000,
          isCreditAllowed: true,
          creditLimitAmount: 10_000,
        },
        lines: [
          {
            lineId: 'L1',
            kind: 'NORMAL',
            variantId: 'TOM',
            productName: 'Thon tomate',
            variantName: null,
            unitId: 'tom-ctn',
            unitName: 'carton',
            unitBaseQty: 20,
            preparedQty: 12,
            unitPrice: 5600,
            deliveredQty: null,
            bonusRuleId: null,
          },
        ],
        delivery: null,
      },
    ],
    progress: { delivered: 0, partial: 0, failed: 0, pending: 1, collected: 0 },
  };
  return loadState({
    ...sellerRows('LIVREUR'),
    driverDay: [{ id: DATE, data: day }],
    truckStock: [
      {
        id: 'TOM',
        data: {
          variantId: 'TOM',
          productId: 'TOM',
          productName: 'Thon tomate',
          variantName: null,
          qty: 400,
          units: [{ id: 'tom-ctn', name: 'carton', baseQty: 20, isBase: false }],
        },
      },
    ],
  });
}

const start = () => op('workday.start', { workdayId: 'w1', date: DATE });
const confirm = (qty: number, cash: number) =>
  op('delivery.confirm', {
    deliveryId: 'd1',
    number: 'L01-B0001',
    orderId: 'o9',
    lines: [{ lineId: 'L1', qty }],
    added: [],
    cashAmount: cash,
  });

describe('livreur hors connexion (spec phase 23 §4.4)', () => {
  it('livraison complète : tournée, encaissé, stock du camion', () => {
    const s = applyOps(driverState(), [start(), confirm(12, 67_200)]);
    const route = driverRouteView(s, DATE)!;
    expect(route.deliveries[0]).toMatchObject({
      status: 'DELIVERED',
      delivery: { number: 'L01-B0001', result: 'DELIVERED' },
    });
    expect(route.deliveries[0]!.lines[0]!.deliveredQty).toBe(12);
    expect(route.progress).toEqual({
      delivered: 1,
      partial: 0,
      failed: 0,
      pending: 0,
      collected: 67_200,
    });
    expect(route.workday).toMatchObject({ id: 'w1', status: 'IN_PROGRESS' });
    expect(truckStockView(s)[0]!.qty).toBe(400 - 12 * 20);
  });

  it('aperçu d’une livraison partielle : palier perdu (P-04), minimum selon le plafond', () => {
    const preview = deliveryPreviewView(applyOps(driverState(), [start()]), {
      orderId: 'o9',
      lines: [{ lineId: 'L1', qty: 8 }],
      added: [],
    });
    expect(preview.lines[0]).toMatchObject({
      lineId: 'L1',
      qty: 8,
      unitPrice: 5800,
      amount: 46_400,
    });
    expect(preview.dueAmount).toBe(46_400);
    // Plafond 10 000, dette 1 000 : 9 000 de crédit possible
    expect(preview.minimumCash).toBe(46_400 - 9000);
    expect(preview.debtAmount).toBe(1000);
  });

  it('livraison partielle confirmée : crédit ajouté à la dette, PARTIAL', () => {
    const s = applyOps(driverState(), [start(), confirm(8, 37_400)]);
    const route = driverRouteView(s, DATE)!;
    expect(route.deliveries[0]!.delivery!.result).toBe('PARTIAL');
    expect(route.deliveries[0]!.status).toBe('PARTIALLY_DELIVERED');
    expect(route.progress).toMatchObject({ partial: 1, collected: 37_400 });
    expect(customerView(s, 'c1')!.debtAmount).toBe(1000 + 9000);
    expect(route.deliveries[0]!.customer.debtAmount).toBe(10_000);
  });

  it('échec de livraison', () => {
    const s = applyOps(driverState(), [
      start(),
      op('delivery.fail', {
        deliveryId: 'd1',
        number: 'L01-B0001',
        orderId: 'o9',
        reasonId: 'r-absent',
      }),
    ]);
    const route = driverRouteView(s, DATE)!;
    expect(route.deliveries[0]!.delivery).toEqual({ number: 'L01-B0001', result: 'FAILED' });
    expect(route.progress).toMatchObject({ failed: 1, pending: 0 });
    expect(truckStockView(s)[0]!.qty).toBe(400);
  });
});
