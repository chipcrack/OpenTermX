import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import appIcon from '../../assets/app-icon.png';
import styles from './AppTopbar.module.css';

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
    <div className={styles.bar}>
      <div className={styles.brand}>
        <img src={appIcon} alt="OpenTermX" className={styles.brandMark} />
        <div>
          <strong className={styles.brandTitle}>OpenTermX</strong>
          <span className={styles.brandSubtitle}>
            {activeSession ? `${activeSession.username}@${activeSession.host}` : 'Gestión visual de servidores'}
          </span>
        </div>
      </div>

      <nav className={styles.actions} aria-label="Acciones principales">
        <button type="button" className={styles.primaryButton} onClick={openCreateSession}>
          Nueva sesión
        </button>
        <button type="button" className={styles.secondaryButton} onClick={openCreateCredential}>
          Credenciales
        </button>
        <button type="button" className={styles.secondaryButton} onClick={toggleSftpPanel}>
          {sftpVisible ? 'Ocultar SFTP' : 'Mostrar SFTP'}
        </button>
        <button type="button" className={styles.secondaryButton} onClick={toggleTunnelsPanel}>
          {tunnelsVisible ? 'Ocultar túneles' : 'Mostrar túneles'}
        </button>
      </nav>

      <div className={styles.utilities}>
        <span className={styles.counter}>{sessions.length} sesiones</span>

        <label className={styles.themeSwitch}>
          <input type="checkbox" checked={theme === 'light'} onChange={toggleTheme} />
          <span className={styles.track} aria-hidden="true">
            <span className={styles.thumb} />
          </span>
          <span className={styles.themeLabel}>{theme === 'dark' ? 'Oscuro' : 'Claro'}</span>
        </label>
      </div>
    </div>
  );
}
