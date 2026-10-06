import type {
  CustomerDto,
  OfflineKind,
  OfflineKindData,
  OperationType,
  ProductDto,
} from '@sellwasl/validation';
import { loadState, type RowsByKind } from './local-state';
import type { OutboxOp } from './types';

/** Données de test du téléphone : un pré-vendeur, un produit, un client du jour (tests seulement). */
export const DATE = '2027-06-05';

export const product: ProductDto = {
  id: 'TOM',
  reference: 'THON-TOM',
  name: 'Thon tomate',
  isActive: true,
  range: { id: 'R1', code: 'CONS', name: 'Conserves' },
  category: null,
  units: [
    { id: 'tom-trip', name: 'triplette', baseQty: 1, isBase: true, isActive: true },
    { id: 'tom-ctn', name: 'carton', baseQty: 20, isBase: false, isActive: true },
  ],
  variants: [
    {
      id: 'TOM',
      reference: 'THON-TOM',
      name: 'Thon tomate',
      isDefault: true,
      isActive: true,
      sortOrder: 0,
      photo: null,
    },
  ],
  hasFlavors: false,
  photo: null,
  supplierId: null,
};

export const customer: CustomerDto = {
  id: 'c1',
  code: 'CL-001',
  name: 'Épicerie Amine',
  phone: null,
  address: 'Rue 1',
  latitude: 35.7,
  longitude: -0.6,
  customerType: { id: 'DETAIL', code: 'DETAIL', name: 'Détail' },
  territory: { id: 'T1', code: 'S1', name: 'Secteur 1' },
  part: { id: 'P1', number: 1, name: 'Partie 1' },
  isPartForced: false,
  frequency: 1,
  referenceDate: null,
  isCreditAllowed: true,
  creditLimitAmount: 10_000,
  debtAmount: 1000,
  status: 'ACTIVE',
  isNew: false,
  isCashOnly: false,
  isClosedPermanently: false,
  reviewReasons: [],
  createdBy: null,
  createdAt: '2027-01-01T00:00:00.000Z',
};

function rows<K extends OfflineKind>(kind: K, items: { id: string; data: OfflineKindData[K] }[]) {
  return { [kind]: items } as RowsByKind;
}

export function sellerRows(roleCode = 'PRE_VENDEUR'): RowsByKind {
  return {
    ...rows('settings', [
      {
        id: 'company',
        data: {
          settingsVersion: 1,
          rules: {
            outOfZoneDistanceM: 200,
            P01_workOnNonWorkingDays: true,
            P02_outOfProgramVisits: true,
            P03_bonusConsumesQuota: false,
            P04_recalculateOnDecrease: true,
          },
          ticket: { widthMm: 58, header: { name: 'Distri', address: '', phone: '' } },
          me: { userId: 'u1', code: 'V07', name: 'Ahmed Kaci', series: 'B', roleCode },
        },
      },
    ]),
    ...rows('product', [{ id: 'TOM', data: product }]),
    ...rows('pricing', [
      {
        id: 'DETAIL',
        data: {
          customerTypeId: 'DETAIL',
          catalog: {
            units: [
              { id: 'tom-trip', productId: 'TOM', baseQty: 1 },
              { id: 'tom-ctn', productId: 'TOM', baseQty: 20 },
            ],
            variants: [{ id: 'TOM', productId: 'TOM', isActive: true }],
            prices: [
              { productId: 'TOM', variantId: null, unitId: 'tom-ctn', price: 5800 },
              { productId: 'TOM', variantId: null, unitId: 'tom-trip', price: 300 },
            ],
            tiers: [
              {
                productId: 'TOM',
                variantId: null,
                unitId: 'tom-ctn',
                minQty: 10,
                unitPrice: 5600,
                thresholdScope: 'ALL_VARIANTS',
              },
            ],
            bonusRules: [],
          },
        },
      },
    ]),
    ...rows('planningDay', [
      {
        id: DATE,
        data: {
          date: DATE,
          status: 'WORKING',
          holiday: null,
          seller: { id: 'u1', code: 'V07', name: 'Ahmed Kaci' },
          territory: { id: 'T1', code: 'S1', name: 'Secteur 1' },
          part: { id: 'P1', name: 'Partie 1' },
          customers: [
            {
              id: 'c1',
              code: 'CL-001',
              name: 'Épicerie Amine',
              phone: null,
              address: 'Rue 1',
              latitude: 35.7,
              longitude: -0.6,
              partName: 'Partie 1',
              frequency: 1,
              referenceDate: null,
              debtAmount: 1000,
              reason: 'SCHEDULED',
            },
          ],
        },
      },
    ]),
    ...rows('customer', [{ id: 'c1', data: customer }]),
    ...rows('quota', [{ id: 'q1', data: { id: 'q1', date: DATE, variantId: 'TOM', qty: 200 } }]),
    ...rows('depotStock', [{ id: 'TOM', data: { variantId: 'TOM', available: 1000 } }]),
  };
}

export const sellerState = (roleCode?: string) => loadState(sellerRows(roleCode));

let seq = 0;
/** Opération en file, comme la crée le moteur. */
export function op(
  type: OperationType,
  payload: Record<string, unknown>,
  extra: Partial<OutboxOp> = {},
): OutboxOp {
  seq += 1;
  return {
    opId: `op-${seq}`,
    deviceSeq: seq,
    type,
    payload,
    workdayId: 'w1',
    occurredAt: `${DATE}T09:${String(seq % 60).padStart(2, '0')}:00.000Z`,
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: null,
    error: null,
    result: null,
    changes: [],
    seen: true,
    reflected: false,
    ...extra,
  };
}
