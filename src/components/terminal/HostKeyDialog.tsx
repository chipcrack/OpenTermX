import { useEffect, useRef } from 'react';
import { answerHostKeyRequest, useHostKeyRequests } from '../../services/hostKeyTrust';
import { Modal } from '../layout/Modal';

export function HostKeyDialog() {
  const request = useHostKeyRequests((state) => state.requests[0]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!request) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      // Keep keyboard input out of the terminal while confirming an identity.
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        answerHostKeyRequest(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        (document.activeElement === cancelRef.current ? acceptRef.current : cancelRef.current)?.focus();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [request]);

  if (!request) return null;
  const { notice } = request;
  return (
    <Modal title="Verificar identidad SSH" onClose={() => answerHostKeyRequest(false)}>
      <div className="flex flex-col gap-4">
        <p>Primera conexion a <strong>{notice.host}:{notice.port}</strong>.</p>
        <p>Compara esta huella con la proporcionada por el administrador del servidor antes de continuar.</p>
        <div className="rounded-xl border border-[var(--otx-border)] p-3">
          <p className="text-sm">Clave {notice.algorithm}</p>
          <code className="select-text break-all text-sm">{notice.fingerprint}</code>
        </div>
        <p className="text-sm text-[var(--otx-muted)]">Todavia no se ha enviado tu contraseña. La clave aceptada se recordara para terminal y SFTP en este equipo.</p>
        <div className="flex justify-end gap-3">
          <button ref={cancelRef} type="button" className="otx-button-secondary" onClick={() => answerHostKeyRequest(false)}>Cancelar</button>
          <button ref={acceptRef} type="button" className="otx-button-primary" onClick={() => answerHostKeyRequest(true)}>Confiar y conectar</button>
        </div>
      </div>
    </Modal>
  );
}
