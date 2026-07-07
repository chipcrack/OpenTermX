import { useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';

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
    <section className="otx-panel-muted flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="otx-kicker m-0">Tunnels</p>
          <h3 className="mt-1.5 text-sm font-semibold">Port forwarding local</h3>
        </div>
        <button type="button" className="otx-button-primary" onClick={openCreateTunnel}>
          + Nuevo tunel
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {activeTunnels.map((tunnel) => (
          <article key={tunnel.id} className="rounded-xl border border-[var(--otx-border)] bg-white/[0.03] p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <strong className="block text-[12px] font-semibold">{tunnel.name}</strong>
                <span className="mt-0.5 block font-mono text-[10px] text-[var(--otx-muted)]">
                  localhost:{tunnel.localPort} -&gt; {tunnel.remoteHost}:{tunnel.remotePort}
                </span>
              </div>
              <span
                className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
                  tunnel.status === 'active'
                    ? 'bg-emerald-500/12 text-emerald-300'
                    : 'bg-slate-400/12 text-[var(--otx-text-soft)]'
                }`}
              >
                {tunnel.status}
              </span>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" className="otx-button-secondary" onClick={() => openEditTunnel(tunnel.id)}>
                Editar
              </button>
              <button type="button" className="otx-button-danger" onClick={() => deleteTunnel(tunnel.id)}>
                Eliminar
              </button>
            </div>
          </article>
        ))}

        {!activeTunnels.length ? (
          <div className="rounded-2xl border border-dashed border-[var(--otx-border)] px-4 py-6 text-center text-sm text-[var(--otx-muted)]">
            <p className="m-0">Crea un tunel local para dejar listo el flujo del MVP.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
