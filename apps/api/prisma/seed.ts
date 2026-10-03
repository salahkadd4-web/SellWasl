/**
 * Données de démonstration (docs/database.md §18) — développement et tests uniquement.
 *
 * Deux entreprises isolées : « Distri Oran » en prévente et « Cash Van Est » en cash van,
 * avec les exemples chiffrés de docs/business-rules.md §22.
 *
 * Lancement : pnpm db:seed (ou automatiquement après pnpm db:reset).
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  assertAllowedPermissions,
  modulesForMode,
  PERMISSIONS,
  ROLE_CHANNEL,
  ROLE_CODES,
  rolePermissions,
  type RoleCode,
  type SalesMode,
} from '@sellwasl/business-rules';
import { defaultCompanySettings } from '@sellwasl/validation';
import { DEFAULT_REASONS as REASONS, ROLE_NAMES } from '../src/companies/defaults';
import { uuidv7 } from '../src/common/uuid';
import {
  type Prisma,
  PrismaClient,
  type VisitFrequency,
  type Weekday,
} from '../src/generated/prisma/client';

/** Mot de passe commun des comptes de démonstration. */
export const DEMO_PASSWORD = 'SellWasl@2026';
/** Date de référence des exemples : samedi 3 octobre 2026 (business-rules.md §22). */
const REFERENCE_SATURDAY = '2026-10-03';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

type Tx = Prisma.TransactionClient;

