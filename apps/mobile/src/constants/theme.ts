// ============================================================
// KORA – Neo-Brutalist Art Deco Design System & Legacy Theme
// ============================================================

import { Platform } from 'react-native';

export const Colors = {
  // New Neo-Brutalist Colors
  bg: '#0A0A0A',
  bgCard: '#111111',
  bgElevated: '#181818',
  bgPanel: '#141414',

  // Borders
  border: '#000000',
  borderGold: '#C9A84C',
  borderAccent: '#D4AF37',

  // Text
  textPrimary: '#F5F0E8',
  textSecondary: '#8A8A8A',
  textMuted: '#555555',
  textGold: '#C9A84C',
  textInverse: '#0A0A0A',

  // Accent Palette
  gold: '#C9A84C',
  goldLight: '#E8D5A3',
  goldDark: '#8B6914',
  crimson: '#8B1A1A',
  crimsonLight: '#C0392B',
  cobalt: '#1A3A5C',
  cobaltLight: '#2E6DA4',
  sage: '#2D4A35',
  sageLight: '#4A7C59',
  ivory: '#F5F0E8',
  amber: '#D4770A',
  amberLight: '#F0A030',

  // Status
  success: '#4A7C59',
  error: '#8B1A1A',
  warning: '#D4770A',
  info: '#1A3A5C',

  // Shadows
  shadow: '#000000',

  // Legacy Theme Colors (to support existing files)
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
}) || {
  sans: 'normal',
  serif: 'serif',
  rounded: 'normal',
  mono: 'monospace',
};

export const Typography = {
  // Display / Headers – Cinzel / Cormorant (serif)
  display: {
    fontFamily: 'CormorantGaramond_700Bold',
    letterSpacing: 2,
    textTransform: 'uppercase' as const,
  },
  heading: {
    fontFamily: 'CormorantGaramond_500Medium',
    letterSpacing: 1,
  },
  // Body – DM Sans (clean sans-serif)
  body: {
    fontFamily: 'DMSans_400Regular',
    letterSpacing: 0,
  },
  bodyMedium: {
    fontFamily: 'DMSans_500Medium',
  },
  bodyBold: {
    fontFamily: 'DMSans_700Bold',
  },
  // Mono – JetBrains Mono
  mono: {
    fontFamily: 'JetBrainsMono_400Regular',
    letterSpacing: 0.5,
  },
  monoMedium: {
    fontFamily: 'JetBrainsMono_500Medium',
  },
  monoBold: {
    fontFamily: 'JetBrainsMono_700Bold',
    letterSpacing: 0.5,
  },
};

export const Spacing = {
  // New Spacing
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,

  // Legacy Spacing
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BorderRadius = {
  none: 0,
  sm: 2,
  md: 4,
};

export const BorderWidth = {
  thin: 1,
  medium: 2,
  thick: 3,
  heavy: 4,
};

export const Shadows = {
  brutal: {
    shadowColor: '#000000',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 8,
  },
  brutalSm: {
    shadowColor: '#000000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  brutalGold: {
    shadowColor: '#C9A84C',
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 0,
    elevation: 8,
  },
};

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
