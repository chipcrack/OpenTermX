import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { getSessionAccent, withAlpha } from '../../utils/sessionAppearance';

export function TerminalTabs() {
  const terminalTabs = useSessionStore((state) => state.terminalTabs);
  const sessions = useSessionStore((state) => state.sessions);
  const activeTabId = useSessionStore((state) => state.activeTabId);
  const activateTab = useSessionStore((state) => state.activateTab);
  const closeTab = useSessionStore((state) => state.closeTab);
  const sessionsById = useMemo(
    () => new Map(sessions.map((session) => [session.id, session])),
    [sessions]
  );

  return (
    <div className="flex min-h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--otx-border)] bg-[var(--otx-panel-strong)]/80 px-1.5 py-1">
      {terminalTabs.map((tab) => {
        const session = sessionsById.get(tab.sessionId);
        const accent = session ? getSessionAccent(session) : '#2563eb';
        const isActive = activeTabId === tab.id;

        return (
          <div
            key={tab.id}
            className="flex h-7 max-w-[15rem] shrink-0 items-center gap-1 rounded-md border px-1.5 transition"
            style={{
              borderColor: isActive ? withAlpha(accent, 0.42) : withAlpha(accent, 0.14),
              background: isActive
                ? `linear-gradient(180deg, ${withAlpha(accent, 0.24)}, ${withAlpha(accent, 0.1)})`
                : `linear-gradient(180deg, ${withAlpha(accent, 0.08)}, transparent)`,
              boxShadow: isActive ? `0 1px 4px ${withAlpha(accent, 0.12)}` : 'none'
            }}
          >
            <span
              className="block h-4 w-0.5 shrink-0 rounded-full"
              style={{
                background: accent,
                boxShadow: isActive ? `0 0 14px ${withAlpha(accent, 0.52)}` : 'none'
              }}
            />
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap border-0 bg-transparent p-0 text-[12px]"
              onClick={() => activateTab(tab.id)}
              title={`${tab.title}${session ? ` — ${session.username}@${session.host}:${session.port}` : ''}`}
              aria-pressed={isActive}
            >

              <span
                className={`h-2 w-2 rounded-full ${
                  tab.reconnecting
                    ? 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]'
                    : tab.connected
                    ? 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.85)]'
                    : 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.7)]'
                }`}
              />
              <span className={`truncate ${isActive ? 'text-[var(--otx-text)]' : 'text-[var(--otx-text-soft)]'}`}>
                {tab.title}
              </span>
            </button>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-full border-0 bg-transparent p-0 text-sm leading-none text-[var(--otx-muted)] transition hover:text-[var(--otx-text)]"
              style={{
                background: isActive ? withAlpha(accent, 0.12) : 'transparent'
              }}
              onClick={() => closeTab(tab.id)}
              aria-label={`Cerrar ${tab.title}`}
              title="Cerrar terminal"
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}
