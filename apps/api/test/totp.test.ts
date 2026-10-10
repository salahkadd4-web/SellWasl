import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/common/crypto';
import {
  base32Decode,
  base32Encode,
  generateSecret,
  otpauthUri,
  totpCode,
  verifyTotp,
} from '../src/auth/totp';

/** Chiffrement des données sensibles et deuxième facteur (phase 27). */
describe('chiffrement AES-256-GCM', () => {
  const key = randomBytes(32);

  it('aller-retour, et un chiffré différent à chaque fois', () => {
    const a = encrypt('JBSWY3DPEHPK3PXP', key);
    const b = encrypt('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decrypt(a, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('altération ou mauvaise clé : refusé', () => {
    const sealed = encrypt('secret', key);
    const parts = sealed.split(':');
    const tampered = [...parts.slice(0, 3), Buffer.from('autre').toString('base64')].join(':');
    expect(() => decrypt(tampered, key)).toThrow();
    expect(() => decrypt(sealed, randomBytes(32))).toThrow();
  });
});

describe('TOTP (RFC 6238)', () => {
  // Secret des vecteurs de test de la RFC : « 12345678901234567890 » en ASCII
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('base32 aller-retour', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('vecteurs de la RFC (6 derniers chiffres)', () => {
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('vérification : pas voisin accepté, rejeu et code faux refusés', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpCode(secret, step), now, null)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now, null)).toBeNull();
    // Rejeu : un pas déjà utilisé (ou plus ancien) est refusé
    expect(verifyTotp(secret, totpCode(secret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, '000000', now, null)).toBeNull();
    expect(verifyTotp(secret, 'abc', now, null)).toBeNull();
  });

  it('secret de 160 bits et URI d’enrôlement', () => {
    const s = generateSecret();
    expect(base32Decode(s)).toHaveLength(20);
    const uri = otpauthUri('admin@sellwasl.test', s);
    expect(uri).toMatch(/^otpauth:\/\/totp\/SellWasl:admin%40sellwasl\.test\?/);
    expect(uri).toContain(`secret=${s}`);
    expect(uri).toContain('issuer=SellWasl');
  });
});
