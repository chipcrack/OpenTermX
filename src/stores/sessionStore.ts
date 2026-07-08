import { create } from 'zustand';
import { desktopApi } from '../services/desktopApi';
import type {
  Credential,
  CredentialDraft,
  Session,
  SessionDraft,
  TerminalTab,
  Tunnel,
  TunnelDraft
} from '../types/entities';

interface SessionStore {
  credentials: Credential[];
  sessions: Session[];
  tunnels: Tunnel[];
  activeSessionId: string | null;
  terminalTabs: TerminalTab[];
  activeTabId: string | null;
  sftpVisible: boolean;
  tunnelsVisible: boolean;
  loading: boolean;
  initialized: boolean;
  error: string | null;
  sessionFormOpen: boolean;
  editingSessionId: string | null;
  credentialFormOpen: boolean;
  editingCredentialId: string | null;
  tunnelFormOpen: boolean;
  editingTunnelId: string | null;
  initialize: () => Promise<void>;
  selectSession: (sessionId: string) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
  setTabConnection: (tabId: string, connected: boolean) => void;
  setTabReconnecting: (tabId: string, reconnecting: boolean) => void;
  setTabShellId: (tabId: string, shellId: string | null) => void;
  toggleSftpPanel: () => void;
  toggleTunnelsPanel: () => void;
  openCreateSession: () => void;
  openEditSession: (sessionId: string) => void;
  closeSessionForm: () => void;
  saveSession: (input: SessionDraft) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  openCreateCredential: () => void;
  openEditCredential: (credentialId: string) => void;
  closeCredentialForm: () => void;
  saveCredential: (input: CredentialDraft) => Promise<void>;
  deleteCredential: (credentialId: string) => Promise<void>;
  openCreateTunnel: () => void;
  openEditTunnel: (tunnelId: string) => void;
  closeTunnelForm: () => void;
  saveTunnel: (input: TunnelDraft) => Promise<void>;
  deleteTunnel: (tunnelId: string) => Promise<void>;
  clearError: () => void;
}

