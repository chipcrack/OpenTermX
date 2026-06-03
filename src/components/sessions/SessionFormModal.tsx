import { useEffect, useState } from 'react';
import { Modal } from '../layout/Modal';
import { useSessionStore } from '../../stores/sessionStore';
import type { SessionDraft } from '../../types/entities';
import styles from './SessionFormModal.module.css';

const defaultDraft: SessionDraft = {
  name: '',
  host: '',
  port: 22,
  username: '',
  environment: 'development',
  groupName: '',
  color: '#3b82f6',
  description: '',
  favorite: false,
  authKind: 'manual',
  credentialId: null,
  password: ''
};

export function SessionFormModal() {
  const sessions = useSessionStore((state) => state.sessions);
  const credentials = useSessionStore((state) => state.credentials);
  const sessionFormOpen = useSessionStore((state) => state.sessionFormOpen);
  const editingSessionId = useSessionStore((state) => state.editingSessionId);
  const closeSessionForm = useSessionStore((state) => state.closeSessionForm);
  const saveSession = useSessionStore((state) => state.saveSession);
  const deleteSession = useSessionStore((state) => state.deleteSession);
  const loading = useSessionStore((state) => state.loading);

  const editingSession = sessions.find((session) => session.id === editingSessionId);
  const [draft, setDraft] = useState<SessionDraft>(defaultDraft);

  useEffect(() => {
    if (!sessionFormOpen) {
      return;
    }

    if (editingSession) {
      setDraft({
        id: editingSession.id,
        name: editingSession.name,
        host: editingSession.host,
        port: editingSession.port,
        username: editingSession.username,
        environment: editingSession.environment,
        groupName: editingSession.groupName,
        color: editingSession.color,
        description: editingSession.description,
        favorite: editingSession.favorite,
        authKind: editingSession.authKind,
        credentialId: editingSession.credentialId,
        password: ''
      });
      return;
    }

    setDraft(defaultDraft);
  }, [editingSession, sessionFormOpen]);

  if (!sessionFormOpen) {
    return null;
  }

  return (
    <Modal
      title={editingSession ? 'Editar sesión' : 'Nueva sesión'}
      subtitle="Configura una conexión SSH reutilizable con autenticación manual o mediante credencial guardada."
      onClose={closeSessionForm}
    >
      <form
        className={styles.form}
        onSubmit={async (event) => {
          event.preventDefault();
          await saveSession(draft);
        }}
      >
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
            <span>Host</span>
            <input
              required
              value={draft.host}
              onChange={(event) => setDraft((state) => ({ ...state, host: event.target.value }))}
            />
          </label>
          <label className={styles.field}>
            <span>Puerto</span>
            <input
              required
              min={1}
              max={65535}
              type="number"
              value={draft.port}
              onChange={(event) =>
                setDraft((state) => ({ ...state, port: Number(event.target.value) }))
              }
            />
          </label>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Usuario</span>
            <input
              required
              disabled={draft.authKind === 'credential'}
              value={draft.username}
              onChange={(event) =>
                setDraft((state) => ({ ...state, username: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Entorno</span>
            <select
              value={draft.environment}
              onChange={(event) =>
                setDraft((state) => ({
                  ...state,
                  environment: event.target.value as SessionDraft['environment']
                }))
              }
            >
              <option value="development">development</option>
              <option value="staging">staging</option>
              <option value="production">production</option>
            </select>
          </label>
        </div>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span>Grupo</span>
            <input
              required
              value={draft.groupName}
              onChange={(event) =>
                setDraft((state) => ({ ...state, groupName: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Color</span>
            <input
              type="color"
              value={draft.color}
              onChange={(event) => setDraft((state) => ({ ...state, color: event.target.value }))}
            />
          </label>
        </div>

        <div className={styles.authBlock}>
          <span className={styles.authLabel}>Autenticación</span>
          <div className={styles.authModes}>
            <button
              type="button"
              className={`${styles.modeButton} ${
                draft.authKind === 'manual' ? styles.modeButtonActive : ''
              }`}
              onClick={() =>
                setDraft((state) => ({
                  ...state,
                  authKind: 'manual',
                  credentialId: null
                }))
              }
            >
              Manual
            </button>
            <button
              type="button"
              className={`${styles.modeButton} ${
                draft.authKind === 'credential' ? styles.modeButtonActive : ''
              }`}
              onClick={() =>
                setDraft((state) => ({
                  ...state,
                  authKind: 'credential',
                  credentialId: credentials[0]?.id ?? null,
                  username: credentials[0]?.username ?? state.username
                }))
              }
            >
              Credencial guardada
            </button>
          </div>
        </div>

        {draft.authKind === 'manual' ? (
          <label className={styles.field}>
            <span>Contraseña SSH</span>
            <input
              type="password"
              placeholder={editingSession?.hasPassword ? 'Dejar vacío para conservar la actual' : 'Ingresa la contraseña del usuario SSH'}
              value={draft.password ?? ''}
              onChange={(event) =>
                setDraft((state) => ({ ...state, password: event.target.value }))
              }
            />
            <p className={styles.helper}>Se usa solo para esta sesión guardada en tu equipo.</p>
          </label>
        ) : (
          <label className={styles.field}>
            <span>Credencial</span>
            <select
              required
              value={draft.credentialId ?? ''}
              onChange={(event) => {
                const credential =
                  credentials.find((item) => item.id === event.target.value) ?? null;
                setDraft((state) => ({
                  ...state,
                  credentialId: event.target.value,
                  username: credential?.username ?? state.username
                }));
              }}
            >
              {!credentials.length ? <option value="">No hay credenciales guardadas</option> : null}
              {credentials.map((credential) => (
                <option key={credential.id} value={credential.id}>
                  {credential.label} ({credential.username})
                </option>
              ))}
            </select>
            <p className={styles.helper}>
              Selecciona una credencial reutilizable desde el administrador.
            </p>
          </label>
        )}

        <label className={styles.field}>
          <span>Descripción</span>
          <textarea
            rows={4}
            value={draft.description}
            onChange={(event) =>
              setDraft((state) => ({ ...state, description: event.target.value }))
            }
          />
        </label>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={draft.favorite}
            onChange={(event) =>
              setDraft((state) => ({ ...state, favorite: event.target.checked }))
            }
          />
          <span>Marcar como favorita</span>
        </label>

        <div className={styles.actions}>
          {editingSession ? (
            <button
              type="button"
              className={styles.dangerButton}
              onClick={() => deleteSession(editingSession.id)}
            >
              Eliminar
            </button>
          ) : (
            <span />
          )}
          <div className={styles.submitGroup}>
            <button type="button" className={styles.secondaryButton} onClick={closeSessionForm}>
              Cancelar
            </button>
            <button type="submit" className={styles.primaryButton} disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar sesión'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
