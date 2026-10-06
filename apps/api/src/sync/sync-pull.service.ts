import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  OFFLINE_KINDS,
  OFFLINE_ROLES,
  type OfflineKind,
  type PulledRow,
  type SyncPullQuery,
  type SyncPullResponse,
} from '@sellwasl/validation';
import { ApiError, forbidden } from '../common/api-error';
import type { AuthUser } from '../common/auth-context';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { type KindDef, type KindRow, SyncKinds } from './sync-kinds';

/** Lignes par page ; réglable pour les tests. */
const pageSize = () => Number(process.env.SYNC_PULL_PAGE_SIZE ?? 500);

/** Position dans la réception : sorte en cours, dernier id envoyé, curseur de la première page. */
interface PageToken {
  k: number;
  id: string | null;
  x: string;
  /** Sortes déjà annoncées comme remplacées sur les pages précédentes. */
  r: OfflineKind[];
}

function encodePage(token: PageToken): string {
  return Buffer.from(JSON.stringify(token)).toString('base64url');
}
function decodePage(page: string): PageToken {
  try {
    const t = JSON.parse(Buffer.from(page, 'base64url').toString()) as PageToken;
    if (typeof t.k !== 'number' || typeof t.x !== 'string' || !/^\d+$/.test(t.x)) throw new Error();
    return { k: t.k, id: t.id ?? null, x: t.x, r: Array.isArray(t.r) ? t.r : [] };
  } catch {
    throw new ApiError(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'Page de synchronisation invalide.',
    );
  }
}

type Delegate = {
  findFirst(args: {
    where: { changeXid: { gte: bigint } };
    select: { id: true };
  }): Promise<unknown>;
};

/**
 * Réception différentielle du téléphone (docs/api.md §6.2, spec phase 23 §3) : le curseur est la
 * plus ancienne transaction en cours au début de la lecture (`pg_snapshot_xmin`). Toute écriture
 * validée avant est lue ; toute écriture validée après porte une transaction au moins égale au
 * curseur, et revient à la réception suivante. Une ligne peut donc arriver deux fois, jamais zéro.
 */
@Injectable()
export class SyncPullService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly kinds: SyncKinds,
  ) {}

  async pull(actor: AuthUser, query: SyncPullQuery): Promise<SyncPullResponse> {
    if (actor.channel !== 'MOBILE' || !actor.deviceId)
      throw forbidden('MOBILE_ONLY', 'La synchronisation est réservée au téléphone.');
    if (!(OFFLINE_ROLES as readonly string[]).includes(actor.roleCode))
      throw forbidden(
        'OFFLINE_NOT_AVAILABLE',
        'Ce rôle travaille en ligne : pas de données hors connexion.',
      );

    const scope = await this.scopeKey(actor);
    const serverTime = new Date().toISOString();
    if (query.scope !== undefined && query.scope !== scope)
      return {
        rows: [],
        replace: [],
        cursor: '0',
        hasMore: false,
        page: null,
        scope,
        reset: true,
        serverTime,
      };

    const token: PageToken = query.page
      ? decodePage(query.page)
      : { k: 0, id: null, x: await this.snapshotXmin(), r: [] };
    const cursor = BigInt(query.cursor);
    const defs = OFFLINE_KINDS.map((k) => this.kinds.get(k)).filter(
      (d): d is KindDef => !!d && d.roles.includes(actor.roleCode),
    );

    const limit = pageSize();
    const rows: PulledRow[] = [];
    const replace = new Set<OfflineKind>(token.r);
    for (let k = token.k; k < defs.length; k += 1) {
      const def = defs[k]!;
      const full = cursor === 0n || (def.full ? await this.changed(def.full, cursor) : false);
      if (
        def.mode === 'set' &&
        !full &&
        def.sources.length > 0 &&
        !(await this.changed(def.sources, cursor))
      )
        continue;
      if (def.mode === 'set' || full) replace.add(def.kind);
      const all = (await def.load({ actor, cursor, date: query.date, full })).sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      const start = k === token.k && token.id !== null ? all.filter((r) => r.id > token.id!) : all;
      for (const r of start) {
        if (rows.length === limit) {
          const last = rows[rows.length - 1]!;
          const next: PageToken = {
            k,
            id: last.kind === def.kind ? last.id : null,
            x: token.x,
            r: [...replace],
          };
          return {
            rows,
            replace: [...replace].filter((kind) => !token.r.includes(kind)),
            cursor: query.cursor,
            hasMore: true,
            page: encodePage(next),
            scope,
            reset: false,
            serverTime,
          };
        }
        rows.push(toPulled(def.kind, r));
      }
    }
    // Réception complète : preuve, côté serveur, du dernier contact de l'appareil (vente cash van
    // hors connexion, spec §3.4)
    await this.db.device.updateMany({
      where: { id: actor.deviceId },
      data: { lastSyncAt: new Date() },
    });
    return {
      rows,
      replace: [...replace].filter((kind) => !token.r.includes(kind)),
      cursor: token.x,
      hasMore: false,
      page: null,
      scope,
      reset: false,
      serverTime,
    };
  }

  /** Une ligne de l'entreprise a-t-elle changé depuis le curseur dans une de ces tables ? */
  private async changed(models: readonly string[], cursor: bigint): Promise<boolean> {
    for (const model of models) {
      const delegate = (this.db as unknown as Record<string, Delegate>)[model]!;
      if (await delegate.findFirst({ where: { changeXid: { gte: cursor } }, select: { id: true } }))
        return true;
    }
    return false;
  }

  private async snapshotXmin(): Promise<string> {
    const [row] = await this.db.$queryRaw<{ xmin: string }[]>`
      SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS xmin`;
    return row!.xmin;
  }

  /** Périmètre de l'utilisateur : rôle, secteurs servis, camion. */
  private async scopeKey(actor: AuthUser): Promise<string> {
    const [territories, truck] = await Promise.all([
      this.db.territory.findMany({
        where: {
          deletedAt: null,
          ...(actor.roleCode === 'LIVREUR'
            ? { deliveryUserId: actor.userId }
            : { sellerUserId: actor.userId }),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      }),
      this.db.warehouse.findFirst({
        where: { type: 'TRUCK', assignedUserId: actor.userId, isActive: true, deletedAt: null },
        select: { id: true },
      }),
    ]);
    return `${actor.roleCode}:t=${territories.map((t) => t.id).join(',')}:w=${truck?.id ?? ''}`;
  }
}

function toPulled(kind: OfflineKind, r: KindRow): PulledRow {
  return { kind, id: r.id, data: r.deleted ? null : r.data, deleted: !!r.deleted };
}
