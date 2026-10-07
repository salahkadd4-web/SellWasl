import { Injectable } from '@nestjs/common';
import type { OfflineKind } from '@sellwasl/validation';
import type { AuthUser } from '../common/auth-context';

/** Ce que reçoit la construction d'une sorte de données (spec phase 23 §3.2). */
export interface KindContext {
  actor: AuthUser;
  /** Curseur du téléphone : transactions à partir de laquelle les lignes ont changé. */
  cursor: bigint;
  /** Date du téléphone (AAAA-MM-JJ). */
  date: string;
  /** Toute la sorte est demandée (réception complète, ou une table « complète » a changé). */
  full: boolean;
}

export interface KindRow {
  id: string;
  data: unknown;
  deleted?: boolean;
}

/** Délégués Prisma (noms de modèles en camelCase) dont un changement fait renvoyer la sorte. */
export type SourceModel =
  | 'bonusRule'
  | 'customer'
  | 'customerReschedule'
  | 'customerType'
  | 'delivery'
  | 'deliveryRoute'
  | 'holiday'
  | 'load'
  | 'loadLine'
  | 'notification'
  | 'objective'
  | 'order'
  | 'orderLine'
  | 'partSchedule'
  | 'payment'
  | 'price'
  | 'priceTier'
  | 'product'
  | 'productCategory'
  | 'productRange'
  | 'productUnit'
  | 'productVariant'
  | 'quota'
  | 'reason'
  | 'stock'
  | 'territory'
  | 'territoryPart'
  | 'user'
  | 'visit'
  | 'warehouse'
  | 'workday';

export interface KindDef {
  kind: OfflineKind;
  roles: readonly string[];
  /**
   * « set » : la sorte entière, renvoyée quand une table source a changé et remplacée sur le
   * téléphone. « rows » : seulement les lignes changées depuis le curseur (avec suppressions) ;
   * une table de `full` qui change fait renvoyer toute la sorte.
   */
  mode: 'set' | 'rows';
  /** Aucune source : la sorte est renvoyée à chaque réception (une ligne, calculée). */
  sources: readonly SourceModel[];
  /** Mode « rows » : tables dont un changement fait renvoyer toute la sorte. */
  full?: readonly SourceModel[];
  load(ctx: KindContext): Promise<KindRow[]>;
}

/** Registre des sortes : chaque domaine inscrit les siennes au démarrage (sync/kinds). */
@Injectable()
export class SyncKinds {
  private readonly defs = new Map<OfflineKind, KindDef>();

  register(def: KindDef): void {
    this.defs.set(def.kind, def);
  }

  get(kind: OfflineKind): KindDef | undefined {
    return this.defs.get(kind);
  }
}
