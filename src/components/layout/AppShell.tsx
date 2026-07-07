import type { ReactNode } from 'react';

interface AppShellProps {
  header?: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
}

export function AppShell({ header, sidebar, main, aside }: AppShellProps) {
  return (
    <div className="relative flex h-dvh min-h-dvh flex-col overflow-hidden bg-transparent text-[var(--otx-text)]">
      {header ? <header className="shrink-0 px-3 pb-0 pt-3 md:px-4">{header}</header> : null}

      <div className="grid min-h-0 flex-1 gap-3 px-3 py-3 md:px-4 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)_19rem]">
        <aside className="otx-panel min-h-0 overflow-hidden">{sidebar}</aside>
        <main className="otx-panel min-h-0 overflow-hidden">{main}</main>
        {aside ? (
          <aside className="otx-panel min-h-0 overflow-hidden lg:col-span-2 xl:col-span-1">{aside}</aside>
        ) : null}
      </div>
    </div>
  );
}
