import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  assignPart,
  type GeoJsonPolygon,
  type LatLng,
  localDate,
  nextScheduledDate,
  type WeekdayCode,
} from '@sellwasl/business-rules';
import { type AmbiguousPartDetails, companySettingsSchema } from '@sellwasl/validation';
import { ApiError } from '../common/api-error';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';

export interface Placement {
  territoryId: string | null;
  partId: string | null;
  isPartForced: boolean;
}

const rule = (message: string, details?: Record<string, unknown>) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BUSINESS_RULE', message, details);

/** Calendrier de l'entreprise, lu une fois pour un lot de clients (import). */
export interface Calendar {
  today: string;
  workingDays: WeekdayCode[];
  holidays: string[];
  weekdaysByPart: Map<string, WeekdayCode[]>;
}

/** Secteur et partie d'un client (BR-ORG-04, BR-CLI-02) et date de référence (BR-PLA-03). */
@Injectable()
export class PlacementService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  /**
   * Partie calculée parmi les secteurs actifs qui servent le type du client, ou parmi les parties
   * du seul secteur du vendeur. Sans position, le client est hors partie.
   * `onAmbiguous: 'reject'` refuse avec la liste des parties possibles, pour que le superviseur
   * choisisse ; `'outOfPart'` laisse le client à revoir (import).
   */
  async place(
    customerTypeId: string,
    point: LatLng | null,
    options: { territoryId?: string; onAmbiguous: 'reject' | 'outOfPart' | 'first' },
  ): Promise<Placement> {
    const outside = { territoryId: options.territoryId ?? null, partId: null, isPartForced: false };
    if (!point) return outside;
    const parts = await this.db.territoryPart.findMany({
      where: {
        deletedAt: null,
        minLat: { lte: point.latitude },
        maxLat: { gte: point.latitude },
        minLng: { lte: point.longitude },
        maxLng: { gte: point.longitude },
        territory: {
          isActive: true,
          deletedAt: null,
          ...(options.territoryId ? { id: options.territoryId } : {}),
          territoryCustomerTypes: { some: { customerTypeId } },
        },
      },
      include: { territory: true },
    });
    const result = assignPart(
      point,
      parts.map((p) => ({
        partId: p.id,
        territoryId: p.territoryId,
        minLat: p.minLat,
        maxLat: p.maxLat,
        minLng: p.minLng,
        maxLng: p.maxLng,
        geojson: p.geojson as unknown as GeoJsonPolygon,
      })),
    );
    if (result.kind === 'ASSIGNED')
      return { territoryId: result.territoryId, partId: result.partId, isPartForced: false };
    if (result.kind === 'OUT_OF_PART') return outside;
    if (options.onAmbiguous === 'first') {
      const [first] = result.options;
      return { territoryId: first!.territoryId, partId: first!.partId, isPartForced: false };
    }
    if (options.onAmbiguous === 'outOfPart') return outside;
    const details: AmbiguousPartDetails = {
      options: result.options.map((o) => {
        const part = parts.find((p) => p.id === o.partId)!;
        return { ...o, label: `${part.territory.code} · ${part.name}` };
      }),
    };
    throw new ApiError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'AMBIGUOUS_PART',
      'Plusieurs parties contiennent cette position : choisissez la partie du client.',
      details as unknown as Record<string, unknown>,
    );
  }

  /** Partie choisie par le superviseur : son secteur doit servir le type du client. */
  async forced(customerTypeId: string, partId: string): Promise<Placement> {
    const part = await this.db.territoryPart.findFirst({
      where: { id: partId, deletedAt: null },
      include: { territory: { include: { territoryCustomerTypes: true } } },
    });
    if (!part) throw rule('Partie introuvable.');
    if (!part.territory.territoryCustomerTypes.some((t) => t.customerTypeId === customerTypeId)) {
      throw rule(`Le secteur ${part.territory.code} ne sert pas ce type de client.`, {
        rule: 'BR-ORG-03',
      });
    }
    return { territoryId: part.territoryId, partId: part.id, isPartForced: true };
  }

  async calendar(): Promise<Calendar> {
    const [company, settings, schedules] = await Promise.all([
      this.db.company.findFirstOrThrow(),
      this.db.companySettings.findFirst({ orderBy: { version: 'desc' } }),
      this.db.partSchedule.findMany({ where: { deletedAt: null } }),
    ]);
    const today = localDate(new Date(), company.timezone);
    const holidays = await this.db.holiday.findMany({
      where: { deletedAt: null, date: { gte: new Date(`${today}T00:00:00Z`) } },
    });
    const weekdaysByPart = new Map<string, WeekdayCode[]>();
    for (const s of schedules) {
      weekdaysByPart.set(s.partId, [...(weekdaysByPart.get(s.partId) ?? []), s.weekday]);
    }
    return {
      today,
      workingDays: companySettingsSchema.parse(settings?.data ?? {}).workingDays,
      holidays: holidays.map((h) => h.date.toISOString().slice(0, 10)),
      weekdaysByPart,
    };
  }

  /** Date de référence par défaut : prochain jour ouvré prévu pour la partie (BR-PLA-03). */
  referenceDate(calendar: Calendar, partId: string | null): Date | null {
    if (!partId) return null;
    const date = nextScheduledDate(
      calendar.today,
      calendar.weekdaysByPart.get(partId) ?? [],
      calendar.workingDays,
      calendar.holidays,
    );
    return date ? new Date(`${date}T00:00:00Z`) : null;
  }
}
