export const FINANCE_THEME = {
  colors: {
    background: '#0F172A',
    surface: '#1E293B',
    surfaceBorder: '#334155',
    primary: '#F59E0B',
    primaryText: '#0F172A',
    text: '#F8FAFC',
    textSecondary: '#CBD5E1',
    textMuted: '#94A3B8',
    border: '#475569',
    success: '#22C55E',
    warning: '#EAB308',
    error: '#EF4444',
    info: '#3B82F6',
  }
} as const;

export const LIGHT_THEME = {
  colors: {
    background: '#F9FAFB',
    surface: '#FFFFFF',
    surfaceBorder: '#E5E7EB',
    primary: '#4F46E5',
    primaryText: '#FFFFFF',
    text: '#111827',
    textSecondary: '#4B5563',
    textMuted: '#9CA3AF',
    border: '#D1D5DB',
    success: '#10B981',
    warning: '#F59E0B',
    error: '#EF4444',
    info: '#3B82F6',
  }
} as const;

export type ThemeMode = 'finance' | 'light';
