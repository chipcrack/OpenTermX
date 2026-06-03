import { useEffect, useState } from 'react';
import { Modal } from '../layout/Modal';
import { useSessionStore } from '../../stores/sessionStore';
import type { CredentialDraft } from '../../types/entities';
import styles from './CredentialManagerModal.module.css';

const defaultDraft: CredentialDraft = {
  label: '',
  username: '',
  password: '',
  note: ''
};

export function CredentialManagerModal() {
  const credentials = useSessionStore((state) => state.credentials);
  const credentialFormOpen = useSessionStore((state) => state.credentialFormOpen);
  const editingCredentialId = useSessionStore((state) => state.editingCredentialId);
  const closeCredentialForm = useSessionStore((state) => state.closeCredentialForm);
  const openCreateCredential = useSessionStore((state) => state.openCreateCredential);
  const openEditCredential = useSessionStore((state) => state.openEditCredential);
  const saveCredential = useSessionStore((state) => state.saveCredential);
  const deleteCredential = useSessionStore((state) => state.deleteCredential);
  const loading = useSessionStore((state) => state.loading);

  const editingCredential =
    credentials.find((credential) => credential.id === editingCredentialId) ?? null;
  const [draft, setDraft] = useState<CredentialDraft>(defaultDraft);

  useEffect(() => {
    if (!credentialFormOpen) {
      return;
    }

    if (editingCredential) {
      setDraft({
        id: editingCredential.id,
        label: editingCredential.label,
        username: editingCredential.username,
        password: editingCredential.password,
        note: editingCredential.note
      });
      return;
    }

    setDraft(defaultDraft);
  }, [credentialFormOpen, editingCredential]);

  if (!credentialFormOpen) {
    return null;
  }

  return (
    <Modal
      title="Credenciales"
      subtitle="Administra usuarios y contraseñas reutilizables para tus sesiones SSH."
      onClose={closeCredentialForm}
    >
      <div className={styles.layout}>
        <section className={styles.listPanel}>
          <div className={styles.listHeader}>
            <strong>Guardadas</strong>
            <button type="button" className={styles.primaryButton} onClick={openCreateCredential}>
              Nueva credencial
            </button>
          </div>

          <div className={styles.list}>
            {credentials.map((credential) => (
              <button
                key={credential.id}
                type="button"
                className={`${styles.credentialItem} ${
                  editingCredentialId === credential.id ? styles.credentialItemActive : ''
                }`}
                onClick={() => openEditCredential(credential.id)}
              >
                <strong>{credential.label}</strong>
                <span>{credential.username}</span>
                <small>{credential.note || 'Sin nota'}</small>
              </button>
            ))}
          </div>
        </section>

        <form
          className={styles.form}
          onSubmit={async (event) => {
            event.preventDefault();
            await saveCredential(draft);
          }}
        >
          <label className={styles.field}>
            <span>Etiqueta</span>
            <input
              required
              value={draft.label}
              onChange={(event) => setDraft((state) => ({ ...state, label: event.target.value }))}
            />
          </label>

          <label className={styles.field}>
            <span>Usuario</span>
            <input
              required
              value={draft.username}
              onChange={(event) =>
                setDraft((state) => ({ ...state, username: event.target.value }))
              }
            />
          </label>

          <label className={styles.field}>
            <span>Contraseña</span>
            <input
              required
              type="password"
              value={draft.password}
              onChange={(event) =>
                setDraft((state) => ({ ...state, password: event.target.value }))
              }
            />
          </label>

          <label className={styles.field}>
            <span>Nota</span>
            <textarea
              rows={4}
              value={draft.note}
              onChange={(event) => setDraft((state) => ({ ...state, note: event.target.value }))}
            />
          </label>

          <div className={styles.actions}>
            {editingCredential ? (
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => deleteCredential(editingCredential.id)}
              >
                Eliminar
              </button>
            ) : (
              <span />
            )}
            <div className={styles.submitGroup}>
              <button type="button" className={styles.secondaryButton} onClick={closeCredentialForm}>
                Cerrar
              </button>
              <button type="submit" className={styles.primaryButton} disabled={loading}>
                {loading ? 'Guardando…' : 'Guardar credencial'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
