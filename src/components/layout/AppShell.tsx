import type { ReactNode } from 'react';
import { useUiStore } from '../../stores/uiStore';

interface AppShellProps {
  header?: ReactNode;
  sidebar: ReactNode;
  sidebarVisible?: boolean;
  main: ReactNode;
  aside?: ReactNode;
}

export function AppShell({
  header,
  sidebar,
  sidebarVisible = true,
  main,
  aside
}: AppShellProps) {
  const toggleSessionsSidebar = useUiStore((state) => state.toggleSessionsSidebar);
  const contentClassName = [
    'grid h-full min-h-0 gap-3 px-3 py-3 md:px-4',
    sidebarVisible && aside
      ? 'lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)_19rem]'
      : sidebarVisible
        ? 'lg:grid-cols-[15.5rem_minmax(0,1fr)]'
        : aside
          ? 'lg:grid-cols-[minmax(0,1fr)_19rem]'
          : 'grid-cols-1'
  ].join(' ');

  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-transparent text-[var(--otx-text)]">
      {header ? <header className="shrink-0 px-3 pb-0 pt-3 md:px-4">{header}</header> : null}

      <div className="relative min-h-0 flex-1">
        <div className={contentClassName}>
          {sidebarVisible ? (
            <aside className="otx-panel relative min-h-0 overflow-visible">
              {sidebar}
              <button
                type="button"
                onClick={toggleSessionsSidebar}
                className="absolute right-0 top-1/2 z-20 inline-flex h-16 w-6 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-r-2xl border border-[var(--otx-border)] bg-[var(--otx-panel-strong)] text-[var(--otx-muted)] shadow-panel transition hover:text-[var(--otx-text)]"
                title="Ocultar panel de sesiones"
                aria-label="Ocultar panel de sesiones"
              >
                <span className="text-sm font-semibold" aria-hidden="true">
                  {'<'}
                </span>
              </button>
            </aside>
          ) : null}
          <main className="otx-panel min-h-0 overflow-hidden">{main}</main>
          {aside ? (
            <aside
              className={`otx-panel min-h-0 overflow-hidden ${
                sidebarVisible ? 'lg:col-span-2 xl:col-span-1' : ''
              }`}
            >
              {aside}
            </aside>
          ) : null}
        </div>

        {!sidebarVisible ? (
          <button
            type="button"
            onClick={toggleSessionsSidebar}
            className="absolute left-3 top-1/2 z-20 inline-flex h-24 w-7 -translate-y-1/2 items-center justify-center rounded-r-2xl border border-[var(--otx-border)] border-l-0 bg-[var(--otx-panel-strong)] text-[var(--otx-muted)] shadow-panel transition hover:text-[var(--otx-text)] md:left-4"
            title="Mostrar panel de sesiones"
            aria-label="Mostrar panel de sesiones"
          >
            <span className="text-sm font-semibold" aria-hidden="true">
              {'>'}
            </span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
