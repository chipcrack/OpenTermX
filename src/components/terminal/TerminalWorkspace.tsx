import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import type { Session } from '../../types/entities';
import { TerminalTabs } from './TerminalTabs';
import { TunnelManager } from './TunnelManager';
import { TerminalViewport } from './TerminalViewport';

export function TerminalWorkspace() {
  const sessions = useSessionStore((state) => state.sessions);
  const terminalTabs = useSessionStore((state) => state.terminalTabs);
  const activeTabId = useSessionStore((state) => state.activeTabId);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const tunnelsVisible = useSessionStore((state) => state.tunnelsVisible);
  const sessionsSidebarVisible = useUiStore((state) => state.sessionsSidebarVisible);

  const activeSession = useMemo<Session | undefined>(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );

  const activeTab = terminalTabs.find((tab) => tab.id === activeTabId);
  const statusLabel = activeTab?.reconnecting
    ? 'Reconectando'
    : activeTab?.connected
      ? 'SSH activo'
      : activeSession
      ? 'Pendiente'
        : 'Sin iniciar';
  const extendedStatus = activeTab?.statusText ?? statusLabel;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden max-[851px]:min-h-[18rem]">
      <div className="sr-only" aria-live="polite">
        {extendedStatus}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--otx-terminal)]">
        <TerminalTabs />
        {terminalTabs.length > 0 ? (
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {terminalTabs.map((tab) => {
              const session = sessions.find((item) => item.id === tab.sessionId);
              if (!session) {
                return null;
              }

              return (
                <TerminalViewport
                  key={tab.id}
                  session={session}
                  tabId={tab.id}
                  isActive={tab.id === activeTabId}
                />
              );
            })}
          </div>
        ) : (
      <div className="grid flex-1 place-items-center px-6 py-10 text-center text-[var(--otx-muted)]">
            <div className="max-w-md">
              <h3 className="mb-2 text-lg font-semibold text-[var(--otx-text)]">No hay terminal abierta</h3>
              <p className="m-0 text-sm">
                {sessionsSidebarVisible
                  ? 'Selecciona una sesion del panel izquierdo para preparar una pestana.'
                  : 'Usa la pestana lateral izquierda para mostrar sesiones y abrir una conexion.'}
              </p>
            </div>
          </div>
        )}
      </div>

      <footer className="flex min-h-6 shrink-0 items-center gap-3 border-t border-[var(--otx-border)] px-2 py-0.5 text-[11px] text-[var(--otx-muted)]">
        <span className="min-w-0 flex-1 truncate" title={activeSession ? `${activeSession.name} — ${activeSession.username}@${activeSession.host}:${activeSession.port}` : undefined}>
          {activeSession ? `${activeSession.username}@${activeSession.host}:${activeSession.port}` : 'Selecciona una sesion para conectar'}
        </span>
        <span className={`shrink-0 ${activeTab?.lastError ? 'text-[var(--otx-danger)]' : ''}`} title={activeTab?.lastError ?? extendedStatus}>{activeTab?.lastError ? 'Error SSH' : statusLabel}</span>
        <span className="shrink-0" title="Terminales abiertas">{terminalTabs.length} {terminalTabs.length === 1 ? 'terminal' : 'terminales'}</span>
      </footer>
      {tunnelsVisible ? <TunnelManager /> : null}
    </section>
  );
}
