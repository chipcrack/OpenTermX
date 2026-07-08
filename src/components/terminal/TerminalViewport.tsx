import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
import { desktopApi } from '../../services/desktopApi';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import type { Session, ThemeMode } from '../../types/entities';
import styles from './TerminalViewport.module.css';

interface TerminalViewportProps {
  session: Session;
  tabId: string;
  isActive: boolean;
}

function buildAnsiPalette(themeMode: ThemeMode) {
  return themeMode === 'light'
    ? {
        accent: '\u001b[1;34m',
        success: '\u001b[1;32m',
        muted: '\u001b[2;37m',
        info: '\u001b[36m',
        reset: '\u001b[0m'
      }
    : {
        accent: '\u001b[1;36m',
        success: '\u001b[1;32m',
        muted: '\u001b[2;37m',
        info: '\u001b[94m',
        reset: '\u001b[0m'
      };
}

function buildTerminalTheme(themeMode: ThemeMode) {
  return themeMode === 'light'
    ? {
        background: '#f8fafc',
        foreground: '#0f172a',
        cursor: '#2563eb',
        cursorAccent: '#f8fafc',
        selectionBackground: 'rgba(37, 99, 235, 0.18)',
        selectionInactiveBackground: 'rgba(37, 99, 235, 0.12)',
        black: '#e2e8f0',
        blue: '#2563eb',
        brightBlue: '#1d4ed8',
        brightCyan: '#0891b2',
        brightGreen: '#15803d',
        brightMagenta: '#7c3aed',
        brightRed: '#dc2626',
        brightWhite: '#0f172a',
        brightYellow: '#ca8a04',
        cyan: '#0f766e',
        green: '#166534',
        magenta: '#9333ea',
        red: '#b91c1c',
        white: '#334155',
        yellow: '#a16207'
      }
    : {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#60a5fa',
        cursorAccent: '#020617',
        selectionBackground: 'rgba(96, 165, 250, 0.22)',
        selectionInactiveBackground: 'rgba(96, 165, 250, 0.14)',
        black: '#0f172a',
        blue: '#60a5fa',
        brightBlue: '#93c5fd',
        brightCyan: '#67e8f9',
        brightGreen: '#4ade80',
        brightMagenta: '#c084fc',
        brightRed: '#f87171',
        brightWhite: '#f8fafc',
        brightYellow: '#fde047',
        cyan: '#22d3ee',
        green: '#22c55e',
        magenta: '#a855f7',
        red: '#ef4444',
        white: '#cbd5e1',
        yellow: '#eab308'
      };
}

function describeError(error: unknown) {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'error desconocido';
}

function fitTerminalViewport(container: HTMLDivElement, terminal: any, fitAddon: any) {
  fitAddon.fit();

  window.requestAnimationFrame(() => {
    fitAddon.fit();

    window.requestAnimationFrame(() => {
      const viewport = container.querySelector('.xterm-viewport') as HTMLElement | null;
      const screen = container.querySelector('.xterm-screen') as HTMLElement | null;

      if (!viewport || !screen || terminal.rows <= 1) {
        return;
      }

      const overflow = Math.ceil(
        screen.getBoundingClientRect().height - viewport.getBoundingClientRect().height
      );

      if (overflow <= 0) {
        return;
      }

      const estimatedRowHeight = screen.getBoundingClientRect().height / terminal.rows;
      const safeRowHeight = Number.isFinite(estimatedRowHeight) && estimatedRowHeight > 1
        ? estimatedRowHeight
        : 1;
      const rowsToTrim = Math.min(
        terminal.rows - 1,
        Math.max(1, Math.ceil(overflow / safeRowHeight))
      );

      if (rowsToTrim > 0) {
        terminal.resize(terminal.cols, terminal.rows - rowsToTrim);
      }
    });
  });
}

