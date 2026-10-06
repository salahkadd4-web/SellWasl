// BR-TEN-03, BR-TEN-05 ; docs/modules.md

export const MODULE_CODES = [
  'PRE_SALES',
  'DELIVERY',
  'CASH_VAN',
  'WAREHOUSE',
  'ANALYTICS',
  /** Analyse des retours (phase 21) : activable par entreprise, hors des modes. */
  'RETURNS_ANALYSIS',
] as const;
export type ModuleCode = (typeof MODULE_CODES)[number];

export const SALES_MODES = ['PRE_SALES', 'CASH_VAN', 'MIXED'] as const;
export type SalesMode = (typeof SALES_MODES)[number];

/** Modules actifs pour chaque mode (BR-TEN-03). */
export const MODULES_BY_MODE: Record<SalesMode, readonly ModuleCode[]> = {
  PRE_SALES: ['PRE_SALES', 'DELIVERY', 'WAREHOUSE', 'ANALYTICS'],
  CASH_VAN: ['CASH_VAN', 'WAREHOUSE', 'ANALYTICS'],
  MIXED: ['PRE_SALES', 'DELIVERY', 'CASH_VAN', 'WAREHOUSE', 'ANALYTICS'],
};

export function modulesForMode(mode: SalesMode): readonly ModuleCode[] {
  return MODULES_BY_MODE[mode];
}

/** Secteurs, planning, journées et visites : actifs dès que PRE_SALES ou CASH_VAN l'est (BR-TEN-05). */
export function hasFieldFeatures(activeModules: readonly ModuleCode[]): boolean {
  return activeModules.includes('PRE_SALES') || activeModules.includes('CASH_VAN');
}
