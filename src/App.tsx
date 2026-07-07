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

  return <WorkspacePage />;
}