function createTabId(sessionId: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `tab-${sessionId}-${crypto.randomUUID()}`;
  }

  return `tab-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildTab(session: Session): TerminalTab {
  return {
    id: createTabId(session.id),
    sessionId: session.id,
    title: session.name,
    connected: false,
    reconnecting: false,
    shellId: null
  };
}

function withNormalizedTabTitles(tabs: TerminalTab[], sessions: Session[]) {
  const counts = new Map<string, number>();
  const totals = tabs.reduce<Map<string, number>>((map, tab) => {
    map.set(tab.sessionId, (map.get(tab.sessionId) ?? 0) + 1);
    return map;
  }, new Map());

  return tabs.map((tab) => {
    const session = sessions.find((item) => item.id === tab.sessionId);
    const baseTitle = session?.name ?? tab.title;
    const nextIndex = (counts.get(tab.sessionId) ?? 0) + 1;
    counts.set(tab.sessionId, nextIndex);
    const needsSuffix = (totals.get(tab.sessionId) ?? 0) > 1;

    return {
      ...tab,
      title: needsSuffix ? `${baseTitle} (${nextIndex})` : baseTitle
    };
  });
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  credentials: [],
  sessions: [],
  tunnels: [],
  activeSessionId: null,
  terminalTabs: [],
  activeTabId: null,
  sftpVisible: false,
  tunnelsVisible: false,
  loading: false,
  initialized: false,
  error: null,
  sessionFormOpen: false,
  editingSessionId: null,
  credentialFormOpen: false,
  editingCredentialId: null,
  tunnelFormOpen: false,
  editingTunnelId: null,
  initialize: async () => {
    if (get().loading) {
      return;
    }

    set({
      loading: true,
      error: null
    });

    try {
      const [credentials, sessions, tunnels] = await Promise.all([
        desktopApi.listCredentials(),
        desktopApi.listSessions(),
        desktopApi.listTunnels()
      ]);

      set((state) => {
        const existingTabs = state.terminalTabs.filter((tab) =>
          sessions.some((session) => session.id === tab.sessionId)
        );
        const nextTabs = existingTabs.length > 0 ? withNormalizedTabTitles(existingTabs, sessions) : [];

        const activeTabId =
          nextTabs.find((tab) => tab.id === state.activeTabId)?.id ?? nextTabs[0]?.id ?? null;
        const activeSessionId =
          nextTabs.find((tab) => tab.id === activeTabId)?.sessionId ?? null;

        return {
          credentials,
          sessions,
          tunnels,
          activeSessionId,
          terminalTabs: nextTabs,
          activeTabId,
          loading: false,
          initialized: true
        };
      });
    } catch (error) {
      set({
        loading: false,
        initialized: true,
        error: error instanceof Error ? error.message : 'No se pudo cargar el workspace'
      });
    }
  },
  selectSession: (sessionId) => {
    const { sessions } = get();
    const session = sessions.find((item) => item.id === sessionId);

    if (!session) {
      return;
    }

    const newTab = buildTab(session);

    set((state) => ({
      activeSessionId: sessionId,
      terminalTabs: withNormalizedTabTitles([...state.terminalTabs, newTab], state.sessions),
      activeTabId: newTab.id
    }));
  },
  activateTab: (tabId) => {
    const tab = get().terminalTabs.find((item) => item.id === tabId);

    if (!tab) {
      return;
    }

    set({
      activeTabId: tab.id,
      activeSessionId: tab.sessionId
    });
  },
  closeTab: (tabId) => {
    const closingTab = get().terminalTabs.find((tab) => tab.id === tabId);
    if (closingTab?.shellId) {
      void desktopApi.closeTerminal(closingTab.shellId);
    }

    const nextTabs = get().terminalTabs.filter((tab) => tab.id !== tabId);
    const nextActiveTab = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : null;

    set({
      terminalTabs: withNormalizedTabTitles(nextTabs, get().sessions),
      activeTabId: nextActiveTab?.id ?? null,
      activeSessionId: nextActiveTab?.sessionId ?? null
    });
  },
  setTabConnection: (tabId, connected) => {
    set((state) => ({
      terminalTabs: state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, connected, reconnecting: connected ? false : tab.reconnecting } : tab
      )
    }));
  },
  setTabReconnecting: (tabId, reconnecting) => {
    set((state) => ({
      terminalTabs: state.terminalTabs.map((tab) =>
        tab.id === tabId ? { ...tab, reconnecting, connected: reconnecting ? false : tab.connected } : tab
      )
    }));
  },
  setTabShellId: (tabId, shellId) => {
    set((state) => ({
      terminalTabs: state.terminalTabs.map((tab) => (tab.id === tabId ? { ...tab, shellId } : tab))
    }));
  },
  toggleSftpPanel: () => {
    set((state) => ({
      sftpVisible: !state.sftpVisible
    }));
  },
  toggleTunnelsPanel: () => {
    set((state) => ({
      tunnelsVisible: !state.tunnelsVisible
    }));
  },
  openCreateSession: () => {
    set({
      sessionFormOpen: true,
      editingSessionId: null
    });
  },
  openEditSession: (sessionId) => {
    set({
      sessionFormOpen: true,
      editingSessionId: sessionId
    });
  },
  closeSessionForm: () => {
    set({
      sessionFormOpen: false,
      editingSessionId: null
    });
  },
  saveSession: async (input) => {
    set({
      loading: true,
      error: null
    });

    try {
      const savedSession = await desktopApi.saveSession(input);

      set((state) => {
        const credential = state.credentials.find((item) => item.id === savedSession.credentialId) ?? null;
        const normalizedSession = {
          ...savedSession,
          credentialLabel: credential?.label ?? savedSession.credentialLabel
        };
        const existing = state.sessions.find((session) => session.id === savedSession.id);
        const sessions = existing
          ? state.sessions.map((session) =>
              session.id === normalizedSession.id ? normalizedSession : session
            )
          : [normalizedSession, ...state.sessions];

        const terminalTabs = existing
          ? withNormalizedTabTitles(state.terminalTabs, sessions)
          : withNormalizedTabTitles([...state.terminalTabs, buildTab(normalizedSession)], sessions);

        const nextActiveTab = terminalTabs.find((tab) => tab.sessionId === normalizedSession.id) ?? null;

        return {
          sessions,
          terminalTabs,
          activeSessionId: normalizedSession.id,
          activeTabId: nextActiveTab?.id ?? state.activeTabId,
          loading: false,
          sessionFormOpen: false,
          editingSessionId: null
        };
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo guardar la sesión'
      });
    }
  },
  deleteSession: async (sessionId) => {
    set({
      loading: true,
      error: null
    });

    try {
      await desktopApi.deleteSession(sessionId);

      set((state) => {
        const sessions = state.sessions.filter((session) => session.id !== sessionId);
        const tunnels = state.tunnels.filter((tunnel) => tunnel.sessionId !== sessionId);
        const tabsToClose = state.terminalTabs.filter((tab) => tab.sessionId === sessionId);
        tabsToClose.forEach((tab) => {
          if (tab.shellId) {
            void desktopApi.closeTerminal(tab.shellId);
          }
        });
        const filteredTabs = state.terminalTabs.filter((tab) => tab.sessionId !== sessionId);
        const nextActiveTab = filteredTabs[0] ?? null;

        return {
          sessions,
          tunnels,
          terminalTabs: withNormalizedTabTitles(filteredTabs, sessions),
          activeTabId: nextActiveTab?.id ?? null,
          activeSessionId: nextActiveTab?.sessionId ?? null,
          loading: false,
          sessionFormOpen: false,
          editingSessionId: null
        };
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo eliminar la sesión'
      });
    }
  },
  openCreateCredential: () => {
    set({
      credentialFormOpen: true,
      editingCredentialId: null
    });
  },
  openEditCredential: (credentialId) => {
    set({
      credentialFormOpen: true,
      editingCredentialId: credentialId
    });
  },
  closeCredentialForm: () => {
    set({
      credentialFormOpen: false,
      editingCredentialId: null
    });
  },
  saveCredential: async (input) => {
    set({
      loading: true,
      error: null
    });

    try {
      const savedCredential = await desktopApi.saveCredential(input);

      set((state) => {
        const credentials = state.credentials.some((credential) => credential.id === savedCredential.id)
          ? state.credentials.map((credential) =>
              credential.id === savedCredential.id ? savedCredential : credential
            )
          : [savedCredential, ...state.credentials];

        const sessions = state.sessions.map((session) =>
          session.credentialId === savedCredential.id
            ? {
                ...session,
                username: savedCredential.username,
                credentialLabel: savedCredential.label
              }
            : session
        );

        return {
          credentials,
          sessions,
          loading: false,
          credentialFormOpen: false,
          editingCredentialId: null
        };
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo guardar la credencial'
      });
    }
  },
  deleteCredential: async (credentialId) => {
    set({
      loading: true,
      error: null
    });

    try {
      await desktopApi.deleteCredential(credentialId);

      set((state) => ({
        credentials: state.credentials.filter((credential) => credential.id !== credentialId),
        loading: false,
        credentialFormOpen: false,
        editingCredentialId: null
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo eliminar la credencial'
      });
    }
  },
  openCreateTunnel: () => {
    set({
      tunnelFormOpen: true,
      editingTunnelId: null
    });
  },
  openEditTunnel: (tunnelId) => {
    set({
      tunnelFormOpen: true,
      editingTunnelId: tunnelId
    });
  },
  closeTunnelForm: () => {
    set({
      tunnelFormOpen: false,
      editingTunnelId: null
    });
  },
  saveTunnel: async (input) => {
    set({
      loading: true,
      error: null
    });

    try {
      const savedTunnel = await desktopApi.saveTunnel(input);

      set((state) => {
        const tunnels = state.tunnels.some((tunnel) => tunnel.id === savedTunnel.id)
          ? state.tunnels.map((tunnel) => (tunnel.id === savedTunnel.id ? savedTunnel : tunnel))
          : [savedTunnel, ...state.tunnels];

        return {
          tunnels,
          loading: false,
          tunnelFormOpen: false,
          editingTunnelId: null
        };
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo guardar el túnel'
      });
    }
  },
  deleteTunnel: async (tunnelId) => {
    set({
      loading: true,
      error: null
    });

    try {
      await desktopApi.deleteTunnel(tunnelId);

      set((state) => ({
        tunnels: state.tunnels.filter((tunnel) => tunnel.id !== tunnelId),
        loading: false,
        tunnelFormOpen: false,
        editingTunnelId: null
      }));
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'No se pudo eliminar el túnel'
      });
    }
  },
  clearError: () => {
    set({
      error: null
    });
  }
}));
