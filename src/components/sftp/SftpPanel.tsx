import { type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from 'react';
import { desktopApi } from '../../services/desktopApi';
import { useSessionStore } from '../../stores/sessionStore';
import type { SftpEntry } from '../../types/entities';
import styles from './SftpPanel.module.css';

type SortKey = 'name' | 'size' | 'modifiedAt';
type SortDirection = 'asc' | 'desc';

function normalizePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed}`
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function getParentPath(path: string) {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return '/';
  }

  const segments = normalized.split('/').filter(Boolean);
  segments.pop();
  return segments.length ? `/${segments.join('/')}` : '/';
}

function joinPath(basePath: string, segment: string) {
  return normalizePath(`${normalizePath(basePath)}/${segment}`);
}

function formatModified(value: string) {
  if (!value) {
    return '—';
  }

  return value.replace('T', ' ').slice(0, 16);
}

function parseSize(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized === '—') {
    return 0;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/);
  if (!match) {
    return 0;
  }

  const amount = Number(match[1]);
  const unit = match[2] ?? 'B';
  const multiplierMap: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4
  };

  return amount * (multiplierMap[unit] ?? 1);
}

function resolveEntryIcon(entry: SftpEntry) {
  if (entry.type === 'directory') {
    if (entry.name.startsWith('.')) {
      return '🗂️';
    }

    return '📁';
  }

  const lowerName = entry.name.toLowerCase();

  if (lowerName.startsWith('.env') || lowerName.endsWith('.conf') || lowerName.endsWith('.ini')) {
    return '⚙️';
  }

  if (
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.gif') ||
    lowerName.endsWith('.svg') ||
    lowerName.endsWith('.webp')
  ) {
    return '🖼️';
  }

  if (
    lowerName.endsWith('.zip') ||
    lowerName.endsWith('.gz') ||
    lowerName.endsWith('.tar') ||
    lowerName.endsWith('.rar') ||
    lowerName.endsWith('.7z')
  ) {
    return '🗜️';
  }

  if (
    lowerName.endsWith('.log') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.json') ||
    lowerName.endsWith('.yml') ||
    lowerName.endsWith('.yaml') ||
    lowerName.endsWith('.xml')
  ) {
    return '📝';
  }

  if (lowerName.startsWith('.')) {
    return '👁️';
  }

  return '📄';
}

export function SftpPanel() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const [path, setPath] = useState('/');
  const [draftPath, setDraftPath] = useState('/');
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [columnWidths, setColumnWidths] = useState<Record<SortKey, number>>({
    name: 260,
    size: 72,
    modifiedAt: 112
  });
  const [activeResize, setActiveResize] = useState<{
    column: SortKey;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entry: SftpEntry;
  } | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );

  const homePath = useMemo(() => {
    if (!activeSession?.username) {
      return '/';
    }

    return normalizePath(`/home/${activeSession.username}`);
  }, [activeSession?.username]);

  useEffect(() => {
    setSelectedPath(null);
    setContextMenu(null);
    if (!activeSession) {
      setPath('/');
      setDraftPath('/');
      return;
    }

    setPath(homePath);
    setDraftPath(homePath);
  }, [activeSession?.id, homePath]);

  useEffect(() => {
    if (!activeSessionId) {
      setEntries([]);
      setSelectedPath(null);
      return;
    }

    setLoading(true);
    setError(null);

    void desktopApi
      .listDirectory(activeSessionId, path)
      .then((result) => {
        setEntries(result);
        setSelectedPath((current) => (current && result.some((entry) => entry.path === current) ? current : null));
        setContextMenu(null);
      })
      .catch((nextError) =>
        setError(nextError instanceof Error ? nextError.message : 'No se pudo cargar el directorio remoto')
      )
      .finally(() => setLoading(false));
  }, [activeSessionId, path, reloadKey]);

  useEffect(() => {
    const dismissContextMenu = () => setContextMenu(null);
    window.addEventListener('click', dismissContextMenu);
    window.addEventListener('scroll', dismissContextMenu, true);
    return () => {
      window.removeEventListener('click', dismissContextMenu);
      window.removeEventListener('scroll', dismissContextMenu, true);
    };
  }, []);

  useEffect(() => {
    if (!activeResize) {
      return;
    }

    const minWidths: Record<SortKey, number> = {
      name: 180,
      size: 52,
      modifiedAt: 82
    };
    const maxWidths: Record<SortKey, number> = {
      name: 640,
      size: 160,
      modifiedAt: 220
    };

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = Math.min(
        maxWidths[activeResize.column],
        Math.max(minWidths[activeResize.column], activeResize.startWidth + event.clientX - activeResize.startX)
      );

      setColumnWidths((current) => ({
        ...current,
        [activeResize.column]: nextWidth
      }));
    };

    const handleMouseUp = () => setActiveResize(null);

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeResize]);

  const visibleEntries = useMemo(
    () =>
      entries
        .filter((entry) => showHidden || !entry.name.startsWith('.'))
        .sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === 'directory' ? -1 : 1;
          }

          let result = 0;

          if (sortKey === 'name') {
            result = left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
          } else if (sortKey === 'size') {
            result = parseSize(left.size) - parseSize(right.size);
          } else {
            result = formatModified(left.modifiedAt).localeCompare(formatModified(right.modifiedAt), 'es');
          }

          return sortDirection === 'asc' ? result : -result;
        }),
    [entries, showHidden, sortDirection, sortKey]
  );

  const selectedEntry = useMemo(
    () => visibleEntries.find((entry) => entry.path === selectedPath) ?? null,
    [selectedPath, visibleEntries]
  );

  const breadcrumbs = useMemo(() => {
    const normalized = normalizePath(path);
    const segments = normalized.split('/').filter(Boolean);
    const items = [{ label: '/', value: '/' }];

    let currentPath = '';
    segments.forEach((segment) => {
      currentPath = `${currentPath}/${segment}`;
      items.push({ label: segment, value: currentPath });
    });

    return items;
  }, [path]);

  const refresh = () => setReloadKey((value) => value + 1);

  const navigate = (nextPath: string) => {
    const normalized = normalizePath(nextPath);
    setPath(normalized);
    setDraftPath(normalized);
    setSelectedPath(null);
  };

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(draftPath);
  };

  const handleNewFolder = async () => {
    if (!activeSessionId) {
      return;
    }

    try {
      const folderName = window.prompt('Nombre de la nueva carpeta');
      if (!folderName) {
        return;
      }

      await desktopApi.createDirectory(activeSessionId, joinPath(path, folderName));
      setError(null);
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo crear la carpeta');
    }
  };

  const handleRenameEntry = async (entry: SftpEntry) => {
    if (!activeSessionId) {
      return;
    }

    try {
      const nextName = window.prompt('Nuevo nombre', entry.name);
      if (!nextName || nextName === entry.name) {
        return;
      }

      await desktopApi.renameEntry(activeSessionId, entry.path, joinPath(path, nextName));
      setError(null);
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo renombrar el elemento');
    }
  };

  const handleRename = async () => {
    if (!selectedEntry) {
      return;
    }

    await handleRenameEntry(selectedEntry);
  };

  const handleDeleteEntry = async (entry: SftpEntry) => {
    if (!activeSessionId) {
      return;
    }

    try {
      const confirmed = window.confirm(`¿Eliminar "${entry.name}"?`);
      if (!confirmed) {
        return;
      }

      await desktopApi.deleteEntry(activeSessionId, entry.path, entry.type);
      setSelectedPath((current) => (current === entry.path ? null : current));
      setError(null);
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'No se pudo eliminar el elemento');
    }
  };

  const handleDelete = async () => {
    if (!selectedEntry) {
      return;
    }

    await handleDeleteEntry(selectedEntry);
  };

  const handleOpenEntry = (entry: SftpEntry) => {
    setContextMenu(null);
    if (entry.type === 'directory') {
      navigate(entry.path);
      return;
    }

    setSelectedPath(entry.path);
  };

  const handleSort = (nextSortKey: SortKey) => {
    setSortKey((currentKey) => {
      if (currentKey === nextSortKey) {
        setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
        return currentKey;
      }

      setSortDirection('asc');
      return nextSortKey;
    });
  };

  const sortIndicator = (column: SortKey) => {
    if (sortKey !== column) {
      return '↕';
    }

    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, entry: SftpEntry) => {
    event.preventDefault();
    setSelectedPath(entry.path);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry
    });
  };

  const runContextAction = async (action: 'open' | 'rename' | 'delete' | 'new-folder') => {
    setContextMenu(null);

    if (action === 'open' && contextMenu) {
      handleOpenEntry(contextMenu.entry);
      return;
    }

    if (action === 'new-folder') {
      await handleNewFolder();
      return;
    }

    if (!contextMenu) {
      return;
    }

    setSelectedPath(contextMenu.entry.path);

    if (action === 'rename') {
      await handleRenameEntry(contextMenu.entry);
      return;
    }

    if (action === 'delete') {
      await handleDeleteEntry(contextMenu.entry);
    }
  };

  const handleResizeStart = (column: SortKey, event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu(null);
    setActiveResize({
      column,
      startX: event.clientX,
      startWidth: columnWidths[column]
    });
  };

  const tableLayoutStyle = {
    '--sftp-columns': `${columnWidths.name}px ${columnWidths.size}px ${columnWidths.modifiedAt}px`,
    '--sftp-table-min-width': `${columnWidths.name + columnWidths.size + columnWidths.modifiedAt + 32}px`
  } as CSSProperties;

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>SFTP Explorer</p>
          <h2 className={styles.title}>{activeSession?.name ?? 'Sin sesión activa'}</h2>
        </div>
        <div className={styles.summary}>
          <span>{visibleEntries.length} elementos</span>
          <span>{selectedEntry ? `Seleccionado: ${selectedEntry.name}` : 'Sin selección'}</span>
        </div>
      </div>

      <div className={styles.toolbar}>
        <button type="button" onClick={() => navigate('/')} disabled={!activeSession || loading} title="Ir a raíz">
          ⟲
        </button>
        <button
          type="button"
          onClick={() => navigate(homePath)}
          disabled={!activeSession || loading}
          title="Ir al home"
        >
          ⌂
        </button>
        <button
          type="button"
          onClick={() => navigate(getParentPath(path))}
          disabled={!activeSession || loading || path === '/'}
          title="Subir un nivel"
        >
          ↑
        </button>
        <button type="button" onClick={refresh} disabled={!activeSession || loading} title="Refrescar">
          ↻
        </button>
        <button type="button" onClick={handleNewFolder} disabled={!activeSession || loading} title="Nueva carpeta">
          ＋ Carpeta
        </button>
        <button
          type="button"
          onClick={handleRename}
          disabled={!selectedEntry || loading}
          title="Renombrar seleccionado"
        >
          ✎ Renombrar
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={!selectedEntry || loading}
          title="Eliminar seleccionado"
        >
          ✕ Eliminar
        </button>
        <label className={styles.hiddenToggle}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(event) => setShowHidden(event.target.checked)}
          />
          <span>Ocultos</span>
        </label>
      </div>

      <div className={styles.breadcrumbs}>
        {breadcrumbs.map((crumb) => (
          <button key={crumb.value} type="button" onClick={() => navigate(crumb.value)} className={styles.crumb}>
            {crumb.label}
          </button>
        ))}
      </div>

      <form className={styles.pathBar} onSubmit={handlePathSubmit}>
        <input
          value={draftPath}
          disabled={!activeSession}
          onChange={(event) => setDraftPath(event.target.value)}
          placeholder="Ruta remota"
        />
        <button type="submit" disabled={!activeSession || loading}>
          Ir
        </button>
      </form>

      <div className={styles.workspace}>
        <div className={styles.tableShell} style={tableLayoutStyle}>
          <div className={styles.tableHeader}>
            <div className={styles.headerCell}>
              <button type="button" className={styles.headerButton} onClick={() => handleSort('name')}>
                <span>Name</span>
                <small>{sortIndicator('name')}</small>
              </button>
              <span
                className={styles.resizeHandle}
                role="separator"
                aria-orientation="vertical"
                title="Redimensionar Name"
                onMouseDown={(event) => handleResizeStart('name', event)}
              />
            </div>
            <div className={styles.headerCell}>
              <button type="button" className={styles.headerButton} onClick={() => handleSort('size')}>
                <span>Size</span>
                <small>{sortIndicator('size')}</small>
              </button>
              <span
                className={styles.resizeHandle}
                role="separator"
                aria-orientation="vertical"
                title="Redimensionar Size"
                onMouseDown={(event) => handleResizeStart('size', event)}
              />
            </div>
            <div className={styles.headerCell}>
              <button type="button" className={styles.headerButton} onClick={() => handleSort('modifiedAt')}>
                <span>Modified</span>
                <small>{sortIndicator('modifiedAt')}</small>
              </button>
              <span
                className={styles.resizeHandle}
                role="separator"
                aria-orientation="vertical"
                title="Redimensionar Modified"
                onMouseDown={(event) => handleResizeStart('modifiedAt', event)}
              />
            </div>
          </div>

          <div className={styles.tableBody}>
            {error ? (
              <div className={styles.emptyState}>
                <p>{error}</p>
              </div>
            ) : null}

            {!error &&
              visibleEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.row} ${selectedPath === entry.path ? styles.rowSelected : ''}`}
                  onClick={() => setSelectedPath(entry.path)}
                  onDoubleClick={() => handleOpenEntry(entry)}
                  onContextMenu={(event) => handleContextMenu(event, entry)}
                  title={entry.path}
                >
                  <span className={styles.nameCell}>
                    <span
                      className={`${styles.icon} ${entry.type === 'directory' ? styles.directoryIcon : styles.fileIcon}`}
                      aria-hidden="true"
                    >
                      {resolveEntryIcon(entry)}
                    </span>
                    <span className={styles.nameText}>{entry.name}</span>
                  </span>
                  <span>{entry.size || '—'}</span>
                  <span>{formatModified(entry.modifiedAt)}</span>
                </button>
              ))}

            {!visibleEntries.length && !error ? (
              <div className={styles.emptyState}>
                <p>
                  {activeSession
                    ? loading
                      ? 'Cargando directorio...'
                      : 'No hay elementos en esta ruta.'
                    : 'Selecciona una sesión para explorar archivos.'}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {contextMenu ? (
        <div className={styles.contextMenu} style={{ top: contextMenu.y + 4, left: contextMenu.x + 4 }}>
          <button type="button" onClick={() => void runContextAction('open')}>
            Abrir
          </button>
          <button type="button" onClick={() => void runContextAction('rename')}>
            Renombrar
          </button>
          <button type="button" onClick={() => void runContextAction('new-folder')}>
            Nueva carpeta
          </button>
          <button type="button" onClick={() => void runContextAction('delete')} className={styles.dangerAction}>
            Eliminar
          </button>
        </div>
      ) : null}
    </section>
  );
}
