import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { App } from './App';
import { InstallView } from './InstallView';
import './styles.css';

/** `#/install` replaces the app shell. @req FR:iphone-access/install.@ui */
const onInstall = () => location.hash.startsWith('#/install');
function Root() {
  const [install, setInstall] = useState(onInstall);
  useEffect(() => { const on = () => setInstall(onInstall()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  return install ? <InstallView /> : <App />;
}

render(<Root />, document.getElementById('app')!);

/** Offline shell and notifications; secure contexts only (https, or localhost). @req FR:pwa/offline.sw */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined); });
}
