import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ColorThemeId = 'violet' | 'blue' | 'green' | 'teal' | 'rose';

export interface ColorThemeDef {
  id: ColorThemeId;
  primary: string;
  primaryDark: string;
  appBg: string;
  /** Preview swatch in the picker */
  swatch: string;
}

export const COLOR_THEMES: ColorThemeDef[] = [
  { id: 'violet', primary: '#6C63FF', primaryDark: '#5A52E0', appBg: '#F6F4FF', swatch: '#6C63FF' },
  { id: 'blue', primary: '#2563EB', primaryDark: '#1D4ED8', appBg: '#F0F5FF', swatch: '#2563EB' },
  { id: 'green', primary: '#059669', primaryDark: '#047857', appBg: '#F0FDF6', swatch: '#059669' },
  { id: 'teal', primary: '#0D9488', primaryDark: '#0F766E', appBg: '#F0FDFA', swatch: '#0D9488' },
  { id: 'rose', primary: '#E11D48', primaryDark: '#BE123C', appBg: '#FFF1F2', swatch: '#E11D48' },
];

const COLOR_THEME_MAP = Object.fromEntries(COLOR_THEMES.map((t) => [t.id, t])) as Record<ColorThemeId, ColorThemeDef>;

const STORAGE_DARK = 'appTheme';
const STORAGE_COLOR = 'appColorTheme';

function isColorThemeId(v: string | null): v is ColorThemeId {
  return !!v && v in COLOR_THEME_MAP;
}

export function applyColorThemeVars(themeId: ColorThemeId) {
  const theme = COLOR_THEME_MAP[themeId] ?? COLOR_THEME_MAP.violet;
  const root = document.documentElement;
  root.style.setProperty('--color-primary', theme.primary);
  root.style.setProperty('--color-primary-dark', theme.primaryDark);
  root.style.setProperty('--color-app-bg', theme.appBg);
  root.dataset.colorTheme = theme.id;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.primary);
}

interface ThemeCtx {
  dark: boolean;
  toggleDark: () => void;
  colorTheme: ColorThemeId;
  setColorTheme: (id: ColorThemeId) => void;
  colorThemes: ColorThemeDef[];
}

const ThemeContext = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_DARK);
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const [colorTheme, setColorThemeState] = useState<ColorThemeId>(() => {
    const saved = localStorage.getItem(STORAGE_COLOR);
    return isColorThemeId(saved) ? saved : 'violet';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem(STORAGE_DARK, dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    applyColorThemeVars(colorTheme);
    localStorage.setItem(STORAGE_COLOR, colorTheme);
  }, [colorTheme]);

  const setColorTheme = (id: ColorThemeId) => {
    if (!isColorThemeId(id)) return;
    setColorThemeState(id);
  };

  return (
    <ThemeContext.Provider
      value={{
        dark,
        toggleDark: () => setDark((d) => !d),
        colorTheme,
        setColorTheme,
        colorThemes: COLOR_THEMES,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
