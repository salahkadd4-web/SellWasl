import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  assignPart,
  boundingBox,
  type GeoJsonPolygon,
  normalizePolygon,
  type PartCandidate,
  polygonsOverlap,
  shiftToWeekdays,
  type WeekdayCode,
} from '@sellwasl/business-rules';
import type {
  assignCustomersSchema,
  createTerritorySchema,
  CustomerPosition,
  FieldPosition,
  PartsChangeResult,
  TerritoryDto,
  TerritoryOverlap,
  territoryPartsSchema,
  territoryScheduleSchema,
  updateTerritorySchema,
  AuditAction,
  AuditEntity,
} from '@sellwasl/validation';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { PlacementService } from '../customers/placement.service';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

type Out<T extends z.ZodType> = z.output<T>;
type Polygon = { type: 'Polygon'; coordinates: number[][][] };

const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);

const SELLER_ROLES = ['PRE_VENDEUR', 'VENDEUR_CASH_VAN'];
const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const territoryInclude = {
  sellerUser: true,
  deliveryUser: true,
  territoryCustomerTypes: { include: { customerType: true } },
  territoryParts: { where: { deletedAt: null }, orderBy: { number: 'asc' } },
  partSchedules: { where: { deletedAt: null } },
} as const satisfies Prisma.TerritoryInclude;
type TerritoryRow = Prisma.TerritoryGetPayload<{ include: typeof territoryInclude }>;

/** Partie candidate, avec ce qu'il faut pour l'afficher. */
interface Candidate extends PartCandidate {
  label: string;
  customerTypeIds: string[];
}

