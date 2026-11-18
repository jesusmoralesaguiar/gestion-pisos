import { MD3DarkTheme, MD3LightTheme, type MD3Theme } from 'react-native-paper';

export const AppLightTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#0F6B5E',
    onPrimary: '#FFFFFF',
    primaryContainer: '#BCECE2',
    onPrimaryContainer: '#00201B',
    secondary: '#3A608F',
    onSecondary: '#FFFFFF',
    secondaryContainer: '#D3E4FF',
    onSecondaryContainer: '#001C38',
    tertiary: '#8C5000',
    tertiaryContainer: '#FFDCC0',
    error: '#BA1A1A',
    errorContainer: '#FFDAD6',
    background: '#F5F7F6',
    surface: '#FFFFFF',
    surfaceVariant: '#E2E8E5',
    onSurface: '#181D1B',
    onSurfaceVariant: '#424946',
    outline: '#727975',
  },
};

export const AppDarkTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#6AD8C5',
    onPrimary: '#003830',
    primaryContainer: '#005045',
    onPrimaryContainer: '#BCECE2',
    secondary: '#A3C9FE',
    onSecondary: '#00315C',
    secondaryContainer: '#1E4876',
    onSecondaryContainer: '#D3E4FF',
    background: '#111413',
    surface: '#191D1B',
    surfaceVariant: '#3F4945',
    onSurface: '#E1E3E1',
    onSurfaceVariant: '#BFC9C4',
    outline: '#89938E',
  },
};
