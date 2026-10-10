import type { ErrorEvent } from '@sentry/nestjs';
import { describe, expect, it } from 'vitest';
import { initSentry, scrubEvent } from '../src/common/sentry';

/** Erreurs envoyées à Sentry, sans données personnelles ni secrets (phase 27). */
describe('Sentry', () => {
  it('sans SENTRY_DSN, rien n’est initialisé', () => {
    expect(initSentry({ NODE_ENV: 'production' })).toBe(false);
  });

  it('l’événement envoyé ne contient ni corps, ni en-tête d’authentification, ni cookie, ni e-mail', () => {
    const event = {
      request: {
        url: '/api/v1/auth/login',
        method: 'POST',
        data: '{"login":"A-SUP","password":"SellWasl@2026"}',
        cookies: { sw_rt: 'jeton-de-rafraichissement' },
        headers: {
          authorization: 'Bearer eyJhbGciOi',
          cookie: 'sw_rt=jeton',
          'user-agent': 'Navigateur',
        },
        query_string: 'refreshToken=abc',
      },
      user: { id: 'u1', email: 'ali@test.dz', ip_address: '203.0.113.7', username: 'Ali' },
      extra: { body: { password: 'x' } },
    } as unknown as ErrorEvent;
    const clean = scrubEvent(event)!;
    const text = JSON.stringify(clean);
    for (const secret of [
      'SellWasl@2026',
      'jeton',
      'eyJhbGciOi',
      'ali@test.dz',
      'refreshToken',
      'Ali',
    ])
      expect(text).not.toContain(secret);
    expect(clean.user).toEqual({ id: 'u1' });
    expect(clean.request?.url).toBe('/api/v1/auth/login');
    expect(clean.request?.headers?.['user-agent']).toBe('Navigateur');
  });
});
