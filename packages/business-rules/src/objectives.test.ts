import { describe, expect, it } from 'vitest';
import { driverBonus } from './delivery';
import { objectiveProgress } from './field';
import { dailyObjectiveAmount } from './objectives';

/** Conditions des objectifs (BR-OBJ-05 à 07) : seuil du mois, objectif du jour payé à la semaine. */
describe('seuil minimum de l’objectif du mois (BR-OBJ-05)', () => {
  const base = { targetAmount: 1_000_000, bonusAmount: 10_000, capPercent: 120 };

  it('sous le seuil : aucune prime ; à partir du seuil : prime × taux, plafond inchangé', () => {
    expect(objectiveProgress({ ...base, realizedAmount: 550_000, minPercent: 60 })).toEqual({
      rate: 55,
      estimatedBonus: 0,
    });
    expect(objectiveProgress({ ...base, realizedAmount: 600_000, minPercent: 60 })).toEqual({
      rate: 60,
      estimatedBonus: 6000,
    });
    expect(objectiveProgress({ ...base, realizedAmount: 750_000, minPercent: 60 })).toEqual({
      rate: 75,
      estimatedBonus: 7500,
    });
    expect(
      objectiveProgress({ ...base, realizedAmount: 2_000_000, minPercent: 60 }).estimatedBonus,
    ).toBe(12_000);
  });

  it('juste sous le seuil (59,96 % affiché 60 %) : pas de prime', () => {
    expect(objectiveProgress({ ...base, realizedAmount: 599_600, minPercent: 60 })).toEqual({
      rate: 60,
      estimatedBonus: 0,
    });
  });

  it('sans seuil : calcul inchangé', () => {
    expect(objectiveProgress({ ...base, realizedAmount: 550_000, minPercent: null })).toEqual({
      rate: 55,
      estimatedBonus: 5500,
    });
  });

  it('livreur : score sous le seuil, aucune prime', () => {
    expect(driverBonus(10_000, 55, 60)).toBe(0);
    expect(driverBonus(10_000, 70, 60)).toBe(7000);
    expect(driverBonus(10_000, 55, null)).toBe(5500);
  });
});

describe('objectif du jour, payé à la semaine (BR-OBJ-06, BR-OBJ-07)', () => {
  // Cible 10 cartons par jour, prime 500 DA par jour, minimum 4 cartons, plafond 100 %
  const objective = { dailyTarget: 10, bonusAmount: 500, capPercent: 100, minQty: 4 };

  it('chaque jour : 0 sous le minimum, sinon prime × min(taux, plafond) ; la semaine en fait la somme', () => {
    const week = dailyObjectiveAmount(objective, [
      { date: '2027-06-05', qty: 3 },
      { date: '2027-06-06', qty: 6 },
      { date: '2027-06-07', qty: 12 },
      { date: '2027-06-08', qty: 4 },
    ]);
    expect(week.days).toEqual([
      { date: '2027-06-05', qty: 3, amount: 0 },
      { date: '2027-06-06', qty: 6, amount: 300 },
      { date: '2027-06-07', qty: 12, amount: 500 },
      { date: '2027-06-08', qty: 4, amount: 200 },
    ]);
    expect(week.amount).toBe(1000);
    expect(week.quantity).toBe(25);
  });

  it('plafond 120 % ; sans plafond ; sans minimum', () => {
    expect(
      dailyObjectiveAmount({ ...objective, capPercent: 120 }, [{ date: 'd', qty: 15 }]).amount,
    ).toBe(600);
    expect(
      dailyObjectiveAmount({ ...objective, capPercent: null }, [{ date: 'd', qty: 15 }]).amount,
    ).toBe(750);
    expect(
      dailyObjectiveAmount({ ...objective, minQty: null }, [{ date: 'd', qty: 1 }]).amount,
    ).toBe(50);
  });

  it('cible nulle ou jours vides : aucune prime', () => {
    expect(
      dailyObjectiveAmount({ ...objective, dailyTarget: 0 }, [{ date: 'd', qty: 9 }]).amount,
    ).toBe(0);
    expect(dailyObjectiveAmount(objective, [])).toEqual({ amount: 0, quantity: 0, days: [] });
  });
});
