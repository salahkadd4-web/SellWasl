import { HttpStatus, type PipeTransform } from '@nestjs/common';
import { z, type ZodType } from 'zod';
import { ApiError } from './api-error';

/** Valide le corps d'une requête avec un schéma Zod partagé (packages/validation). */
export class ZodValidationPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> {
  /** Lu aussi par la documentation OpenAPI (phase 25). */
  constructor(readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Données invalides.', {
        fields: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}
