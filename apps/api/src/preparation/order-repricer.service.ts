import { Injectable } from '@nestjs/common';
import { RepriceError, repriceOrder } from '@sellwasl/business-rules';
import { PricingService } from '../catalog/pricing.service';
import { dateOnly, rule } from '../field/field-errors';

export interface RepriceNormal {
  id: string;
  variantId: string;
  unitId: string;
  unitPrice: bigint;
  /** Quantité retenue (préparée ou livrée), dans l'unité de la ligne. */
  qty: number;
}

export interface RepriceBonus {
  id: string;
  bonusRuleId: string | null;
  variantId: string;
  /** Plafond : ce qui a été préparé pour ce bonus, dans son unité. */
  maxQty: number;
}

export interface RepriceAdded {
  variantId: string;
  unitId: string;
  qty: number;
}

export interface RepriceResult {
  /** Prix unitaire de chaque ligne normale. */
  prices: Map<string, bigint>;
  /** Quantité offerte de chaque ligne bonus. */
  bonus: Map<string, number>;
  /** Produits ajoutés sur une nouvelle ligne, chiffrés. */
  added: (RepriceAdded & { productId: string; unitPrice: bigint })[];
}

/**
 * Prix d'une commande dont les quantités changent (BR-CAT-10) : la règle est partagée avec le
 * téléphone (`repriceOrder`, business-rules) ; ici, la grille du type du client et les montants en
 * BigInt de la base.
 */
@Injectable()
export class OrderRepricer {
  constructor(private readonly pricing: PricingService) {}

  async reprice(
    order: { customerTypeId: string; orderDate: Date },
    normals: RepriceNormal[],
    bonuses: RepriceBonus[],
    added: RepriceAdded[],
    recalculate: boolean,
  ): Promise<RepriceResult> {
    if (!recalculate && added.length === 0)
      return {
        prices: new Map(normals.map((l) => [l.id, l.unitPrice])),
        bonus: new Map(bonuses.map((b) => [b.id, b.maxQty])),
        added: [],
      };
    const catalog = await this.pricing.pricingCatalog(order.customerTypeId);
    try {
      const r = repriceOrder(
        catalog,
        { customerTypeId: order.customerTypeId, date: dateOnly(order.orderDate) },
        normals.map((l) => ({ ...l, unitPrice: Number(l.unitPrice) })),
        bonuses,
        added,
        recalculate,
      );
      return {
        prices: new Map([...r.prices].map(([id, price]) => [id, BigInt(price)])),
        bonus: r.bonus,
        added: r.added.map((a) => ({ ...a, unitPrice: BigInt(a.unitPrice) })),
      };
    } catch (error) {
      if (error instanceof RepriceError) throw rule(error.message);
      throw error;
    }
  }
}
