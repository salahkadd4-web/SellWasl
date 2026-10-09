import { HttpStatus } from '@nestjs/common';
import type { Page } from '@sellwasl/validation';
import { ApiError } from './api-error';

type Dir = 'asc' | 'desc';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paramètres lus par `pageQuery` (packages/validation). */
export interface PageQuery {
  limit: number;
  cursor?: string;
  sort: string;
}

/** Ce que la requête Prisma de la liste reçoit : filtre du curseur, tri et nombre de lignes. */
export interface PageArgs {
  /** À combiner (AND) avec le filtre de la liste. */
  after: Record<string, unknown>;
  orderBy: Record<string, Dir>[];
  take: number;
}

/** Valeur du champ de tri dans le curseur, avec son type (date, montant, nombre, texte). */
type Tagged = ['d' | 'b' | 'n' | 's', string | number];

function tag(value: unknown): Tagged {
  if (value instanceof Date) return ['d', value.toISOString()];
  if (typeof value === 'bigint') return ['b', value.toString()];
  if (typeof value === 'number') return ['n', value];
  if (typeof value === 'string') return ['s', value];
  // Les listes ne trient que sur des champs obligatoires
  throw new Error(`Champ de tri sans valeur : ${String(value)}`);
}

function untag([type, value]: Tagged): unknown {
  if (type === 'd') return new Date(String(value));
  if (type === 'b') return BigInt(value);
  return value;
}

const invalidCursor = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Curseur invalide.', {
    fields: [{ path: 'cursor', message: 'Curseur invalide ou d’un autre tri.' }],
  });

function decode(cursor: string, sort: string): { value: unknown; id: string } {
  try {
    const [cursorSort, type, value, id] = JSON.parse(
      Buffer.from(cursor, 'base64url').toString(),
    ) as [string, Tagged[0], string | number, string];
    if (
      cursorSort !== sort ||
      typeof id !== 'string' ||
      !UUID.test(id) ||
      !['d', 'b', 'n', 's'].includes(type)
    )
      throw invalidCursor();
    const decoded = untag([type, value]);
    if (decoded instanceof Date && Number.isNaN(decoded.getTime())) throw invalidCursor();
    return { value: decoded, id };
  } catch {
    throw invalidCursor();
  }
}

/** Tri, curseur et nombre de lignes d'une requête paginée (une ligne de plus : page suivante ?). */
export function pageArgs(query: PageQuery): PageArgs & { field: string } {
  const desc = query.sort.startsWith('-');
  const field = desc ? query.sort.slice(1) : query.sort;
  const dir: Dir = desc ? 'desc' : 'asc';
  const op = desc ? 'lt' : 'gt';
  let after: Record<string, unknown> = {};
  if (query.cursor) {
    const { value, id } = decode(query.cursor, query.sort);
    // Champ de tri non unique : l'identifiant départage, aucune ligne perdue ni répétée
    after = { OR: [{ [field]: { [op]: value } }, { [field]: value, id: { [op]: id } }] };
  }
  return { after, orderBy: [{ [field]: dir }, { id: dir }], take: query.limit + 1, field };
}

/**
 * Liste paginée (api.md §1, phase 25) : `find` lit les lignes avec le curseur et le tri donnés,
 * `count` compte avec les seuls filtres de la liste, `map` met les lignes au format de la réponse.
 */
export async function paginate<R extends { id: string }, T>(
  query: PageQuery,
  find: (args: PageArgs) => Promise<R[]>,
  count: () => Promise<number>,
  map: (rows: R[]) => T[] | Promise<T[]>,
): Promise<Page<T>> {
  const args = pageArgs(query);
  const [rows, total] = await Promise.all([
    find(args).catch((error: unknown) => {
      // Curseur fabriqué : valeur d'un autre type que le champ de tri, refusée par Prisma
      if (query.cursor && (error as Error)?.constructor?.name?.startsWith('PrismaClient'))
        throw invalidCursor();
      throw error;
    }),
    count(),
  ]);
  const page = rows.slice(0, query.limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > query.limit && last
      ? Buffer.from(
          JSON.stringify([
            query.sort,
            ...tag((last as unknown as Record<string, unknown>)[args.field]),
            last.id,
          ]),
        ).toString('base64url')
      : null;
  return { data: await map(page), nextCursor, total };
}
