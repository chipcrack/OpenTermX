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
    ? 'left-1.5 min-[852px]:left-[13.375rem]'
    : 'left-1.5';
  const contentClassName = [
    'grid h-full min-h-0 gap-1.5 p-1.5 max-[851px]:overflow-y-auto',
    sidebarVisible && aside
      ? 'min-[852px]:grid-cols-[13rem_minmax(0,1fr)_minmax(14rem,24vw)]'
      : sidebarVisible
        ? 'min-[852px]:grid-cols-[13rem_minmax(0,1fr)]'
        : aside
          ? 'min-[852px]:grid-cols-[minmax(0,1fr)_minmax(14rem,24vw)]'
          : 'grid-cols-1'
  ].join(' ');

  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-transparent text-[var(--otx-text)]">
      {header ? <header className="shrink-0 px-1.5 pt-1.5">{header}</header> : null}

      <div className="relative min-h-0 flex-1">
        <button
          type="button"
          onClick={toggleSessionsSidebar}
          className={`absolute top-[calc(50%-2rem)] z-30 inline-flex h-16 w-3 appearance-none items-center justify-center rounded-r-md border border-[var(--otx-border)] bg-[var(--otx-panel-strong)] text-[var(--otx-muted)] shadow-panel transition-[left,color] duration-150 hover:text-[var(--otx-text)] ${toggleButtonClassName} ${
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
            <aside className="otx-panel min-h-0 min-w-0 overflow-visible max-[851px]:max-h-[28dvh]">
              {sidebar}
            </aside>
          ) : null}
          <main className="otx-panel min-h-0 min-w-0 overflow-hidden">{main}</main>
          {aside ? (
            <aside
              className="otx-panel min-h-0 min-w-0 overflow-hidden max-[851px]:min-h-[14rem]"
            >
              {aside}
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
