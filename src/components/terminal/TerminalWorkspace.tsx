import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import type { Session } from '../../types/entities';
import { TerminalTabs } from './TerminalTabs';
import { TunnelManager } from './TunnelManager';
import { TerminalViewport } from './TerminalViewport';
import styles from './TerminalWorkspace.module.css';

export function TerminalWorkspace() {
  const sessions = useSessionStore((state) => state.sessions);
  const tunnels = useSessionStore((state) => state.tunnels);
  const terminalTabs = useSessionStore((state) => state.terminalTabs);
  const activeTabId = useSessionStore((state) => state.activeTabId);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const tunnelsVisible = useSessionStore((state) => state.tunnelsVisible);
  const openCreateTunnel = useSessionStore((state) => state.openCreateTunnel);

  const activeSession = useMemo<Session | undefined>(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );

  const activeTunnels = useMemo(
    () => tunnels.filter((tunnel) => tunnel.sessionId === activeSessionId),
    [activeSessionId, tunnels]
  );

  const activeTab = terminalTabs.find((tab) => tab.id === activeTabId);
  const statusLabel = activeTab?.connected ? 'SSH activo' : activeSession ? 'Pendiente' : 'Sin iniciar';

  return (
    <section className={styles.workspace}>
      <header className={styles.toolbar}>
        <div>
          <p className={styles.eyebrow}>Terminal</p>
          <h2 className={styles.title}>{activeSession?.name ?? 'Sin sesión activa'}</h2>
          <span className={styles.subtitle}>
            {activeSession
              ? `${activeSession.username}@${activeSession.host}:${activeSession.port}`
              : 'Selecciona una sesión para abrir una pestaña'}
          </span>
        </div>

        <div className={styles.actions}>
          {tunnelsVisible ? (
            <button type="button" className={styles.secondaryButton} onClick={openCreateTunnel}>
              Nuevo túnel
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.metrics}>
        <div className={styles.metricCard}>
          <span>Pestañas</span>
          <strong>{terminalTabs.length}</strong>
        </div>
        <div className={styles.metricCard}>
          <span>Túneles</span>
          <strong>{activeTunnels.length}</strong>
        </div>
        <div className={styles.metricCard}>
          <span>Estado</span>
          <strong>{statusLabel}</strong>
        </div>
      </div>

      <div className={styles.terminalPanel}>
        <TerminalTabs />
        {activeTabId && activeSession ? (
          <TerminalViewport session={activeSession} tabId={activeTab?.id ?? activeTabId} />
        ) : (
          <div className={styles.emptyState}>
            <h3>No hay terminal abierta</h3>
            <p>Selecciona una sesión del panel izquierdo para preparar una pestaña.</p>
          </div>
        )}
      </div>

      {tunnelsVisible ? <TunnelManager /> : null}
    </section>
  );
}
