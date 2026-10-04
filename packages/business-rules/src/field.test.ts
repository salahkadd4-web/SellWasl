import { describe, expect, it } from 'vitest';
import { objectiveProgress, paymentNumber, visitCounters } from './field';
import { distanceMeters } from './geo';

describe('terrain', () => {
  it('mesure la distance entre deux points (haversine)', () => {
    const oran = { latitude: 35.6971, longitude: -0.6308 };
    expect(distanceMeters(oran, oran)).toBe(0);
    // 0,001° de latitude ≈ 111 m
    expect(distanceMeters(oran, { latitude: 35.6981, longitude: -0.6308 })).toBe(111);
  });

  it('compte x/N et les visites hors programme, une fois par client (BR-VIS-06 à 08)', () => {
    const day = ['A', 'B', 'C'];
    const visits = [
      { customerId: 'A', status: 'COMPLETED' },
      { customerId: 'A', status: 'COMPLETED' },
      { customerId: 'B', status: 'IN_PROGRESS' },
      { customerId: 'X', status: 'COMPLETED' },
      { customerId: 'X', status: 'COMPLETED' },
      { customerId: 'C', status: 'MISSED' },
    ];
    expect(visitCounters(day, visits)).toEqual({ visited: 1, planned: 3, outOfProgram: 1 });
  });

  it('calcule le taux et la prime plafonnée (BR-OBJ-03)', () => {
    expect(
      objectiveProgress({
        targetAmount: 3_200_000,
        realizedAmount: 1_984_000,
        bonusAmount: 12_000,
        capPercent: 120,
      }),
    ).toEqual({ rate: 62, estimatedBonus: 7440 });
    expect(
      objectiveProgress({
        targetAmount: 1000,
        realizedAmount: 2000,
        bonusAmount: 10_000,
        capPercent: 120,
      }),
    ).toEqual({ rate: 200, estimatedBonus: 12_000 });
    expect(
      objectiveProgress({
        targetAmount: 0,
        realizedAmount: 0,
        bonusAmount: 10_000,
        capPercent: 120,
      }),
    ).toEqual({ rate: 0, estimatedBonus: 0 });
  });

  it('numérote les reçus : code + série + séquence (ARC-11)', () => {
    expect(paymentNumber('V07', 'B', 42)).toBe('V07-B0042');
  });
});
