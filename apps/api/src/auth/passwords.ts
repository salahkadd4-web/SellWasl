import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Mots de passe hachés en Argon2id (architecture §16). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

// Hash factice : vérifier un mot de passe prend le même temps, que le compte existe ou non.
let dummyHash: Promise<string> | null = null;

export async function verifyPassword(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hash('compte-inexistant');
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(passwordHash, password).catch(() => false);
}

/** Mot de passe provisoire lisible (sans 0/O ni 1/l), à changer à la première connexion. */
export function temporaryPassword(): string {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string) => set[randomInt(set.length)]!;
  return `${Array.from({ length: 4 }, () => pick(letters)).join('')}-${Array.from({ length: 4 }, () => pick(digits)).join('')}`;
}
