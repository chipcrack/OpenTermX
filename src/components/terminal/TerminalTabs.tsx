import { useSessionStore } from '../../stores/sessionStore';

export function TerminalTabs() {
  const terminalTabs = useSessionStore((state) => state.terminalTabs);
  const activeTabId = useSessionStore((state) => state.activeTabId);
  const activateTab = useSessionStore((state) => state.activateTab);
  const closeTab = useSessionStore((state) => state.closeTab);

  return (
    <div className="flex min-h-[46px] items-center gap-1.5 overflow-x-auto border-b border-[var(--otx-border)] bg-slate-950/30 px-2.5 py-2">
      {terminalTabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1 ${
            activeTabId === tab.id
              ? 'border-blue-400/40 bg-blue-500/12 text-[var(--otx-text)]'
              : 'border-white/8 bg-white/[0.03] text-[var(--otx-muted)]'
          }`}
        >
          <button
            type="button"
            className="inline-flex items-center gap-1.5 whitespace-nowrap border-0 bg-transparent p-0 text-[12px]"
            onClick={() => activateTab(tab.id)}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                tab.connected
                  ? 'bg-emerald-400 shadow-[0_0_12px_rgba(74,222,128,0.85)]'
                  : 'bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.7)]'
              }`}
            />
            {tab.title}
          </button>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full border-0 bg-transparent p-0 text-sm leading-none hover:bg-white/10"
            onClick={() => closeTab(tab.id)}
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}
