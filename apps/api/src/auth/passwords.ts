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
