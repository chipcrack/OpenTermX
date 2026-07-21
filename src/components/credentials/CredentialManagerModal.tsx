import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Modal } from '../layout/Modal';
import { useSessionStore } from '../../stores/sessionStore';
import type { CredentialDraft, WorkspaceTransferData } from '../../types/entities';
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
  const exportWorkspaceData = useSessionStore((state) => state.exportWorkspaceData);
  const importWorkspaceData = useSessionStore((state) => state.importWorkspaceData);
  const loading = useSessionStore((state) => state.loading);

  const editingCredential =
    credentials.find((credential) => credential.id === editingCredentialId) ?? null;
  const [draft, setDraft] = useState<CredentialDraft>(defaultDraft);
  const [showPassword, setShowPassword] = useState(false);
  const [transferFeedback, setTransferFeedback] = useState<{
    kind: 'success' | 'error';
    text: string;
  } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!credentialFormOpen) {
      setTransferFeedback(null);
      return;
    }

    setShowPassword(false);

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

  async function handleExport() {
    try {
      setTransferFeedback(null);
      const savedPath = await exportWorkspaceData();

      if (!savedPath) {
        setTransferFeedback({
          kind: 'success',
          text: 'Exportacion cancelada. No se guardo ningun archivo.'
        });
        return;
      }

      setTransferFeedback({
        kind: 'success',
        text: `Exportacion guardada en: ${savedPath}`
      });
    } catch (error) {
      setTransferFeedback({
        kind: 'error',
        text: error instanceof Error ? error.message : 'No se pudo exportar la data.'
      });
    }
  }

  async function handleImportSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    try {
      setTransferFeedback(null);
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as WorkspaceTransferData;
      await importWorkspaceData(parsed);
      setTransferFeedback({
        kind: 'success',
        text: `Importadas ${parsed.credentials?.length ?? 0} credenciales y ${parsed.sessions?.length ?? 0} sesiones.`
      });
    } catch (error) {
      setTransferFeedback({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'No se pudo importar el archivo seleccionado.'
      });
    }
  }

  if (!credentialFormOpen) {
    return null;
  }

  return (
    <Modal
      title="Credenciales"
      subtitle="Administra usuarios y contrasenas reutilizables para tus sesiones SSH."
      onClose={closeCredentialForm}
    >
      <div className={styles.layout}>
        <section className={styles.listPanel}>
          <div className={styles.listHeader}>
            <strong>Guardadas</strong>
            <div className={styles.listActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => importInputRef.current?.click()}
                disabled={loading}
              >
                Importar
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => void handleExport()}
                disabled={loading}
              >
                Exportar
              </button>
              <button type="button" className={styles.primaryButton} onClick={openCreateCredential}>
                Nueva credencial
              </button>
            </div>
          </div>

          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            className={styles.hiddenInput}
            onChange={(event) => void handleImportSelection(event)}
          />

          <p className={styles.transferHint}>
            La importacion solo actualiza o agrega credenciales y sesiones por `id`. No modifica
            tuneles.
          </p>

          {transferFeedback ? (
            <div
              className={`${styles.transferFeedback} ${
                transferFeedback.kind === 'success'
                  ? styles.transferFeedbackSuccess
                  : styles.transferFeedbackError
              }`}
            >
              {transferFeedback.text}
            </div>
          ) : null}

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
                <span className={styles.credentialKey}>K</span>
                <span className={styles.credentialMain}>
                  <strong>{credential.label}</strong>
                  <small>{credential.note || 'Sin nota'}</small>
                </span>
                <span className={styles.credentialUser}>{credential.username}</span>
              </button>
            ))}

            {!credentials.length ? (
              <div className={styles.emptyState}>No hay credenciales guardadas.</div>
            ) : null}
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
            <span>Contrasena</span>
            <div className={styles.passwordInputWrap}>
              <input
                required
                type={showPassword ? 'text' : 'password'}
                value={draft.password}
                onChange={(event) =>
                  setDraft((state) => ({ ...state, password: event.target.value }))
                }
              />
              <button
                type="button"
                className={styles.passwordToggle}
                aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                title={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                onClick={() => setShowPassword((current) => !current)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {showPassword ? (
                    <>
                      <path d="M3 4.5 19.5 21" />
                      <path d="M10.6 6.3A10.8 10.8 0 0 1 12 6c5.4 0 9 6 9 6a16.7 16.7 0 0 1-3.3 3.8" />
                      <path d="M6.7 8A16.6 16.6 0 0 0 3 12s3.6 6 9 6c1.4 0 2.6-.3 3.7-.8" />
                      <path d="M9.9 9.8A3 3 0 0 0 12 15a3 3 0 0 0 2-.8" />
                    </>
                  ) : (
                    <>
                      <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </svg>
              </button>
            </div>
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
                {loading ? 'Guardando...' : 'Guardar credencial'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
