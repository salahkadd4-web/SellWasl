import { addDaysTo, isCustomerDue, weekdayOf } from '@sellwasl/business-rules';
import type {
  CompanyUser,
  CustomerDto,
  Page,
  PlanningCalendarDay,
  PlanningDay,
  RescheduleDto,
  TerritoryDto,
} from '@sellwasl/validation';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, startApp, type TestApp, webLogin } from './helpers';

/** Prochain jour ouvré (samedi à jeudi) au moins `days` jours après aujourd'hui. */
function futureWorkingDay(days: number, weekday?: string): string {
  let date = addDaysTo(new Date().toISOString().slice(0, 10), days);
  while (weekdayOf(date) === 'FRI' || (weekday && weekdayOf(date) !== weekday))
    date = addDaysTo(date, 1);
  return date;
}

/** Phase 14 : clients du jour et reprogrammations (BR-PLA-01 à BR-PLA-07, UC-54). */
describe('planification des visites', () => {
  let t: TestApp;
  let sup: string;
  let admin: string;
  let seller: CompanyUser;
  let territory: TerritoryDto;

  beforeAll(async () => {
    t = await startApp();
    sup = await webLogin(t.url, 'DISTRI-ORAN', 'A-SUP');
    admin = await webLogin(t.url, 'DISTRI-ORAN', 'A-ADM');
    const users = await call<CompanyUser[]>(t.url, 'GET', '/users', { token: sup });
    seller = users.body.find((u) => u.code === 'V08')!;
    const territories = await call<TerritoryDto[]>(t.url, 'GET', '/territories', { token: sup });
    territory = territories.body.find((x) => x.code === '3102')!;
  });
  afterAll(() => t.close());

  const day = (date: string) =>
    call<PlanningDay>(t.url, 'GET', `/planning/day?userId=${seller.id}&date=${date}`, {
      token: sup,
    });

  it('calcule la liste du jour comme le téléphone (BR-PLA-02)', async () => {
    // Samedi 3 octobre 2026 : partie 1 du secteur 3102
    const saturday = await day('2026-10-03');
    expect(saturday.body).toMatchObject({
      status: 'WORKING',
      territory: { code: '3102' },
      part: { name: 'Partie 1' },
    });
    const part1 = territory.parts.find((p) => p.number === 1)!;
    const customers = await call<Page<CustomerDto>>(
      t.url,
      'GET',
      `/customers?partId=${part1.id}&limit=50`,
      { token: sup },
    );
    const calendar = {
      workingDays: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'] as const,
      holidays: [],
      partByWeekday: { SAT: part1.id },
    };
    const expected = customers.body.data
      .filter((c) =>
        isCustomerDue(
          {
            id: c.id,
            partId: c.part?.id ?? null,
            frequency: c.frequency,
            referenceDate: c.referenceDate,
            isActive: c.status === 'ACTIVE',
          },
          '2026-10-03',
          calendar,
        ),
      )
      .map((c) => c.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(saturday.body.customers.map((c) => c.id).sort()).toEqual(expected);
    expect(saturday.body.customers.every((c) => c.reason === 'SCHEDULED')).toBe(true);

    // Vendredi chômé : pas de clients du jour (BR-PLA-04)
    const friday = await day('2026-10-09');
    expect(friday.body).toMatchObject({ status: 'NON_WORKING', part: null, customers: [] });
  });

  it('donne le calendrier des 14 prochains jours', async () => {
    const calendar = await call<PlanningCalendarDay[]>(
      t.url,
      'GET',
      `/planning/calendar?userId=${seller.id}&from=2026-10-03&days=14`,
      { token: sup },
    );
    expect(calendar.body).toHaveLength(14);
    expect(calendar.body[0]).toMatchObject({ date: '2026-10-03', partName: 'Partie 1' });
    const fridays = calendar.body.filter((d) => weekdayOf(d.date) === 'FRI');
    expect(fridays.every((d) => d.status === 'NON_WORKING' && d.count === 0)).toBe(true);
    // Chaque client de la semaine est vu au moins une fois en 14 jours
    expect(calendar.body.reduce((s, d) => s + d.count, 0)).toBeGreaterThanOrEqual(30);
  });

  it('reprogramme un client à une date précise, sans changer sa fréquence (BR-PLA-05)', async () => {
    const date = futureWorkingDay(7, 'SUN');
    const list = await day(date);
    const part1 = territory.parts.find((p) => p.number === 1)!;
    const customers = await call<Page<CustomerDto>>(
      t.url,
      'GET',
      `/customers?partId=${part1.id}&limit=5`,
      { token: sup },
    );
    // Un client de la partie 1 (samedi) n'est jamais du jour un dimanche
    const customer = customers.body.data[0]!;
    expect(list.body.customers.some((c) => c.id === customer.id)).toBe(false);

    const created = await call<RescheduleDto>(
      t.url,
      'POST',
      `/customers/${customer.id}/reschedules`,
      { token: sup, body: { date } },
    );
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ date, customer: { id: customer.id } });
    const after = await day(date);
    expect(after.body.customers.find((c) => c.id === customer.id)?.reason).toBe('RESCHEDULED');

    const twice = await call(t.url, 'POST', `/customers/${customer.id}/reschedules`, {
      token: sup,
      body: { date },
    });
    expect(twice.status).toBe(409);
    const listed = await call<RescheduleDto[]>(
      t.url,
      'GET',
      `/planning/reschedules?userId=${seller.id}`,
      { token: sup },
    );
    expect(listed.body.some((r) => r.customer.id === customer.id && r.date === date)).toBe(true);

    // Annulation, puis nouvelle reprogrammation au même jour
    expect(
      (await call(t.url, 'DELETE', `/customers/${customer.id}/reschedules/${date}`, { token: sup }))
        .status,
    ).toBe(204);
    expect((await day(date)).body.customers.some((c) => c.id === customer.id)).toBe(false);
    const again = await call(t.url, 'POST', `/customers/${customer.id}/reschedules`, {
      token: sup,
      body: { date },
    });
    expect(again.status).toBe(201);
    await call(t.url, 'DELETE', `/customers/${customer.id}/reschedules/${date}`, { token: sup });
  });

  it('refuse un jour passé, chômé ou férié (BR-PLA-04)', async () => {
    const customer = (
      await call<Page<CustomerDto>>(t.url, 'GET', '/customers?limit=1', { token: sup })
    ).body.data[0]!;
    const post = (date: string, token = sup) =>
      call(t.url, 'POST', `/customers/${customer.id}/reschedules`, { token, body: { date } });

    expect((await post('2020-01-04')).status).toBe(422);
    expect(
      (await post(futureWorkingDay(3, 'THU').replace(/.*/, (d) => addDaysTo(d, 1)))).status,
    ).toBe(422);

    const holidayDate = futureWorkingDay(20, 'MON');
    const holiday = await call<{ id: string }>(t.url, 'POST', '/holidays', {
      token: admin,
      body: { date: holidayDate, label: 'Fête de test' },
    });
    try {
      expect((await post(holidayDate)).status).toBe(422);
      expect((await day(holidayDate)).body).toMatchObject({
        status: 'HOLIDAY',
        holiday: 'Fête de test',
        customers: [],
      });
    } finally {
      await call(t.url, 'DELETE', `/holidays/${holiday.body.id}`, { token: admin });
    }

    const accountant = await webLogin(t.url, 'DISTRI-ORAN', 'A-CPT');
    expect((await post(futureWorkingDay(7), accountant)).status).toBe(403);
  });
});
