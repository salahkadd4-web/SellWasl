// BR-ORG-01 à BR-ORG-07 ; docs/api.md §5.3 ; docs/territories.md
import { z } from 'zod';
import type { TerritoryOption } from './customers';
import { weekdaySchema, type Weekday } from './settings';

const code = z
  .string()
  .trim()
  .min(1, 'Code obligatoire')
  .max(20)
  .transform((v) => v.toUpperCase());

const territoryFields = {
  code,
  name: z.string().trim().min(1, 'Nom obligatoire').max(80),
  /** Types de clients servis (BR-ORG-01, BR-ORG-03). */
  customerTypeIds: z.array(z.uuid()).min(1, 'Choisissez au moins un type de client').max(20),
  sellerUserId: z.uuid().nullable(),
  deliveryUserId: z.uuid().nullable(),
  /** Nombre de parties prévues (BR-ORG-02). */
  partCount: z.number().int().min(1).max(30),
  isActive: z.boolean(),
};

export const createTerritorySchema = z.object({
  ...territoryFields,
  sellerUserId: territoryFields.sellerUserId.default(null),
  deliveryUserId: territoryFields.deliveryUserId.default(null),
  partCount: territoryFields.partCount.default(6),
  isActive: territoryFields.isActive.default(true),
});
export const updateTerritorySchema = z.object(territoryFields).partial();

/** Polygone GeoJSON, coordonnées [longitude, latitude] ; vérifié par business-rules. */
const polygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z
    .array(z.array(z.array(z.number()).min(2).max(3)).max(2000))
    .min(1)
    .max(5),
});

export const territoryPartsSchema = z.object({
  /** Toutes les parties du secteur : une partie absente est supprimée. */
  parts: z
    .array(
      z.object({
        number: z.number().int().min(1).max(30),
        name: z.string().trim().min(1).max(60),
        geojson: polygonSchema,
      }),
    )
    .max(30),
});
export type TerritoryPartsInput = z.input<typeof territoryPartsSchema>;

export const territoryScheduleSchema = z.object({
  /** Partie visitée chaque jour de la semaine ; null : aucune (BR-ORG-07). */
  days: z.array(z.object({ weekday: weekdaySchema, partId: z.uuid().nullable() })).max(7),
});

export const assignCustomersSchema = z.object({
  customerIds: z.array(z.uuid()).min(1).max(2000),
  /** Partie imposée à ces clients ; null : retour au calcul automatique (BR-ORG-04). */
  partId: z.uuid().nullable(),
});

export interface TerritoryPartDto {
  id: string;
  number: number;
  name: string;
  geojson: { type: 'Polygon'; coordinates: number[][][] };
  customerCount: number;
}

export interface TerritoryDto extends TerritoryOption {
  partCount: number;
  isActive: boolean;
  customerTypes: { id: string; name: string }[];
  seller: { id: string; code: string; name: string } | null;
  deliveryUser: { id: string; code: string; name: string } | null;
  parts: TerritoryPartDto[];
  schedule: { weekday: Weekday; partId: string }[];
  customerCount: number;
  outOfPartCount: number;
}

export interface TerritoryOverlap {
  /** Deux parties d'un même secteur, ou de deux secteurs qui servent un même type. */
  kind: 'SAME_TERRITORY' | 'SAME_CUSTOMER_TYPE';
  a: { territoryId: string; territoryCode: string; partId: string | null; partName: string };
  b: { territoryId: string; territoryCode: string; partId: string | null; partName: string };
  customerTypes: string[];
}

/** Effet d'un enregistrement des parties, montré avant confirmation (BR-ORG-06). */
export interface PartsChangeResult {
  applied: boolean;
  moved: { customerId: string; name: string; from: string; to: string }[];
  /** Chevauchements avec des secteurs qui servent un même type : signalés, non bloquants. */
  overlaps: TerritoryOverlap[];
  removedParts: string[];
}

/** Client sur la carte. */
export interface CustomerPosition {
  id: string;
  name: string;
  code: string | null;
  latitude: number;
  longitude: number;
  customerTypeId: string;
  territoryId: string | null;
  partId: string | null;
  isPartForced: boolean;
  isNew: boolean;
}

/** Vendeur ou livreur sur la carte : dernière position connue (journée en cours). */
export interface FieldPosition {
  userId: string;
  code: string;
  name: string;
  role: string;
  latitude: number;
  longitude: number;
  at: string;
  batteryLevel: number | null;
}
