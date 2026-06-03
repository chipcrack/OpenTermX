import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import styles from './TunnelManager.module.css';

export function TunnelManager() {
  const tunnels = useSessionStore((state) => state.tunnels);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const openCreateTunnel = useSessionStore((state) => state.openCreateTunnel);
  const openEditTunnel = useSessionStore((state) => state.openEditTunnel);
  const deleteTunnel = useSessionStore((state) => state.deleteTunnel);

  const activeTunnels = useMemo(
    () => tunnels.filter((tunnel) => tunnel.sessionId === activeSessionId),
    [activeSessionId, tunnels]
  );

  return (
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <p className={styles.kicker}>Tunnels</p>
          <h3 className={styles.title}>Port forwarding local</h3>
        </div>
        <button type="button" className={styles.primaryButton} onClick={openCreateTunnel}>
          + Nuevo túnel
        </button>
      </div>

      <div className={styles.list}>
        {activeTunnels.map((tunnel) => (
          <article key={tunnel.id} className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <strong>{tunnel.name}</strong>
                <span>
                  localhost:{tunnel.localPort} → {tunnel.remoteHost}:{tunnel.remotePort}
                </span>
              </div>
              <span
                className={`${styles.status} ${
                  tunnel.status === 'active' ? styles.statusActive : styles.statusInactive
                }`}
              >
                {tunnel.status}
              </span>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={() => openEditTunnel(tunnel.id)}>
                Editar
              </button>
              <button type="button" className={styles.dangerButton} onClick={() => deleteTunnel(tunnel.id)}>
                Eliminar
              </button>
            </div>
          </article>
        ))}

        {!activeTunnels.length ? (
          <div className={styles.emptyState}>
            <p>Crea un túnel local para dejar listo el flujo del MVP.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
