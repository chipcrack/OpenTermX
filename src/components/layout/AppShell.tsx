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
  const toggleButtonClassName = sidebarVisible
    ? 'left-3 md:left-4 min-[852px]:left-[14.5rem]'
    : 'left-3 md:left-4';
  const contentClassName = [
    'grid h-full min-h-0 gap-3 px-3 py-3 md:px-4',
    sidebarVisible && aside
      ? 'min-[852px]:grid-cols-[14.5rem_minmax(0,1fr)] xl:grid-cols-[14.5rem_minmax(0,1fr)_19rem]'
      : sidebarVisible
        ? 'min-[852px]:grid-cols-[14.5rem_minmax(0,1fr)]'
        : aside
          ? 'min-[852px]:grid-cols-[minmax(0,1fr)_18rem]'
          : 'grid-cols-1'
  ].join(' ');

  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-transparent text-[var(--otx-text)]">
      {header ? <header className="shrink-0 px-3 pb-0 pt-3 md:px-4">{header}</header> : null}

      <div className="relative min-h-0 flex-1">
        <button
          type="button"
          onClick={toggleSessionsSidebar}
          className={`absolute top-[calc(50%-3rem)] z-30 inline-flex h-24 w-4 appearance-none items-center justify-center rounded-r-2xl border border-[var(--otx-border)] bg-[var(--otx-panel-strong)] text-[var(--otx-muted)] shadow-panel transition-[left,color] duration-150 hover:text-[var(--otx-text)] ${toggleButtonClassName} ${
            sidebarVisible ? '' : 'border-l-0'
          }`}
          title={sidebarVisible ? 'Ocultar panel de sesiones' : 'Mostrar panel de sesiones'}
          aria-label={sidebarVisible ? 'Ocultar panel de sesiones' : 'Mostrar panel de sesiones'}
        >
          <span className="text-sm font-semibold" aria-hidden="true">
            {sidebarVisible ? '<' : '>'}
          </span>
        </button>

        <div className={contentClassName}>
          {sidebarVisible ? (
            <aside className="otx-panel min-h-0 overflow-visible">
              {sidebar}
            </aside>
          ) : null}
          <main className="otx-panel min-h-0 overflow-hidden">{main}</main>
          {aside ? (
            <aside
              className={`otx-panel min-h-0 overflow-hidden ${
                sidebarVisible ? 'min-[852px]:col-span-2 xl:col-span-1' : ''
              }`}
            >
              {aside}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
