import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Deuxième facteur des comptes plateforme (phase 27) : codes TOTP de la RFC 6238, compatibles
 * avec Google Authenticator, Microsoft Authenticator, etc. — HMAC-SHA1, 6 chiffres, pas de 30 s.
 */
const STEP_MS = 30_000;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Secret base32 illisible.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Nouveau secret de 160 bits, en base32. */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Code à 6 chiffres d'un pas de temps (RFC 4226 §5.3). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Pas du code s'il est juste (tolérance d'un pas avant ou après, pour l'horloge du téléphone),
 * sinon null. Un pas déjà utilisé, ou plus ancien, est refusé : un code ne sert qu'une fois.
 */
export function verifyTotp(
  secret: string,
  code: string,
  now: number,
  lastStep: number | null,
): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / STEP_MS);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

/** URI d'enrôlement, affichée en QR code par l'écran de connexion de la plateforme. */
export function otpauthUri(email: string, secret: string): string {
  const label = `SellWasl:${encodeURIComponent(email)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=SellWasl&algorithm=SHA1&digits=6&period=30`;
}
