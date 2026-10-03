import type { AuthUser } from '../common/auth-context';
import type { Prisma } from '../generated/prisma/client';

export const MAX_ROWS = 10_000;
export const SAMPLE_SIZE = 20;

// Type (et non interface) : il est enregistré tel quel dans une colonne JSON
export type ImportError = {
  line: number;
  message: string;
};

/** Fichier vérifié, prêt à être importé (clients ou produits). */
export interface CheckedImport {
  totalRows: number;
  validRows: number;
  errors: ImportError[];
  columns: string[];
  sample: { line: number; values: string[] }[];
  /** Import des lignes valides, dans la transaction de confirmation ; renvoie le nombre de lignes. */
  apply(tx: Prisma.TransactionClient, actor: AuthUser): Promise<number>;
}
