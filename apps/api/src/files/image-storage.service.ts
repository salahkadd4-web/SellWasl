import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiError } from '../common/api-error';
import { uuidv7 } from '../common/uuid';
import { FileStorageService } from './file-storage.service';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadedImage {
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Adresses d'une photo : taille d'affichage et miniature pour les listes. */
export interface ImageUrls {
  url: string;
  thumbUrl: string;
  /** Version légère pour le téléphone (400 px, WebP), gardée hors connexion. */
  mobileUrl: string;
}

interface CloudinaryConfig {
  apiKey: string;
  apiSecret: string;
  cloudName: string;
}

/** Type réel du fichier, d'après ses premiers octets (le type annoncé ne suffit pas). */
export function sniffImage(buffer: Buffer): 'jpg' | 'png' | 'webp' | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'png';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'webp';
  return null;
}

/** Signature d'une requête Cloudinary : SHA-1 des paramètres triés, suivis du secret. */
export function cloudinarySignature(params: Record<string, string>, apiSecret: string): string {
  const payload = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return createHash('sha1')
    .update(payload + apiSecret)
    .digest('hex');
}

export function parseCloudinaryUrl(url: string | undefined): CloudinaryConfig | null {
  const match = url ? /^cloudinary:\/\/([^:]+):([^@]+)@([\w-]+)$/.exec(url) : null;
  return match ? { apiKey: match[1]!, apiSecret: match[2]!, cloudName: match[3]! } : null;
}

/**
 * Photos des produits. Avec CLOUDINARY_URL, les photos sont envoyées à Cloudinary, qui les
 * redimensionne et les convertit à la volée (WebP ou AVIF selon le téléphone). Sinon, elles sont
 * gardées telles quelles dans STORAGE_DIR et servies par l'API (`/media/...`).
 * La clé enregistrée en base indique le fournisseur : « cloudinary:v<version>/<id> » ou
 * « local:<chemin> ».
 */
@Injectable()
export class ImageStorageService {
  private readonly logger = new Logger(ImageStorageService.name);
  private readonly cloudinary: CloudinaryConfig | null;

  constructor(
    config: ConfigService,
    private readonly files: FileStorageService,
  ) {
    this.cloudinary = parseCloudinaryUrl(config.get<string>('CLOUDINARY_URL'));
  }

  /** Vérifie et enregistre une photo ; renvoie sa clé. */
  async save(companyId: string, folder: string, file: UploadedImage | undefined): Promise<string> {
    if (!file || file.size === 0) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Choisissez une photo.');
    }
    const type = sniffImage(file.buffer);
    if (!type) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'BUSINESS_RULE',
        'Format non accepté : envoyez une photo JPEG, PNG ou WebP.',
      );
    }
    const name = uuidv7();
    if (this.cloudinary) return this.uploadToCloudinary(companyId, folder, name, file.buffer, type);
    const path = `${companyId}/${folder}/${name}.${type}`;
    await this.files.put(`media/${path}`, file.buffer);
    return `local:${path}`;
  }

  private async uploadToCloudinary(
    companyId: string,
    folder: string,
    name: string,
    buffer: Buffer,
    type: string,
  ): Promise<string> {
    const { apiKey, apiSecret, cloudName } = this.cloudinary!;
    const params = {
      public_id: `sellwasl/${companyId}/${folder}/${name}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
    };
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: `image/${type === 'jpg' ? 'jpeg' : type}` }),
    );
    form.append('api_key', apiKey);
    form.append('signature', cloudinarySignature(params, apiSecret));
    for (const [k, v] of Object.entries(params)) form.append(k, v);

    const response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
      method: 'POST',
      body: form,
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      public_id?: string;
      version?: number;
      error?: { message?: string };
    } | null;
    if (!response?.ok || !body?.public_id) {
      this.logger.error(`Envoi Cloudinary refusé : ${body?.error?.message ?? response?.status}`);
      throw new ApiError(
        HttpStatus.BAD_GATEWAY,
        'STORAGE_ERROR',
        "La photo n'a pas pu être enregistrée. Réessayez dans un instant.",
      );
    }
    return `cloudinary:v${body.version}/${body.public_id}`;
  }

  /** Supprime une ancienne photo ; un échec est seulement journalisé. */
  async remove(key: string | null): Promise<void> {
    if (!key) return;
    try {
      if (key.startsWith('local:')) {
        await this.files.delete(`media/${key.slice('local:'.length)}`);
      } else if (key.startsWith('cloudinary:') && this.cloudinary) {
        const { apiKey, apiSecret, cloudName } = this.cloudinary;
        const publicId = key.slice('cloudinary:'.length).replace(/^v\d+\//, '');
        const params = { public_id: publicId, timestamp: String(Math.floor(Date.now() / 1000)) };
        const form = new FormData();
        form.append('api_key', apiKey);
        form.append('signature', cloudinarySignature(params, apiSecret));
        for (const [k, v] of Object.entries(params)) form.append(k, v);
        await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
          method: 'POST',
          body: form,
        });
      }
    } catch (error) {
      this.logger.warn(`Suppression de la photo ${key} impossible : ${String(error)}`);
    }
  }

  /** Adresses publiques d'une photo, d'après sa clé. */
  urls(key: string | null): ImageUrls | null {
    if (!key) return null;
    if (key.startsWith('local:')) {
      const url = `/api/v1/media/${key.slice('local:'.length)}`;
      return { url, thumbUrl: url, mobileUrl: url };
    }
    const cloud = this.cloudinary?.cloudName;
    const path = key.slice('cloudinary:'.length);
    if (!cloud) return null;
    const base = `https://res.cloudinary.com/${cloud}/image/upload`;
    return {
      url: `${base}/c_limit,w_800,h_800,f_auto,q_auto/${path}`,
      thumbUrl: `${base}/c_fill,w_160,h_160,f_auto,q_auto/${path}`,
      mobileUrl: `${base}/c_limit,w_400,h_400,f_webp,q_auto/${path}`,
    };
  }

  /** Photo locale, servie par l'API en développement. */
  readLocal(path: string): Promise<Buffer> {
    return this.files.get(`media/${path}`);
  }
}
