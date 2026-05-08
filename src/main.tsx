import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ShareView from './ShareView.tsx';
import './index.css';

function Root() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const m = path.match(/^\/s\/([^/]+)\/?$/);
  if (m?.[1]) {
    return <ShareView shareId={m[1]} />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
