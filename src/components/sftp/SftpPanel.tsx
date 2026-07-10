import {
  type ChangeEvent,
  type CSSProperties,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Modal } from '../layout/Modal';
import { desktopApi } from '../../services/desktopApi';
import { isTauriRuntime } from '../../services/runtime';
import { useSessionStore } from '../../stores/sessionStore';
import type { SftpEntry } from '../../types/entities';
import styles from './SftpPanel.module.css';

type SortKey = 'name' | 'size' | 'modifiedAt';
type SortDirection = 'asc' | 'desc';
type TransferNoticeKind = 'success' | 'error' | 'info';
type SftpDialogState =
  | {
      kind: 'new-folder';
      value: string;
    }
  | {
      kind: 'rename';
      entry: SftpEntry;
      value: string;
    }
  | {
      kind: 'delete';
      entry: SftpEntry;
    };

interface LocalWritable {
  write: (data: BlobPart) => Promise<void>;
  close: () => Promise<void>;
}

interface LocalFileHandle {
  createWritable: () => Promise<LocalWritable>;
}

interface LocalDirectoryHandle {
  getDirectoryHandle: (
    name: string,
    options?: {
      create?: boolean;
    }
  ) => Promise<LocalDirectoryHandle>;
  getFileHandle: (
    name: string,
    options?: {
      create?: boolean;
    }
  ) => Promise<LocalFileHandle>;
}

interface DownloadPlanStep {
  kind: 'directory' | 'file';
  relativePath: string;
  remotePath?: string;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<LocalDirectoryHandle>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      excludeAcceptAllOption?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: BlobPart) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  }
}

function normalizePath(path: string) {
  const sanitized = path.trim().replace(/\\/g, '/');
  if (!sanitized || sanitized === '/') {
    return '/';
  }

  return `/${sanitized}`.replace(/\/+/g, '/').replace(/\/$/, '');
}

function getParentPath(path: string) {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return '/';
  }

  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return '/';
  }

  return normalized.slice(0, lastSlashIndex) || '/';
}

function joinPath(basePath: string, segment: string) {
  return normalizePath(`${normalizePath(basePath)}/${segment}`);
}

function resolveHomePath(username?: string | null) {
  const normalizedUser = username?.trim();
  if (!normalizedUser) {
    return '/';
  }

  if (normalizedUser === 'root') {
    return '/root';
  }

  return normalizePath(`/home/${normalizedUser}`);
}

function formatModified(value: string) {
  if (!value) {
    return '--';
  }

  return value.replace('T', ' ').slice(0, 16);
}

function parseSize(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized === '--') {
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
    return 'DIR';
  }

  const lowerName = entry.name.toLowerCase();

  if (lowerName.startsWith('.env') || lowerName.endsWith('.conf') || lowerName.endsWith('.ini')) {
    return 'CFG';
  }

  if (
    lowerName.endsWith('.png') ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg') ||
    lowerName.endsWith('.gif') ||
    lowerName.endsWith('.svg') ||
    lowerName.endsWith('.webp')
  ) {
    return 'IMG';
  }

  if (
    lowerName.endsWith('.zip') ||
    lowerName.endsWith('.gz') ||
    lowerName.endsWith('.tar') ||
    lowerName.endsWith('.rar') ||
    lowerName.endsWith('.7z')
  ) {
    return 'ARC';
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
    return 'TXT';
  }

  if (lowerName.startsWith('.')) {
    return 'DOT';
  }

  return 'FILE';
}

