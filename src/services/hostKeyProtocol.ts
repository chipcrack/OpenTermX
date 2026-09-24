export interface HostKeyNotice {
  code: 'unknown' | 'changed';
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
  expectedFingerprint: string | null;
  token: string | null;
}

export class HostKeyVerificationError extends Error {}

export function parseHostKeyNotice(error: unknown): HostKeyNotice | null {
  if (typeof error !== 'string' || !error.startsWith('SSH_HOST_KEY:')) return null;
  try {
    const value = JSON.parse(error.slice('SSH_HOST_KEY:'.length));
    if (
      !value || !['unknown', 'changed'].includes(value.code) ||
      typeof value.host !== 'string' || !Number.isInteger(value.port) ||
      typeof value.algorithm !== 'string' || typeof value.fingerprint !== 'string' ||
      (value.code === 'unknown' && typeof value.token !== 'string') ||
      (value.code === 'changed' && typeof value.expectedFingerprint !== 'string')
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function blockedMessage(notice: HostKeyNotice) {
  return `Conexion SSH bloqueada: cambio la clave de ${notice.host}:${notice.port}.\n` +
    `Huella guardada: ${notice.expectedFingerprint}\nHuella recibida: ${notice.fingerprint}\n` +
    'Verifica el cambio con el administrador del servidor. La clave guardada no se reemplazo.';
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

// A retry is only allowed after an explicit confirmation, before authentication
// and before the remote operation has started. Never retry a changed host key.
export function createHostKeyInvoker(invoke: Invoke, confirm: (notice: HostKeyNotice) => Promise<boolean>): Invoke {
  const decisions = new Map<string, { promise: Promise<void>; createdAt: number }>();
  return async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      const notice = parseHostKeyNotice(error);
      if (!notice) throw error;
      if (notice.code === 'changed') throw new HostKeyVerificationError(blockedMessage(notice));
      const token = notice.token!;
      // Keep resolved decisions briefly: concurrent IPC responses can arrive
      // after the dialog has closed. Reusing a one-use token would fail then.
      for (const [id, decision] of decisions) {
        if (Date.now() - decision.createdAt > 600_000) decisions.delete(id);
      }
      let decision = decisions.get(token)?.promise;
      if (!decision) {
        decision = (async () => {
          const accept = await confirm(notice);
          await invoke('resolve_host_key', { token, accept });
          if (!accept) throw new HostKeyVerificationError('Conexion cancelada: no se acepto la identidad del servidor.');
        })();
        if (decisions.size >= 128) decisions.delete(decisions.keys().next().value!);
        decisions.set(token, { promise: decision, createdAt: Date.now() });
      }
      try {
        await decision;
      } catch (failure) {
        throw failure instanceof HostKeyVerificationError ? failure : new HostKeyVerificationError(String(failure));
      }
      try {
        return await invoke<T>(command, args);
      } catch (retryError) {
        const retryNotice = parseHostKeyNotice(retryError);
        if (retryNotice) {
          throw new HostKeyVerificationError(retryNotice.code === 'changed'
            ? blockedMessage(retryNotice)
            : 'No se pudo verificar la clave confirmada. Vuelve a conectar.');
        }
        throw retryError;
      }
    }
  };
}