const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number): string => {
  const d = day(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Générateur pseudo-aléatoire déterministe : le seed produit toujours les mêmes données. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

interface UserSpec {
  code: string;
  role: RoleCode;
  firstName: string;
  lastName: string;
  email?: string;
}

interface CompanySpec {
  code: string;
  name: string;
  mode: SalesMode;
  city: string;
  /** Coin sud-ouest du premier secteur [latitude, longitude]. */
  origin: [number, number];
  emailDomain: string;
  users: UserSpec[];
  territories: { code: string; name: string; seller: string; types: string[] }[];
  driver?: string;
  trucks: { code: string; plate: string; user: string; stocked: boolean }[];
  seed: number;
}

const COMPANIES: CompanySpec[] = [
  {
    code: 'DISTRI-ORAN',
    name: 'Distri Oran',
    mode: 'PRE_SALES',
    city: 'Oran',
    origin: [35.68, -0.66],
    emailDomain: 'distri-oran.test',
    seed: 31,
    users: [
      {
        code: 'A-ADM',
        role: 'COMPANY_ADMIN',
        firstName: 'Karim',
        lastName: 'Benali',
        email: 'admin',
      },
      {
        code: 'A-SUP',
        role: 'SUPERVISEUR',
        firstName: 'Nadia',
        lastName: 'Haddad',
        email: 'superviseur',
      },
      {
        code: 'A-CPT',
        role: 'COMPTABLE',
        firstName: 'Samir',
        lastName: 'Rahmani',
        email: 'comptable',
      },
      { code: 'V07', role: 'PRE_VENDEUR', firstName: 'Ahmed', lastName: 'Kaci' },
      { code: 'V08', role: 'PRE_VENDEUR', firstName: 'Mohamed', lastName: 'Ziani' },
      { code: 'L01', role: 'LIVREUR', firstName: 'Youcef', lastName: 'Belkacem' },
      { code: 'M01', role: 'MAGASINIER', firstName: 'Rachid', lastName: 'Saadi' },
    ],
    territories: [
      { code: '3101', name: 'Oran Est', seller: 'V07', types: ['DETAIL'] },
      { code: '3102', name: 'Oran Ouest', seller: 'V08', types: ['DETAIL', 'SUPERETTE'] },
    ],
    driver: 'L01',
    trucks: [{ code: 'TRUCK-01', plate: '01234-120-31', user: 'L01', stocked: false }],
  },
  {
    code: 'CASHVAN-EST',
    name: 'Cash Van Est',
    mode: 'CASH_VAN',
    city: 'Constantine',
    origin: [36.34, 6.58],
    emailDomain: 'cashvan-est.test',
    seed: 25,
    users: [
      {
        code: 'B-ADM',
        role: 'COMPANY_ADMIN',
        firstName: 'Leila',
        lastName: 'Bouzid',
        email: 'admin',
      },
      {
        code: 'B-SUP',
        role: 'SUPERVISEUR',
        firstName: 'Omar',
        lastName: 'Mansouri',
        email: 'superviseur',
      },
      {
        code: 'B-CPT',
        role: 'COMPTABLE',
        firstName: 'Amina',
        lastName: 'Cherif',
        email: 'comptable',
      },
      { code: 'C01', role: 'VENDEUR_CASH_VAN', firstName: 'Bilal', lastName: 'Hamidi' },
      { code: 'C02', role: 'VENDEUR_CASH_VAN', firstName: 'Sofiane', lastName: 'Laib' },
      { code: 'M01', role: 'MAGASINIER', firstName: 'Farid', lastName: 'Toumi' },
    ],
    territories: [
      { code: '2501', name: 'Constantine Centre', seller: 'C01', types: ['DETAIL'] },
      { code: '2502', name: 'Constantine Nord', seller: 'C02', types: ['DETAIL', 'SUPERETTE'] },
    ],
    trucks: [
      { code: 'TRUCK-01', plate: '04567-120-25', user: 'C01', stocked: true },
      { code: 'TRUCK-02', plate: '04568-120-25', user: 'C02', stocked: true },
    ],
  },
];

const CUSTOMER_TYPES = [
  { code: 'DETAIL', name: 'Détail' },
  { code: 'SUPERETTE', name: 'Supérette' },
  { code: 'GROS', name: 'Gros' },
];

const HOLIDAYS = [
  { date: '2026-11-01', label: 'Fête de la Révolution' },
  { date: '2027-01-01', label: 'Nouvel An' },
  { date: '2027-01-12', label: 'Yennayer' },
  { date: '2027-05-01', label: 'Fête du Travail' },
];

const WEEKDAYS: Weekday[] = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'];

/** Catalogue commun aux deux entreprises : prix en DA par type de client (business-rules.md §22). */
const CATALOG = [
  {
    reference: 'THON-TOM',
    name: 'Thon tomate',
    range: 'THON',
    category: 'Conserves',
    units: [
      { name: 'triplette', baseQty: 1 },
      { name: 'carton', baseQty: 20 },
    ],
    variants: [{ reference: 'THON-TOM', name: 'Thon tomate', isDefault: true, stock: 8000 }],
    prices: {
      DETAIL: { carton: 5800, triplette: 300 },
      SUPERETTE: { carton: 5650, triplette: 290 },
      GROS: { carton: 5500 },
    },
    tiers: [{ type: 'DETAIL', unit: 'carton', minQty: 10, unitPrice: 5600 }],
  },
  {
    reference: 'THON-HUI',
    name: "Thon à l'huile",
    range: 'THON',
    category: 'Conserves',
    units: [
      { name: 'triplette', baseQty: 1 },
      { name: 'carton', baseQty: 20 },
    ],
    variants: [{ reference: 'THON-HUI', name: "Thon à l'huile", isDefault: true, stock: 6000 }],
    prices: {
      DETAIL: { carton: 6200, triplette: 320 },
      SUPERETTE: { carton: 6050, triplette: 310 },
      GROS: { carton: 5900 },
    },
    tiers: [],
  },
  {
    reference: 'BIMO',
    name: 'Biscuit Bimo',
    range: 'BIMO',
    category: 'Biscuits',
    units: [
      { name: 'paquet', baseQty: 1 },
      { name: 'carton', baseQty: 24 },
    ],
    variants: [
      { reference: 'BIMO-CHOC', name: 'Chocolat', isDefault: false, stock: 2400 },
      { reference: 'BIMO-FRA', name: 'Fraise', isDefault: false, stock: 2400 },
      {
        reference: 'BIMO-PIS',
        name: 'Pistache',
        isDefault: false,
        stock: 1200,
        // Prix propre du parfum (BR-CAT-14).
        prices: { DETAIL: { carton: 1400, paquet: 65 }, SUPERETTE: { carton: 1370, paquet: 63 } },
      },
    ],
    prices: {
      DETAIL: { carton: 1200, paquet: 55 },
      SUPERETTE: { carton: 1170, paquet: 53 },
      GROS: { carton: 1130 },
    },
    // Seuil calculé sur le total des parfums au prix du produit (BR-CAT-15).
    tiers: [{ type: 'DETAIL', unit: 'carton', minQty: 10, unitPrice: 1150 }],
  },
] as const;

const SHOP_PREFIXES = ['Alimentation', 'Supérette', 'Épicerie', 'Magasin', 'Boutique', 'Dépôt'];
const SHOP_NAMES = [
  'El Amel',
  'Benali',
  'Ennour',
  'Essalam',
  'El Baraka',
  'Hamdi',
  'Ouled Brahim',
  'Rahma',
  'El Khir',
  'Djamel',
  'Sidi Bel Abbès',
  'Les Amis',
  'El Fadjr',
  'Yasmine',
  'Ezzouhour',
  'Ibn Sina',
  'El Wafa',
  'Atlas',
  'Tassili',
  'Hoggar',
];
const FREQUENCIES: VisitFrequency[] = [
  'WEEKLY',
  'WEEKLY',
  'BIWEEKLY',
  'WEEKLY',
  'EVERY_4_WEEKS',
  'BIWEEKLY',
];

/** Polygone GeoJSON d'un rectangle (longitude puis latitude, ARC-09). */
function rectangle(minLat: number, minLng: number, maxLat: number, maxLng: number) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

async function seedPermissions(): Promise<void> {
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { description: p.description, scope: p.scope },
      create: { code: p.code, description: p.description, scope: p.scope },
    });
  }
}

