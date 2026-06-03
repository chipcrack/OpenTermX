import { useSessionStore } from '../../stores/sessionStore';
import styles from './TerminalTabs.module.css';

export function TerminalTabs() {
  const terminalTabs = useSessionStore((state) => state.terminalTabs);
  const activeTabId = useSessionStore((state) => state.activeTabId);
  const activateTab = useSessionStore((state) => state.activateTab);
  const closeTab = useSessionStore((state) => state.closeTab);

  return (
    <div className={styles.tabs}>
      {terminalTabs.map((tab) => (
        <div
          key={tab.id}
          className={`${styles.tab} ${activeTabId === tab.id ? styles.tabActive : ''}`}
        >
          <button type="button" className={styles.tabButton} onClick={() => activateTab(tab.id)}>
            <span
              className={`${styles.tabStatus} ${
                tab.connected ? styles.tabStatusConnected : styles.tabStatusPending
              }`}
            />
            {tab.title}
          </button>
          <button type="button" className={styles.closeButton} onClick={() => closeTab(tab.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
