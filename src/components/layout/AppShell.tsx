import type { ReactNode } from 'react';
import styles from './AppShell.module.css';

interface AppShellProps {
  header?: ReactNode;
  sidebar: ReactNode;
  main: ReactNode;
  aside?: ReactNode;
}

export function AppShell({ header, sidebar, main, aside }: AppShellProps) {
  return (
    <div className={styles.shell}>
      {header ? <header className={styles.header}>{header}</header> : null}
      <aside className={styles.sidebar}>{sidebar}</aside>
      <main className={styles.main}>{main}</main>
      {aside ? <aside className={styles.aside}>{aside}</aside> : null}
    </div>
  );
}
