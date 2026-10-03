import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { uuidv7 } from '../common/uuid';
import { TENANT_PRISMA, type TenantPrisma } from '../tenancy/tenant-prisma';
import { decodeCsv, normalizeHeader, parseCsv } from './csv';
import { type CheckedImport, type ImportError, MAX_ROWS, SAMPLE_SIZE } from './import-types';

interface PriceCell {
  customerTypeId: string;
  unitKey: string;
  price: number;
}

interface ProductGroup {
  reference: string;
  name: string;
  range: string;
  category: string | null;
  baseUnit: string;
  packagings: { name: string; baseQty: number }[];
  /** Prix du produit (ligne sans parfum). */
  prices: PriceCell[];
  flavors: { line: number; reference: string; name: string; prices: PriceCell[] }[];
  lines: number[];
}

const intText = (text: string) => Number(text.replace(/\s/g, ''));

/**
 * Import CSV des produits (BR-IO-02) : une ligne par produit, puis une ligne par parfum.
 * Les prix sont dans les colonnes `prix_<TYPE>_<unité>` : sur la ligne du produit, prix du
 * produit ; sur la ligne d'un parfum, son prix propre (BR-CAT-14), vide s'il n'en a pas.
 * L'import crée des produits ; il ne modifie pas les produits existants.
 */
@Injectable()
export class ProductImportService {
  constructor(@Inject(TENANT_PRISMA) private readonly db: TenantPrisma) {}

