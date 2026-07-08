import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { getEnvironmentAppearance, getSessionAccent, withAlpha } from '../../utils/sessionAppearance';

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
    <div className="flex min-h-[48px] items-center gap-1.5 overflow-x-auto border-b border-[var(--otx-border)] bg-[var(--otx-panel-strong)]/80 px-2.5 py-2">
      {terminalTabs.map((tab) => {
        const session = sessionsById.get(tab.sessionId);
        const accent = session ? getSessionAccent(session) : '#2563eb';
        const badge = session ? getEnvironmentAppearance(session.environment).badge : 'TAB';
        const isActive = activeTabId === tab.id;

        return (
          <div
            key={tab.id}
            className="flex shrink-0 items-center gap-2 rounded-xl border px-2 py-1 transition"
            style={{
              borderColor: isActive ? withAlpha(accent, 0.42) : withAlpha(accent, 0.14),
              background: isActive
                ? `linear-gradient(180deg, ${withAlpha(accent, 0.24)}, ${withAlpha(accent, 0.1)})`
                : `linear-gradient(180deg, ${withAlpha(accent, 0.08)}, transparent)`,
              boxShadow: isActive ? `0 10px 24px ${withAlpha(accent, 0.18)}` : 'none'
            }}
          >
            <span
              className="block h-7 w-1 shrink-0 rounded-full"
              style={{
                background: accent,
                boxShadow: isActive ? `0 0 14px ${withAlpha(accent, 0.52)}` : 'none'
              }}
            />
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-2 whitespace-nowrap border-0 bg-transparent p-0 text-[12px]"
              onClick={() => activateTab(tab.id)}
            >
              {/*<span
                className="inline-flex min-w-[2rem] items-center justify-center rounded-md border px-1 text-[9px] font-semibold tracking-[0.08em]"
                style={{
                  borderColor: withAlpha(accent, 0.24),
                  background: withAlpha(accent, isActive ? 0.16 : 0.09),
                  color: accent
                }}
              >
                {badge}
              </span>*/}
              <span
                className={`h-2 w-2 rounded-full ${
                  tab.reconnecting
                    ? 'bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]'
                    : tab.connected
                    ? 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.85)]'
                    : 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.7)]'
                }`}
              />
              <span className={isActive ? 'text-[var(--otx-text)]' : 'text-[var(--otx-text-soft)]'}>
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
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}
