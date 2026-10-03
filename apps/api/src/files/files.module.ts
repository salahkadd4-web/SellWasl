import { Global, Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { ImageStorageService } from './image-storage.service';
import { MediaController } from './media.controller';

/** Fichiers : imports CSV et photos (Cloudinary ou disque). */
@Global()
@Module({
  controllers: [MediaController],
  providers: [FileStorageService, ImageStorageService],
  exports: [FileStorageService, ImageStorageService],
})
export class FilesModule {}
