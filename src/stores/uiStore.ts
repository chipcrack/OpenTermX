import { create } from 'zustand';
import type { ThemeMode } from '../types/entities';

interface UiStore {
  theme: ThemeMode;
  sessionsSidebarVisible: boolean;
  setTheme: (theme: ThemeMode) => void;
  toggleTheme: () => void;
  setSessionsSidebarVisible: (visible: boolean) => void;
  toggleSessionsSidebar: () => void;
}

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light';
  }

  const storedTheme = window.localStorage.getItem('opentermx-theme');
  return storedTheme === 'dark' ? 'dark' : 'light';
}

function readStoredSessionsSidebarVisibility() {
  if (typeof window === 'undefined') {
    return true;
  }

  const stored = window.localStorage.getItem('opentermx-sessions-sidebar-visible');
  return stored === null ? true : stored === 'true';
}

export const useUiStore = create<UiStore>((set, get) => ({
  theme: readStoredTheme(),
  sessionsSidebarVisible: readStoredSessionsSidebarVisibility(),
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
  },
  setSessionsSidebarVisible: (visible) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('opentermx-sessions-sidebar-visible', String(visible));
    }

    set({ sessionsSidebarVisible: visible });
  },
  toggleSessionsSidebar: () => {
    const nextVisible = !get().sessionsSidebarVisible;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('opentermx-sessions-sidebar-visible', String(nextVisible));
    }

    set({ sessionsSidebarVisible: nextVisible });
  }
}));
