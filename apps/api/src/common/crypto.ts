import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Chiffrement des données sensibles en base (phase 27) : AES-256-GCM, vecteur aléatoire à chaque
 * fois ; « v1:<iv>:<tag>:<chiffré> » en base64. Une altération est détectée au déchiffrement.
 */
export function encrypt(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64')))
    .join(':');
}

export function decrypt(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Chiffré illisible.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

/** Chiffrement avec la clé de l'environnement (DATA_ENCRYPTION_KEY, config/env.ts). */
@Injectable()
export class DataCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('DATA_ENCRYPTION_KEY'), 'base64');
  }

  encrypt(plain: string): string {
    return encrypt(plain, this.key);
  }

  decrypt(sealed: string): string {
    return decrypt(sealed, this.key);
  }
}
