import { useEffect } from 'react';
import { CredentialManagerModal } from '../components/credentials/CredentialManagerModal';
import { AppShell } from '../components/layout/AppShell';
import { AppTopbar } from '../components/layout/AppTopbar';
import { SessionFormModal } from '../components/sessions/SessionFormModal';
import { SessionsSidebar } from '../components/sessions/SessionsSidebar';
import { SftpPanel } from '../components/sftp/SftpPanel';
import { TunnelFormModal } from '../components/terminal/TunnelFormModal';
import { TerminalWorkspace } from '../components/terminal/TerminalWorkspace';
import { useSessionStore } from '../stores/sessionStore';
import { useUiStore } from '../stores/uiStore';

export function WorkspacePage() {
  const sftpVisible = useSessionStore((state) => state.sftpVisible);
  const initialize = useSessionStore((state) => state.initialize);
  const initialized = useSessionStore((state) => state.initialized);
  const loading = useSessionStore((state) => state.loading);
  const error = useSessionStore((state) => state.error);
  const clearError = useSessionStore((state) => state.clearError);
  const sessionsSidebarVisible = useUiStore((state) => state.sessionsSidebarVisible);

  useEffect(() => {
    if (!initialized) {
      void initialize();
    }
  }, [initialize, initialized]);

  return (
    <>
      {error ? (
        <div className="fixed right-4 top-4 z-[60] max-w-md rounded-2xl border border-red-400/30 bg-red-950/90 px-4 py-3 text-red-50 shadow-2xl shadow-slate-950/20 backdrop-blur">
          <div className="flex items-center gap-3">
            <span>{error}</span>
            <button
              type="button"
              onClick={clearError}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-transparent text-inherit"
            >
              x
            </button>
          </div>
        </div>
      ) : null}

      <AppShell
        header={<AppTopbar />}
        sidebar={<SessionsSidebar />}
        sidebarVisible={sessionsSidebarVisible}
        main={<TerminalWorkspace />}
        aside={sftpVisible ? <SftpPanel /> : null}
      />

      <CredentialManagerModal />
      <SessionFormModal />
      <TunnelFormModal />

      {loading && !initialized ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/55 text-slate-100 backdrop-blur-sm">
          <div className="otx-panel flex items-center gap-3 px-5 py-4">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-sky-400" />
            <p className="m-0 text-sm font-medium">Cargando workspace...</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
