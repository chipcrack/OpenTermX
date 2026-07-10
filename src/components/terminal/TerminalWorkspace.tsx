import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import type { Session } from '../../types/entities';
import { TerminalTabs } from './TerminalTabs';
import { TunnelManager } from './TunnelManager';
import { TerminalViewport } from './TerminalViewport';

export function TerminalWorkspace() {
  const sessions = useSessionStore((state) => state.sessions);
  const tunnels = useSessionStore((state) => state.tunnels);
  const terminalTabs = useSessionStore((state) => state.terminalTabs);
  const activeTabId = useSessionStore((state) => state.activeTabId);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const tunnelsVisible = useSessionStore((state) => state.tunnelsVisible);
  const openCreateTunnel = useSessionStore((state) => state.openCreateTunnel);
  const sessionsSidebarVisible = useUiStore((state) => state.sessionsSidebarVisible);

  const activeSession = useMemo<Session | undefined>(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );

  const activeTunnels = useMemo(
    () => tunnels.filter((tunnel) => tunnel.sessionId === activeSessionId),
    [activeSessionId, tunnels]
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
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3 max-lg:overflow-y-auto">
      <header className="shrink-0 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="otx-kicker m-0">Workspace</p>
          <h2 className="mt-1.5 text-lg font-semibold">{activeSession?.name ?? 'Sin sesion activa'}</h2>
          <span className="mt-0.5 inline-block break-all text-xs text-[var(--otx-muted)]">
            {activeSession
              ? `${activeSession.username}@${activeSession.host}:${activeSession.port}`
              : 'Selecciona una sesion para abrir una pestana'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="otx-chip">{terminalTabs.length} tabs</span>
          {/*<span className="otx-chip">{activeTunnels.length} tuneles</span>*/}
          <span className="otx-chip">{statusLabel}</span>
          {tunnelsVisible ? (
            <button type="button" className="otx-button-secondary" onClick={openCreateTunnel}>
              Nuevo tunel
            </button>
          ) : null}
        </div>
      </header>

      <div className="shrink-0 flex flex-wrap items-center gap-2">
        <div className="otx-panel-muted flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--otx-muted)]">Pestanas</span>
          <strong className="text-sm font-semibold">{terminalTabs.length}</strong>
        </div>
        {/*<div className="otx-panel-muted flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--otx-muted)]">Tuneles</span>
          <strong className="text-sm font-semibold">{activeTunnels.length}</strong>
        </div>*/}
        <div className="otx-panel-muted flex items-center gap-2 px-3 py-2">
          <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--otx-muted)]">Estado</span>
          <strong className="text-sm font-semibold">{extendedStatus}</strong>
        </div>
        {activeTab?.lastError ? (
          <div className="otx-panel-muted flex min-w-[16rem] items-center gap-2 px-3 py-2 text-[var(--otx-danger)]">
            <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--otx-muted)]">Ultimo error</span>
            <strong className="truncate text-sm font-semibold">{activeTab.lastError}</strong>
          </div>
        ) : null}
      </div>

      {activeTab?.lastEventAt ? (
        <div className="shrink-0 text-xs text-[var(--otx-muted)]">
          Ultima actividad de terminal: {new Date(activeTab.lastEventAt).toLocaleString()}
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite">
        {extendedStatus}
      </div>

      <div className="flex min-h-[21rem] flex-1 flex-col overflow-hidden rounded-[22px] border border-[var(--otx-border)] bg-[var(--otx-terminal)] shadow-shell max-lg:min-h-[24rem]">
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

      {tunnelsVisible ? <TunnelManager /> : null}
    </section>
  );
}