/** Secteurs, parties, planning et carte (UC-50, UC-51, UC-52 ; BR-ORG-01 à BR-ORG-07). */
@Injectable()
export class TerritoriesService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly placement: PlacementService,
  ) {}

  private log(
    actor: AuthUser,
    action: AuditAction,
    entity: AuditEntity,
    entityId: string,
    after?: unknown,
  ) {
    return this.audit.write({
      companyId: actor.companyId,
      actorUserId: actor.userId,
      action,
      entity,
      entityId,
      after: after as Prisma.InputJsonValue,
    });
  }

  // Liste ----------------------------------------------------------------------------------------

  async list(): Promise<TerritoryDto[]> {
    const [territories, counts] = await Promise.all([
      this.db.territory.findMany({
        where: { deletedAt: null },
        include: territoryInclude,
        orderBy: { code: 'asc' },
      }),
      this.db.customer.groupBy({
        by: ['territoryId', 'partId'],
        where: { deletedAt: null, status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);
    const count = (territoryId: string, partId?: string | null) =>
      counts
        .filter(
          (c) => c.territoryId === territoryId && (partId === undefined || c.partId === partId),
        )
        .reduce((sum, c) => sum + c._count._all, 0);
    return territories.map((t) => this.toDto(t, count));
  }

  private toDto(
    t: TerritoryRow,
    count: (territoryId: string, partId?: string | null) => number,
  ): TerritoryDto {
    const user = (u: TerritoryRow['sellerUser']) =>
      u ? { id: u.id, code: u.code, name: fullName(u) } : null;
    return {
      id: t.id,
      version: t.version,
      code: t.code,
      name: t.name,
      partCount: t.partCount,
      isActive: t.isActive,
      customerTypeIds: t.territoryCustomerTypes.map((c) => c.customerTypeId),
      customerTypes: t.territoryCustomerTypes.map((c) => ({
        id: c.customerType.id,
        name: c.customerType.name,
      })),
      seller: user(t.sellerUser),
      deliveryUser: user(t.deliveryUser),
      parts: t.territoryParts.map((p) => ({
        id: p.id,
        number: p.number,
        name: p.name,
        geojson: p.geojson as unknown as Polygon,
        customerCount: count(t.id, p.id),
      })),
      schedule: t.partSchedules.map((s) => ({ weekday: s.weekday, partId: s.partId })),
      customerCount: count(t.id),
      outOfPartCount: count(t.id, null),
    };
  }

  private async find(id: string): Promise<TerritoryRow> {
    const territory = await this.db.territory.findFirst({
      where: { id, deletedAt: null },
      include: territoryInclude,
    });
    if (!territory) throw notFound('Secteur introuvable.');
    return territory;
  }

  private async get(id: string): Promise<TerritoryDto> {
    return (await this.list()).find((t) => t.id === id)!;
  }

  // Création et modification ---------------------------------------------------------------------

  /** Vendeur (un seul secteur par vendeur, BR-ORG-01) et livreur d'un secteur. */
  private async assertPeople(
    sellerUserId: string | null | undefined,
    deliveryUserId: string | null | undefined,
    territoryId?: string,
  ) {
    if (sellerUserId) {
      const seller = await this.db.user.findFirst({
        where: { id: sellerUserId, deletedAt: null },
        include: { role: true },
      });
      if (!seller || seller.status !== 'ACTIVE' || !SELLER_ROLES.includes(seller.role.code))
        throw rule('Le vendeur doit être un pré-vendeur ou un vendeur cash van actif.');
      const other = await this.db.territory.findFirst({
        where: {
          sellerUserId,
          deletedAt: null,
          ...(territoryId && { id: { not: territoryId } }),
        },
      });
      if (other)
        throw rule(
          `${fullName(seller)} a déjà le secteur ${other.code} : un vendeur a un seul secteur.`,
          {
            rule: 'BR-ORG-01',
          },
        );
    }
    if (deliveryUserId) {
      const driver = await this.db.user.findFirst({
        where: { id: deliveryUserId, deletedAt: null },
        include: { role: true },
      });
      if (!driver || driver.status !== 'ACTIVE' || driver.role.code !== 'LIVREUR')
        throw rule('Le livreur doit être un utilisateur actif de rôle livreur.');
    }
  }

  private async assertTypes(ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await this.db.customerType.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (found !== unique.length) throw rule('Type de client introuvable.');
  }

  async create(actor: AuthUser, input: Out<typeof createTerritorySchema>): Promise<TerritoryDto> {
    await this.assertTypes(input.customerTypeIds);
    await this.assertPeople(input.sellerUserId, input.deliveryUserId);
    const id = uuidv7();
    await this.db.$transaction(async (tx) => {
      await tx.territory.create({
        data: {
          id,
          companyId: actor.companyId,
          code: input.code,
          name: input.name,
          partCount: input.partCount,
          isActive: input.isActive,
          sellerUserId: input.sellerUserId,
          deliveryUserId: input.deliveryUserId,
          createdByUserId: actor.userId,
        },
      });
      await tx.territoryCustomerType.createMany({
        data: [...new Set(input.customerTypeIds)].map((customerTypeId) => ({
          territoryId: id,
          customerTypeId,
        })),
      });
    });
    await this.log(actor, 'territory.create', 'Territory', id, input);
    return this.get(id);
  }

  async update(
    actor: AuthUser,
    id: string,
    input: Out<typeof updateTerritorySchema>,
  ): Promise<TerritoryDto> {
    const territory = await this.find(id);
    if (input.customerTypeIds) await this.assertTypes(input.customerTypeIds);
    await this.assertPeople(input.sellerUserId, input.deliveryUserId, id);
    if (input.partCount !== undefined) {
      const highest = Math.max(0, ...territory.territoryParts.map((p) => p.number));
      if (input.partCount < highest)
        throw rule(
          `La partie ${highest} est dessinée : supprimez-la avant de réduire le nombre de parties.`,
        );
    }
    await this.db.$transaction(async (tx) => {
      const { customerTypeIds, ...fields } = input;
      await tx.territory.update({
        where: { id },
        data: { ...fields, version: { increment: 1 } },
      });
      if (customerTypeIds) {
        await tx.territoryCustomerType.deleteMany({ where: { territoryId: id } });
        await tx.territoryCustomerType.createMany({
          data: [...new Set(customerTypeIds)].map((customerTypeId) => ({
            territoryId: id,
            customerTypeId,
          })),
        });
      }
    });
    await this.log(actor, 'territory.update', 'Territory', id, input);
    return this.get(id);
  }

  // Parties (BR-ORG-02, BR-ORG-04, BR-ORG-06) -----------------------------------------------------

  /** Toutes les parties actives, avec les types de clients servis par leur secteur. */
  private async allCandidates(): Promise<Candidate[]> {
    const parts = await this.db.territoryPart.findMany({
      where: { deletedAt: null, territory: { deletedAt: null, isActive: true } },
      include: { territory: { include: { territoryCustomerTypes: true } } },
    });
    return parts.map((p) => ({
      partId: p.id,
      territoryId: p.territoryId,
      minLat: p.minLat,
      maxLat: p.maxLat,
      minLng: p.minLng,
      maxLng: p.maxLng,
      geojson: p.geojson as unknown as GeoJsonPolygon,
      label: `${p.territory.code} · ${p.name}`,
      customerTypeIds: p.territory.territoryCustomerTypes.map((c) => c.customerTypeId),
    }));
  }

  /**
   * Remplace les parties d'un secteur. Une partie garde son identifiant (et son planning) tant
   * que son numéro reste. Les clients non forcés sont réaffectés ; avec `dryRun`, rien n'est
   * enregistré et la réponse montre les clients qui changeraient de partie (BR-ORG-06).
   */
  async setParts(
    actor: AuthUser,
    id: string,
    input: Out<typeof territoryPartsSchema>,
    dryRun: boolean,
  ): Promise<PartsChangeResult> {
    const territory = await this.find(id);
    const numbers = input.parts.map((p) => p.number);
    if (new Set(numbers).size !== numbers.length) throw rule('Deux parties ont le même numéro.');
    const tooHigh = numbers.find((n) => n > territory.partCount);
    if (tooHigh)
      throw rule(
        `La partie ${tooHigh} dépasse le nombre de parties du secteur (${territory.partCount}).`,
      );

    // Une partie supprimée garde sa place dans l'index unique : elle est réactivée si son numéro revient
    const deletedParts = await this.db.territoryPart.findMany({
      where: { territoryId: id, deletedAt: { not: null } },
    });
    const drawn = input.parts.map((p) => {
      const result = normalizePolygon(p.geojson);
      if ('error' in result) throw rule(`${p.name} : ${result.error}`);
      const existing =
        territory.territoryParts.find((e) => e.number === p.number) ??
        deletedParts.find((e) => e.number === p.number);
      return {
        id: existing?.id ?? `new:${p.number}`,
        number: p.number,
        name: p.name,
        polygon: result.polygon,
        box: boundingBox(result.polygon),
      };
    });

    // Les parties d'un même secteur ne se chevauchent pas (BR-ORG-02)
    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        if (polygonsOverlap(drawn[i]!.polygon, drawn[j]!.polygon)) {
          throw rule(`${drawn[i]!.name} et ${drawn[j]!.name} se chevauchent.`, {
            rule: 'BR-ORG-02',
          });
        }
      }
    }

    // Secteurs qui servent un même type et se superposent : signalés (BR-ORG-03)
    const others = (await this.allCandidates()).filter((c) => c.territoryId !== id);
    const types = territory.territoryCustomerTypes;
    const overlaps: TerritoryOverlap[] = [];
    for (const part of drawn) {
      for (const other of others) {
        const common = types.filter((t) => other.customerTypeIds.includes(t.customerTypeId));
        if (common.length === 0) continue;
        if (polygonsOverlap(part.polygon, other.geojson as Polygon)) {
          const [otherCode, otherName] = other.label.split(' · ');
          overlaps.push({
            kind: 'SAME_CUSTOMER_TYPE',
            a: {
              territoryId: id,
              territoryCode: territory.code,
              partId: null,
              partName: part.name,
            },
            b: {
              territoryId: other.territoryId,
              territoryCode: otherCode!,
              partId: other.partId,
              partName: otherName!,
            },
            customerTypes: common.map((c) => c.customerType.name),
          });
        }
      }
    }

    // Réaffectation des clients avec la nouvelle géométrie
    const candidates: Candidate[] = territory.isActive
      ? [
          ...others,
          ...drawn.map((p) => ({
            partId: p.id,
            territoryId: id,
            ...p.box,
            geojson: p.polygon,
            label: `${territory.code} · ${p.name}`,
            customerTypeIds: types.map((t) => t.customerTypeId),
          })),
        ]
      : others;
    const labelOf = (partId: string | null) =>
      partId
        ? (candidates.find((c) => c.partId === partId)?.label ?? 'partie supprimée')
        : 'hors partie';
    const keptIds = new Set(drawn.map((p) => p.id));
    const removed = territory.territoryParts.filter((p) => !keptIds.has(p.id));
    const removedIds = new Set(removed.map((p) => p.id));
    const oldLabels = new Map(
      territory.territoryParts.map((p) => [p.id, `${territory.code} · ${p.name}`]),
    );

    const customers = await this.db.customer.findMany({
      where: {
        deletedAt: null,
        OR: [{ territoryId: id }, { customerTypeId: { in: types.map((t) => t.customerTypeId) } }],
      },
    });
    const changes: {
      id: string;
      name: string;
      from: string | null;
      territoryId: string | null;
      partId: string | null;
      unforce: boolean;
    }[] = [];
    for (const c of customers) {
      const forcedAndKept = c.isPartForced && c.partId && !removedIds.has(c.partId);
      if (forcedAndKept) continue;
      let territoryId = c.territoryId;
      let partId: string | null = null;
      if (c.latitude !== null && c.longitude !== null) {
        const result = assignPart(
          { latitude: c.latitude, longitude: c.longitude },
          candidates.filter((p) => p.customerTypeIds.includes(c.customerTypeId)),
        );
        if (result.kind === 'ASSIGNED') {
          ({ territoryId, partId } = result);
        } else if (result.kind === 'AMBIGUOUS') {
          // Plusieurs parties : la partie actuelle si elle convient, sinon à revoir
          partId = result.options.some((o) => o.partId === c.partId) ? c.partId : null;
        }
      }
      if (
        partId !== c.partId ||
        territoryId !== c.territoryId ||
        (c.isPartForced && removedIds.has(c.partId!))
      ) {
        changes.push({
          id: c.id,
          name: c.name,
          from: c.partId,
          territoryId,
          partId,
          unforce: c.isPartForced,
        });
      }
    }

    const result: PartsChangeResult = {
      applied: !dryRun,
      moved: changes
        .filter((c) => c.partId !== c.from)
        .map((c) => ({
          customerId: c.id,
          name: c.name,
          from: c.from ? (oldLabels.get(c.from) ?? labelOf(c.from)) : 'hors partie',
          to: labelOf(c.partId),
        })),
      overlaps,
      removedParts: removed.map((p) => p.name),
    };
    if (dryRun) return result;

    await this.db.$transaction(
      async (tx) => {
        const realIds = new Map<string, string>();
        for (const p of drawn) {
          const data = {
            name: p.name,
            geojson: p.polygon as unknown as Prisma.InputJsonValue,
            ...p.box,
          };
          if (p.id.startsWith('new:')) {
            const partId = uuidv7();
            realIds.set(p.id, partId);
            await tx.territoryPart.create({
              data: {
                id: partId,
                companyId: actor.companyId,
                territoryId: id,
                number: p.number,
                createdByUserId: actor.userId,
                ...data,
              },
            });
          } else {
            await tx.territoryPart.update({
              where: { id: p.id },
              data: { ...data, deletedAt: null, version: { increment: 1 } },
            });
          }
        }
        if (removed.length > 0) {
          await tx.territoryPart.updateMany({
            where: { id: { in: [...removedIds] } },
            data: { deletedAt: new Date() },
          });
          await tx.partSchedule.updateMany({
            where: { partId: { in: [...removedIds] }, deletedAt: null },
            data: { deletedAt: new Date() },
          });
        }
        const calendar = await this.placement.calendar();
        for (const c of changes) {
          const partId = c.partId ? (realIds.get(c.partId) ?? c.partId) : null;
          await tx.customer.update({
            where: { id: c.id },
            data: {
              territoryId: c.territoryId,
              partId,
              ...(c.unforce && { isPartForced: false }),
              ...(partId !== c.from && {
                referenceDate: this.placement.referenceDate(calendar, partId),
              }),
              version: { increment: 1 },
            },
          });
        }
        await this.audit.write(
          {
            companyId: actor.companyId,
            actorUserId: actor.userId,
            action: 'territory.parts',
            entity: 'Territory',
            entityId: id,
            after: {
              parts: drawn.map((p) => p.number),
              removed: result.removedParts,
              moved: result.moved.length,
            },
          },
          tx,
        );
      },
      { timeout: 60_000 },
    );
    return result;
  }

  // Planning (BR-ORG-07) -----------------------------------------------------------------------

  /**
   * Partie visitée chaque jour. Quand les jours d'une partie changent, la date de référence de
   * ses clients passe au premier nouveau jour de la même semaine (BR-PLA-03).
   */
  async setSchedule(
    actor: AuthUser,
    id: string,
    input: Out<typeof territoryScheduleSchema>,
  ): Promise<TerritoryDto> {
    const territory = await this.find(id);
    const weekdays = input.days.map((d) => d.weekday);
    if (new Set(weekdays).size !== weekdays.length) throw rule('Un jour est saisi deux fois.');
    const partIds = new Set(territory.territoryParts.map((p) => p.id));
    if (input.days.some((d) => d.partId && !partIds.has(d.partId)))
      throw rule("Une partie n'appartient pas à ce secteur.");

    const before = new Map<string, WeekdayCode[]>();
    for (const s of territory.partSchedules)
      before.set(s.partId, [...(before.get(s.partId) ?? []), s.weekday]);

    const existing = await this.db.partSchedule.findMany({ where: { territoryId: id } });
    await this.db.$transaction(async (tx) => {
      for (const day of input.days) {
        const row = existing.find((e) => e.weekday === day.weekday);
        if (day.partId) {
          if (row) {
            await tx.partSchedule.update({
              where: { id: row.id },
              data: { partId: day.partId, deletedAt: null, version: { increment: 1 } },
            });
          } else {
            await tx.partSchedule.create({
              data: {
                id: uuidv7(),
                companyId: actor.companyId,
                territoryId: id,
                weekday: day.weekday,
                partId: day.partId,
                createdByUserId: actor.userId,
              },
            });
          }
        } else if (row && !row.deletedAt) {
          await tx.partSchedule.update({
            where: { id: row.id },
            data: { deletedAt: new Date(), version: { increment: 1 } },
          });
        }
      }

      // Jours de chaque partie après la modification
      const after = new Map<string, WeekdayCode[]>();
      for (const s of territory.partSchedules) {
        if (input.days.some((d) => d.weekday === s.weekday)) continue;
        after.set(s.partId, [...(after.get(s.partId) ?? []), s.weekday]);
      }
      for (const d of input.days) {
        if (d.partId) after.set(d.partId, [...(after.get(d.partId) ?? []), d.weekday]);
      }
      for (const partId of partIds) {
        const oldDays = [...(before.get(partId) ?? [])].sort().join();
        const newDays = after.get(partId) ?? [];
        if (oldDays === [...newDays].sort().join() || newDays.length === 0) continue;
        const customers = await tx.customer.findMany({
          where: { partId, deletedAt: null, referenceDate: { not: null } },
        });
        for (const c of customers) {
          const shifted = shiftToWeekdays(dateOnly(c.referenceDate!), newDays);
          if (shifted && shifted !== dateOnly(c.referenceDate!)) {
            await tx.customer.update({
              where: { id: c.id },
              data: {
                referenceDate: new Date(`${shifted}T00:00:00Z`),
                version: { increment: 1 },
              },
            });
          }
        }
      }
      await this.audit.write(
        {
          companyId: actor.companyId,
          actorUserId: actor.userId,
          action: 'territory.schedule',
          entity: 'Territory',
          entityId: id,
          after: input as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    });
    return this.get(id);
  }

  // Chevauchements (BR-ORG-02, BR-ORG-03) -------------------------------------------------------

  async overlaps(): Promise<TerritoryOverlap[]> {
    const candidates = await this.allCandidates();
    const types = await this.db.customerType.findMany({ where: { deletedAt: null } });
    const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? '?';
    const result: TerritoryOverlap[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const a = candidates[i]!;
        const b = candidates[j]!;
        const same = a.territoryId === b.territoryId;
        const common = a.customerTypeIds.filter((t) => b.customerTypeIds.includes(t));
        if (!same && common.length === 0) continue;
        if (!polygonsOverlap(a.geojson as Polygon, b.geojson as Polygon)) continue;
        const side = (c: Candidate) => {
          const [territoryCode, partName] = c.label.split(' · ');
          return {
            territoryId: c.territoryId,
            territoryCode: territoryCode!,
            partId: c.partId,
            partName: partName!,
          };
        };
        result.push({
          kind: same ? 'SAME_TERRITORY' : 'SAME_CUSTOMER_TYPE',
          a: side(a),
          b: side(b),
          customerTypes: common.map(typeName),
        });
      }
    }
    return result;
  }

  // Carte ----------------------------------------------------------------------------------------

  async customerPositions(): Promise<CustomerPosition[]> {
    const rows = await this.db.customer.findMany({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      code: c.code,
      latitude: c.latitude!,
      longitude: c.longitude!,
      customerTypeId: c.customerTypeId,
      territoryId: c.territoryId,
      partId: c.partId,
      isPartForced: c.isPartForced,
      isNew: c.isNew,
    }));
  }

  /** Dernière position connue des vendeurs et livreurs, pendant leur journée (BR-JOU-09). */
  async fieldPositions(): Promise<FieldPosition[]> {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const devices = await this.db.device.findMany({
      where: {
        status: 'ACTIVE',
        lastLatitude: { not: null },
        lastLongitude: { not: null },
        lastPositionAt: { gte: since },
      },
      include: { user: { include: { role: true } } },
    });
    return devices.map((d) => ({
      userId: d.userId,
      code: d.user.code,
      name: fullName(d.user),
      role: d.user.role.name,
      latitude: d.lastLatitude!,
      longitude: d.lastLongitude!,
      at: d.lastPositionAt!.toISOString(),
      batteryLevel: d.batteryLevel,
    }));
  }

  /**
   * Place plusieurs clients dans une partie choisie (partie forcée), ou les rend au calcul
   * automatique (`partId` null). Sélection sur la carte (UC-53).
   */
  async assignCustomers(
    actor: AuthUser,
    input: Out<typeof assignCustomersSchema>,
  ): Promise<{ updated: number; skipped: { id: string; name: string; reason: string }[] }> {
    const customers = await this.db.customer.findMany({
      where: { id: { in: input.customerIds }, deletedAt: null },
    });
    const skipped: { id: string; name: string; reason: string }[] = [];
    const calendar = await this.placement.calendar();
    let updated = 0;
    for (const c of customers) {
      let placement;
      try {
        placement = input.partId
          ? await this.placement.forced(c.customerTypeId, input.partId)
          : await this.placement.place(
              c.customerTypeId,
              c.latitude !== null && c.longitude !== null
                ? { latitude: c.latitude, longitude: c.longitude }
                : null,
              { onAmbiguous: 'outOfPart' },
            );
      } catch (error) {
        skipped.push({
          id: c.id,
          name: c.name,
          reason: error instanceof Error ? error.message : 'Placement impossible.',
        });
        continue;
      }
      await this.db.customer.update({
        where: { id: c.id },
        data: {
          ...placement,
          ...(placement.partId !== c.partId && {
            referenceDate: this.placement.referenceDate(calendar, placement.partId),
          }),
          version: { increment: 1 },
        },
      });
      updated += 1;
    }
    await this.log(actor, 'customer.assign_part', 'TerritoryPart', input.partId ?? 'auto', {
      customers: input.customerIds.length,
      updated,
    });
    return { updated, skipped };
  }
}
