import { createHash } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileStorageService } from '../src/files/file-storage.service';
import {
  cloudinarySignature,
  ImageStorageService,
  parseCloudinaryUrl,
  sniffImage,
} from '../src/files/image-storage.service';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const COMPANY = '01a10360-7309-716e-8971-d1922031c05e';

function service(url?: string) {
  const config = { get: () => url } as unknown as ConfigService;
  return new ImageStorageService(config, {} as FileStorageService);
}

/** Photos sur Cloudinary, sans appel réel : l'API de Cloudinary est simulée. */
describe('photos sur Cloudinary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lit l’adresse Cloudinary et reconnaît les images par leur contenu', () => {
    expect(parseCloudinaryUrl('cloudinary://123:abc@demo')).toEqual({
      apiKey: '123',
      apiSecret: 'abc',
      cloudName: 'demo',
    });
    expect(parseCloudinaryUrl('https://example.com')).toBeNull();
    expect(sniffImage(PNG)).toBe('png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
  });

  it('signe les paramètres triés suivis du secret', () => {
    const expected = createHash('sha1')
      .update('public_id=a/b&timestamp=1700000000secret')
      .digest('hex');
    expect(cloudinarySignature({ timestamp: '1700000000', public_id: 'a/b' }, 'secret')).toBe(
      expected,
    );
  });

  it('envoie la photo signée et construit les adresses redimensionnées', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const form = init.body as FormData;
      expect(form.get('api_key')).toBe('123');
      expect(String(form.get('public_id'))).toMatch(
        new RegExp(`^sellwasl/${COMPANY}/products/[0-9a-f-]{36}$`),
      );
      const params = {
        public_id: String(form.get('public_id')),
        timestamp: String(form.get('timestamp')),
      };
      expect(form.get('signature')).toBe(cloudinarySignature(params, 'abc'));
      return new Response(JSON.stringify({ public_id: params.public_id, version: 42 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const images = service('cloudinary://123:abc@demo');
    const key = await images.save(COMPANY, 'products', {
      mimetype: 'image/png',
      size: PNG.length,
      buffer: PNG,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.cloudinary.com/v1_1/demo/image/upload');
    expect(key).toMatch(/^cloudinary:v42\/sellwasl\//);
    const urls = images.urls(key)!;
    expect(urls.url).toMatch(
      /^https:\/\/res\.cloudinary\.com\/demo\/image\/upload\/c_limit,w_800,h_800,f_auto,q_auto\/v42\/sellwasl\//,
    );
    expect(urls.thumbUrl).toContain('/c_fill,w_160,h_160,f_auto,q_auto/v42/');
  });

  it('signale un refus de Cloudinary sans laisser une photo à moitié enregistrée', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'Invalid Signature' } }), {
            status: 401,
          }),
      ),
    );
    await expect(
      service('cloudinary://123:abc@demo').save(COMPANY, 'products', {
        mimetype: 'image/png',
        size: PNG.length,
        buffer: PNG,
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
});
