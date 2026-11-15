/**
 * everfind design tokens
 * Extracted from approved main screen
 * Revised for Material-3 correctness and library limitations
 */

export const colorTokens = {
  primary: '#0A84FF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#E6F4FE',
  onPrimaryContainer: '#001B3E',

  secondary: '#5C5F61',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#E1E3E5',
  onSecondaryContainer: '#191C1E',

  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',

  background: '#FEFBFF',
  onBackground: '#1A1C1E',

  surface: '#FEFBFF',
  onSurface: '#1A1C1E',

  surfaceVariant: '#DDE3EA',
  onSurfaceVariant: '#41484D',

  outline: '#71787E',
  shadow: '#000000',
  scrim: '#000000',

  inverseSurface: '#2E3132',
  inverseOnSurface: '#F0F0F4',
  inversePrimary: '#A4C8FF',

  surfaceDisabled: '#1A1C1E1F',
  onSurfaceDisabled: '#1A1C1E61',
  backdrop: '#0000004D',
} as const

export const colorTokensDark = {
  primary: '#8CB9FF',
  onPrimary: '#002A5C',
  primaryContainer: '#0A3D7A',
  onPrimaryContainer: '#D7E3FF',

  secondary: '#C3C7CA',
  onSecondary: '#2D3133',
  secondaryContainer: '#43474A',
  onSecondaryContainer: '#E1E3E5',

  error: '#FFB4AB',
  onError: '#690005',
  errorContainer: '#93000A',
  onErrorContainer: '#FFDAD6',

  background: '#111315',
  onBackground: '#E2E2E6',

  surface: '#111315',
  onSurface: '#E2E2E6',

  surfaceVariant: '#3F4449',
  onSurfaceVariant: '#C4C7CC',

  outline: '#8E9196',
  shadow: '#000000',
  scrim: '#000000',

  inverseSurface: '#E2E2E6',
  inverseOnSurface: '#2A2C2E',
  inversePrimary: '#0A84FF',

  surfaceDisabled: '#E2E2E61F',
  onSurfaceDisabled: '#E2E2E666',
  backdrop: '#00000099',
} as const

/**
 * Semantic surfaces
 * These intentionally mirror Material 3 container levels
 * without relying on unsupported MD3 color keys.
 */

export type SurfaceTokens = {
  card: string
  cardLow: string
  rail: string
}

export const surfaceTokensLight: SurfaceTokens = {
  card: '#F8F9FA',
  cardLow: '#FFFFFF',
  rail: '#F1F2F3',
}

export const surfaceTokensDark: SurfaceTokens = {
  card: '#1C1D1F',
  cardLow: '#17181A',
  rail: '#222326',
}

export const spacingTokens = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 10,
  lg: 12,
  xl: 14,
  xxl: 16,
  xxxl: 24,
  giant: 32,

  infoBlockInset: 14,
  scrollBottomInset: 88,

  segmentedPadding: 4,
  segmentedItemPadding: 10,

  fabBaseOffset: 16,
  fabStackOffset1: 112, //32,
  fabStackOffset2: 188, //48,
  fabStackOffset3: 264, //64,
  fabStackOffset4: 340, //80,
} as const

export const shapeTokens = {
  cornerSmall: 12,
  cornerMedium: 14,
  cornerLarge: 16,
  cornerFull: 999,
} as const

export const typographyTokens = {
  appBarTitle: { fontWeight: '500' as const, letterSpacing: 0.1 },
  segmentedLabel: { fontWeight: '600' as const },
  supportingText: { opacity: 0.6 },

  bodyFontSize: 16,
  labelFontSize: 14,

  bodyLineHeight: 20,
  titleLineHeight: 24,
  compactTitleLineHeight: 22,
} as const

export const elevationTokens = {
  level0: 0,
  level1: 1,
  level2: 2,
  level3: 3,
  level4: 4,
} as const

export const opacityTokens = {
  alpha80: 'CC',
  alpha70: 'B3',
  alpha60: '99',
  alpha53: '88',
  alpha40: '66',
  alpha30: '4D',
  alpha24: '3D',
  alpha20: '33',
  alpha16: '29',
  alpha12: '1F',
  alpha08: '14',
} as const

export const layoutTokens = {
  appBarHeight: 64,
  roomIconTile: 42,
  boxIconTile: 38,
  fabTranslations: {
    item: -72,
    box: -128,
    container: -184,
    room: -240,
  },
} as const
