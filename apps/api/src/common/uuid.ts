import { randomBytes } from 'node:crypto';

/**
 * UUID v7 (RFC 9562) : 48 bits d'horodatage en millisecondes, puis de l'aléatoire.
 * Ordonnés dans le temps, ils gardent les index compacts (architecture §14).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ts = BigInt(now);
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(ts & 0xffn);
    ts >>= 8n;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variante RFC 9562
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
