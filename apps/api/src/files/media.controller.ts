import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { Public } from '../common/auth-context';
import { ImageStorageService } from './image-storage.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;
const TYPES = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;

/**
 * Photos gardées sur le disque quand Cloudinary n'est pas configuré (développement). Publiques,
 * comme le seraient les adresses Cloudinary : chaque nom est un identifiant imprévisible.
 */
@Controller('media')
export class MediaController {
  constructor(private readonly images: ImageStorageService) {}

  @Public()
  @Get(':companyId/:folder/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async get(
    @Param('companyId') companyId: string,
    @Param('folder') folder: string,
    @Param('file') file: string,
  ): Promise<StreamableFile> {
    const match = FILE.exec(file);
    if (!UUID.test(companyId) || !/^[a-z-]+$/.test(folder) || !match) throw new NotFoundException();
    try {
      const content = await this.images.readLocal(`${companyId}/${folder}/${file}`);
      return new StreamableFile(content, { type: TYPES[match[2] as keyof typeof TYPES] });
    } catch {
      throw new NotFoundException();
    }
  }
}
