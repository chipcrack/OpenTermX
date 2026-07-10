import appIcon from '../../assets/app-icon.png';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import { getEnvironmentAppearance, getSessionAccent, withAlpha } from '../../utils/sessionAppearance';

function ThemeIcon({ theme }: { theme: 'light' | 'dark' }) {
  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path
          d="M21 12.8A9 9 0 1 1 11.2 3a7.1 7.1 0 0 0 9.8 9.8Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.1M12 19.4v2.1M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M2.5 12h2.1M19.4 12h2.1M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5" strokeLinecap="round" />
    </svg>
  );
}

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
  const activeAccent = activeSession ? getSessionAccent(activeSession) : null;
  const activeBadge = activeSession ? getEnvironmentAppearance(activeSession.environment).badge : 'CTX';

  return (
    <div className="otx-panel flex flex-col gap-3 px-3 py-3 min-[852px]:flex-row min-[852px]:items-center min-[852px]:justify-between">
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
        <span
          className="otx-chip"
          style={
            activeAccent
              ? {
                  borderColor: withAlpha(activeAccent, 0.22),
                  background: withAlpha(activeAccent, 0.12),
                  color: activeAccent
                }
              : undefined
          }
        >
          {activeBadge}
          <span className="text-[var(--otx-text-soft)]">{activeSession ? activeSession.environment : 'Sin conexion'}</span>
        </span>
        <button
          type="button"
          className="otx-button-secondary h-10 w-10 rounded-full p-0"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--otx-brand-soft)] text-[var(--otx-brand)]">
            <ThemeIcon theme={theme} />
          </span>
        </button>
      </div>
    </div>
  );
}
