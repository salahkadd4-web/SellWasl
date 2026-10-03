import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { assignPart, type GeoJsonPolygon, type PartCandidate } from '@sellwasl/business-rules';
import type { Frequency, ImportPreview } from '@sellwasl/validation';
import { AuditService } from '../audit/audit.service';
import { ApiError, notFound } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { uuidv7 } from '../common/uuid';
import { PlacementService } from '../customers/placement.service';
import { FileStorageService } from '../files/file-storage.service';
import type { Prisma } from '../generated/prisma/client';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { decodeCsv, parseCsv } from './csv';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10_000;
const SAMPLE_SIZE = 20;

/** Colonnes du modèle d'import des clients (BR-IO-01). */
export const CUSTOMER_COLUMNS = [
  'code',
  'nom',
  'telephone',
  'adresse',
  'type',
  'latitude',
  'longitude',
  'frequence',
  'credit_autorise',
  'plafond_credit',
] as const;

export const CUSTOMER_TEMPLATE =
  '﻿' +
  [
    CUSTOMER_COLUMNS.join(';'),
    'C-001;Alimentation Benali;0550123456;12 rue Larbi Ben Mhidi, Oran;DETAIL;35,6971;-0,6308;1;non;0',
    'C-002;Supérette El Bahia;0661234567;Cité Djamel, Oran;SUPERETTE;;;2;oui;50000',
  ].join('\r\n') +
  '\r\n';

