import { createContext, useContext } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

export type ThemePreferenceContextValue = {
  preference: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setPreference: (preference: ThemePreference) => Promise<void> | void;
};

const noop = async () => {};

export const ThemePreferenceContext = createContext<ThemePreferenceContextValue>({
  preference: 'system',
  resolvedTheme: 'light',
  setPreference: noop,
});

export function useThemePreference() {
  return useContext(ThemePreferenceContext);
}
