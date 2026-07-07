import { useEffect } from 'react';
import { WorkspacePage } from './pages/WorkspacePage';
import { useUiStore } from './stores/uiStore';

export default function App() {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const reloadShortcut = key === 'f5' || ((event.ctrlKey || event.metaKey) && key === 'r');

      if (!reloadShortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown, { capture: true });

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, []);

  return <WorkspacePage />;
}
