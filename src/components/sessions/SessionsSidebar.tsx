import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import type { Session } from '../../types/entities';
import styles from './SessionsSidebar.module.css';

function groupSessions(sessions: Session[]) {
  return sessions.reduce<Record<string, Session[]>>((groups, session) => {
    groups[session.groupName] = groups[session.groupName] ?? [];
    groups[session.groupName].push(session);
    return groups;
  }, {});
}

export function SessionsSidebar() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const selectSession = useSessionStore((state) => state.selectSession);
  const openCreateSession = useSessionStore((state) => state.openCreateSession);
  const openEditSession = useSessionStore((state) => state.openEditSession);

  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Sesiones</p>
          <h1 className={styles.title}>Conexiones guardadas</h1>
          <p className={styles.caption}>Selecciona una sesión para abrir o retomar su terminal.</p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button className={styles.actionButton} type="button" onClick={openCreateSession}>
          Nueva sesión
        </button>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <span>Sesiones</span>
          <strong>{sessions.length}</strong>
        </div>
        <div className={styles.summaryCard}>
          <span>Favoritas</span>
          <strong>{sessions.filter((session) => session.favorite).length}</strong>
        </div>
      </div>

      <div className={styles.groups}>
        {Object.entries(groups).map(([groupName, items]) => (
          <section key={groupName} className={styles.group}>
            <header className={styles.groupHeader}>
              <span>{groupName}</span>
              <small>{items.length}</small>
            </header>

            <div className={styles.sessionList}>
              {items.map((session) => (
                <div
                  key={session.id}
                  className={`${styles.sessionCard} ${
                    activeSessionId === session.id ? styles.sessionCardActive : ''
                  }`}
                >
                  <button
                    type="button"
                    className={styles.sessionMain}
                    onClick={() => selectSession(session.id)}
                  >
                    <span
                      className={styles.sessionAccent}
                      style={{ backgroundColor: session.color }}
                    />
                    <div className={styles.sessionMeta}>
                      <div className={styles.sessionHeaderRow}>
                        <strong>{session.name}</strong>
                        <span className={styles.sessionEnvironment}>{session.environment}</span>
                      </div>
                      <p className={styles.sessionDescription}>{session.description || 'Sin descripción'}</p>
                      <div className={styles.sessionTags}>
                        <small className={styles.tag}>
                          {session.authKind === 'credential'
                            ? `Credencial: ${session.credentialLabel ?? 'Sin asignar'}`
                            : session.hasPassword
                              ? 'Password manual guardado'
                              : 'Password pendiente'}
                        </small>
                      </div>
                      <span className={styles.sessionEndpoint}>
                        {session.username}@{session.host}:{session.port}
                      </span>
                      <small>Última conexión: {session.lastConnection}</small>
                    </div>
                  </button>
                  <div className={styles.sessionFooter}>
                    <span className={styles.sessionGroup}>{session.groupName}</span>
                    <button
                      type="button"
                      className={styles.inlineAction}
                      onClick={() => openEditSession(session.id)}
                    >
                      Editar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
