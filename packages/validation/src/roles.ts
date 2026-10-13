// Permissions du superviseur réglées par l'administrateur (docs/rbac.md §7 bis)
import { z } from 'zod';

export const supervisorPermissionsSchema = z.object({
  permissions: z.array(z.string().min(1).max(100)).max(300),
});
export type SupervisorPermissionsInput = z.infer<typeof supervisorPermissionsSchema>;

export interface SupervisorPermissionsDto {
  /** Permissions actuelles du superviseur. */
  granted: string[];
  /** Permissions que l'administrateur peut accorder, avec leur libellé. */
  delegable: { code: string; description: string }[];
  /** Permissions par défaut du superviseur (bouton « Par défaut »), selon les paramètres. */
  defaults: string[];
}
