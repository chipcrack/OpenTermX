import { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import { desktopApi } from '../../services/desktopApi';
import { isTauriRuntime } from '../../services/runtime';
import { useSessionStore } from '../../stores/sessionStore';
import { useUiStore } from '../../stores/uiStore';
import type { Session, ThemeMode } from '../../types/entities';
import styles from './TerminalViewport.module.css';

interface TerminalViewportProps {
  session: Session;
  tabId: string;
  isActive: boolean;
}

interface SearchMatch {
  row: number;
  col: number;
  length: number;
}

interface ContextMenuState {
  x: number;
  y: number;
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

function getTerminalBufferLines(terminal: any) {
  const activeBuffer = terminal?.buffer?.active;

  if (!activeBuffer || typeof activeBuffer.length !== 'number') {
    return [] as string[];
  }

  const lines: string[] = [];
  for (let index = 0; index < activeBuffer.length; index += 1) {
    lines.push(activeBuffer.getLine(index)?.translateToString(true) ?? '');
  }

  return lines;
}

function findTerminalMatches(terminal: any, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (!normalizedQuery) {
    return [] as SearchMatch[];
  }

  const matches: SearchMatch[] = [];
  const lines = getTerminalBufferLines(terminal);

  lines.forEach((line, row) => {
    const normalizedLine = line.toLocaleLowerCase();
    let startIndex = 0;

    while (startIndex < normalizedLine.length) {
      const foundAt = normalizedLine.indexOf(normalizedQuery, startIndex);
      if (foundAt === -1) {
        break;
      }

      matches.push({
        row,
        col: foundAt,
        length: normalizedQuery.length
      });

      startIndex = foundAt + Math.max(normalizedQuery.length, 1);
    }
  });

  return matches;
}

function revealTerminalMatch(terminal: any, match: SearchMatch | undefined) {
  if (!match) {
    return false;
  }

  terminal.select(match.col, match.row, match.length);
  if (typeof terminal.scrollToLine === 'function') {
    terminal.scrollToLine(Math.max(match.row - 2, 0));
  }
  terminal.focus();
  return true;
}

function toControlCharacter(key: string) {
  if (key.length !== 1) {
    return null;
  }

  const code = key.toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) {
    return null;
  }

  return String.fromCharCode(code - 64);
}

export function TerminalViewport({ session, tabId, isActive }: TerminalViewportProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
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
  const streamOutputModeRef = useRef(false);
  const streamOutputUnlistenRef = useRef<(() => void) | null>(null);
  const streamCloseUnlistenRef = useRef<(() => void) | null>(null);
  const inputBufferRef = useRef('');
  const readingRef = useRef(false);
  const transportClosedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const hasConnectedRef = useRef(false);
  const manualCloseRef = useRef(false);
  const searchStateRef = useRef<{
    query: string;
    matches: SearchMatch[];
    activeIndex: number;
  }>({
    query: '',
    matches: [],
    activeIndex: -1
  });
  const setTabConnection = useSessionStore((state) => state.setTabConnection);
  const setTabReconnecting = useSessionStore((state) => state.setTabReconnecting);
  const setTabShellId = useSessionStore((state) => state.setTabShellId);
  const setTabStatus = useSessionStore((state) => state.setTabStatus);
  const registerTerminalController = useSessionStore((state) => state.registerTerminalController);
  const unregisterTerminalController = useSessionStore((state) => state.unregisterTerminalController);
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
    let detachGlobalPointerListener: (() => void) | null = null;

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
      setContextMenu(null);
      clearReconnectTimer();
      clearTransportLoops();
      syncTransportLoopRef.current = null;
      detachContextMenuListener?.();
      detachContextMenuListener = null;
      detachGlobalPointerListener?.();
      detachGlobalPointerListener = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      inputDisposableRef.current?.dispose();
      inputDisposableRef.current = null;
      streamOutputUnlistenRef.current?.();
      streamOutputUnlistenRef.current = null;
      streamCloseUnlistenRef.current?.();
      streamCloseUnlistenRef.current = null;
      streamOutputModeRef.current = false;
      inputBufferRef.current = '';
      readingRef.current = false;
      transportClosedRef.current = true;
      reconnectAttemptRef.current = 0;
      hasConnectedRef.current = false;
      searchStateRef.current = {
        query: '',
        matches: [],
        activeIndex: -1
      };
      bootstrappedRef.current = false;
      openingRef.current = false;
      unregisterTerminalController(tabId);

      if (shellIdRef.current) {
        void desktopApi.closeTerminal(shellIdRef.current);
        setTabConnection(tabId, false);
        setTabReconnecting(tabId, false);
        setTabShellId(tabId, null);
        setTabStatus(tabId, 'Pendiente', null);
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
        setTabStatus(tabId, 'Preparando terminal...', null);

        const writeStatusLine = (message: string) => {
          if (!disposed && terminalRef.current) {
            terminalRef.current.writeln('');
            terminalRef.current.writeln(message);
          }
        };

        const writeClipboardText = async (text: string) => {
          await navigator.clipboard.writeText(text);
        };

        const readClipboardText = async () => navigator.clipboard.readText();

        const updateStatus = (statusText: string, lastError?: string | null) => {
          setTabStatus(tabId, statusText, lastError);
        };

        const teardownTerminalStreamListeners = () => {
          streamOutputUnlistenRef.current?.();
          streamOutputUnlistenRef.current = null;
          streamCloseUnlistenRef.current?.();
          streamCloseUnlistenRef.current = null;
        };

        const copySelectionToClipboard = async () => {
          const currentTerminal = terminalRef.current;
          const selection = currentTerminal?.getSelection?.();

          if (!selection) {
            return false;
          }

          try {
            await writeClipboardText(selection);
            updateStatus('Seleccion copiada', null);
            return true;
          } catch (error) {
            const message = describeError(error);
            writeStatusLine(`Error al copiar: ${message}`);
            updateStatus('Error al copiar', message);
            return false;
          }
        };

        const copyTerminalBufferToClipboard = async () => {
          try {
            const lines = getTerminalBufferLines(terminalRef.current);
            const payload = lines.join('\n').trimEnd();

            if (!payload) {
              return false;
            }

            await writeClipboardText(payload);
            updateStatus('Buffer copiado', null);
            return true;
          } catch (error) {
            const message = describeError(error);
            writeStatusLine(`Error al copiar el buffer: ${message}`);
            updateStatus('Error al copiar buffer', message);
            return false;
          }
        };

        const pasteClipboardIntoTerminal = async () => {
          if (!terminalRef.current || !shellIdRef.current || transportClosedRef.current) {
            return false;
          }

          try {
            const text = await readClipboardText();

            if (!text) {
              return false;
            }

            terminalRef.current.paste(text);
            terminalRef.current.focus();
            updateStatus('Texto pegado', null);
            return true;
          } catch (error) {
            const message = describeError(error);
            writeStatusLine(`Error al pegar: ${message}`);
            updateStatus('Error al pegar', message);
            return false;
          }
        };

        const selectAllTerminalOutput = () => {
          terminal.selectAll();
          terminal.focus();
          updateStatus('Seleccion total lista', null);
        };

        const clearTerminalViewport = () => {
          terminal.clear();
          terminal.focus();
          updateStatus('Terminal limpiada', null);
        };

        const copyTerminalDiagnostics = async () => {
          const diagnostics = [
            'OpenTermX terminal diagnostics',
            `session=${session.name}`,
            `host=${session.username}@${session.host}:${session.port}`,
            `tabId=${tabId}`,
            `shellId=${shellIdRef.current ?? 'none'}`,
            `connected=${String(Boolean(shellIdRef.current) && !transportClosedRef.current)}`,
            `reconnectAttempts=${reconnectAttemptRef.current}`,
            `cols=${terminal.cols}`,
            `rows=${terminal.rows}`,
            `bufferLines=${getTerminalBufferLines(terminal).length}`,
            `timestamp=${new Date().toISOString()}`
          ].join('\n');

          try {
            await writeClipboardText(diagnostics);
            updateStatus('Diagnostico copiado', null);
            return true;
          } catch (error) {
            const message = describeError(error);
            writeStatusLine(`Error al copiar diagnostico: ${message}`);
            updateStatus('Error al copiar diagnostico', message);
            return false;
          }
        };

        const runSearch = (query: string, direction: 'next' | 'previous') => {
          const normalizedQuery = query.trim();
          if (!normalizedQuery) {
            terminal.clearSelection();
            searchStateRef.current = {
              query: '',
              matches: [],
              activeIndex: -1
            };
            updateStatus('Busqueda limpiada', null);
            return false;
          }

          if (searchStateRef.current.query !== normalizedQuery) {
            searchStateRef.current = {
              query: normalizedQuery,
              matches: findTerminalMatches(terminal, normalizedQuery),
              activeIndex: direction === 'next' ? -1 : 0
            };
          }

          const { matches } = searchStateRef.current;
          if (!matches.length) {
            updateStatus(`Sin coincidencias para "${normalizedQuery}"`, null);
            return false;
          }

          const nextIndex =
            direction === 'next'
              ? (searchStateRef.current.activeIndex + 1 + matches.length) % matches.length
              : (searchStateRef.current.activeIndex - 1 + matches.length) % matches.length;

          searchStateRef.current.activeIndex = nextIndex;
          const found = revealTerminalMatch(terminal, matches[nextIndex]);

          if (found) {
            updateStatus(
              `Coincidencia ${nextIndex + 1} de ${matches.length} para "${normalizedQuery}"`,
              null
            );
          }

          return found;
        };

        const syncTransportLoops = (forceFlush = false) => {
          clearTransportLoops();

          if (!shellIdRef.current) {
            return;
          }

          if (!streamOutputModeRef.current) {
            pollTimerRef.current = window.setInterval(() => {
              void flushRemoteOutput();
            }, isActiveRef.current ? 55 : 240);
          }

          if (isActiveRef.current) {
            inputFlushTimerRef.current = window.setInterval(() => {
              void flushInputBuffer();
            }, 24);
          }

          if (forceFlush) {
            if (!streamOutputModeRef.current) {
              void flushRemoteOutput();
            }
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

          updateStatus(`Reconectando en ${Math.round(delay / 1000)} s`, message ?? null);
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
          streamOutputModeRef.current = false;
          teardownTerminalStreamListeners();
          shellIdRef.current = null;
          setTabConnection(tabId, false);
          setTabShellId(tabId, null);
          updateStatus(shouldReconnect ? 'Reconectando' : 'Sesion detenida', message ?? null);

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

        const setupTerminalStreamListeners = async (shellId: string) => {
          if (!isTauriRuntime()) {
            return false;
          }

          try {
            teardownTerminalStreamListeners();
            const { listen } = await import('@tauri-apps/api/event');

            streamOutputUnlistenRef.current = await listen<number[]>(
              `ssh-output-${shellId}`,
              (event) => {
                if (
                  shellId !== shellIdRef.current ||
                  !streamOutputModeRef.current ||
                  !terminalRef.current ||
                  transportClosedRef.current
                ) {
                  return;
                }

                terminalRef.current.write(new Uint8Array(event.payload));
              }
            );

            streamCloseUnlistenRef.current = await listen<boolean>(
              `ssh-closed-${shellId}`,
              () => {
                if (shellId !== shellIdRef.current || transportClosedRef.current) {
                  return;
                }

                closeTransport({ shouldReconnect: hasConnectedRef.current });
              }
            );

            return true;
          } catch {
            teardownTerminalStreamListeners();
            return false;
          }
        };

        const startTerminalSession = async (isReconnect = false) => {
          if (disposed || manualCloseRef.current || openingRef.current || !terminalRef.current) {
            return;
          }

          openingRef.current = true;
          streamOutputModeRef.current = false;

          if (isReconnect) {
            writeStatusLine(`${colors.info}Intentando reconectar la sesion SSH...${colors.reset}`);
            updateStatus('Intentando reconectar...', null);
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
            updateStatus(result.connected ? 'SSH activo' : 'Pendiente', null);

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

            if (result.connected && await setupTerminalStreamListeners(result.shellId)) {
              try {
                const pendingOutput = await desktopApi.enableTerminalStream(result.shellId);

                if (pendingOutput.data) {
                  terminal.write(pendingOutput.data);
                }

                if (pendingOutput.closed) {
                  closeTransport({ shouldReconnect: hasConnectedRef.current });
                } else {
                  streamOutputModeRef.current = true;
                }
              } catch {
                streamOutputModeRef.current = false;
                teardownTerminalStreamListeners();
              }
            }

            syncTransportLoops(true);
          } catch (error) {
            setTabConnection(tabId, false);
            setTabShellId(tabId, null);

            if (hasConnectedRef.current && !disposed && !manualCloseRef.current) {
              scheduleReconnect(`Error de reconexion: ${describeError(error)}`);
            } else if (!disposed) {
              const message = describeError(error);
              setTabReconnecting(tabId, false);
              updateStatus('Error de arranque', message);
              writeStatusLine(`Error de arranque: ${message}`);
              terminal.write('$ ');
            }
          } finally {
            openingRef.current = false;
          }
        };

        const reconnectNow = async () => {
          clearReconnectTimer();
          closeTransport({
            message: `${colors.info}Reconectando manualmente...${colors.reset}`
          });
          await startTerminalSession(true);
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
            const message = describeError(error);
            closeTransport({
              message: `Error de lectura: ${message}`,
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
            const message = describeError(error);
            closeTransport({
              message: `Error de escritura: ${message}`,
              shouldReconnect: hasConnectedRef.current
            });
          }
        };

        syncTransportLoopRef.current = syncTransportLoops;
        registerTerminalController(tabId, {
          focus: () => {
            terminal.focus();
          },
          reconnectNow,
          copySelection: copySelectionToClipboard,
          copyAll: copyTerminalBufferToClipboard,
          paste: pasteClipboardIntoTerminal,
          selectAll: selectAllTerminalOutput,
          clear: clearTerminalViewport,
          copyDiagnostics: copyTerminalDiagnostics,
          findNext: (query) => runSearch(query, 'next'),
          findPrevious: (query) => runSearch(query, 'previous')
        });

        terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
          const isModifier = event.ctrlKey || event.metaKey;
          const key = event.key.toLowerCase();

          if (isModifier && event.shiftKey && key === 'v') {
            event.preventDefault();
            void pasteClipboardIntoTerminal();
            return false;
          }

          if (isModifier && event.shiftKey && key === 'c') {
            event.preventDefault();
            void copySelectionToClipboard();
            return false;
          }

          if (isModifier && event.shiftKey && key === 'a') {
            event.preventDefault();
            selectAllTerminalOutput();
            return false;
          }

          if (isModifier && event.shiftKey && key === 'k') {
            event.preventDefault();
            clearTerminalViewport();
            return false;
          }

          if (isModifier && event.shiftKey && key === 'r') {
            event.preventDefault();
            void reconnectNow();
            return false;
          }

          if (event.shiftKey && key === 'insert') {
            event.preventDefault();
            void pasteClipboardIntoTerminal();
            return false;
          }

          if (isModifier && key === 'c' && terminal.hasSelection()) {
            event.preventDefault();
            void copySelectionToClipboard();
            return false;
          }

          if (
            event.ctrlKey &&
            !event.metaKey &&
            !event.altKey &&
            !event.shiftKey &&
            terminalRef.current &&
            shellIdRef.current &&
            !transportClosedRef.current
          ) {
            const controlCharacter = toControlCharacter(key);

            if (controlCharacter) {
              event.preventDefault();
              inputBufferRef.current += controlCharacter;
              void flushInputBuffer();
              return false;
            }
          }

          return true;
        });

        const handleTerminalContextMenu = (event: MouseEvent) => {
          event.preventDefault();
          const bounds = containerRef.current?.getBoundingClientRect();
          setContextMenu({
            x: Math.max(12, (event.clientX ?? 0) - (bounds?.left ?? 0)),
            y: Math.max(12, (event.clientY ?? 0) - (bounds?.top ?? 0))
          });
        };

        containerRef.current.addEventListener('contextmenu', handleTerminalContextMenu);
        detachContextMenuListener = () => {
          containerRef.current?.removeEventListener('contextmenu', handleTerminalContextMenu);
        };
        const closeContextMenu = () => setContextMenu(null);
        window.addEventListener('pointerdown', closeContextMenu);
        detachGlobalPointerListener = () => {
          window.removeEventListener('pointerdown', closeContextMenu);
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
  }, [
    registerTerminalController,
    session.id,
    setTabConnection,
    setTabReconnecting,
    setTabShellId,
    setTabStatus,
    tabId,
    unregisterTerminalController
  ]);

  return (
    <div
      className={`${styles.viewport} ${isActive ? styles.viewportActive : styles.viewportHidden}`}
      ref={containerRef}
      aria-hidden={!isActive}
      onMouseDown={() => setContextMenu(null)}
    >
      {contextMenu ? (
        <div
          className="absolute z-20 min-w-[13rem] rounded-2xl border border-[var(--otx-border)] bg-[var(--otx-panel-strong)] p-1.5 shadow-2xl backdrop-blur"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--otx-brand-soft)]"
            onClick={() => {
              setContextMenu(null);
              void useSessionStore.getState().terminalControllers[tabId]?.copySelection();
            }}
          >
            <span>Copiar seleccion</span>
            <span className="text-xs text-[var(--otx-muted)]">Ctrl+Shift+C</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--otx-brand-soft)]"
            onClick={() => {
              setContextMenu(null);
              void useSessionStore.getState().terminalControllers[tabId]?.paste();
            }}
          >
            <span>Pegar</span>
            <span className="text-xs text-[var(--otx-muted)]">Ctrl+Shift+V</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--otx-brand-soft)]"
            onClick={() => {
              setContextMenu(null);
              useSessionStore.getState().terminalControllers[tabId]?.selectAll();
            }}
          >
            <span>Seleccionar todo</span>
            <span className="text-xs text-[var(--otx-muted)]">Ctrl+Shift+A</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--otx-brand-soft)]"
            onClick={() => {
              setContextMenu(null);
              useSessionStore.getState().terminalControllers[tabId]?.clear();
            }}
          >
            <span>Limpiar terminal</span>
            <span className="text-xs text-[var(--otx-muted)]">Ctrl+Shift+K</span>
          </button>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm hover:bg-[var(--otx-brand-soft)]"
            onClick={() => {
              setContextMenu(null);
              void useSessionStore.getState().terminalControllers[tabId]?.copyDiagnostics();
            }}
          >
            <span>Copiar diagnostico</span>
            <span className="text-xs text-[var(--otx-muted)]">Info</span>
          </button>
          <button
            type="button"
            className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-[var(--otx-brand)] hover:bg-[var(--otx-brand-soft)]"
            onClick={() => {
              setContextMenu(null);
              void useSessionStore.getState().terminalControllers[tabId]?.reconnectNow();
            }}
          >
            <span>Reconectar ahora</span>
            <span className="text-xs text-[var(--otx-muted)]">Ctrl+Shift+R</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
