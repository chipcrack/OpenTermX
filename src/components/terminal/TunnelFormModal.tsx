import { useEffect, useState } from 'react';
import { Modal } from '../layout/Modal';
import { useSessionStore } from '../../stores/sessionStore';
import type { TunnelDraft } from '../../types/entities';
import styles from './TunnelFormModal.module.css';

const defaultDraft: TunnelDraft = {
  sessionId: '',
  name: '',
  localPort: 8080,
  remoteHost: '127.0.0.1',
  remotePort: 3000,
  status: 'inactive'
};

export function TunnelFormModal() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const tunnels = useSessionStore((state) => state.tunnels);
  const tunnelFormOpen = useSessionStore((state) => state.tunnelFormOpen);
  const editingTunnelId = useSessionStore((state) => state.editingTunnelId);
  const closeTunnelForm = useSessionStore((state) => state.closeTunnelForm);
  const saveTunnel = useSessionStore((state) => state.saveTunnel);
  const deleteTunnel = useSessionStore((state) => state.deleteTunnel);
  const loading = useSessionStore((state) => state.loading);

  const editingTunnel = tunnels.find((tunnel) => tunnel.id === editingTunnelId);
  const [draft, setDraft] = useState<TunnelDraft>(defaultDraft);

  useEffect(() => {
    if (!tunnelFormOpen) {
      return;
    }

    if (editingTunnel) {
      setDraft(editingTunnel);
      return;
    }

    setDraft({
      ...defaultDraft,
      sessionId: activeSessionId ?? sessions[0]?.id ?? ''
    });
  }, [activeSessionId, editingTunnel, sessions, tunnelFormOpen]);

  if (!tunnelFormOpen) {
    return null;
  }

  return (
    <Modal
      title={editingTunnel ? 'Editar túnel' : 'Nuevo túnel'}
      subtitle="Preparado para port forwarding y automatización del workspace."
      onClose={closeTunnelForm}
    >
      <form
        className={styles.form}
        onSubmit={async (event) => {
          event.preventDefault();
          await saveTunnel(draft);
        }}
      >
        <label className={styles.field}>
          <span>Sesión</span>
          <select
            required
            value={draft.sessionId}
            onChange={(event) => setDraft((state) => ({ ...state, sessionId: event.target.value }))}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Nombre</span>
          <input
            required
            value={draft.name}
            onChange={(event) => setDraft((state) => ({ ...state, name: event.target.value }))}
          />
        </label>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Puerto local</span>
            <input
              required
              min={1}
              max={65535}
              type="number"
              value={draft.localPort}
              onChange={(event) =>
                setDraft((state) => ({ ...state, localPort: Number(event.target.value) }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Puerto remoto</span>
            <input
              required
              min={1}
              max={65535}
              type="number"
              value={draft.remotePort}
              onChange={(event) =>
                setDraft((state) => ({ ...state, remotePort: Number(event.target.value) }))
              }
            />
          </label>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Host remoto</span>
            <input
              required
              value={draft.remoteHost}
              onChange={(event) =>
                setDraft((state) => ({ ...state, remoteHost: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Estado</span>
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft((state) => ({
                  ...state,
                  status: event.target.value as TunnelDraft['status']
                }))
              }
            >
              <option value="inactive">inactive</option>
              <option value="active">active</option>
            </select>
          </label>
        </div>

        <div className={styles.actions}>
          {editingTunnel ? (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => deleteTunnel(editingTunnel.id)}
            >
              Eliminar
            </button>
          ) : (
            <span />
          )}
          <div className={styles.submitGroup}>
            <button type="button" className={styles.secondaryButton} onClick={closeTunnelForm}>
              Cancelar
            </button>
            <button type="submit" className={styles.primaryButton} disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar túnel'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
