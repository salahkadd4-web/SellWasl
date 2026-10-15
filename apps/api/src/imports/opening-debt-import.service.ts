import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { FROZEN_MESSAGE, OpeningDebtService } from '../customers/opening-debt.service';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { decodeCsv, parseCsv } from './csv';
import { type CheckedImport, type ImportError, MAX_ROWS, SAMPLE_SIZE } from './import-types';

export const OPENING_DEBT_TEMPLATE =
  '﻿' +
  ['code;nom;dette', 'C-001;Alimentation Benali;12000', 'C-002;Supérette El Bahia;0'].join('\r\n') +
  '\r\n';

const MAX_AMOUNT = 1_000_000_000;
const da = (amount: number) => `${new Intl.NumberFormat('fr-FR').format(amount)} DA`;

interface OpeningRow {
  line: number;
  customerId: string;
  code: string;
  name: string;
  before: number;
  amount: number;
}

/**
 * Import CSV des soldes d'ouverture (BR-PAY-09) : une ligne par client, repéré par son code.
 * Les clients absents du fichier ne changent pas ; un client figé est refusé.
 */
@Injectable()
export class OpeningDebtImportService {
  constructor(
    @Inject(TENANT_PRISMA) private readonly db: TenantPrisma,
    private readonly openingDebts: OpeningDebtService,
  ) {}

  async check(content: Buffer): Promise<CheckedImport> {
    const { headers, rows } = parseCsv(decodeCsv(content));
    const missing = ['code', 'dette'].filter((c) => !headers.includes(c));
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

    const customers = await this.db.customer.findMany({
      where: { deletedAt: null, code: { not: null } },
      select: { id: true, code: true, name: true },
    });
    const byCode = new Map(customers.map((c) => [c.code!.toLowerCase(), c]));
    const states = await this.openingDebts.editableByCustomer(customers.map((c) => c.id));

    const errors: ImportError[] = [];
    const valid: OpeningRow[] = [];
    const seen = new Set<string>();
    for (const { line, values: v } of rows) {
      const code = (v.code ?? '').trim();
      const text = (v.dette ?? '').replace(/\s/g, '');
      const amount = Number(text);
      const customer = byCode.get(code.toLowerCase());
      const problems: string[] = [];
      if (!code) problems.push('code manquant');
      else if (!customer) problems.push(`client ${code} inconnu`);
      else if (seen.has(customer.id)) problems.push(`client ${code} présent deux fois`);
      if (!text || !Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT)
        problems.push('dette invalide (montant entier en DA)');
      if (customer && problems.length === 0 && !states.get(customer.id)!.editable)
        problems.push(FROZEN_MESSAGE);
      if (customer) seen.add(customer.id);
      if (problems.length > 0 || !customer) {
        errors.push({ line, message: problems.join(' ; ') });
        continue;
      }
      valid.push({
        line,
        customerId: customer.id,
        code: customer.code!,
        name: customer.name,
        before: states.get(customer.id)!.opening,
        amount,
      });
    }

    return {
      totalRows: rows.length,
      validRows: valid.length,
      errors,
      columns: ['Code', 'Client', 'Solde actuel', 'Nouveau solde'],
      sample: valid.slice(0, SAMPLE_SIZE).map((r) => ({
        line: r.line,
        values: [r.code, r.name, da(r.before), da(r.amount)],
      })),
      apply: async (tx, actor) => {
        let changed = 0;
        for (const r of valid) {
          if ((await this.openingDebts.set(tx, actor, r.customerId, r.amount)).changed)
            changed += 1;
        }
        return changed;
      },
    };
  }
}
