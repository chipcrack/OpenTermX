export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 32;

export function shouldBlockTerminalReload(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>,
  insideTerminal: boolean
) {
  const key = event.key.toLowerCase();
  if (key === 'f5') return true;
  if (!(event.ctrlKey || event.metaKey) || key !== 'r') return false;
  // Preserve Ctrl+R (shell history) and Ctrl/Cmd+Shift+R (reconnect) only in xterm.
  return !(insideTerminal && !event.altKey && (event.shiftKey || (event.ctrlKey && !event.metaKey)));
}

export function clampTerminalFontSize(size: number) {
  return Number.isFinite(size)
    ? Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(size)))
    : DEFAULT_TERMINAL_FONT_SIZE;
}

export function terminalZoomAction(event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'in';
  if (event.key === '-' || event.code === 'NumpadSubtract') return 'out';
  if (event.key === '0' || event.code === 'Numpad0') return 'reset';
  return null;
}
