import { useMemo } from 'react';
import { FINANCE_THEME, LIGHT_THEME, ThemeMode } from '../constants/theme';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceBorder: string;
  primary: string;
  primaryText: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  success: string;
  warning: string;
  error: string;
  info: string;
}

export function useTheme(themeMode: ThemeMode): ThemeColors {
  return useMemo(() => {
    return themeMode === 'finance' ? FINANCE_THEME.colors : LIGHT_THEME.colors;
  }, [themeMode]);
}

export function getThemeClass(themeMode: ThemeMode, classes: { finance: string; light: string }): string {
  return themeMode === 'finance' ? classes.finance : classes.light;
}
