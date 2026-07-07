import { invoke } from '@tauri-apps/api/core';
import { mockCredentials, mockSessions, mockSftpEntries, mockTunnels } from './mockData';
import { isTauriRuntime } from './runtime';
import type {
  Credential,
  CredentialDraft,
  Session,
  SessionDraft,
  SftpEntry,
  TerminalBootstrap,
  TerminalOutput,
  Tunnel,
  TunnelDraft
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

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRemotePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed}`
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

    const nextSession = buildSession(input);
    const existingIndex = sessionMemory.findIndex((session) => session.id === nextSession.id);

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
  async listDirectory(sessionId: string, path?: string) {
    if (isTauriRuntime()) {
      return invoke<SftpEntry[]>('list_directory', { sessionId, path });
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
  async createDirectory(sessionId: string, path: string) {
    if (isTauriRuntime()) {
      return invoke<void>('create_directory', { sessionId, path });
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
  async renameEntry(sessionId: string, fromPath: string, toPath: string) {
    if (isTauriRuntime()) {
      return invoke<void>('rename_entry', { sessionId, fromPath, toPath });
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
  async deleteEntry(sessionId: string, path: string, entryType: SftpEntry['type']) {
    if (isTauriRuntime()) {
      return invoke<void>('delete_entry', { sessionId, path, entryType });
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
  async uploadFile(sessionId: string, remotePath: string, contents: Uint8Array) {
    if (isTauriRuntime()) {
      return invoke<void>('upload_file', {
        sessionId,
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
  async downloadFile(sessionId: string, path: string) {
    if (isTauriRuntime()) {
      const payload = await invoke<number[]>('download_file', { sessionId, path });
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
  }
};
