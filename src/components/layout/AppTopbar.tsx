import appIcon from '../../assets/app-icon.png';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';

export function AppTopbar() {
  const theme = useUiStore((state) => state.theme);
  const toggleTheme = useUiStore((state) => state.toggleTheme);
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const sftpVisible = useSessionStore((state) => state.sftpVisible);
  const tunnelsVisible = useSessionStore((state) => state.tunnelsVisible);
  const openCreateSession = useSessionStore((state) => state.openCreateSession);
  const openCreateCredential = useSessionStore((state) => state.openCreateCredential);
  const toggleSftpPanel = useSessionStore((state) => state.toggleSftpPanel);
  const toggleTunnelsPanel = useSessionStore((state) => state.toggleTunnelsPanel);

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  return (
    <div className="otx-panel flex flex-col gap-3 px-3 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-2.5">
        <img
          src={appIcon}
          alt="OpenTermX"
          className="h-10 w-10 rounded-xl border border-white/10 object-cover shadow-panel"
        />
        <div className="min-w-0">
          <p className="otx-kicker m-0"></p>
          <div className="flex min-w-0 items-center gap-2">
            <strong className="truncate text-sm font-semibold">OpenTermX</strong>
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-[var(--otx-text-soft)] md:inline-flex">
              {sessions.length} sesiones
            </span>
          </div>
          <span className="block truncate text-xs text-[var(--otx-muted)]">
            {activeSession
              ? `${activeSession.username}@${activeSession.host}`
              : 'Workspace operativo para servidores'}
          </span>
        </div>
      </div>

      <nav className="flex flex-wrap items-center gap-1.5" aria-label="Acciones principales">
        <button type="button" className="otx-button-primary" onClick={openCreateSession}>
          Nueva sesion
        </button>
        <button type="button" className="otx-button-secondary" onClick={openCreateCredential}>
          Credenciales
        </button>
        <button type="button" className="otx-button-secondary" onClick={toggleSftpPanel}>
          {sftpVisible ? 'Ocultar SFTP' : 'Mostrar SFTP'}
        </button>
        {/* <button type="button" className="otx-button-secondary" onClick={toggleTunnelsPanel}>
          {tunnelsVisible ? 'Ocultar tuneles' : 'Mostrar tuneles'}
        </button> */}
      </nav>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="otx-chip">{activeSession ? activeSession.environment : 'sin contexto'}</span>
        <button type="button" className="otx-button-secondary min-w-[5.75rem]" onClick={toggleTheme}>
          {theme === 'dark' ? 'Modo oscuro' : 'Modo claro'}
        </button>
      </div>
    </div>
  );
}
