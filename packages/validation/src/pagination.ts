import { z } from 'zod';

/** Page d'une liste qui grossit (api.md §1, phase 25). */
export interface Page<T> {
  data: T[];
  /** Curseur opaque de la page suivante ; null à la dernière page. */
  nextCursor: string | null;
  /** Nombre total de lignes avec les filtres de la requête. */
  total: number;
}

/**
 * Paramètres d'une liste paginée : `limit` (50 par défaut, 200 au plus), `cursor` (opaque) et
 * `sort` choisi parmi les champs autorisés de la route (`champ` croissant, `-champ` décroissant).
 */
export const pageQuery = <S extends string>(
  sorts: readonly [S, ...S[]],
  fallback: S | `-${S}`,
) => ({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(500).optional(),
  sort: z
    .enum([...sorts, ...sorts.map((s) => `-${s}`)] as [string, ...string[]], {
      error: `Tri inconnu : ${[...sorts].join(', ')} (préfixe « - » pour décroissant).`,
    })
    .default(fallback),
});
