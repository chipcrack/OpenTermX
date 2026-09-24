import { useEffect } from 'react';
import { WorkspacePage } from './pages/WorkspacePage';
import { useUiStore } from './stores/uiStore';
import { HostKeyDialog } from './components/terminal/HostKeyDialog';
import { shouldBlockTerminalReload } from './utils/terminalShortcuts';

export default function App() {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const insideTerminal = event.target instanceof Element && Boolean(event.target.closest('.xterm'));
      const reloadShortcut = shouldBlockTerminalReload(event, insideTerminal);

      if (!reloadShortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);

  return <><WorkspacePage /><HostKeyDialog /></>;
}
