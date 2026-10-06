import type { LocalState } from './local-state';
import type { OutboxOp } from './types';

/** Effet local d'une opération sur la vue (spec phase 23 §4.4). */
export type Effect = (s: LocalState, payload: Record<string, unknown>, op: OutboxOp) => void;

export const str = (v: unknown) => (typeof v === 'string' ? v : null);
export const num = (v: unknown) => (typeof v === 'number' ? v : null);
