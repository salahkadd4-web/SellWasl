/**
 * Couleurs de l'identité SellWasl (README §2, architecture §20).
 * Source unique : le Web (preset Tailwind) et le mobile les importent d'ici.
 */
export const colors = {
  /** Bleu marine : textes, boutons principaux. */
  primary: '#001850',
  textDark: '#00043C',
  /** Turquoise : fonds, icônes, boutons. Jamais pour du texte courant (contraste 2,3:1). */
  accent: '#00BCBC',
  deepBlue: '#012E8E',
  background: '#FFFFFF',
  surface: '#F4F7FB',
  border: '#D9E1EC',
  muted: '#5B6B82',
  /** États communs au Web et au mobile. */
  status: {
    synced: '#16A34A',
    pending: '#F59E0B',
    error: '#DC2626',
    visited: '#16A34A',
    toVisit: '#DC2626',
  },
} as const;

/** Dégradé du symbole « SW ». */
export const brandGradient = ['#0053F6', '#01ADDC', '#01CCCD', '#37E9AB'] as const;

export const fontFamily = {
  sans: 'Poppins',
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;
