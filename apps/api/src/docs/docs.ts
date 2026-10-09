import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Express } from 'express';
import { absolutePath } from 'swagger-ui-dist';
import { z, type ZodType } from 'zod';
import {
  ANY_AUTHENTICATED,
  IS_PLATFORM,
  IS_PUBLIC,
  MODULE,
  PERMISSION,
} from '../common/auth-context';
import { IDEMPOTENT } from '../common/idempotency';
import { VERSIONED } from '../common/versioning';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

/** Documentation servie hors production, ou sur demande (`API_DOCS=on`, staging) — api.md §1. */
export function docsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.API_DOCS === 'on' || env.NODE_ENV !== 'production';
}

type JsonSchema = Record<string, unknown>;
interface Operation {
  operationId: string;
  tags: string[];
  summary: string;
  security: { bearer: string[] }[];
  'x-permission'?: string;
  'x-access'?: string;
  'x-module'?: string;
  'x-versioned'?: boolean;
  parameters: {
    name: string;
    in: 'path' | 'query' | 'header';
    required: boolean;
    schema: JsonSchema;
    description?: string;
  }[];
  requestBody?: { required: boolean; content: { 'application/json': { schema: JsonSchema } } };
  responses: Record<string, unknown>;
}

/** Schéma JSON d'un schéma Zod, côté entrée ; un type non représentable devient « tout ». */
function jsonSchema(schema: ZodType): JsonSchema {
  try {
    const out = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
    delete out.$schema;
    return out;
  } catch {
    return {};
  }
}

const ERROR = { $ref: '#/components/schemas/ErrorResponse' };
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ERROR } },
});

/** Pipes Zod d'un argument de route (corps, requête ou paramètre). */
function zodOf(pipes: unknown[] | undefined): ZodType | null {
  const pipe = (pipes ?? []).find((p) => p instanceof ZodValidationPipe) as
    ZodValidationPipe<ZodType> | undefined;
  return pipe?.schema ?? null;
}

/**
 * Document OpenAPI 3.1 généré depuis le code (phase 25) : routes et chemins Nest, accès
 * (@Public, @PlatformOnly, @AnyAuthenticated, permission, module) et schémas Zod des pipes de
 * validation. Les réponses sont décrites de façon générique (format d'erreur commun).
 */
