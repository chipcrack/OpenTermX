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
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const inputDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const syncTransportLoopRef = useRef<((forceFlush?: boolean) => void) | null>(null);
  const inputBufferRef = useRef('');
  const readingRef = useRef(false);
  const setTabConnection = useSessionStore((state) => state.setTabConnection);
  const setTabShellId = useSessionStore((state) => state.setTabShellId);
  const themeMode = useUiStore((state) => state.theme);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.options.theme = buildTerminalTheme(themeMode);
    terminalRef.current.refresh(0, Math.max(terminalRef.current.rows - 1, 0));
    fitAddonRef.current?.fit();

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
      fitAddonRef.current?.fit();

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
      clearTransportLoops();
      syncTransportLoopRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      inputBufferRef.current = '';
      readingRef.current = false;
      bootstrappedRef.current = false;
      openingRef.current = false;

      if (shellIdRef.current) {
        void desktopApi.closeTerminal(shellIdRef.current);
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

        openingRef.current = true;

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
        fitAddon.fit();

        terminalRef.current = terminal;
        fitAddonRef.current = fitAddon;
        bootstrappedRef.current = true;

        const colors = buildAnsiPalette(themeMode);
        terminal.writeln(
          `${colors.accent}OpenTermX${colors.reset} ${colors.muted}- terminal remota${colors.reset}`
        );
        terminal.writeln(
          `${colors.info}${session.username}@${session.host}:${session.port}${colors.reset} ${colors.muted}- ${session.name}${colors.reset}`
        );
        terminal.writeln(`${colors.muted}Preparando terminal interactiva...${colors.reset}`);
        terminal.writeln('');

        const flushRemoteOutput = async () => {
          if (!shellIdRef.current || !terminalRef.current || readingRef.current) {
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
              setTabConnection(tabId, false);
              setTabShellId(tabId, null);
              shellIdRef.current = null;
              clearTransportLoops();
            }
          } catch (error) {
            if (!disposed && terminalRef.current) {
              terminalRef.current.writeln('');
              terminalRef.current.writeln(
                `Error de lectura: ${error instanceof Error ? error.message : 'error desconocido'}`
              );
              setTabConnection(tabId, false);
            }
          } finally {
            readingRef.current = false;
          }
        };

        const flushInputBuffer = async () => {
          if (!shellIdRef.current || !inputBufferRef.current) {
            return;
          }

          const payload = inputBufferRef.current;
          inputBufferRef.current = '';

          try {
            await desktopApi.writeTerminalInput(shellIdRef.current, payload);
          } catch (error) {
            inputBufferRef.current = payload + inputBufferRef.current;

            if (!disposed && terminalRef.current) {
              terminalRef.current.writeln('');
              terminalRef.current.writeln(
                `Error de escritura: ${error instanceof Error ? error.message : 'error desconocido'}`
              );
              setTabConnection(tabId, false);
            }
          }
        };

        syncTransportLoopRef.current = (forceFlush = false) => {
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

        try {
          const result = await desktopApi.bootstrapTerminal(session.id, terminal.cols, terminal.rows);

          if (disposed) {
            cleanup();
            return;
          }

          shellIdRef.current = result.shellId;
          setTabShellId(tabId, result.shellId);
          terminal.writeln('');
          terminal.writeln(`${colors.success}${result.banner}${colors.reset}`);
          terminal.writeln(`${colors.success}Estado de conexion: en linea${colors.reset}`);
          {/*terminal.writeln(`${colors.muted}Tip: usa comandos normales como ls, pwd, cd o clear.${colors.reset}`);*/}
          terminal.writeln('');
          setTabConnection(tabId, result.connected);

          if (result.connected && result.initialOutput) {
            terminal.write(result.initialOutput);
          }

          inputDisposableRef.current = terminal.onData((input: string) => {
            if (!shellIdRef.current) {
              return;
            }

            inputBufferRef.current += input;
          });

          syncTransportLoopRef.current?.(true);

          resizeObserverRef.current = new ResizeObserver(() => {
            if (!isActiveRef.current) {
              return;
            }

            fitAddon.fit();

            if (shellIdRef.current) {
              void desktopApi.resizeTerminal(shellIdRef.current, terminal.cols, terminal.rows);
            }
          });
          resizeObserverRef.current.observe(containerRef.current);
        } catch (error) {
          if (!disposed) {
            terminal.writeln('');
            terminal.writeln(
              `Error de arranque: ${error instanceof Error ? error.message : 'error desconocido'}`
            );
            terminal.write('$ ');
            setTabConnection(tabId, false);
            setTabShellId(tabId, null);
          }
        } finally {
          openingRef.current = false;
        }
      }
    );

    return () => {
      disposed = true;
      cleanup();
    };
  }, [session.id, setTabConnection, setTabShellId, tabId]);

  return (
    <div
      className={`${styles.viewport} ${isActive ? styles.viewportActive : styles.viewportHidden}`}
      ref={containerRef}
      aria-hidden={!isActive}
    />
  );
}
