import { create } from 'zustand';
import type { ThemeMode } from '../types/entities';

interface UiStore {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark';
  }

  const storedTheme = window.localStorage.getItem('opentermx-theme');
  return storedTheme === 'light' ? 'light' : 'dark';
}

export const useUiStore = create<UiStore>((set, get) => ({
  theme: readStoredTheme(),
  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('opentermx-theme', theme);
    }
    set({ theme });
  },
  toggleTheme: () => {
    const nextTheme = get().theme === 'dark' ? 'light' : 'dark';
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('opentermx-theme', nextTheme);
    }
    set({ theme: nextTheme });
  }
}));
