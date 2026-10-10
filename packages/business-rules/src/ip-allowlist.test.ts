import { describe, expect, it } from 'vitest';
import { clientIp, ipAllowed, parseAllowlist, platformAccess } from './ip-allowlist';

describe('liste d’IP de la plateforme (phase 27)', () => {
  const rules = parseAllowlist(
    '198.51.100.4, 10.0.0.0/8, 2001:db8::/32, ::1, illisible, 1.2.3.4/40',
  );

  it('adresses et plages IPv4', () => {
    expect(ipAllowed('198.51.100.4', rules)).toBe(true);
    expect(ipAllowed('198.51.100.5', rules)).toBe(false);
    expect(ipAllowed('10.200.3.4', rules)).toBe(true);
    expect(ipAllowed('11.0.0.1', rules)).toBe(false);
    expect(ipAllowed('::ffff:10.1.2.3', rules)).toBe(true);
  });

  it('adresses et plages IPv6, entrées illisibles ignorées', () => {
    expect(rules).toHaveLength(4);
    expect(ipAllowed('2001:db8:1::5', rules)).toBe(true);
    expect(ipAllowed('2001:db9::1', rules)).toBe(false);
    expect(ipAllowed('::1', rules)).toBe(true);
    expect(ipAllowed('0:0:0:0:0:0:0:1', rules)).toBe(true);
    expect(ipAllowed('pas-une-ip', rules)).toBe(false);
    expect(ipAllowed(undefined, rules)).toBe(false);
  });

  it('liste vide : ouverte en développement, fermée en staging et en production', () => {
    expect(platformAccess({ NODE_ENV: 'development' })('203.0.113.1')).toBe(true);
    expect(platformAccess({ NODE_ENV: 'test', PLATFORM_ALLOWED_IPS: '' })('203.0.113.1')).toBe(
      true,
    );
    expect(platformAccess({ NODE_ENV: 'staging' })('127.0.0.1')).toBe(false);
    expect(platformAccess({ NODE_ENV: 'production' })('198.51.100.4')).toBe(false);
    const allow = platformAccess({ NODE_ENV: 'production', PLATFORM_ALLOWED_IPS: '198.51.100.4' });
    expect(allow('198.51.100.4')).toBe(true);
    expect(allow('198.51.100.40')).toBe(false);
  });

  it('IP du client derrière les proxys de confiance', () => {
    expect(clientIp('203.0.113.7', '10.0.0.2', 0)).toBe('10.0.0.2');
    expect(clientIp('203.0.113.7', '10.0.0.2', 1)).toBe('203.0.113.7');
    // Une adresse falsifiée ajoutée à gauche par le client n'est pas retenue
    expect(clientIp('6.6.6.6, 203.0.113.7', '10.0.0.2', 1)).toBe('203.0.113.7');
    expect(clientIp('6.6.6.6, 203.0.113.7, 10.0.0.9', '10.0.0.2', 2)).toBe('203.0.113.7');
    expect(clientIp(null, '10.0.0.2', 1)).toBe('10.0.0.2');
  });
});
