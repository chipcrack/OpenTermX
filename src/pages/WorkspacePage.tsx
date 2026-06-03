import { CredentialManagerModal } from '../components/credentials/CredentialManagerModal';
import { AppShell } from '../components/layout/AppShell';
import { AppTopbar } from '../components/layout/AppTopbar';
import { SessionFormModal } from '../components/sessions/SessionFormModal';
import { SessionsSidebar } from '../components/sessions/SessionsSidebar';
import { SftpPanel } from '../components/sftp/SftpPanel';
import { TunnelFormModal } from '../components/terminal/TunnelFormModal';
import { TerminalWorkspace } from '../components/terminal/TerminalWorkspace';
import { useSessionStore } from '../stores/sessionStore';
import { useEffect } from 'react';

export function WorkspacePage() {
  const sftpVisible = useSessionStore((state) => state.sftpVisible);
  const initialize = useSessionStore((state) => state.initialize);
  const initialized = useSessionStore((state) => state.initialized);
  const loading = useSessionStore((state) => state.loading);
  const error = useSessionStore((state) => state.error);
  const clearError = useSessionStore((state) => state.clearError);

  useEffect(() => {
    if (!initialized) {
      void initialize();
    }
  }, [initialize, initialized]);

  return (
    <>
      {error ? (
        <div
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 60,
            border: '1px solid rgba(248, 113, 113, 0.35)',
            borderRadius: 14,
            background: 'rgba(127, 29, 29, 0.92)',
            color: '#fee2e2',
            padding: '0.9rem 1rem',
            boxShadow: '0 12px 30px rgba(2, 6, 23, 0.25)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              style={{
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 999,
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer'
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : null}

      <AppShell
        header={<AppTopbar />}
        sidebar={<SessionsSidebar />}
        main={<TerminalWorkspace />}
        aside={sftpVisible ? <SftpPanel /> : null}
      />

      <CredentialManagerModal />
      <SessionFormModal />
      <TunnelFormModal />

      {loading && !initialized ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 40,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(2, 6, 23, 0.6)',
            color: '#e2e8f0'
          }}
        >
          <p>Cargando workspace…</p>
        </div>
      ) : null}
    </>
  );
}