export function buildOpenApi(app: INestApplication) {
  const paths: Record<string, Record<string, Operation>> = {};
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!controller) continue;
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
        if (sub === undefined) continue;
        const method = String(
          RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? 'GET',
        ).toLowerCase();
        const path = `/api/v1/${[base, sub].filter((s) => s && s !== '/').join('/')}`
          .replace(/\/+/g, '/')
          .replace(/\/$/, '')
          .replace(/:([A-Za-z0-9_]+)/g, '{$1}');
        const meta = (key: string) =>
          Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
        const permission = meta(PERMISSION) as string | undefined;
        const isPublic = !!meta(IS_PUBLIC);
        const access = isPublic
          ? 'public'
          : meta(IS_PLATFORM)
            ? 'platform'
            : permission
              ? 'permission'
              : meta(ANY_AUTHENTICATED)
                ? 'authenticated'
                : 'module';

        const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {}) as Record<
          string,
          { index: number; data?: unknown; pipes?: unknown[] }
        >;
        const parameters: Operation['parameters'] = [];
        let body: ZodType | null = null;
        for (const [key, arg] of Object.entries(args)) {
          const type = Number(key.split(':')[0]);
          const schema = zodOf(arg.pipes);
          if (type === RouteParamtypes.BODY && schema) body = schema;
          if (type === RouteParamtypes.QUERY && schema) {
            const json = jsonSchema(schema) as {
              properties?: Record<string, JsonSchema>;
              required?: string[];
            };
            for (const [prop, propSchema] of Object.entries(json.properties ?? {}))
              parameters.push({
                name: prop,
                in: 'query',
                required: (json.required ?? []).includes(prop),
                schema: propSchema,
              });
          }
        }
        // Paramètres de chemin, typés UUID quand ParseUUIDPipe les valide
        for (const [, token] of path.matchAll(/\{([^}]+)\}/g)) {
          const arg = Object.entries(args).find(
            ([key, a]) => Number(key.split(':')[0]) === RouteParamtypes.PARAM && a.data === token,
          )?.[1];
          // ParseUUIDPipe passé comme classe ou comme instance
          const uuid = (arg?.pipes ?? []).some(
            (p) =>
              (p as { name?: string }).name === 'ParseUUIDPipe' ||
              (p as { constructor?: { name?: string } }).constructor?.name === 'ParseUUIDPipe',
          );
          parameters.push({
            name: token!,
            in: 'path',
            required: true,
            schema: uuid ? { type: 'string', format: 'uuid' } : { type: 'string' },
          });
        }

        if (meta(IDEMPOTENT))
          parameters.push({
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string', minLength: 8, maxLength: 100 },
            description: 'Rejouable sans effet pendant 24 h (api.md §1).',
          });
        const operation: Operation = {
          operationId: `${controller.name}.${name}`,
          tags: [path.split('/')[3] ?? 'api'],
          summary: `${controller.name.replace(/Controller$/, '')} · ${name}`,
          security: isPublic ? [] : [{ bearer: [] }],
          ...(permission ? { 'x-permission': permission } : {}),
          'x-access': access,
          ...(meta(MODULE) ? { 'x-module': meta(MODULE) as string } : {}),
          ...(meta(VERSIONED) ? { 'x-versioned': true } : {}),
          parameters,
          ...(body
            ? {
                requestBody: {
                  required: true,
                  content: { 'application/json': { schema: jsonSchema(body) } },
                },
              }
            : {}),
          responses: {
            '200': { description: 'Succès' },
            '400': errorResponse('Données invalides (VALIDATION_ERROR)'),
            ...(isPublic ? {} : { '401': errorResponse('Session absente ou expirée') }),
            ...(isPublic ? {} : { '403': errorResponse('Droit, canal ou module refusé') }),
            '404': errorResponse('Introuvable ou hors périmètre'),
            '409': errorResponse('Conflit : doublon, version, état'),
            '422': errorResponse('Règle métier (BUSINESS_RULE)'),
            '429': errorResponse('Trop de requêtes (RATE_LIMITED)'),
          },
        };
        (paths[path] ??= {})[method] = operation;
      }
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'SellWasl API',
      version: 'v1',
      description:
        'API de SellWasl, générée depuis le code (routes, droits, schémas Zod). Conventions et erreurs : docs/api.md.',
    },
    servers: [{ url: '/' }],
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      schemas: {
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', examples: ['VALIDATION_ERROR', 'NOT_FOUND'] },
                message: { type: 'string', description: 'En français, affichable tel quel' },
                details: { type: 'object' },
                requestId: { type: 'string' },
              },
            },
          },
        },
        Page: {
          type: 'object',
          required: ['data', 'nextCursor', 'total'],
          properties: {
            data: { type: 'array', items: {} },
            nextCursor: { type: ['string', 'null'] },
            total: { type: 'integer' },
          },
        },
      },
    },
  };
}

const PAGE = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <title>SellWasl API</title>
  <link rel="stylesheet" href="/api/docs/ui/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/docs/ui/swagger-ui-bundle.js"></script>
  <script src="/api/docs/init.js"></script>
</body>
</html>`;

const INIT = `window.ui = SwaggerUIBundle({ url: '/api/docs/openapi.json', dom_id: '#swagger-ui' });`;

/** Monte /api/docs (Swagger UI) et /api/docs/openapi.json, hors préfixe et hors gardes. */
export function mountDocs(app: INestApplication): void {
  if (!docsEnabled()) return;
  const server = app.getHttpAdapter().getInstance() as Express;
  let document: ReturnType<typeof buildOpenApi> | null = null;
  server.get('/api/docs/openapi.json', (_req, res) => {
    document ??= buildOpenApi(app);
    res.json(document);
  });
  server.get('/api/docs/init.js', (_req, res) => res.type('application/javascript').send(INIT));
  (app as NestExpressApplication).useStaticAssets(absolutePath(), { prefix: '/api/docs/ui' });
  server.get('/api/docs', (_req, res) => res.type('html').send(PAGE));
}
