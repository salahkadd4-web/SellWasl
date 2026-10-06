import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  companySettingsSchema,
  type OfflinePricing,
  type OfflineReason,
  type OfflineSettings,
  type VisitPricingCatalog,
} from '@sellwasl/validation';
import { CatalogService } from '../../catalog/catalog.service';
import { ReceiptsService } from '../../delivery/receipts.service';
import { OrderService } from '../../field/order.service';
import { TENANT_PRISMA, type TenantPrisma } from '../../tenancy/tenant-prisma';
import { TerritoriesService } from '../../territories/territories.service';
import { SyncKinds } from '../sync-kinds';

const ALL = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN', 'LIVREUR'] as const;
const SELLERS = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'] as const;

/** Sortes du référentiel : paramètres, motifs, catalogue, prix, secteurs (spec phase 23 §3.2). */
@Injectable()
export class ReferenceKinds implements OnModuleInit {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly kinds: SyncKinds,
    private readonly catalog: CatalogService,
    private readonly orders: OrderService,
    private readonly territories: TerritoriesService,
    private readonly receipts: ReceiptsService,
  ) {}

  onModuleInit(): void {
    this.kinds.register({
      kind: 'settings',
      roles: ALL,
      mode: 'set',
      sources: [],
      load: async ({ actor }) => {
        const [row, ticket, user, device] = await Promise.all([
          this.db.companySettings.findFirst({ orderBy: { version: 'desc' } }),
          this.receipts.ticket(),
          this.db.user.findFirstOrThrow({ where: { id: actor.userId } }),
          actor.deviceId ? this.db.device.findFirst({ where: { id: actor.deviceId } }) : null,
        ]);
        const s = companySettingsSchema.parse(row?.data ?? {});
        const data: OfflineSettings = {
          settingsVersion: row?.version ?? 1,
          rules: {
            outOfZoneDistanceM: s.outOfZoneDistanceM,
            P01_workOnNonWorkingDays: s.rules.P01_workOnNonWorkingDays,
            P02_outOfProgramVisits: s.rules.P02_outOfProgramVisits,
            P03_bonusConsumesQuota: s.rules.P03_bonusConsumesQuota,
            P04_recalculateOnDecrease: s.rules.P04_recalculateOnDecrease,
          },
          ticket,
          me: {
            userId: user.id,
            code: user.code,
            name: `${user.firstName} ${user.lastName}`,
            series: device?.series ?? null,
            roleCode: actor.roleCode,
          },
        };
        return [{ id: 'company', data }];
      },
    });

    this.kinds.register({
      kind: 'reason',
      roles: ALL,
      mode: 'set',
      sources: ['reason'],
      load: async () => {
        const rows = await this.db.reason.findMany({
          where: { deletedAt: null },
          orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }],
        });
        return rows.map((r) => {
          const data: OfflineReason = {
            id: r.id,
            kind: r.kind,
            label: r.label,
            isActive: r.isActive,
          };
          return { id: r.id, data };
        });
      },
    });

    this.kinds.register({
      kind: 'product',
      roles: ALL,
      mode: 'set',
      sources: ['product', 'productUnit', 'productVariant', 'productRange', 'productCategory'],
      load: async () =>
        (await this.catalog.list({ status: 'ACTIVE' })).map((p) => ({ id: p.id, data: p })),
    });

    // Grille de chaque type de client : commande du vendeur, recalcul à la livraison (P-04)
    this.kinds.register({
      kind: 'pricing',
      roles: ALL,
      mode: 'set',
      sources: ['price', 'priceTier', 'bonusRule', 'customerType', 'productUnit', 'productVariant'],
      load: async () => {
        const types = await this.db.customerType.findMany({ where: { deletedAt: null } });
        return Promise.all(
          types.map(async (t) => {
            const data: OfflinePricing = {
              customerTypeId: t.id,
              catalog: (await this.orders.catalogFor(t.id)) as unknown as VisitPricingCatalog,
            };
            return { id: t.id, data };
          }),
        );
      },
    });

    this.kinds.register({
      kind: 'territory',
      roles: SELLERS,
      mode: 'set',
      sources: ['territory', 'territoryPart', 'partSchedule', 'customerType'],
      load: async ({ actor }) =>
        (await this.territories.list())
          .filter((t) => t.seller?.id === actor.userId)
          .map((t) => ({ id: t.id, data: t })),
    });
  }
}
