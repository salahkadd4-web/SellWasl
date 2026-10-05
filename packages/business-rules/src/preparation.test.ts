import { describe, expect, it } from 'vitest';
import { capBonus, defaultPrepared, launchBlockers } from './preparation';

describe('préparation', () => {
  const ok = {
    inProgressWorkdays: 0,
    pendingSyncDevices: 0,
    pendingLines: 0,
    hasDriver: true,
    hasTruck: true,
  };

  it('launchBlockers liste ce qui empêche le lancement, dans un ordre fixe (BR-PRE-02)', () => {
    expect(launchBlockers(ok)).toEqual([]);
    expect(
      launchBlockers({
        inProgressWorkdays: 1,
        pendingSyncDevices: 2,
        pendingLines: 3,
        hasDriver: false,
        hasTruck: false,
      }),
    ).toEqual(['WORKDAY_IN_PROGRESS', 'PENDING_SYNC', 'PENDING_LINES', 'NO_DRIVER', 'NO_TRUCK']);
    expect(launchBlockers({ ...ok, pendingLines: 1 })).toEqual(['PENDING_LINES']);
  });

  it('defaultPrepared : unités entières de la ligne couvertes par la réservation', () => {
    expect(defaultPrepared(45, 20)).toBe(2);
    expect(defaultPrepared(40, 20)).toBe(2);
    expect(defaultPrepared(0, 20)).toBe(0);
  });

  it('capBonus : un bonus ne dépasse pas ce qui a été préparé pour lui', () => {
    expect(capBonus(3, 1)).toBe(1);
    expect(capBonus(1, 3)).toBe(1);
  });
});
