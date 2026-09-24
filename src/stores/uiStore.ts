import { create } from 'zustand';
import type { ThemeMode } from '../types/entities';
import { clampTerminalFontSize, DEFAULT_TERMINAL_FONT_SIZE } from '../utils/terminalShortcuts';

interface UiStore {
  theme: ThemeMode;
  terminalFontSize: number;
  setTerminalFontSize: (size: number) => void;
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
  terminalFontSize: (() => {
    try {
      const stored = window.localStorage.getItem('opentermx-terminal-font-size');
      return stored === null ? DEFAULT_TERMINAL_FONT_SIZE : clampTerminalFontSize(Number(stored));
    } catch {
      return DEFAULT_TERMINAL_FONT_SIZE;
    }
  })(),
  setTerminalFontSize: (size) => {
    const terminalFontSize = clampTerminalFontSize(size);
    try {
      window.localStorage.setItem('opentermx-terminal-font-size', String(terminalFontSize));
    } catch {
      // Zoom remains available when persistent browser storage is unavailable.
    }
    set({ terminalFontSize });
  },
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