export interface UploadedCsv {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface CustomerRowInput {
  line: number;
  code: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  customerTypeId: string;
  customerTypeName: string;
  latitude: number | null;
  longitude: number | null;
  frequency: Frequency;
  isCreditAllowed: boolean;
  creditLimitAmount: number;
  territoryId: string | null;
  partId: string | null;
  placement: string;
}

interface Checked {
  totalRows: number;
  valid: CustomerRowInput[];
  errors: { line: number; message: string }[];
}

const FREQUENCY_BY_TEXT: Record<string, Frequency> = {
  '': 'WEEKLY',
  '1': 'WEEKLY',
  weekly: 'WEEKLY',
  hebdomadaire: 'WEEKLY',
  '2': 'BIWEEKLY',
  biweekly: 'BIWEEKLY',
  '15': 'BIWEEKLY',
  '4': 'EVERY_4_WEEKS',
  every_4_weeks: 'EVERY_4_WEEKS',
  mensuel: 'EVERY_4_WEEKS',
};
const YES = ['oui', 'o', 'yes', 'y', 'true', 'vrai', '1', 'x'];
const NO = ['', 'non', 'n', 'no', 'false', 'faux', '0'];

const number = (text: string) => Number(text.replace(/\s/g, '').replace(',', '.'));

/** Import CSV des clients, avec aperçu puis confirmation (UC-83, BR-IO-01). */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly audit: AuditService,
    private readonly files: FileStorageService,
    private readonly placement: PlacementService,
  ) {}

  /** Lit et vérifie chaque ligne ; les lignes en erreur sont listées avec leur motif. */
  private async check(content: Buffer): Promise<Checked> {
    const { headers, rows } = parseCsv(decodeCsv(content));
    const missing = ['nom', 'type'].filter((c) => !headers.includes(c));
    if (missing.length > 0) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IMPORT_INVALID',
        `Colonnes obligatoires absentes : ${missing.join(', ')}. Partez du modèle de fichier.`,
      );
    }
    if (rows.length > MAX_ROWS) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'IMPORT_INVALID',
        `Le fichier dépasse ${MAX_ROWS} lignes.`,
      );
    }

    const [types, customers, parts] = await Promise.all([
      this.db.customerType.findMany({ where: { deletedAt: null, isActive: true } }),
      this.db.customer.findMany({
        where: { deletedAt: null, code: { not: null } },
        select: { code: true },
      }),
      this.db.territoryPart.findMany({
        where: { deletedAt: null, territory: { isActive: true, deletedAt: null } },
        include: { territory: { include: { territoryCustomerTypes: true } } },
      }),
    ]);
    const typeByKey = new Map<string, (typeof types)[number]>();
    for (const t of types) {
      typeByKey.set(t.code.toLowerCase(), t);
      typeByKey.set(t.name.toLowerCase(), t);
    }
    const usedCodes = new Set(customers.map((c) => c.code!.toLowerCase()));
    const partLabel = new Map(parts.map((p) => [p.id, `${p.territory.code} · ${p.name}`]));

    const valid: CustomerRowInput[] = [];
    const errors: { line: number; message: string }[] = [];
    for (const { line, values: v } of rows) {
      const problems: string[] = [];
      const name = v.nom ?? '';
      if (!name) problems.push('nom manquant');
      if (name.length > 120) problems.push('nom trop long (120 caractères au plus)');

      const type = typeByKey.get((v.type ?? '').toLowerCase());
      if (!v.type) problems.push('type manquant');
      else if (!type) problems.push(`type « ${v.type} » inconnu`);

      const code = v.code || null;
      if (code && usedCodes.has(code.toLowerCase())) problems.push(`code ${code} déjà utilisé`);

      let latitude: number | null = null;
      let longitude: number | null = null;
      if (v.latitude || v.longitude) {
        latitude = number(v.latitude ?? '');
        longitude = number(v.longitude ?? '');
        if (
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180 ||
          !v.latitude ||
          !v.longitude
        ) {
          problems.push('position invalide (latitude et longitude en degrés décimaux)');
        }
      }

      const frequency = FREQUENCY_BY_TEXT[(v.frequence ?? '').toLowerCase()];
      if (!frequency) problems.push('fréquence invalide (1, 2 ou 4 semaines)');

      const creditText = (v.credit_autorise ?? '').toLowerCase();
      const isCreditAllowed = YES.includes(creditText);
      if (!isCreditAllowed && !NO.includes(creditText))
        problems.push('crédit autorisé : oui ou non');
      const creditLimitAmount = v.plafond_credit ? number(v.plafond_credit) : 0;
      if (!Number.isInteger(creditLimitAmount) || creditLimitAmount < 0)
        problems.push('plafond de crédit invalide (montant entier en DA)');

      if (problems.length > 0 || !type || !frequency) {
        errors.push({ line, message: problems.join(' ; ') });
        continue;
      }
      if (code) usedCodes.add(code.toLowerCase());

      // Partie calculée (BR-ORG-04) ; plusieurs possibles ou aucune : client à revoir (BR-IO-01)
      let territoryId: string | null = null;
      let partId: string | null = null;
      let placement = 'Sans position : à placer';
      if (latitude !== null && longitude !== null) {
        const candidates: PartCandidate[] = parts
          .filter((p) =>
            p.territory.territoryCustomerTypes.some((t) => t.customerTypeId === type.id),
          )
          .map((p) => ({
            partId: p.id,
            territoryId: p.territoryId,
            minLat: p.minLat,
            maxLat: p.maxLat,
            minLng: p.minLng,
            maxLng: p.maxLng,
            geojson: p.geojson as unknown as GeoJsonPolygon,
          }));
        const result = assignPart({ latitude, longitude }, candidates);
        if (result.kind === 'ASSIGNED') {
          ({ territoryId, partId } = result);
          placement = partLabel.get(partId)!;
        } else {
          placement =
            result.kind === 'AMBIGUOUS' ? 'Plusieurs parties : à placer' : 'Hors partie : à placer';
        }
      }

      valid.push({
        line,
        code,
        name,
        phone: v.telephone || null,
        address: v.adresse || null,
        customerTypeId: type.id,
        customerTypeName: type.name,
        latitude,
        longitude,
        frequency,
        isCreditAllowed,
        creditLimitAmount: isCreditAllowed ? creditLimitAmount : 0,
        territoryId,
        partId,
        placement,
      });
    }
    return { totalRows: rows.length, valid, errors };
  }

  private toPreview(
    job: Prisma.ImportJobGetPayload<{ include: { file: true } }>,
    checked: Checked | null,
  ): ImportPreview {
    const stored = (job.errors ?? []) as { line: number; message: string }[];
    return {
      id: job.id,
      kind: job.kind,
      status: job.status,
      filename: job.file.filename,
      totalRows: job.totalRows,
      validRows: checked ? checked.valid.length : job.totalRows - stored.length,
      importedRows: job.importedRows,
      errors: stored,
      sample: (checked?.valid ?? []).slice(0, SAMPLE_SIZE).map((r) => ({
        line: r.line,
        name: r.name,
        code: r.code,
        customerType: r.customerTypeName,
        position:
          r.latitude !== null && r.longitude !== null ? `${r.latitude}, ${r.longitude}` : null,
        placement: r.placement,
      })),
    };
  }

  /** Étape 1 : dépôt du fichier et aperçu, sans rien importer. */
  async preview(actor: AuthUser, file: UploadedCsv | undefined): Promise<ImportPreview> {
    if (!file || file.size === 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Choisissez un fichier CSV.');
    }
    const checked = await this.check(file.buffer);
    const fileId = uuidv7();
    const storageKey = `${actor.companyId}/imports/${fileId}.csv`;
    await this.files.put(storageKey, file.buffer);
    const job = await this.db.$transaction(async (tx) => {
      await tx.storedFile.create({
        data: {
          id: fileId,
          companyId: actor.companyId,
          kind: 'IMPORT',
          storageKey,
          filename: file.originalname.slice(0, 200),
          contentType: 'text/csv',
          sizeBytes: file.size,
          createdByUserId: actor.userId,
        },
      });
      return tx.importJob.create({
        data: {
          id: uuidv7(),
          companyId: actor.companyId,
          kind: 'CUSTOMERS',
          totalRows: checked.totalRows,
          errors: checked.errors,
          createdByUserId: actor.userId,
          fileId,
        },
        include: { file: true },
      });
    });
    return this.toPreview(job, checked);
  }

  private async findJob(id: string) {
    const job = await this.db.importJob.findFirst({ where: { id }, include: { file: true } });
    if (!job) throw notFound('Import introuvable.');
    return job;
  }

  async get(id: string): Promise<ImportPreview> {
    return this.toPreview(await this.findJob(id), null);
  }

  /**
   * Étape 2 : import des lignes valides, dans une transaction. Le fichier est vérifié de
   * nouveau : un code utilisé entre-temps passe dans les erreurs.
   */
  async confirm(actor: AuthUser, id: string): Promise<ImportPreview> {
    const job = await this.findJob(id);
    if (job.status !== 'PREVIEW') {
      throw new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE', 'Cet import est déjà terminé.');
    }
    const checked = await this.check(await this.files.get(job.file.storageKey));
    const calendar = await this.placement.calendar();
    const updated = await this.db.$transaction(
      async (tx) => {
        // Un double clic ne doit pas importer deux fois
        const claimed = await tx.importJob.updateMany({
          where: { id, status: 'PREVIEW' },
          data: { status: 'IMPORTED' },
        });
        if (claimed.count === 0) {
          throw new ApiError(HttpStatus.CONFLICT, 'INVALID_STATE', 'Cet import est déjà terminé.');
        }
        for (let i = 0; i < checked.valid.length; i += 1000) {
          await tx.customer.createMany({
            data: checked.valid.slice(i, i + 1000).map((r) => ({
              id: uuidv7(),
              companyId: actor.companyId,
              code: r.code,
              name: r.name,
              phone: r.phone,
              address: r.address,
              latitude: r.latitude,
              longitude: r.longitude,
              customerTypeId: r.customerTypeId,
              territoryId: r.territoryId,
              partId: r.partId,
              frequency: r.frequency,
              referenceDate: this.placement.referenceDate(calendar, r.partId),
              isCreditAllowed: r.isCreditAllowed,
              creditLimitAmount: BigInt(r.creditLimitAmount),
              createdByUserId: actor.userId,
            })),
          });
        }
        await this.audit.write(
          {
            companyId: actor.companyId,
            actorUserId: actor.userId,
            action: 'import.customers',
            entity: 'ImportJob',
            entityId: id,
            after: { imported: checked.valid.length, errors: checked.errors.length },
          },
          tx,
        );
        return tx.importJob.update({
          where: { id },
          data: {
            importedRows: checked.valid.length,
            totalRows: checked.totalRows,
            errors: checked.errors,
          },
          include: { file: true },
        });
      },
      { timeout: 60_000 },
    );
    return this.toPreview(updated, checked);
  }
}
