import { useMemo, useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import type { Session } from '../../types/entities';

function groupSessions(sessions: Session[]) {
  return sessions.reduce<Record<string, Session[]>>((groups, session) => {
    groups[session.groupName] = groups[session.groupName] ?? [];
    groups[session.groupName].push(session);
    return groups;
  }, {});
}

function sortSessions(items: Session[]) {
  return [...items].sort((left, right) =>
    `${left.host} ${left.name}`.localeCompare(`${right.host} ${right.name}`, 'es', {
      sensitivity: 'base',
      numeric: true
    })
  );
}

function getSessionLabel(session: Session) {
  const suffix = session.name?.trim() ? session.name.trim() : session.username;
  return `${session.host} [${suffix}]`;
}

export function SessionsSidebar() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const selectSession = useSessionStore((state) => state.selectSession);
  const openCreateSession = useSessionStore((state) => state.openCreateSession);
  const openEditSession = useSessionStore((state) => state.openEditSession);
  const [query, setQuery] = useState('');

  const filteredSessions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return sessions;
    }

    return sessions.filter((session) =>
      [
        session.name,
        session.host,
        session.username,
        session.groupName,
        session.environment,
        session.description
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalized)
    );
  }, [query, sessions]);

  const groupedSessions = useMemo(() => {
    const grouped = groupSessions(filteredSessions);
    return Object.entries(grouped)
      .sort(([leftName], [rightName]) => leftName.localeCompare(rightName, 'es', { sensitivity: 'base' }))
      .map(([groupName, items]) => ({ groupName, items: sortSessions(items) }));
  }, [filteredSessions]);

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  function isExpanded(groupName: string) {
    return expandedGroups[groupName] ?? true;
  }

  function toggleGroup(groupName: string) {
    setExpandedGroups((current) => ({
      ...current,
      [groupName]: !(current[groupName] ?? true)
    }));
  }

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-2.5">
      <div className="rounded-xl border border-[var(--otx-border)] bg-[var(--otx-panel-strong)] px-2.5 py-2 shadow-panel">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[var(--otx-brand-soft)] text-[11px] text-[var(--otx-brand)]">
            U
          </span>
          <strong className="text-[12px] font-semibold text-[var(--otx-text)]">User sessions</strong>
          <span className="ml-auto text-[10px] text-[var(--otx-muted)]">{sessions.length}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="otx-button-primary flex-1" type="button" onClick={openCreateSession}>
          Nueva sesion
        </button>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Filtrar"
        className="otx-input w-full text-xs"
      />

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[var(--otx-border)] bg-[var(--otx-panel)] px-1.5 py-2 shadow-panel">
        {groupedSessions.map(({ groupName, items }) => {
          const expanded = isExpanded(groupName);

          return (
            <section key={groupName} className="mb-1.5 last:mb-0">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] text-[var(--otx-text)] hover:bg-[var(--otx-brand-soft)]"
                onClick={() => toggleGroup(groupName)}
              >
                <span className="w-3 shrink-0 text-[10px] text-[var(--otx-muted)]">{expanded ? 'v' : '>'}</span>
                <span className="relative inline-flex h-4 w-5 shrink-0 items-center">
                  <span className="absolute left-0 top-[3px] h-[10px] w-[16px] rounded-sm bg-[#7b95bb]" />
                  <span className="absolute left-[1px] top-0 h-[4px] w-[8px] rounded-t-sm bg-[#a8b9d4]" />
                </span>
                <span className="truncate">{groupName}</span>
              </button>

              {expanded ? (
                <div className="ml-5 mt-0.5 flex flex-col">
                  {items.map((session) => (
                    <div
                      key={session.id}
                      className={`group flex items-center gap-2 rounded-md px-1.5 py-1 ${
                        activeSessionId === session.id
                          ? 'border border-[var(--otx-border)] bg-[var(--otx-brand-soft)]'
                          : 'border border-transparent hover:bg-[var(--otx-brand-soft)]'
                      }`}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden border-0 bg-transparent p-0 text-left"
                        onClick={() => selectSession(session.id)}
                        title={getSessionLabel(session)}
                      >
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-amber-500/20 bg-amber-400/12 text-[9px] text-amber-600 dark:text-amber-300">
                          K
                        </span>
                        <span className="truncate text-[11px] text-[var(--otx-text)]">{getSessionLabel(session)}</span>
                      </button>

                      <button
                        type="button"
                        className="shrink-0 border-0 bg-transparent p-0 text-[10px] text-[var(--otx-muted)] opacity-0 transition group-hover:opacity-100 hover:text-[var(--otx-text)]"
                        onClick={() => openEditSession(session.id)}
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}

        {!groupedSessions.length ? (
          <div className="px-2 py-6 text-center text-[11px] text-[var(--otx-muted)]">No hay sesiones para mostrar.</div>
        ) : null}
      </div>
    </div>
  );
}
