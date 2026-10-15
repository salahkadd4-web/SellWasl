// Phase 27 — espace plateforme réservé à une liste d'adresses IP (docs/security.md)

interface Rule {
  family: 4 | 6;
  base: bigint;
  bits: number;
}

/** Adresse en entier (IPv4 sur 32 bits, IPv6 sur 128 bits) ; une IPv4 « mappée » IPv6 devient IPv4. */
function parse(raw: string): { family: 4 | 6; value: bigint } | null {
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (mapped) ip = mapped[1]!;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts.some((p) => p > 255)) return null;
    return { family: 4, value: parts.reduce((v, p) => (v << 8n) | BigInt(p), 0n) };
  }
  if (!/^[0-9a-f:]+$/.test(ip) || (ip.match(/::/g) ?? []).length > 1) return null;
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, undefined];
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (tail === undefined && missing !== 0)) return null;
  const groups = [...left, ...Array<string>(missing).fill('0'), ...right];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return { family: 6, value: groups.reduce((v, g) => (v << 16n) | BigInt(parseInt(g, 16)), 0n) };
}

/** « 198.51.100.4, 10.0.0.0/8, 2001:db8::/32 » → règles ; une entrée illisible est ignorée. */
export function parseAllowlist(raw: string | undefined): Rule[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [address, prefix] = entry.split('/');
      const ip = parse(address ?? '');
      if (!ip) return [];
      const max = ip.family === 4 ? 32 : 128;
      const bits = prefix === undefined ? max : Number(prefix);
      if (!Number.isInteger(bits) || bits < 0 || bits > max) return [];
      return [{ family: ip.family, base: ip.value >> BigInt(max - bits), bits }];
    });
}

/** L'adresse appartient-elle à l'une des règles ? */
export function ipAllowed(raw: string | undefined, rules: readonly Rule[]): boolean {
  const ip = raw ? parse(raw) : null;
  if (!ip) return false;
  const max = ip.family === 4 ? 32 : 128;
  return rules.some((r) => r.family === ip.family && ip.value >> BigInt(max - r.bits) === r.base);
}

/**
 * Accès à l'espace plateforme : liste vide → ouvert en développement et en test, fermé en
 * staging et en production (fermé par défaut là où sont les vraies données).
 */
export function platformAccess(env: {
  NODE_ENV?: string;
  PLATFORM_ALLOWED_IPS?: string;
}): (ip: string | undefined) => boolean {
  const rules = parseAllowlist(env.PLATFORM_ALLOWED_IPS);
  if (rules.length === 0) {
    const deployed = env.NODE_ENV === 'staging' || env.NODE_ENV === 'production';
    return () => !deployed;
  }
  return (ip) => ipAllowed(ip, rules);
}

/**
 * IP du client derrière `trustProxy` proxys de confiance : la n-ième adresse en partant de la
 * droite de X-Forwarded-For ; sans proxy de confiance, l'adresse de la connexion.
 */
export function clientIp(
  forwardedFor: string | null | undefined,
  remote: string | undefined,
  trustProxy: number,
): string | undefined {
  if (trustProxy <= 0 || !forwardedFor) return remote;
  const chain = forwardedFor
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return chain[Math.max(0, chain.length - trustProxy)] ?? remote;
}

/**
 * En-têtes posés par le Web (proxy Next.js) sur les requêtes qu'il transmet à l'API : adresse du
 * client lue derrière Vercel, et clé partagée (`WEB_PROXY_SECRET`) sans laquelle l'API l'ignore.
 */
export const WEB_PROXY_IP_HEADER = 'x-sellwasl-client-ip';
export const WEB_PROXY_KEY_HEADER = 'x-sellwasl-proxy-key';
