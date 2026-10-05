import { describe, expect, it } from 'vitest';
import {
  driverBonus,
  driverScore,
  minimumCash,
  returnRate,
  shouldReschedule,
  tierScore,
} from './delivery';

describe('livraison', () => {
  it('minimumCash : tout sans crédit, le dépassement du plafond avec crédit (BR-PAY-03)', () => {
    expect(minimumCash({ due: 10000, isCreditAllowed: false, creditLimit: 0, debt: 0 })).toBe(
      10000,
    );
    // Plafond 20 000, dette 15 000 : 5 000 de crédit possible → 5 000 à encaisser au minimum
    expect(
      minimumCash({ due: 10000, isCreditAllowed: true, creditLimit: 20000, debt: 15000 }),
    ).toBe(5000);
    expect(minimumCash({ due: 10000, isCreditAllowed: true, creditLimit: 50000, debt: 0 })).toBe(0);
    // Dette déjà au-delà du plafond : tout le dû
    expect(
      minimumCash({ due: 10000, isCreditAllowed: true, creditLimit: 20000, debt: 25000 }),
    ).toBe(10000);
  });

  it('shouldReschedule : premier échec reportable, si P-05 (BR-LIV-06)', () => {
    const base = { attempt: 1, rescheduleEnabled: true };
    expect(shouldReschedule({ ...base, reasonCode: 'CUSTOMER_ABSENT' })).toBe(true);
    expect(shouldReschedule({ ...base, reasonCode: 'STORE_CLOSED' })).toBe(true);
    expect(shouldReschedule({ ...base, reasonCode: 'NOT_DELIVERED' })).toBe(true);
    expect(shouldReschedule({ ...base, reasonCode: 'REFUSED' })).toBe(false);
    expect(shouldReschedule({ ...base, reasonCode: null })).toBe(false);
    expect(shouldReschedule({ ...base, attempt: 2, reasonCode: 'CUSTOMER_ABSENT' })).toBe(false);
    expect(
      shouldReschedule({ attempt: 1, rescheduleEnabled: false, reasonCode: 'CUSTOMER_ABSENT' }),
    ).toBe(false);
  });

  it('returnRate : retourné ÷ chargé, au dixième ; rien de chargé → null', () => {
    expect(returnRate(400, 18)).toBe(4.5);
    expect(returnRate(300, 1)).toBe(0.3);
    expect(returnRate(0, 0)).toBeNull();
  });

  it('tierScore : premier palier atteint ; au-delà ou sans taux → 0', () => {
    const tiers = [
      { maxRate: 5, score: 100 },
      { maxRate: 8, score: 70 },
      { maxRate: 12, score: 40 },
    ];
    expect(tierScore(4.5, tiers)).toBe(100);
    expect(tierScore(5, tiers)).toBe(100);
    expect(tierScore(7.9, tiers)).toBe(70);
    expect(tierScore(12, tiers)).toBe(40);
    expect(tierScore(12.1, tiers)).toBe(0);
    expect(tierScore(null, tiers)).toBe(0);
  });

  it('driverScore et driverBonus : somme pondérée, notes sur 10', () => {
    // Taux de retour 60 % du score (palier 70), propreté 25 % (8/10), ponctualité 15 % (10/10)
    const score = driverScore({
      returnWeight: 60,
      returnScore: 70,
      criteria: [
        { weight: 25, rating: 8 },
        { weight: 15, rating: 10 },
      ],
    });
    expect(score).toBe(77);
    expect(driverBonus(12000, score)).toBe(9240);
    expect(driverScore({ returnWeight: 100, returnScore: 100, criteria: [] })).toBe(100);
  });
});
