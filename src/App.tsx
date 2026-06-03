import { useEffect } from 'react';
import { useUiStore } from './stores/uiStore';
import { WorkspacePage } from './pages/WorkspacePage';

export default function App() {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return <WorkspacePage />;
}