  /** Modèle avec une colonne de prix par type de client, pour le paquet et le carton. */
  async template(): Promise<string> {
    const types = await this.db.customerType.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    });
    const priceColumns = types.flatMap((t) => [`prix_${t.code}_carton`, `prix_${t.code}_paquet`]);
    const cells = (values: string[]) => [...values, ...priceColumns.map(() => '')];
    const withPrices = (values: string[], carton: number, paquet: number) => [
      ...values,
      ...types.flatMap(() => [String(carton), String(paquet)]),
    ];
    const head = [
      'reference_produit',
      'nom_produit',
      'gamme',
      'categorie',
      'unite_base',
      'conditionnements',
      'reference_parfum',
      'nom_parfum',
      ...priceColumns,
    ];
    const rows = [
      head,
      withPrices(
        ['GAUF-01', 'Gaufrette', 'BISCUITS', 'Biscuits', 'paquet', 'carton=24', '', ''],
        1100,
        50,
      ),
      cells(['GAUF-01', '', '', '', '', '', 'GAUF-01-CHOC', 'Chocolat']),
      withPrices(['GAUF-01', '', '', '', '', '', 'GAUF-01-NOIS', 'Noisette'], 1300, 60),
    ];
    return '﻿' + rows.map((r) => r.join(';')).join('\r\n') + '\r\n';
  }

  async check(content: Buffer): Promise<CheckedImport> {
    const { headers, rows } = parseCsv(decodeCsv(content));
    const required = ['reference_produit', 'nom_produit', 'gamme', 'unite_base'];
    const missing = required.filter((c) => !headers.includes(c));
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

    const [types, ranges, categories, products, variants] = await Promise.all([
      this.db.customerType.findMany({ where: { deletedAt: null } }),
      this.db.productRange.findMany({ where: { deletedAt: null } }),
      this.db.productCategory.findMany({ where: { deletedAt: null } }),
      this.db.product.findMany({ where: { deletedAt: null }, select: { reference: true } }),
      this.db.productVariant.findMany({ where: { deletedAt: null }, select: { reference: true } }),
    ]);

    // Colonnes de prix : prix_<code du type>_<unité>
    const priceColumns: { header: string; customerTypeId: string; unitKey: string }[] = [];
    for (const header of headers.filter((h) => h.startsWith('prix_'))) {
      const rest = header.slice('prix_'.length);
      const type = types
        .map((t) => ({ t, key: normalizeHeader(t.code) }))
        .sort((a, b) => b.key.length - a.key.length)
        .find(({ key }) => rest.startsWith(`${key}_`));
      if (!type) {
        throw new ApiError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'IMPORT_INVALID',
          `Colonne ${header} : type de client inconnu. Format attendu : prix_<TYPE>_<unité>.`,
        );
      }
      priceColumns.push({
        header,
        customerTypeId: type.t.id,
        unitKey: rest.slice(type.key.length + 1),
      });
    }

    const usedReferences = new Set(
      [...products, ...variants].map((r) => r.reference.toUpperCase()),
    );
    const errors: ImportError[] = [];
    const groups = new Map<string, ProductGroup>();
    const failed = new Set<string>();
    const fail = (reference: string, line: number, message: string) => {
      errors.push({ line, message });
      failed.add(reference);
    };

    for (const { line, values: v } of rows) {
      const reference = (v.reference_produit ?? '').toUpperCase();
      if (!reference) {
        errors.push({ line, message: 'référence du produit manquante' });
        continue;
      }
      const group =
        groups.get(reference) ??
        ({
          reference,
          name: '',
          range: '',
          category: null,
          baseUnit: '',
          packagings: [],
          prices: [],
          flavors: [],
          lines: [],
        } satisfies ProductGroup);
      groups.set(reference, group);
      group.lines.push(line);

      const prices: PriceCell[] = [];
      for (const column of priceColumns) {
        const text = v[column.header] ?? '';
        if (!text) continue;
        const price = intText(text);
        if (!Number.isInteger(price) || price < 0) {
          fail(reference, line, `${column.header} : montant entier en DA attendu`);
          continue;
        }
        prices.push({ customerTypeId: column.customerTypeId, unitKey: column.unitKey, price });
      }

      const flavorRef = (v.reference_parfum ?? '').toUpperCase();
      const flavorName = v.nom_parfum ?? '';
      if (flavorRef || flavorName) {
        if (!flavorRef || !flavorName) {
          fail(reference, line, 'parfum : référence et nom vont ensemble');
          continue;
        }
        if (usedReferences.has(flavorRef)) {
          fail(reference, line, `référence ${flavorRef} déjà utilisée`);
          continue;
        }
        usedReferences.add(flavorRef);
        group.flavors.push({ line, reference: flavorRef, name: flavorName, prices });
        continue;
      }

      // Ligne du produit
      if (group.name) {
        fail(reference, line, `produit ${reference} décrit deux fois`);
        continue;
      }
      if (usedReferences.has(reference)) {
        fail(
          reference,
          line,
          `référence ${reference} déjà utilisée (l'import ne modifie pas un produit existant)`,
        );
        continue;
      }
      const problems: string[] = [];
      if (!v.nom_produit) problems.push('nom du produit manquant');
      if (!v.gamme) problems.push('gamme manquante');
      if (!v.unite_base) problems.push('unité de base manquante');
      const packagings: { name: string; baseQty: number }[] = [];
      for (const part of (v.conditionnements ?? '').split(/[|,]/).map((p) => p.trim())) {
        if (!part) continue;
        const [name, qty] = part.split('=').map((x) => x.trim());
        const baseQty = intText(qty ?? '');
        if (!name || !Number.isInteger(baseQty) || baseQty < 2) {
          problems.push(`conditionnement « ${part} » invalide (ex. carton=24)`);
        } else packagings.push({ name, baseQty });
      }
      const unitKeys = [v.unite_base ?? '', ...packagings.map((p) => p.name)].map(normalizeHeader);
      if (new Set(unitKeys).size !== unitKeys.length)
        problems.push('deux unités portent le même nom');
      if (problems.length > 0) {
        fail(reference, line, problems.join(' ; '));
        continue;
      }
      group.name = v.nom_produit!;
      group.range = v.gamme!;
      group.category = v.categorie || null;
      group.baseUnit = v.unite_base!;
      group.packagings = packagings;
      group.prices = prices;
      usedReferences.add(reference);
    }

    // Cohérence de chaque produit : ligne du produit présente, prix sur des unités connues
    for (const group of groups.values()) {
      if (failed.has(group.reference)) continue;
      if (!group.name) {
        fail(
          group.reference,
          group.lines[0]!,
          `ligne du produit ${group.reference} absente (sans parfum)`,
        );
        continue;
      }
      const units = new Set(
        [group.baseUnit, ...group.packagings.map((p) => p.name)].map(normalizeHeader),
      );
      const bad = [group.prices, ...group.flavors.map((f) => f.prices)]
        .flat()
        .find((p) => !units.has(p.unitKey));
      if (bad) {
        fail(
          group.reference,
          group.lines[0]!,
          `prix en « ${bad.unitKey} » : ce produit n'a pas cette unité`,
        );
      }
    }

    const valid = [...groups.values()].filter((g) => !failed.has(g.reference));
    const rangeKey = (text: string) =>
      ranges.find(
        (r) =>
          r.code.toLowerCase() === text.toLowerCase() ||
          r.name.toLowerCase() === text.toLowerCase(),
      );
    const categoryKey = (text: string) =>
      categories.find((c) => c.name.toLowerCase() === text.toLowerCase());

    return {
      totalRows: rows.length,
      validRows: valid.reduce((sum, g) => sum + g.lines.length, 0),
      errors: errors.sort((a, b) => a.line - b.line),
      columns: ['Référence', 'Produit', 'Parfums', 'Gamme', 'Unités', 'Prix'],
      sample: valid.slice(0, SAMPLE_SIZE).map((g) => ({
        line: g.lines[0]!,
        values: [
          g.reference,
          g.name,
          g.flavors.map((f) => f.name).join(', ') || '—',
          rangeKey(g.range) ? g.range : `${g.range} (nouvelle)`,
          [g.baseUnit, ...g.packagings.map((p) => `${p.name} = ${p.baseQty}`)].join(', '),
          `${g.prices.length + g.flavors.reduce((s, f) => s + f.prices.length, 0)} prix`,
        ],
      })),
      apply: async (tx, actor) => {
        const companyId = actor.companyId;
        const rangeIds = new Map<string, string>();
        const categoryIds = new Map<string, string>();
        for (const g of valid) {
          const rKey = g.range.toLowerCase();
          if (!rangeIds.has(rKey)) {
            const existing = rangeKey(g.range);
            const id = existing?.id ?? uuidv7();
            if (!existing) {
              await tx.productRange.create({
                data: {
                  id,
                  companyId,
                  code: normalizeHeader(g.range).toUpperCase().slice(0, 40),
                  name: g.range,
                  createdByUserId: actor.userId,
                },
              });
            }
            rangeIds.set(rKey, id);
          }
          if (g.category && !categoryIds.has(g.category.toLowerCase())) {
            const existing = categoryKey(g.category);
            const id = existing?.id ?? uuidv7();
            if (!existing) {
              await tx.productCategory.create({
                data: { id, companyId, name: g.category, createdByUserId: actor.userId },
              });
            }
            categoryIds.set(g.category.toLowerCase(), id);
          }

          const productId = uuidv7();
          await tx.product.create({
            data: {
              id: productId,
              companyId,
              reference: g.reference,
              name: g.name,
              rangeId: rangeIds.get(rKey)!,
              categoryId: g.category ? categoryIds.get(g.category.toLowerCase())! : null,
              createdByUserId: actor.userId,
            },
          });
          const unitIds = new Map<string, string>();
          for (const u of [{ name: g.baseUnit, baseQty: 1 }, ...g.packagings]) {
            const id = uuidv7();
            unitIds.set(normalizeHeader(u.name), id);
            await tx.productUnit.create({
              data: {
                id,
                companyId,
                productId,
                name: u.name,
                baseQty: u.baseQty,
                isBase: u.baseQty === 1,
                createdByUserId: actor.userId,
              },
            });
          }
          const articles =
            g.flavors.length > 0
              ? g.flavors.map((f) => ({ ...f, isDefault: false }))
              : [{ reference: g.reference, name: g.name, prices: [], isDefault: true }];
          const priceRows: {
            productVariantId: string | null;
            customerTypeId: string;
            unitId: string;
            price: bigint;
          }[] = g.prices.map((p) => ({
            productVariantId: null,
            customerTypeId: p.customerTypeId,
            unitId: unitIds.get(p.unitKey)!,
            price: BigInt(p.price),
          }));
          for (const [i, a] of articles.entries()) {
            const variantId = uuidv7();
            await tx.productVariant.create({
              data: {
                id: variantId,
                companyId,
                productId,
                reference: a.reference,
                name: a.name,
                isDefault: a.isDefault,
                sortOrder: i,
                createdByUserId: actor.userId,
              },
            });
            for (const p of a.prices) {
              priceRows.push({
                productVariantId: variantId,
                customerTypeId: p.customerTypeId,
                unitId: unitIds.get(p.unitKey)!,
                price: BigInt(p.price),
              });
            }
          }
          if (priceRows.length > 0) {
            await tx.price.createMany({
              data: priceRows.map((p) => ({
                id: uuidv7(),
                companyId,
                productId,
                createdByUserId: actor.userId,
                ...p,
              })),
            });
          }
        }
        return valid.reduce((sum, g) => sum + g.lines.length, 0);
      },
    };
  }
}
