import { invoke } from '@tauri-apps/api/core';
import { mockCredentials, mockSessions, mockSftpEntries, mockTunnels } from './mockData';
import { isTauriRuntime } from './runtime';
import type {
  Credential,
  CredentialDraft,
  Session,
  SessionDraft,
  SessionTransferData,
  SftpDownloadResult,
  SftpEntry,
  SftpUploadResult,
  TerminalBootstrap,
  TerminalOutput,
  Tunnel,
  TunnelDraft,
  WorkspaceTransferData
} from '../types/entities';

let sessionMemory = [...mockSessions];
let tunnelMemory = [...mockTunnels];
let credentialMemory = [...mockCredentials];
let sftpMemory = Object.fromEntries(
  Object.entries(mockSftpEntries).map(([sessionId, entries]) => [
    sessionId,
    entries.map((entry) => ({ ...entry }))
  ])
) as Record<string, SftpEntry[]>;
const sftpFileMemory = new Map<string, Uint8Array>();
const shellMemory = new Map<string, { sessionId: string; buffer: string }>();
const sessionPasswordMemory = new Map<string, string>([['dev-db', 'secret-demo-password']]);

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRemotePath(path: string) {
  const sanitized = path.trim().replace(/\\/g, '/');
  if (!sanitized || sanitized === '/') {
    return '/';
  }

  return `/${sanitized}`
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

function getParentDirectory(path: string) {
  const normalized = normalizeRemotePath(path);
  if (normalized === '/') {
    return '/';
  }

  const segments = normalized.split('/').filter(Boolean);
  segments.pop();
  return segments.length ? `/${segments.join('/')}` : '/';
}

function joinRemotePath(base: string, name: string) {
  const normalizedBase = normalizeRemotePath(base);
  return normalizeRemotePath(`${normalizedBase}/${name}`);
}

function getSftpFileKey(sessionId: string, path: string) {
  return `${sessionId}:${normalizeRemotePath(path)}`;
}

function collectMockDownloadStats(
  sessionId: string,
  normalizedPath: string
): Pick<SftpDownloadResult, 'filesDownloaded' | 'directoriesPrepared' | 'filesSkipped'> {
  const entry = (sftpMemory[sessionId] ?? []).find((item) => item.path === normalizedPath);

  if (!entry) {
    return {
      filesDownloaded: 0,
      directoriesPrepared: 0,
      filesSkipped: 1
    };
  }

  if (entry.type === 'file') {
    return {
      filesDownloaded: 1,
      directoriesPrepared: 0,
      filesSkipped: 0
    };
  }

  const children = (sftpMemory[sessionId] ?? []).filter(
    (item) => getParentDirectory(item.path) === normalizedPath
  );

  return children.reduce(
    (totals, child) => {
      const childTotals = collectMockDownloadStats(sessionId, child.path);
      return {
        filesDownloaded: totals.filesDownloaded + childTotals.filesDownloaded,
        directoriesPrepared: totals.directoriesPrepared + childTotals.directoriesPrepared,
        filesSkipped: totals.filesSkipped + childTotals.filesSkipped
      };
    },
    {
      filesDownloaded: 0,
      directoriesPrepared: 1,
      filesSkipped: 0
    }
  );
}

function buildSession(input: SessionDraft): Session {
  const selectedCredential =
    input.authKind === 'credential' && input.credentialId
      ? credentialMemory.find((credential) => credential.id === input.credentialId) ?? null
      : null;

  return {
    id: input.id ?? createId('session'),
    name: input.name,
    host: input.host,
    port: input.port,
    username: selectedCredential?.username ?? input.username,
    environment: input.environment,
    groupName: input.groupName,
    color: input.color,
    description: input.description,
    favorite: input.favorite,
    lastConnection: 'Nunca',
    authKind: input.authKind,
    credentialId: input.credentialId,
    credentialLabel: selectedCredential?.label ?? null,
    hasPassword: Boolean(input.password)
  };
}

function buildTunnel(input: TunnelDraft): Tunnel {
  return {
    id: input.id ?? createId('tunnel'),
    sessionId: input.sessionId,
    name: input.name,
    localPort: input.localPort,
    remoteHost: input.remoteHost,
    remotePort: input.remotePort,
    status: input.status
  };
}

function buildSessionTransfer(session: Session): SessionTransferData {
  return {
    id: session.id,
    name: session.name,
    host: session.host,
    port: session.port,
    username: session.username,
    environment: session.environment,
    groupName: session.groupName,
    color: session.color,
    description: session.description,
    favorite: session.favorite,
    authKind: session.authKind,
    credentialId: session.credentialId,
    password:
      session.authKind === 'manual' ? sessionPasswordMemory.get(session.id) ?? null : null
  };
}

function validateWorkspaceTransferData(input: WorkspaceTransferData) {
  if (input.version !== 1) {
    throw new Error('La version del archivo no es compatible con esta importacion');
  }

  const credentialIds = new Set<string>();
  for (const credential of input.credentials) {
    if (!credential.id?.trim()) {
      throw new Error('Cada credencial importada debe incluir un id');
    }

    if (credentialIds.has(credential.id)) {
      throw new Error(`La credencial importada '${credential.id}' aparece duplicada`);
    }

    credentialIds.add(credential.id);
  }

  const sessionIds = new Set<string>();
  for (const session of input.sessions) {
    if (!session.id?.trim()) {
      throw new Error('Cada sesion importada debe incluir un id');
    }

    if (sessionIds.has(session.id)) {
      throw new Error(`La sesion importada '${session.id}' aparece duplicada`);
    }

    sessionIds.add(session.id);

    if (session.authKind === 'credential' && !session.credentialId?.trim()) {
      throw new Error(`La sesion '${session.id}' requiere una credencial valida`);
    }

    if (session.authKind !== 'credential' && session.authKind !== 'manual') {
      throw new Error(`La sesion '${session.id}' tiene un tipo de autenticacion invalido`);
    }
  }
}

export const desktopApi = {
  async listCredentials() {
    if (isTauriRuntime()) {
      return invoke<Credential[]>('list_credentials');
    }

    return Promise.resolve([...credentialMemory]);
  },
  async saveCredential(input: CredentialDraft) {
    if (isTauriRuntime()) {
      return invoke<Credential>('save_credential', { input });
    }

    const nextCredential: Credential = {
      id: input.id ?? createId('credential'),
      label: input.label,
      username: input.username,
      password: input.password,
      note: input.note
    };
    const existingIndex = credentialMemory.findIndex((credential) => credential.id === nextCredential.id);

    if (existingIndex >= 0) {
      credentialMemory[existingIndex] = nextCredential;
      return Promise.resolve(nextCredential);
    }

    credentialMemory = [nextCredential, ...credentialMemory];
    return Promise.resolve(nextCredential);
  },
  async deleteCredential(id: string) {
    if (isTauriRuntime()) {
      return invoke<void>('delete_credential', { id });
    }

    const linkedSessionCount = sessionMemory.filter((session) => session.credentialId === id).length;
    if (linkedSessionCount > 0) {
      throw new Error('La credencial está asignada a una o más sesiones');
    }

    credentialMemory = credentialMemory.filter((credential) => credential.id !== id);
    return Promise.resolve();
  },
  async listSessions() {
    if (isTauriRuntime()) {
      return invoke<Session[]>('list_sessions');
    }

    return Promise.resolve([...sessionMemory]);
  },
  async saveSession(input: SessionDraft) {
    if (isTauriRuntime()) {
      return invoke<Session>('save_session', { input });
    }

    const existingPassword = input.id ? sessionPasswordMemory.get(input.id) : undefined;
    const nextPassword =
      input.authKind === 'manual'
        ? input.password && input.password.trim().length > 0
          ? input.password
          : existingPassword
        : undefined;
    const nextSession = buildSession({
      ...input,
      password: nextPassword
    });
    const existingIndex = sessionMemory.findIndex((session) => session.id === nextSession.id);

    if (nextSession.authKind === 'manual') {
      if (nextPassword && nextPassword.trim().length > 0) {
        sessionPasswordMemory.set(nextSession.id, nextPassword);
      } else {
        sessionPasswordMemory.delete(nextSession.id);
      }
    } else {
      sessionPasswordMemory.delete(nextSession.id);
    }

    if (existingIndex >= 0) {
      sessionMemory[existingIndex] = {
        ...sessionMemory[existingIndex],
        ...nextSession
      };
      return Promise.resolve(sessionMemory[existingIndex]);
    }

    sessionMemory = [nextSession, ...sessionMemory];
    return Promise.resolve(nextSession);
  },
  async deleteSession(id: string) {
    if (isTauriRuntime()) {
      return invoke<void>('delete_session', { id });
    }

    sessionMemory = sessionMemory.filter((session) => session.id !== id);
    tunnelMemory = tunnelMemory.filter((tunnel) => tunnel.sessionId !== id);
    sessionPasswordMemory.delete(id);
    return Promise.resolve();
  },
  async listTunnels() {
    if (isTauriRuntime()) {
      return invoke<Tunnel[]>('list_tunnels');
    }

    return Promise.resolve([...tunnelMemory]);
  },
  async saveTunnel(input: TunnelDraft) {
    if (isTauriRuntime()) {
      return invoke<Tunnel>('save_tunnel', { input });
    }

    const nextTunnel = buildTunnel(input);
    const existingIndex = tunnelMemory.findIndex((tunnel) => tunnel.id === nextTunnel.id);

    if (existingIndex >= 0) {
      tunnelMemory[existingIndex] = {
        ...tunnelMemory[existingIndex],
        ...nextTunnel
      };
      return Promise.resolve(tunnelMemory[existingIndex]);
    }

    tunnelMemory = [nextTunnel, ...tunnelMemory];
    return Promise.resolve(nextTunnel);
  },
  async deleteTunnel(id: string) {
    if (isTauriRuntime()) {
      return invoke<void>('delete_tunnel', { id });
    }

    tunnelMemory = tunnelMemory.filter((tunnel) => tunnel.id !== id);
    return Promise.resolve();
  },
  async exportWorkspaceData() {
    if (isTauriRuntime()) {
      return invoke<WorkspaceTransferData>('export_workspace_data');
    }

    return Promise.resolve({
      version: 1,
      exportedAt: new Date().toISOString(),
      credentials: credentialMemory.map((credential) => ({
        id: credential.id,
        label: credential.label,
        username: credential.username,
        password: credential.password,
        note: credential.note
      })),
      sessions: sessionMemory.map((session) => buildSessionTransfer(session))
    });
  },
  async exportWorkspaceDataToFile() {
    if (isTauriRuntime()) {
      return invoke<string | null>('export_workspace_data_to_file');
    }

    const data = await this.exportWorkspaceData();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const fileName = `opentermx-credenciales-sesiones-${new Date().toISOString().slice(0, 10)}.json`;
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return Promise.resolve(fileName);
  },
  async importWorkspaceData(input: WorkspaceTransferData) {
    if (isTauriRuntime()) {
      return invoke<void>('import_workspace_data', { input });
    }

    validateWorkspaceTransferData(input);

    const nextCredentials = [...credentialMemory];
    for (const credential of input.credentials) {
      const normalizedCredential: Credential = {
        id: credential.id,
        label: credential.label,
        username: credential.username,
        password: credential.password,
        note: credential.note
      };
      const existingIndex = nextCredentials.findIndex((item) => item.id === normalizedCredential.id);

      if (existingIndex >= 0) {
        nextCredentials[existingIndex] = normalizedCredential;
      } else {
        nextCredentials.unshift(normalizedCredential);
      }
    }
    credentialMemory = nextCredentials;

    const nextSessions = [...sessionMemory];
    for (const session of input.sessions) {
      const existingPassword = sessionPasswordMemory.get(session.id);
      const resolvedPassword =
        session.authKind === 'manual'
          ? session.password && session.password.trim().length > 0
            ? session.password
            : existingPassword
          : undefined;

      const normalizedSession = buildSession({
        ...session,
        password: resolvedPassword ?? undefined
      });

      if (
        normalizedSession.authKind === 'credential' &&
        !credentialMemory.some((credential) => credential.id === normalizedSession.credentialId)
      ) {
        throw new Error(`La sesion '${normalizedSession.id}' requiere una credencial valida`);
      }

      if (normalizedSession.authKind === 'manual') {
        if (resolvedPassword && resolvedPassword.trim().length > 0) {
          sessionPasswordMemory.set(normalizedSession.id, resolvedPassword);
        } else {
          sessionPasswordMemory.delete(normalizedSession.id);
        }
      } else {
        sessionPasswordMemory.delete(normalizedSession.id);
      }

      const existingIndex = nextSessions.findIndex((item) => item.id === normalizedSession.id);
      if (existingIndex >= 0) {
        nextSessions[existingIndex] = {
          ...nextSessions[existingIndex],
          ...normalizedSession
        };
      } else {
        nextSessions.unshift(normalizedSession);
      }
    }

    sessionMemory = nextSessions;
    return Promise.resolve();
  },
  async bootstrapTerminal(sessionId: string, cols?: number, rows?: number) {
    if (isTauriRuntime()) {
      return invoke<TerminalBootstrap>('open_terminal', { sessionId, cols, rows });
    }

    const session = sessionMemory.find((item) => item.id === sessionId);
    const shellId = createId('shell');
    shellMemory.set(shellId, {
      sessionId,
      buffer: session
        ? `\r\n${session.username}@${session.host}:${session.port}\r\n$ `
        : '\r\n$ '
    });

    return Promise.resolve({
      shellId,
      banner: session
        ? `Vista local preparada para ${session.username}@${session.host}:${session.port}`
        : `OpenTermX preparó una vista local para la sesión ${sessionId}`,
      connected: Boolean(session && (session.hasPassword || session.credentialId)),
      initialOutput: session ? '\r\n$ ' : ''
    });
  },
  async readTerminalOutput(shellId: string) {
    if (isTauriRuntime()) {
      return invoke<TerminalOutput>('read_terminal_output', { shellId });
    }

    const shell = shellMemory.get(shellId);
    if (!shell) {
      return Promise.resolve({ data: '', closed: true });
    }

    const data = shell.buffer;
    shell.buffer = '';
    return Promise.resolve({ data, closed: false });
  },
  async enableTerminalStream(shellId: string) {
    if (isTauriRuntime()) {
      return invoke<TerminalOutput>('enable_terminal_stream', { shellId });
    }

    const shell = shellMemory.get(shellId);
    return Promise.resolve({ data: shell?.buffer ?? '', closed: !shell });
  },
  async writeTerminalInput(shellId: string, input: string) {
    if (isTauriRuntime()) {
      return invoke<void>('write_terminal_input', { shellId, input });
    }

    const shell = shellMemory.get(shellId);
    if (!shell) {
      return Promise.resolve();
    }

    shell.buffer += input;
    if (input.includes('\r')) {
      shell.buffer += '\r\nComando ejecutado en la vista web local.\r\n$ ';
    }
    return Promise.resolve();
  },
  async resizeTerminal(shellId: string, cols: number, rows: number) {
    if (isTauriRuntime()) {
      return invoke<void>('resize_terminal', { shellId, cols, rows });
    }

    void shellId;
    void cols;
    void rows;
    return Promise.resolve();
  },
  async closeTerminal(shellId: string) {
    if (isTauriRuntime()) {
      return invoke<void>('close_terminal', { shellId });
    }

    shellMemory.delete(shellId);
    return Promise.resolve();
  },
  async listDirectory(sessionId: string, path?: string, shellId?: string | null) {
    if (isTauriRuntime()) {
      return invoke<SftpEntry[]>('list_directory', { sessionId, path, shellId });
    }

    const baseEntries = sftpMemory[sessionId] ?? [];
    const targetPath = normalizeRemotePath(path ?? '/');

    return Promise.resolve(
      baseEntries.map((entry) => ({
        ...entry
      }))
        .filter((entry) => getParentDirectory(entry.path) === targetPath)
        .sort((left, right) => {
          if (left.type !== right.type) {
            return left.type === 'directory' ? -1 : 1;
          }

          return left.name.localeCompare(right.name, 'es', { sensitivity: 'base' });
        })
    );
  },
  async createDirectory(sessionId: string, path: string, shellId?: string | null) {
    if (isTauriRuntime()) {
      return invoke<void>('create_directory', { sessionId, path, shellId });
    }

    const normalizedPath = normalizeRemotePath(path);
    const entryName = normalizedPath.split('/').filter(Boolean).pop();

    if (!entryName) {
      throw new Error('Ruta inválida para crear carpeta');
    }

    const nextEntry: SftpEntry = {
      id: createId('sftp'),
      name: entryName,
      path: normalizedPath,
      type: 'directory',
      size: '—',
      modifiedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
    };

    sftpMemory[sessionId] = [nextEntry, ...(sftpMemory[sessionId] ?? [])];
    return Promise.resolve();
  },
  async renameEntry(sessionId: string, fromPath: string, toPath: string, shellId?: string | null) {
    if (isTauriRuntime()) {
      return invoke<void>('rename_entry', { sessionId, fromPath, toPath, shellId });
    }

    const entries = sftpMemory[sessionId] ?? [];
    const nextFrom = normalizeRemotePath(fromPath);
    const nextTo = normalizeRemotePath(toPath);

    const movedFiles = new Map<string, Uint8Array>();
    [...sftpFileMemory.entries()].forEach(([key, value]) => {
      const prefix = `${sessionId}:`;
      if (!key.startsWith(prefix)) {
        return;
      }

      const currentPath = key.slice(prefix.length);
      if (currentPath === nextFrom) {
        movedFiles.set(nextTo, value);
        sftpFileMemory.delete(key);
        return;
      }

      if (currentPath.startsWith(`${nextFrom}/`)) {
        movedFiles.set(currentPath.replace(nextFrom, nextTo), value);
        sftpFileMemory.delete(key);
      }
    });

    sftpMemory[sessionId] = entries.map((entry) => {
      if (entry.path === nextFrom) {
        return {
          ...entry,
          name: nextTo.split('/').filter(Boolean).pop() ?? entry.name,
          path: nextTo
        };
      }

      if (entry.path.startsWith(`${nextFrom}/`)) {
        return {
          ...entry,
          path: entry.path.replace(nextFrom, nextTo),
          name:
            entry.path === nextFrom
              ? nextTo.split('/').filter(Boolean).pop() ?? entry.name
              : entry.name
        };
      }

      return entry;
    });

    movedFiles.forEach((value, movedPath) => {
      sftpFileMemory.set(getSftpFileKey(sessionId, movedPath), value);
    });

    return Promise.resolve();
  },
  async deleteEntry(sessionId: string, path: string, entryType: SftpEntry['type'], shellId?: string | null) {
    if (isTauriRuntime()) {
      return invoke<void>('delete_entry', { sessionId, path, entryType, shellId });
    }

    const normalizedPath = normalizeRemotePath(path);
    sftpMemory[sessionId] = (sftpMemory[sessionId] ?? []).filter((entry) => {
      if (entry.path === normalizedPath) {
        return false;
      }

      if (entryType === 'directory' && entry.path.startsWith(`${normalizedPath}/`)) {
        return false;
      }

      return true;
    });

    if (entryType === 'file') {
      sftpFileMemory.delete(getSftpFileKey(sessionId, normalizedPath));
    } else {
      [...sftpFileMemory.keys()].forEach((key) => {
        if (key === getSftpFileKey(sessionId, normalizedPath) || key.startsWith(`${sessionId}:${normalizedPath}/`)) {
          sftpFileMemory.delete(key);
        }
      });
    }

    return Promise.resolve();
  },
  async uploadFile(sessionId: string, remotePath: string, contents: Uint8Array, shellId?: string | null) {
    if (isTauriRuntime()) {
      return invoke<void>('upload_file', {
        sessionId,
        shellId,
        remotePath,
        contents: Array.from(contents)
      });
    }

    const normalizedPath = normalizeRemotePath(remotePath);
    const entryName = normalizedPath.split('/').filter(Boolean).pop();
    if (!entryName) {
      throw new Error('Ruta invalida para subir archivo');
    }

    const nextEntry: SftpEntry = {
      id: normalizedPath,
      name: entryName,
      path: normalizedPath,
      type: 'file',
      size: `${contents.byteLength} B`,
      modifiedAt: new Date().toISOString().slice(0, 16).replace('T', ' ')
    };

    const currentEntries = sftpMemory[sessionId] ?? [];
    const withoutExisting = currentEntries.filter((entry) => entry.path !== normalizedPath);
    sftpMemory[sessionId] = [nextEntry, ...withoutExisting];
    sftpFileMemory.set(getSftpFileKey(sessionId, normalizedPath), new Uint8Array(contents));
    return Promise.resolve();
  },
  async uploadEntries(sessionId: string, remoteDirectory: string): Promise<SftpUploadResult> {
    if (isTauriRuntime()) {
      return invoke<SftpUploadResult>('upload_entries', { sessionId, remoteDirectory });
    }

    return Promise.resolve({
      cancelled: true,
      filesUploaded: 0
    });
  },
  async downloadFile(sessionId: string, path: string, shellId?: string | null) {
    if (isTauriRuntime()) {
      const payload = await invoke<number[]>('download_file', { sessionId, path, shellId });
      return Uint8Array.from(payload);
    }

    const normalizedPath = normalizeRemotePath(path);
    const cached = sftpFileMemory.get(getSftpFileKey(sessionId, normalizedPath));
    if (cached) {
      return Promise.resolve(new Uint8Array(cached));
    }

    const entry = (sftpMemory[sessionId] ?? []).find((item) => item.path === normalizedPath);
    if (!entry || entry.type !== 'file') {
      throw new Error('No se encontro el archivo remoto');
    }

    const fallback = new TextEncoder().encode(`Mock file for ${entry.name}\n`);
    return Promise.resolve(fallback);
  },
  async downloadEntries(sessionId: string, paths: string[]): Promise<SftpDownloadResult> {
    if (isTauriRuntime()) {
      return invoke<SftpDownloadResult>('download_entries', { sessionId, paths });
    }

    const totals = paths.reduce<SftpDownloadResult>(
      (result, path) => {
        const next = collectMockDownloadStats(sessionId, normalizeRemotePath(path));
        return {
          cancelled: false,
          filesDownloaded: result.filesDownloaded + next.filesDownloaded,
          directoriesPrepared: result.directoriesPrepared + next.directoriesPrepared,
          filesSkipped: result.filesSkipped + next.filesSkipped
        };
      },
      {
        cancelled: false,
        filesDownloaded: 0,
        directoriesPrepared: 0,
        filesSkipped: 0
      }
    );

    return Promise.resolve(totals);
  }
};
