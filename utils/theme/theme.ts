import { MD3LightTheme, MD3DarkTheme, configureFonts, type MD3Theme } from 'react-native-paper'
import type { SurfaceTokens } from './tokens'

import {
  colorTokens,
  colorTokensDark,
  surfaceTokensLight,
  surfaceTokensDark,
  spacingTokens,
  shapeTokens,
  typographyTokens,
  elevationTokens,
  opacityTokens,
  layoutTokens,
} from './tokens'

const fontConfig = {
  fontFamily: 'System',
}

export type AppTheme = MD3Theme & {
  custom: {
    spacing: typeof spacingTokens
    shapes: typeof shapeTokens
    typography: typeof typographyTokens
    elevation: typeof elevationTokens
    opacity: typeof opacityTokens
    layout: typeof layoutTokens
    surfaces: SurfaceTokens
  }
}

export const lightTheme: AppTheme = {
  ...MD3LightTheme,

  colors: {
    ...MD3LightTheme.colors,
    ...colorTokens,
  },

  fonts: configureFonts({ config: fontConfig }),

  custom: {
    spacing: spacingTokens,
    shapes: shapeTokens,
    typography: typographyTokens,
    elevation: elevationTokens,
    opacity: opacityTokens,
    layout: layoutTokens,
    surfaces: surfaceTokensLight,
  },
}

export const darkTheme: AppTheme = {
  ...MD3DarkTheme,

  colors: {
    ...MD3DarkTheme.colors,
    ...colorTokensDark,
  },

  fonts: configureFonts({ config: fontConfig }),

  custom: {
    spacing: spacingTokens,
    shapes: shapeTokens,
    typography: typographyTokens,
    elevation: elevationTokens,
    opacity: opacityTokens,
    layout: layoutTokens,
    surfaces: surfaceTokensDark,
  },
}