function triggerBrowserDownload(fileName: string, bytes: Uint8Array) {
  const safeBytes = new Uint8Array(bytes.byteLength);
  safeBytes.set(bytes);
  const blob = new Blob([safeBytes as unknown as BlobPart]);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function saveBytesWithPicker(fileName: string, bytes: Uint8Array) {
  if (typeof window.showSaveFilePicker !== 'function') {
    triggerBrowserDownload(fileName, bytes);
    return 'downloads';
  }

  const handle = await window.showSaveFilePicker({
    suggestedName: fileName
  });
  const safeBytes = new Uint8Array(bytes.byteLength);
  safeBytes.set(bytes);
  const writable = await handle.createWritable();
  await writable.write(safeBytes as unknown as BlobPart);
  await writable.close();
  return 'custom';
}

async function pickDownloadDirectory() {
  if (typeof window.showDirectoryPicker !== 'function') {
    throw new Error('Este entorno no permite elegir carpetas locales para descargas estructuradas');
  }

  return window.showDirectoryPicker({
    id: 'opentermx-sftp-download',
    mode: 'readwrite'
  });
}

async function ensureLocalDirectory(rootHandle: LocalDirectoryHandle, relativePath: string) {
  const segments = relativePath.split('/').filter(Boolean);
  let currentHandle = rootHandle;

  for (const segment of segments) {
    currentHandle = await currentHandle.getDirectoryHandle(segment, { create: true });
  }

  return currentHandle;
}

async function createLocalDirectory(rootHandle: LocalDirectoryHandle, relativePath: string) {
  await ensureLocalDirectory(rootHandle, relativePath);
}

async function writeBytesToLocalPath(
  rootHandle: LocalDirectoryHandle,
  relativePath: string,
  bytes: Uint8Array
) {
  const segments = relativePath.split('/').filter(Boolean);
  const fileName = segments.pop();

  if (!fileName) {
    return false;
  }

  const directoryHandle = await ensureLocalDirectory(rootHandle, segments.join('/'));
  let exists = false;

  try {
    await directoryHandle.getFileHandle(fileName);
    exists = true;
  } catch {
    exists = false;
  }

  if (exists) {
    const confirmed = window.confirm(
      `El archivo local "${relativePath}" ya existe. Deseas sobrescribirlo?`
    );

    if (!confirmed) {
      return false;
    }
  }

  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const safeBytes = new Uint8Array(bytes.byteLength);
  safeBytes.set(bytes);
  const writable = await fileHandle.createWritable();
  await writable.write(safeBytes as unknown as BlobPart);
  await writable.close();
  return true;
}

async function collectDownloadPlan(
  sessionId: string,
  entry: SftpEntry,
  relativePath = entry.name
): Promise<DownloadPlanStep[]> {
  if (entry.type === 'file') {
    return [
      {
        kind: 'file',
        relativePath,
        remotePath: entry.path
      }
    ];
  }

  const children = await desktopApi.listDirectory(sessionId, entry.path);
  const plan: DownloadPlanStep[] = [
    {
      kind: 'directory',
      relativePath
    }
  ];

  for (const child of children) {
    plan.push(...(await collectDownloadPlan(sessionId, child, `${relativePath}/${child.name}`)));
  }

  return plan;
}

type ToolbarIconKind =
  | 'root'
  | 'home'
  | 'up'
  | 'refresh'
  | 'upload'
  | 'download'
  | 'folder'
  | 'rename'
  | 'delete';

function ToolbarIcon({
  kind,
  className
}: {
  kind: ToolbarIconKind;
  className?: string;
}) {
  if (kind === 'root') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 4v6" strokeLinecap="round" />
        <path d="M7 8h10l3 4v7H4v-7l3-4Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'home') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m4 11 8-6 8 6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.5 10.5V19h11v-8.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (kind === 'up') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M6 18h7a4 4 0 0 0 4-4V6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m13 10 4-4 4 4" strokeLinecap="round" strokeLinejoin="round" transform="translate(-4 0)" />
      </svg>
    );
  }

  if (kind === 'refresh') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M20 6v5h-5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 18v-5h5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7.5 8A7 7 0 0 1 19 11" strokeLinecap="round" />
        <path d="M16.5 16A7 7 0 0 1 5 13" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'upload') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 17V5" strokeLinecap="round" />
        <path d="m7 10 5-5 5 5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 19h14" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'download') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 5v12" strokeLinecap="round" />
        <path d="m7 12 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 19h14" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'folder') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3.5 7.5h6l2 2H20v8.5a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 11.5v5" strokeLinecap="round" />
        <path d="M9.5 14h5" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === 'rename') {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m4 20 4.5-1 9-9a1.8 1.8 0 0 0 0-2.5l-1-1a1.8 1.8 0 0 0-2.5 0l-9 9L4 20Z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m13 7 4 4" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M7 8h10" strokeLinecap="round" />
      <path d="M9 8V6.5A1.5 1.5 0 0 1 10.5 5h3A1.5 1.5 0 0 1 15 6.5V8" strokeLinecap="round" />
      <path d="M6 8.5 7 19h10l1-10.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SftpPanel() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const [path, setPath] = useState('/');
  const [draftPath, setDraftPath] = useState('/');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
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
  const [notice, setNotice] = useState<{
    kind: TransferNoticeKind;
    message: string;
  } | null>(null);
  const [dialogState, setDialogState] = useState<SftpDialogState | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pathRef = useRef(path);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [activeSessionId, sessions]
  );

  const homePath = useMemo(() => {
    return resolveHomePath(activeSession?.username);
  }, [activeSession?.username]);

  useEffect(() => {
    setSelectedPaths([]);
    setContextMenu(null);
    setPathHistory([]);
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
      setSelectedPaths([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    void desktopApi
      .listDirectory(activeSessionId, path)
      .then((result) => {
        setEntries(result);
        setSelectedPaths((current) =>
          current.filter((selectedPath) => result.some((entry) => entry.path === selectedPath))
        );
        setContextMenu(null);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'No se pudo cargar la ruta remota'))
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
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

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

  const parentPath = useMemo(() => getParentPath(path), [path]);
  const hasParent = path !== '/' && parentPath !== path;

  const displayEntries = useMemo(() => {
    if (!hasParent) {
      return visibleEntries;
    }

    const parentEntry: SftpEntry = {
      id: `__parent__:${path}`,
      name: '..',
      path: parentPath,
      type: 'directory',
      size: '--',
      modifiedAt: ''
    };

    return [parentEntry, ...visibleEntries];
  }, [hasParent, parentPath, path, visibleEntries]);

  const refresh = () => setReloadKey((value) => value + 1);

  const navigate = (nextPath: string, options?: { rememberCurrent?: boolean }) => {
    const normalized = normalizePath(nextPath);
    const currentPath = pathRef.current;

    if ((options?.rememberCurrent ?? true) && currentPath && currentPath !== normalized) {
      setPathHistory((currentHistory) => {
        if (currentHistory[currentHistory.length - 1] === currentPath) {
          return currentHistory;
        }

        return [...currentHistory, currentPath];
      });
    }

    setPath(normalized);
    setDraftPath(normalized);
    setSelectedPaths([]);
  };

  const navigateUp = () => {
    if (hasParent) {
      navigate(parentPath, { rememberCurrent: false });
      return;
    }

    const currentPath = pathRef.current;
    const previousPath = [...pathHistory].reverse().find((entry) => entry !== currentPath) ?? null;
    if (previousPath) {
      navigate(previousPath, { rememberCurrent: false });
    }
  };

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(draftPath);
  };

  const handleNewFolder = () => {
    if (!activeSessionId) {
      return;
    }

    setContextMenu(null);
    setDialogState({
      kind: 'new-folder',
      value: ''
    });
  };

  const handleRenameEntry = (entry: SftpEntry) => {
    if (!activeSessionId) {
      return;
    }

    setContextMenu(null);
    setDialogState({
      kind: 'rename',
      entry,
      value: entry.name
    });
  };

  const handleRename = () => {
    if (!selectedEntry) {
      return;
    }

    handleRenameEntry(selectedEntry);
  };

  const handleDeleteEntry = (entry: SftpEntry) => {
    if (!activeSessionId) {
      return;
    }

    setContextMenu(null);
    setDialogState({
      kind: 'delete',
      entry
    });
  };

  const handleDelete = () => {
    if (!selectedEntry) {
      return;
    }

    handleDeleteEntry(selectedEntry);
  };

  const handleOpenEntry = (entry: SftpEntry) => {
    setContextMenu(null);
    if (entry.type === 'directory') {
      navigate(entry.path);
      return;
    }

    setSelectedPaths([entry.path]);
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
      return '<>';
    }

    return sortDirection === 'asc' ? '^' : 'v';
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLButtonElement>, entry: SftpEntry) => {
    event.preventDefault();
    setSelectedPaths([entry.path]);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      entry
    });
  };

  const handleRowSelection = (event: ReactMouseEvent<HTMLButtonElement>, entry: SftpEntry) => {
    setContextMenu(null);
    const appendSelection = event.ctrlKey || event.metaKey;

    setSelectedPaths((current) => {
      if (!appendSelection) {
        return [entry.path];
      }

      if (current.includes(entry.path)) {
        return current.filter((selectedPath) => selectedPath !== entry.path);
      }

      return [...current, entry.path];
    });
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

  const closeDialog = () => setDialogState(null);

  const handleDialogSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();

    if (!activeSessionId || !dialogState) {
      return;
    }

    try {
      if (dialogState.kind === 'new-folder') {
        const folderName = dialogState.value.trim();
        if (!folderName) {
          return;
        }

        await desktopApi.createDirectory(activeSessionId, joinPath(path, folderName));
        setError(null);
        setDialogState(null);
        refresh();
        return;
      }

      if (dialogState.kind === 'rename') {
        const nextName = dialogState.value.trim();
        if (!nextName) {
          return;
        }

        if (nextName === dialogState.entry.name) {
          setDialogState(null);
          return;
        }

        await desktopApi.renameEntry(activeSessionId, dialogState.entry.path, joinPath(path, nextName));
        setError(null);
        setDialogState(null);
        refresh();
        return;
      }

      await desktopApi.deleteEntry(activeSessionId, dialogState.entry.path, dialogState.entry.type);
      setSelectedPaths((current) =>
        current.filter((selectedPath) => {
          if (selectedPath === dialogState.entry.path) {
            return false;
          }

          return !(
            dialogState.entry.type === 'directory' &&
            selectedPath.startsWith(`${dialogState.entry.path}/`)
          );
        })
      );
      setError(null);
      setDialogState(null);
      refresh();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : dialogState.kind === 'new-folder'
            ? 'No se pudo crear la carpeta'
            : dialogState.kind === 'rename'
              ? 'No se pudo renombrar el elemento'
              : 'No se pudo eliminar el elemento'
      );
    }
  };

  const handleSelectUpload = async () => {
    if (!activeSessionId) {
      return;
    }

    if (isTauriRuntime()) {
      try {
        setUploading(true);
        const result = await desktopApi.uploadEntries(activeSessionId, path);

        if (result.cancelled) {
          return;
        }

        setError(null);
        setNotice({
          kind: result.filesUploaded > 0 ? 'success' : 'info',
          message: `Subida completada: ${result.filesUploaded} archivo(s)`
        });
        refresh();
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : 'No se pudo subir el archivo';
        setError(message);
        setNotice({
          kind: 'error',
          message
        });
      } finally {
        setUploading(false);
      }

      return;
    }

    fileInputRef.current?.click();
  };

  const handleUploadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeSessionId) {
      event.target.value = '';
      return;
    }

    try {
      setUploading(true);
      const bytes = new Uint8Array(await file.arrayBuffer());
      await desktopApi.uploadFile(activeSessionId, joinPath(path, file.name), bytes);
      setError(null);
      setNotice({
        kind: 'success',
        message: `Subida completada: ${file.name}`
      });
      refresh();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'No se pudo subir el archivo';
      setError(message);
      setNotice({
        kind: 'error',
        message
      });
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleSingleFileDownload = async (entry: SftpEntry) => {
    if (!activeSessionId || entry.type !== 'file') {
      return;
    }

    if (isTauriRuntime()) {
      try {
        setDownloading(true);
        const result = await desktopApi.downloadEntries(activeSessionId, [entry.path]);

        if (result.cancelled) {
          return;
        }

        setError(null);
        setNotice({
          kind: result.filesDownloaded > 0 ? 'success' : 'info',
          message: `Descarga completada: ${result.filesDownloaded} archivo(s)${
            result.filesSkipped > 0 ? `, ${result.filesSkipped} omitido(s)` : ''
          }`
        });
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : 'No se pudo descargar el archivo';
        setError(message);
        setNotice({
          kind: 'error',
          message
        });
      } finally {
        setDownloading(false);
      }

      return;
    }

    try {
      setDownloading(true);
      const bytes = await desktopApi.downloadFile(activeSessionId, entry.path);
      const target = await saveBytesWithPicker(entry.name, bytes);
      setError(null);
      setNotice({
        kind: 'success',
        message:
          target === 'custom'
            ? `Descarga completada: ${entry.name}`
            : `Descarga iniciada en Descargas: ${entry.name}`
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : 'No se pudo descargar el archivo';
      setError(message);
      if (!(nextError instanceof DOMException && nextError.name === 'AbortError')) {
        setNotice({
          kind: 'error',
          message
        });
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleStructuredDownload = async (targets: SftpEntry[]) => {
    if (!activeSessionId || !targets.length) {
      return;
    }

    if (isTauriRuntime()) {
      try {
        setDownloading(true);
        const result = await desktopApi.downloadEntries(
          activeSessionId,
          targets.map((entry) => entry.path)
        );

        if (result.cancelled) {
          return;
        }

        setError(null);
        setNotice({
          kind: result.filesDownloaded > 0 ? 'success' : 'info',
          message: `Descarga completada: ${result.filesDownloaded} archivo(s), ${result.directoriesPrepared} carpeta(s)${
            result.filesSkipped > 0 ? `, ${result.filesSkipped} omitido(s)` : ''
          }`
        });
      } catch (nextError) {
        const message =
          nextError instanceof Error ? nextError.message : 'No se pudo completar la descarga';
        setError(message);
        setNotice({
          kind: 'error',
          message
        });
      } finally {
        setDownloading(false);
      }

      return;
    }

    try {
      setDownloading(true);

      if (typeof window.showDirectoryPicker !== 'function') {
        if (targets.some((entry) => entry.type === 'directory')) {
          throw new Error(
            'Esta plataforma no permite elegir una carpeta local para descargar directorios sin comprimir'
          );
        }

        for (const entry of targets) {
          const bytes = await desktopApi.downloadFile(activeSessionId, entry.path);
          triggerBrowserDownload(entry.name, bytes);
        }

        setError(null);
        setNotice({
          kind: 'info',
          message: `Descarga iniciada para ${targets.length} archivo(s)`
        });
        return;
      }

      const rootHandle = await pickDownloadDirectory();
      let filesDownloaded = 0;
      let filesSkipped = 0;
      let directoriesPrepared = 0;

      for (const target of targets) {
        const plan = await collectDownloadPlan(activeSessionId, target);

        for (const step of plan) {
          if (step.kind === 'directory') {
            await createLocalDirectory(rootHandle, step.relativePath);
            directoriesPrepared += 1;
            continue;
          }

          const bytes = await desktopApi.downloadFile(activeSessionId, step.remotePath!);
          const saved = await writeBytesToLocalPath(rootHandle, step.relativePath, bytes);

          if (saved) {
            filesDownloaded += 1;
          } else {
            filesSkipped += 1;
          }
        }
      }

      setError(null);
      setNotice({
        kind: filesDownloaded > 0 ? 'success' : 'info',
        message: `Descarga completada: ${filesDownloaded} archivo(s), ${directoriesPrepared} carpeta(s)${
          filesSkipped > 0 ? `, ${filesSkipped} omitido(s)` : ''
        }`
      });
    } catch (nextError) {
      const message =
        nextError instanceof Error ? nextError.message : 'No se pudo completar la descarga estructurada';
      setError(message);
      if (!(nextError instanceof DOMException && nextError.name === 'AbortError')) {
        setNotice({
          kind: 'error',
          message
        });
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleDownload = async (target: SftpEntry | SftpEntry[] = selectedEntries) => {
    const targets = Array.isArray(target) ? target : target ? [target] : [];

    if (!targets.length) {
      return;
    }

    if (targets.length === 1 && targets[0].type === 'file') {
      await handleSingleFileDownload(targets[0]);
      return;
    }

    await handleStructuredDownload(targets);
  };

  const runContextAction = async (action: 'open' | 'rename' | 'delete' | 'new-folder' | 'download' | 'upload') => {
    const currentEntry = contextMenu?.entry ?? null;
    setContextMenu(null);

    if (action === 'open' && currentEntry) {
      handleOpenEntry(currentEntry);
      return;
    }

      if (action === 'new-folder') {
        handleNewFolder();
        return;
      }

      if (action === 'upload') {
        await handleSelectUpload();
        return;
      }

    if (action === 'download' && currentEntry) {
      setSelectedPaths([currentEntry.path]);
      await handleDownload(currentEntry);
      return;
    }

    if (!currentEntry) {
      return;
    }

    setSelectedPaths([currentEntry.path]);

    if (action === 'rename') {
      await handleRenameEntry(currentEntry);
      return;
    }

    if (action === 'delete') {
      await handleDeleteEntry(currentEntry);
    }
  };

  const tableLayoutStyle = {
    '--sftp-columns': `${columnWidths.name}px ${columnWidths.size}px ${columnWidths.modifiedAt}px`,
    '--sftp-table-min-width': `${columnWidths.name + columnWidths.size + columnWidths.modifiedAt + 32}px`
  } as CSSProperties;

  const selectedEntries = useMemo(() => {
    const entryMap = new Map(visibleEntries.map((entry) => [entry.path, entry]));
    return selectedPaths
      .map((selectedPath) => entryMap.get(selectedPath))
      .filter((entry): entry is SftpEntry => Boolean(entry));
  }, [selectedPaths, visibleEntries]);

  const selectedEntry = selectedEntries[selectedEntries.length - 1] ?? null;

  return (
    <section className={styles.panel}>
      {notice ? (
        <div
          className={`${styles.notice} ${
            notice.kind === 'success'
              ? styles.noticeSuccess
              : notice.kind === 'error'
                ? styles.noticeError
                : styles.noticeInfo
          }`}
        >
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar notificacion">
            x
          </button>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={() => navigate('/')}
          disabled={!activeSession || loading}
          title="Ir a raiz"
          aria-label="Ir a raiz"
        >
          <ToolbarIcon kind="root" className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={() => navigate(homePath)}
          disabled={!activeSession || loading}
          title="Ir al home"
          aria-label="Ir al home"
        >
          <ToolbarIcon kind="home" className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={navigateUp}
          disabled={!activeSession || loading || path === '/'}
          title="Subir un nivel"
          aria-label="Subir un nivel"
        >
          <ToolbarIcon kind="up" className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={refresh}
          disabled={!activeSession || loading}
          title="Refrescar"
          aria-label="Refrescar"
        >
          <ToolbarIcon kind="refresh" className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={handleSelectUpload}
          disabled={!activeSession || loading || uploading}
          title={uploading ? 'Subiendo archivo...' : 'Subir archivo'}
          aria-label={uploading ? 'Subiendo archivo' : 'Subir archivo'}
        >
          <ToolbarIcon
            kind="upload"
            className={`${styles.toolbarIcon} ${uploading ? styles.toolbarIconBusy : ''}`}
          />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={() => void handleDownload()}
          disabled={!activeSession || !selectedEntries.length || loading || downloading}
          title="Descargar seleccion"
          aria-label="Descargar seleccion"
        >
          <ToolbarIcon
            kind="download"
            className={`${styles.toolbarIcon} ${downloading ? styles.toolbarIconBusy : ''}`}
          />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={handleNewFolder}
          disabled={!activeSession || loading}
          title="Nueva carpeta"
          aria-label="Nueva carpeta"
        >
          <ToolbarIcon kind="folder" className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={handleRename}
          disabled={!activeSession || selectedEntries.length !== 1 || loading}
          title="Renombrar seleccionado"
          aria-label="Renombrar seleccionado"
        >
          <ToolbarIcon kind="rename" className={styles.toolbarIcon} />
        </button>
        <button
          type="button"
          className={styles.toolbarIconButton}
          onClick={handleDelete}
          disabled={!activeSession || selectedEntries.length !== 1 || loading}
          title="Eliminar seleccionado"
          aria-label="Eliminar seleccionado"
        >
          <ToolbarIcon kind="delete" className={styles.toolbarIcon} />
        </button>
        <label className={styles.hiddenToggle}>
          <input type="checkbox" checked={showHidden} onChange={(event) => setShowHidden(event.target.checked)} />
          <span>Ocultos</span>
        </label>
      </div>

      <form className={styles.pathBar} onSubmit={handlePathSubmit}>
        <input
          value={draftPath}
          disabled={!activeSession}
          onChange={(event) => setDraftPath(event.target.value)}
          placeholder="Ruta remota"
        />
        <span className={styles.pathMeta}>
          {selectedEntries.length > 0 ? `${selectedEntries.length} sel` : `${visibleEntries.length} items`}
        </span>
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
              displayEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`${styles.row} ${selectedPaths.includes(entry.path) ? styles.rowSelected : ''}`}
                  onClick={(event) => {
                    if (entry.id.startsWith('__parent__:')) {
                      navigateUp();
                      return;
                    }

                    handleRowSelection(event, entry);
                  }}
                  onDoubleClick={() => {
                    if (entry.id.startsWith('__parent__:')) {
                      navigateUp();
                      return;
                    }

                    handleOpenEntry(entry);
                  }}
                  onContextMenu={(event) => handleContextMenu(event, entry)}
                  title={entry.path}
                >
                  <span className={styles.nameCell}>
                    <span
                      className={`${styles.icon} ${
                        entry.id.startsWith('__parent__:')
                          ? styles.parentIcon
                          : entry.type === 'directory'
                            ? styles.directoryIcon
                            : styles.fileIcon
                      }`}
                      aria-hidden="true"
                    >
                      {entry.id.startsWith('__parent__:') ? '..' : resolveEntryIcon(entry)}
                    </span>
                    <span className={styles.nameText}>{entry.name}</span>
                  </span>
                  <span>{entry.size || '--'}</span>
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
                    : 'Selecciona una sesion para explorar archivos.'}
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
          <button type="button" onClick={() => void runContextAction('download')}>
            Descargar
          </button>
          <button type="button" onClick={() => void runContextAction('upload')}>
            Subir aqui
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

      {dialogState ? (
        <Modal
          title={
            dialogState.kind === 'new-folder'
              ? 'Nueva carpeta'
              : dialogState.kind === 'rename'
                ? 'Renombrar elemento'
                : 'Confirmar eliminacion'
          }
          subtitle={
            dialogState.kind === 'delete'
              ? `Se eliminara "${dialogState.entry.name}" de la ruta remota actual.`
              : 'Accion gestionada dentro de la app de escritorio.'
          }
          onClose={closeDialog}
        >
          {dialogState.kind === 'delete' ? (
            <div className={styles.dialogBody}>
              <p className={styles.dialogText}>
                Vas a eliminar <strong>{dialogState.entry.name}</strong>. Esta accion no se puede deshacer.
              </p>
              <div className={styles.dialogActions}>
                <button type="button" className={styles.dialogButton} onClick={closeDialog}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`${styles.dialogButton} ${styles.dialogDangerButton}`}
                  onClick={() => void handleDialogSubmit()}
                >
                  Eliminar
                </button>
              </div>
            </div>
          ) : (
            <form className={styles.dialogForm} onSubmit={(event) => void handleDialogSubmit(event)}>
              <label className={styles.dialogField}>
                <span>{dialogState.kind === 'new-folder' ? 'Nombre de carpeta' : 'Nuevo nombre'}</span>
                <input
                  autoFocus
                  value={dialogState.value}
                  onChange={(event) =>
                    setDialogState((current) =>
                      current && current.kind !== 'delete'
                        ? {
                            ...current,
                            value: event.target.value
                          }
                        : current
                    )
                  }
                />
              </label>
              <div className={styles.dialogActions}>
                <button type="button" className={styles.dialogButton} onClick={closeDialog}>
                  Cancelar
                </button>
                <button type="submit" className={`${styles.dialogButton} ${styles.dialogPrimaryButton}`}>
                  Guardar
                </button>
              </div>
            </form>
          )}
        </Modal>
      ) : null}

      {!isTauriRuntime() ? <input ref={fileInputRef} type="file" hidden onChange={handleUploadFile} /> : null}
    </section>
  );
}