async function seedCompany(spec: CompanySpec, passwordHash: string): Promise<void> {
  const existing = await prisma.company.findUnique({ where: { code: spec.code } });
  if (existing) {
    console.log(`• ${spec.name} existe déjà : ignorée (pnpm db:reset pour repartir de zéro).`);
    return;
  }
  const random = rng(spec.seed);

  await prisma.$transaction(
    async (tx: Tx) => {
      const companyId = uuidv7();
      const today = new Date();
      await tx.company.create({
        data: {
          id: companyId,
          name: spec.name,
          code: spec.code,
          mode: spec.mode,
          status: 'ACTIVE',
        },
      });

      // Modules et paramètres (BR-TEN-03, BR-TEN-08)
      await tx.companyModule.createMany({
        data: modulesForMode(spec.mode).map((moduleCode) => ({
          id: uuidv7(),
          companyId,
          moduleCode,
          status: 'ACTIVE' as const,
          activatedAt: today,
        })),
      });
      const settings = defaultCompanySettings();
      settings.receiptHeader = { name: spec.name, address: spec.city, phone: '' };
      await tx.companySettings.create({
        data: { id: uuidv7(), companyId, version: 1, data: settings },
      });

      // Rôles et permissions (docs/rbac.md §5, §7)
      const roleIds = {} as Record<RoleCode, string>;
      for (const code of ROLE_CODES) {
        roleIds[code] = uuidv7();
        await tx.role.create({
          data: {
            id: roleIds[code],
            companyId,
            code,
            name: ROLE_NAMES[code],
            channel: ROLE_CHANNEL[code],
          },
        });
        const permissions = rolePermissions(code, settings.rules);
        assertAllowedPermissions(code, permissions);
        await tx.rolePermission.createMany({
          data: permissions.map((permissionCode) => ({
            roleId: roleIds[code],
            permissionCode,
          })),
        });
      }

      // Utilisateurs
      const userIds: Record<string, string> = {};
      for (const u of spec.users) {
        const userId = (userIds[u.code] = uuidv7());
        await tx.user.create({
          data: {
            id: userId,
            companyId,
            roleId: roleIds[u.role],
            code: u.code,
            firstName: u.firstName,
            lastName: u.lastName,
            email: u.email ? `${u.email}@${spec.emailDomain}` : null,
            passwordHash,
            mustChangePassword: false,
          },
        });
      }

      // Paramétrage
      const typeIds: Record<string, string> = {};
      for (const t of CUSTOMER_TYPES) {
        const typeId = (typeIds[t.code] = uuidv7());
        await tx.customerType.create({ data: { id: typeId, companyId, ...t } });
      }
      await tx.holiday.createMany({
        data: HOLIDAYS.map((h) => ({ id: uuidv7(), companyId, date: day(h.date), label: h.label })),
      });
      await tx.reason.createMany({
        data: REASONS.map((r, i) => ({
          id: uuidv7(),
          companyId,
          kind: r.kind,
          label: r.label,
          systemCode: r.systemCode ?? null,
          sortOrder: i,
        })),
      });

      // Entrepôts
      const depotId = uuidv7();
      await tx.warehouse.create({
        data: { id: depotId, companyId, type: 'DEPOT', code: 'DEPOT', name: `Dépôt ${spec.city}` },
      });
      const truckIds: Record<string, string> = {};
      for (const t of spec.trucks) {
        const truckId = (truckIds[t.code] = uuidv7());
        await tx.warehouse.create({
          data: {
            id: truckId,
            companyId,
            type: 'TRUCK',
            code: t.code,
            name: `Camion ${t.code.slice(-2)}`,
            plateNumber: t.plate,
            assignedUserId: userIds[t.user],
          },
        });
      }

      // Catalogue
      const rangeIds: Record<string, string> = {};
      for (const [code, name] of [
        ['THON', 'Thon'],
        ['BIMO', 'Bimo'],
      ] as const) {
        rangeIds[code] = uuidv7();
        await tx.productRange.create({ data: { id: rangeIds[code], companyId, code, name } });
      }
      const categoryIds: Record<string, string> = {};
      for (const name of ['Conserves', 'Biscuits']) {
        categoryIds[name] = uuidv7();
        await tx.productCategory.create({ data: { id: categoryIds[name], companyId, name } });
      }

      const productIds: Record<string, string> = {};
      const unitIds: Record<string, Record<string, string>> = {};
      const variantIds: Record<string, string> = {};
      for (const p of CATALOG) {
        const productId = (productIds[p.reference] = uuidv7());
        await tx.product.create({
          data: {
            id: productId,
            companyId,
            reference: p.reference,
            name: p.name,
            rangeId: rangeIds[p.range]!,
            categoryId: categoryIds[p.category],
          },
        });
        unitIds[p.reference] = {};
        for (const u of p.units) {
          const unitId = (unitIds[p.reference]![u.name] = uuidv7());
          await tx.productUnit.create({
            data: {
              id: unitId,
              companyId,
              productId,
              name: u.name,
              baseQty: u.baseQty,
              isBase: u.baseQty === 1,
            },
          });
        }
        for (const [i, v] of p.variants.entries()) {
          const variantId = (variantIds[v.reference] = uuidv7());
          await tx.productVariant.create({
            data: {
              id: variantId,
              companyId,
              productId,
              reference: v.reference,
              name: v.name,
              isDefault: v.isDefault,
              sortOrder: i,
            },
          });
          // Stock : entrée au dépôt, puis transfert vers les camions de cash van.
          // Le stock reste égal à la somme de ses mouvements (docs/database.md §16).
          const stockedTrucks = spec.trucks.filter((t) => t.stocked);
          const truckQty = Math.min(v.stock, 40 * p.units[1]!.baseQty);
          const storekeeperId = userIds['M01']!;
          await tx.stockMovement.create({
            data: {
              id: uuidv7(),
              companyId,
              type: 'IN',
              productVariantId: variantId,
              qty: v.stock + truckQty * stockedTrucks.length,
              toWarehouseId: depotId,
              sourceType: 'RECEIPT',
              userId: storekeeperId,
              occurredAt: day('2026-10-01'),
            },
          });
          await tx.stock.create({
            data: {
              id: uuidv7(),
              companyId,
              warehouseId: depotId,
              productVariantId: variantId,
              physicalQty: v.stock,
            },
          });
          for (const t of stockedTrucks) {
            await tx.stockMovement.create({
              data: {
                id: uuidv7(),
                companyId,
                type: 'TRANSFER',
                productVariantId: variantId,
                qty: truckQty,
                fromWarehouseId: depotId,
                toWarehouseId: truckIds[t.code]!,
                sourceType: 'LOAD',
                userId: storekeeperId,
                occurredAt: day('2026-10-03'),
              },
            });
            await tx.stock.create({
              data: {
                id: uuidv7(),
                companyId,
                warehouseId: truckIds[t.code]!,
                productVariantId: variantId,
                physicalQty: truckQty,
              },
            });
          }
          if ('prices' in v) {
            for (const [type, byUnit] of Object.entries(v.prices)) {
              for (const [unit, price] of Object.entries(byUnit)) {
                await tx.price.create({
                  data: {
                    id: uuidv7(),
                    companyId,
                    productId,
                    productVariantId: variantId,
                    customerTypeId: typeIds[type]!,
                    unitId: unitIds[p.reference]![unit]!,
                    price: BigInt(price as number),
                  },
                });
              }
            }
          }
        }
        for (const [type, byUnit] of Object.entries(p.prices)) {
          for (const [unit, price] of Object.entries(byUnit)) {
            await tx.price.create({
              data: {
                id: uuidv7(),
                companyId,
                productId,
                customerTypeId: typeIds[type]!,
                unitId: unitIds[p.reference]![unit]!,
                price: BigInt(price as number),
              },
            });
          }
        }
        for (const t of p.tiers) {
          await tx.priceTier.create({
            data: {
              id: uuidv7(),
              companyId,
              productId,
              customerTypeId: typeIds[t.type]!,
              unitId: unitIds[p.reference]![t.unit]!,
              minQty: t.minQty,
              unitPrice: BigInt(t.unitPrice),
              thresholdScope: 'ALL_VARIANTS',
            },
          });
        }
      }

      // Bonus : « pour 1 carton de thon tomate, 4 triplettes de thon à l'huile offertes » (§22)
      await tx.bonusRule.create({
        data: {
          id: uuidv7(),
          companyId,
          name: '1 carton de thon tomate = 4 triplettes de thon à l’huile offertes',
          buyProductId: productIds['THON-TOM']!,
          buyQty: 1,
          buyUnitId: unitIds['THON-TOM']!['carton']!,
          freeProductId: productIds['THON-HUI']!,
          freeVariantId: variantIds['THON-HUI'],
          freeVariantMode: 'FIXED',
          freeQty: 4,
          freeUnitId: unitIds['THON-HUI']!['triplette']!,
          validFrom: day('2026-10-01'),
        },
      });

      // Secteurs : 6 parties en grille 3 × 2, une par jour de samedi à jeudi
      const partWidth = 0.02;
      const partHeight = 0.02;
      let customerIndex = 0;
      for (const [ti, t] of spec.territories.entries()) {
        const territoryId = uuidv7();
        const minLat = spec.origin[0];
        const minLng = spec.origin[1] + ti * 3 * partWidth;
        await tx.territory.create({
          data: {
            id: territoryId,
            companyId,
            code: t.code,
            name: t.name,
            sellerUserId: userIds[t.seller],
            deliveryUserId: spec.driver ? userIds[spec.driver] : null,
            partCount: 6,
          },
        });
        await tx.territoryCustomerType.createMany({
          data: t.types.map((code) => ({ territoryId, customerTypeId: typeIds[code]! })),
        });

        for (let n = 1; n <= 6; n += 1) {
          const col = (n - 1) % 3;
          const row = Math.floor((n - 1) / 3);
          const box = {
            minLat: minLat + row * partHeight,
            maxLat: minLat + (row + 1) * partHeight,
            minLng: minLng + col * partWidth,
            maxLng: minLng + (col + 1) * partWidth,
          };
          const partId = uuidv7();
          await tx.territoryPart.create({
            data: {
              id: partId,
              companyId,
              territoryId,
              number: n,
              name: `Partie ${n}`,
              geojson: rectangle(box.minLat, box.minLng, box.maxLat, box.maxLng),
              ...box,
            },
          });
          await tx.partSchedule.create({
            data: { id: uuidv7(), companyId, territoryId, weekday: WEEKDAYS[n - 1]!, partId },
          });

          // 5 clients par partie ; date de référence = premier jour prévu pour la partie (BR-PLA-03)
          for (let k = 0; k < 5; k += 1) {
            customerIndex += 1;
            const frequency = FREQUENCIES[(customerIndex + k) % FREQUENCIES.length]!;
            const isSuperette = t.types.includes('SUPERETTE') && k === 4;
            const prefix = isSuperette
              ? 'Supérette'
              : SHOP_PREFIXES[customerIndex % SHOP_PREFIXES.length]!;
            const credit = customerIndex % 5 === 0;
            const offsetWeeks = frequency === 'BIWEEKLY' && k % 2 === 1 ? 7 : 0;
            await tx.customer.create({
              data: {
                id: uuidv7(),
                companyId,
                code: `${t.code}-${String(customerIndex).padStart(3, '0')}`,
                name: `${prefix} ${SHOP_NAMES[customerIndex % SHOP_NAMES.length]}`,
                phone: `05${String(50000000 + Math.floor(random() * 49999999))}`,
                customerTypeId: typeIds[isSuperette ? 'SUPERETTE' : 'DETAIL']!,
                latitude: box.minLat + 0.002 + random() * (partHeight - 0.004),
                longitude: box.minLng + 0.002 + random() * (partWidth - 0.004),
                territoryId,
                partId,
                frequency,
                referenceDate: day(addDays(REFERENCE_SATURDAY, n - 1 + offsetWeeks)),
                isCreditAllowed: credit,
                creditLimitAmount: credit ? 50000n : 0n,
              },
            });
          }
        }

        // 2 clients hors partie, à revoir par le superviseur (BR-ORG-04, BR-CLI-05)
        for (let k = 0; k < 2; k += 1) {
          customerIndex += 1;
          await tx.customer.create({
            data: {
              id: uuidv7(),
              companyId,
              code: `${t.code}-${String(customerIndex).padStart(3, '0')}`,
              name: `Alimentation ${SHOP_NAMES[customerIndex % SHOP_NAMES.length]} (hors partie)`,
              customerTypeId: typeIds['DETAIL']!,
              latitude: minLat - 0.01 - k * 0.003,
              longitude: minLng + 0.01,
              territoryId,
              partId: null,
              isNew: true,
            },
          });
        }
      }

      // Dette de l'exemple §22 : plafond 50 000 DA, dette actuelle 42 000 DA
      const debtor = await tx.customer.findFirstOrThrow({
        where: { companyId, isCreditAllowed: true },
        orderBy: { code: 'asc' },
      });
      await tx.customerDebtEntry.create({
        data: {
          id: uuidv7(),
          companyId,
          customerId: debtor.id,
          kind: 'CREDIT_SALE',
          amount: 42000n,
          occurredAt: day('2026-09-28'),
        },
      });
      await tx.customer.update({ where: { id: debtor.id }, data: { debtAmount: 42000n } });

      // Quota de l'exemple §22 : 10 cartons de thon tomate pour le premier vendeur, le 3 octobre
      const firstSeller = spec.territories[0]!.seller;
      await tx.quota.create({
        data: {
          id: uuidv7(),
          companyId,
          userId: userIds[firstSeller]!,
          productVariantId: variantIds['THON-TOM']!,
          date: day(REFERENCE_SATURDAY),
          qty: 200,
          enteredQty: 10,
          enteredUnitId: unitIds['THON-TOM']!['carton']!,
        },
      });

      // Objectifs d'octobre (exemple §22 pour Bimo)
      for (const t of spec.territories) {
        for (const [range, target, bonus] of [
          ['BIMO', 3_200_000n, 12_000n],
          ['THON', 5_000_000n, 15_000n],
        ] as const) {
          await tx.objective.create({
            data: {
              id: uuidv7(),
              companyId,
              userId: userIds[t.seller]!,
              rangeId: rangeIds[range]!,
              month: day('2026-10-01'),
              targetAmount: target,
              bonusAmount: bonus,
              capPercent: 120,
            },
          });
        }
      }
    },
    { timeout: 60_000 },
  );

  const counts = await prisma.customer.count({ where: { company: { code: spec.code } } });
  console.log(
    `✔ ${spec.name} (${spec.mode}) : ${spec.users.length} utilisateurs, ${counts} clients.`,
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Le seed de démonstration ne doit jamais tourner en production.');
  }
  await seedPermissions();
  const passwordHash = await hash(DEMO_PASSWORD);
  // Compte Super Admin de démonstration (comptes plateforme séparés)
  await prisma.platformUser.upsert({
    where: { email: 'superadmin@sellwasl.test' },
    update: {},
    create: { id: uuidv7(), email: 'superadmin@sellwasl.test', name: 'Super Admin', passwordHash },
  });
  console.log('✔ Super Admin : superadmin@sellwasl.test');
  for (const spec of COMPANIES) {
    await seedCompany(spec, passwordHash);
  }
  console.log(`\nMot de passe des comptes de démonstration : ${DEMO_PASSWORD}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
