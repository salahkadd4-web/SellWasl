import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stockage des fichiers (imports CSV). En attendant le stockage objet compatible S3
 * (architecture §13), les fichiers sont écrits sur le disque du serveur, dans STORAGE_DIR.
 * Les clés sont préfixées par l'entreprise.
 */
@Injectable()
export class FileStorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('STORAGE_DIR') ?? 'storage');
  }

  private path(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root)) throw new Error(`Clé de fichier invalide : ${key}`);
    return path;
  }

  async put(key: string, content: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
}
