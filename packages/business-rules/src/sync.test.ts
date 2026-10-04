import { describe, expect, it } from 'vitest';
import { isSameAction } from './sync';

describe('renvoi d’une action restée sans réponse', () => {
  it('reconnaît le même encaissement malgré un nouvel identifiant et un nouveau numéro', () => {
    const sent = {
      type: 'payment.debt',
      payload: { paymentId: 'p1', number: 'V07-B0001', customerId: 'c1', amount: 3000 },
    };
    const retry = {
      type: 'payment.debt',
      payload: { paymentId: 'p2', number: 'V07-B0002', customerId: 'c1', amount: 3000 },
    };
    expect(isSameAction(sent, retry)).toBe(true);
    expect(isSameAction(sent, { ...retry, payload: { ...retry.payload, customerId: 'c2' } })).toBe(
      false,
    );
    expect(isSameAction(sent, { ...retry, payload: { ...retry.payload, amount: 2000 } })).toBe(
      false,
    );
  });

  it('reconnaît le même nouveau client et la même visite', () => {
    const client = {
      name: 'Kiosque',
      customerTypeId: 't',
      latitude: 35.69,
      longitude: -0.63,
      frequency: 'WEEKLY',
    };
    expect(
      isSameAction(
        { type: 'customer.create', payload: { customerId: 'a', ...client } },
        { type: 'customer.create', payload: { customerId: 'b', ...client } },
      ),
    ).toBe(true);
    expect(
      isSameAction(
        { type: 'visit.start', payload: { visitId: 'v1', customerId: 'c1', mode: 'ON_SITE' } },
        { type: 'visit.start', payload: { visitId: 'v2', customerId: 'c1', mode: 'ON_SITE' } },
      ),
    ).toBe(true);
  });

  it('distingue deux types différents', () => {
    expect(
      isSameAction(
        { type: 'workday.start', payload: { workdayId: 'w', date: '2026-10-03' } },
        { type: 'workday.close', payload: { workdayId: 'w' } },
      ),
    ).toBe(false);
  });
});