export function TerminalViewport({ session, tabId, isActive }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<any>(null);
  const fitAddonRef = useRef<any>(null);
  const shellIdRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);
  const bootstrappedRef = useRef(false);
  const openingRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const inputFlushTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const syncTransportLoopRef = useRef<((forceFlush?: boolean) => void) | null>(null);
  const inputBufferRef = useRef('');
  const readingRef = useRef(false);
  const transportClosedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const setTabConnection = useSessionStore((state) => state.setTabConnection);
  const setTabReconnecting = useSessionStore((state) => state.setTabReconnecting);
  const setTabShellId = useSessionStore((state) => state.setTabShellId);
  const themeMode = useUiStore((state) => state.theme);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.options.theme = buildTerminalTheme(themeMode);
    terminalRef.current.refresh(0, Math.max(terminalRef.current.rows - 1, 0));
    if (containerRef.current && fitAddonRef.current) {
      fitTerminalViewport(containerRef.current, terminalRef.current, fitAddonRef.current);
    }

    if (shellIdRef.current) {
      void desktopApi.resizeTerminal(
        shellIdRef.current,
        terminalRef.current.cols,
        terminalRef.current.rows
      );
    }
  }, [themeMode]);

  useEffect(() => {
    isActiveRef.current = isActive;

    if (!terminalRef.current) {
      return;
    }

    if (isActive) {
      if (containerRef.current && fitAddonRef.current) {
        fitTerminalViewport(containerRef.current, terminalRef.current, fitAddonRef.current);
      }

      if (shellIdRef.current) {
        void desktopApi.resizeTerminal(
          shellIdRef.current,
          terminalRef.current.cols,
          terminalRef.current.rows
        );
      }
    }

    syncTransportLoopRef.current?.(isActive);
  }, [isActive]);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let disposed = false;
    let detachContextMenuListener: (() => void) | null = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearTransportLoops = () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      if (inputFlushTimerRef.current !== null) {
        window.clearInterval(inputFlushTimerRef.current);
        inputFlushTimerRef.current = null;
      }
    };

    const cleanup = () => {
      manualCloseRef.current = true;
      clearReconnectTimer();
      clearTransportLoops();
      syncTransportLoopRef.current = null;
      detachContextMenuListener?.();
      detachContextMenuListener = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      inputBufferRef.current = '';
      readingRef.current = false;
      transportClosedRef.current = true;
      reconnectAttemptRef.current = 0;
      hasConnectedRef.current = false;
      bootstrappedRef.current = false;
      openingRef.current = false;

      if (shellIdRef.current) {
        void desktopApi.closeTerminal(shellIdRef.current);
        setTabConnection(tabId, false);
        setTabReconnecting(tabId, false);
        setTabShellId(tabId, null);
        shellIdRef.current = null;
      }

      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };

    void Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]).then(
      async ([xtermModule, fitModule]) => {
        if (disposed || !containerRef.current || bootstrappedRef.current || openingRef.current) {
          return;
        }

        const terminal = new xtermModule.Terminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          fontWeight: '500',
          fontWeightBold: '700',
          lineHeight: 1.15,
          scrollback: 5000,
          minimumContrastRatio: 4.5,
          theme: buildTerminalTheme(themeMode)
        });

        const fitAddon = new fitModule.FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(containerRef.current);
        fitTerminalViewport(containerRef.current, terminal, fitAddon);

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        bootstrappedRef.current = true;
        manualCloseRef.current = false;
        transportClosedRef.current = false;

        const colors = buildAnsiPalette(themeMode);
        terminal.writeln(
          `${colors.accent}OpenTermX${colors.reset} ${colors.muted}- terminal remota${colors.reset}`
        );
        terminal.writeln(
          `${colors.info}${session.username}@${session.host}:${session.port}${colors.reset} ${colors.muted}- ${session.name}${colors.reset}`
        );
        terminal.writeln(`${colors.muted}Preparando terminal interactiva...${colors.reset}`);
        terminal.writeln('');

        const writeStatusLine = (message: string) => {
          if (!disposed && terminalRef.current) {
            terminalRef.current.writeln('');
            terminalRef.current.writeln(message);
          }
        };

        const copySelectionToClipboard = async () => {
          const currentTerminal = terminalRef.current;
          const selection = currentTerminal?.getSelection?.();

          if (!selection) {
            return false;
          }

          try {
            await navigator.clipboard.writeText(selection);
            return true;
          } catch (error) {
            writeStatusLine(`Error al copiar: ${describeError(error)}`);
            return false;
          }
        };

        const pasteClipboardIntoTerminal = async () => {
          if (!terminalRef.current || !shellIdRef.current || transportClosedRef.current) {
            return false;
          }

          try {
            const text = await navigator.clipboard.readText();

            if (!text) {
              return false;
            }

            terminalRef.current.paste(text);
            terminalRef.current.focus();
            return true;
          } catch (error) {
            writeStatusLine(`Error al pegar: ${describeError(error)}`);
            return false;
          }
        };

        const syncTransportLoops = (forceFlush = false) => {
          clearTransportLoops();

          if (!shellIdRef.current) {
            return;
          }

          pollTimerRef.current = window.setInterval(() => {
            void flushRemoteOutput();
          }, isActiveRef.current ? 55 : 240);

          if (isActiveRef.current) {
            inputFlushTimerRef.current = window.setInterval(() => {
              void flushInputBuffer();
            }, 24);
          }

          if (forceFlush) {
            void flushRemoteOutput();
          }
        };

        const scheduleReconnect = (message?: string) => {
          if (
            disposed ||
            manualCloseRef.current ||
            reconnectTimerRef.current !== null ||
            openingRef.current
          ) {
            return;
          }

          reconnectAttemptRef.current += 1;
          setTabConnection(tabId, false);
          setTabReconnecting(tabId, true);

          const delay = Math.min(1000 * 2 ** Math.min(reconnectAttemptRef.current - 1, 3), 8000);

          if (message) {
            writeStatusLine(message);
          }

          writeStatusLine(
            `${colors.muted}Conexion interrumpida. Reintentando en ${Math.round(delay / 1000)} s...${colors.reset}`
          );

          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;

            if (disposed || manualCloseRef.current || !terminalRef.current) {
              return;
            }

            void startTerminalSession(true);
          }, delay);
        };

        const closeTransport = ({
          message,
          shouldReconnect = false
        }: {
          message?: string;
          shouldReconnect?: boolean;
        } = {}) => {
          if (transportClosedRef.current && !shellIdRef.current) {
            if (shouldReconnect) {
              scheduleReconnect(message);
            } else if (message) {
              writeStatusLine(message);
            }
            return;
          }

          transportClosedRef.current = true;
          clearTransportLoops();
          inputBufferRef.current = '';
          readingRef.current = false;

          const shellId = shellIdRef.current;
          shellIdRef.current = null;
          setTabConnection(tabId, false);
          setTabShellId(tabId, null);

          if (shellId) {
            void desktopApi.closeTerminal(shellId).catch(() => undefined);
          }

          if (shouldReconnect) {
            scheduleReconnect(message);
            return;
          }

          setTabReconnecting(tabId, false);

          if (message) {
            writeStatusLine(message);
          }
        };

        const startTerminalSession = async (isReconnect = false) => {
          if (disposed || manualCloseRef.current || openingRef.current || !terminalRef.current) {
            return;
          }

          openingRef.current = true;

          if (isReconnect) {
            writeStatusLine(`${colors.info}Intentando reconectar la sesion SSH...${colors.reset}`);
          }

          try {
            const result = await desktopApi.bootstrapTerminal(session.id, terminal.cols, terminal.rows);

            if (disposed || manualCloseRef.current) {
              if (result.shellId) {
                void desktopApi.closeTerminal(result.shellId).catch(() => undefined);
              }
              return;
            }

            clearReconnectTimer();
            reconnectAttemptRef.current = 0;
            shellIdRef.current = result.shellId;
            transportClosedRef.current = !result.connected;
            setTabShellId(tabId, result.shellId);
            setTabConnection(tabId, result.connected);
            setTabReconnecting(tabId, false);

            terminal.writeln('');
            terminal.writeln(`${colors.success}${result.banner}${colors.reset}`);
            terminal.writeln(`${colors.success}Estado de conexion: en linea${colors.reset}`);
            if (isReconnect) {
              terminal.writeln(
                `${colors.success}SSH reconectado${colors.reset} ${colors.muted}- se conservo el historial visible, verifica el contexto remoto${colors.reset}`
              );
            }
            terminal.writeln('');

            if (result.connected) {
              hasConnectedRef.current = true;
            }

            if (result.connected && result.initialOutput) {
              terminal.write(result.initialOutput);
            }

            syncTransportLoops(true);
          } catch (error) {
            setTabConnection(tabId, false);
            setTabShellId(tabId, null);

            if (hasConnectedRef.current && !disposed && !manualCloseRef.current) {
              scheduleReconnect(`Error de reconexion: ${describeError(error)}`);
            } else if (!disposed) {
              setTabReconnecting(tabId, false);
              writeStatusLine(`Error de arranque: ${describeError(error)}`);
              terminal.write('$ ');
            }
          } finally {
            openingRef.current = false;
          }
        };

        const flushRemoteOutput = async () => {
          if (
            !shellIdRef.current ||
            !terminalRef.current ||
            readingRef.current ||
            transportClosedRef.current
          ) {
            return;
          }

          readingRef.current = true;

          try {
            const output = await desktopApi.readTerminalOutput(shellIdRef.current);

            if (disposed || !terminalRef.current) {
              readingRef.current = false;
              return;
            }

            if (output.data) {
              terminalRef.current.write(output.data);
            }

            if (output.closed) {
              closeTransport({ shouldReconnect: hasConnectedRef.current });
            }
          } catch (error) {
            closeTransport({
              message: `Error de lectura: ${describeError(error)}`,
              shouldReconnect: hasConnectedRef.current
            });
          } finally {
            readingRef.current = false;
          }
        };

        const flushInputBuffer = async () => {
          if (!shellIdRef.current || !inputBufferRef.current || transportClosedRef.current) {
            return;
          }

          const payload = inputBufferRef.current;
          inputBufferRef.current = '';

          try {
            await desktopApi.writeTerminalInput(shellIdRef.current, payload);
          } catch (error) {
            closeTransport({
              message: `Error de escritura: ${describeError(error)}`,
              shouldReconnect: hasConnectedRef.current
            });
          }
        };

        syncTransportLoopRef.current = syncTransportLoops;

        terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          const isModifier = event.ctrlKey || event.metaKey;
          const key = event.key.toLowerCase();

          if (isModifier && key === 'v') {
            event.preventDefault();
            void pasteClipboardIntoTerminal();
            return false;
          }

          if (isModifier && key === 'c' && terminal.hasSelection()) {
            event.preventDefault();
            void copySelectionToClipboard();
            return false;
          }

          if (isModifier && event.shiftKey && key === 'c') {
            event.preventDefault();
            void copySelectionToClipboard();
            return false;
          }

          if (event.shiftKey && key === 'insert') {
            event.preventDefault();
            void pasteClipboardIntoTerminal();
            return false;
          }

          return true;
        });

        const handleTerminalContextMenu = (event: MouseEvent) => {
          event.preventDefault();

          if (terminal.hasSelection()) {
            void copySelectionToClipboard().then((copied) => {
              if (copied) {
                terminal.clearSelection();
                terminal.focus();
              }
            });
            return;
          }

          void pasteClipboardIntoTerminal();
        };

        containerRef.current.addEventListener('contextmenu', handleTerminalContextMenu);
        detachContextMenuListener = () => {
          containerRef.current?.removeEventListener('contextmenu', handleTerminalContextMenu);
        };

        inputDisposableRef.current = terminal.onData((input: string) => {
          if (!shellIdRef.current || transportClosedRef.current) {
            return;
          }

          inputBufferRef.current += input;
        });

        terminal.focus();

        resizeObserverRef.current = new ResizeObserver(() => {
          if (!isActiveRef.current) {
            return;
          }

          fitTerminalViewport(containerRef.current!, terminal, fitAddon);

          if (shellIdRef.current) {
            void desktopApi.resizeTerminal(shellIdRef.current, terminal.cols, terminal.rows);
          }
        });
        resizeObserverRef.current.observe(containerRef.current);

        void startTerminalSession(false);
      }
    );

    return () => {
      disposed = true;
      cleanup();
    };
  }, [session.id, setTabConnection, setTabReconnecting, setTabShellId, tabId]);

  return (
    <div
      className={`${styles.viewport} ${isActive ? styles.viewportActive : styles.viewportHidden}`}
      ref={containerRef}
      aria-hidden={!isActive}
    />
  );
}
