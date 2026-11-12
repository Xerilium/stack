import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { App } from './App';
import { InstallView } from './InstallView';
import { Onboarding } from './OnboardingView';
import { isLocalHost, loadSetup, type SetupStatus } from './onboarding';
import './styles.css';

/** `#/install` replaces the app shell. @req FR:iphone-access/install.@ui */
const onInstall = () => location.hash.startsWith('#/install');
/** A local host asks `/setup` first; the hosted app never does. @req FR:first-run-onboarding/web.gate */
const local = isLocalHost(location.hostname);
function Root() {
  const [install, setInstall] = useState(onInstall);
  const [setup, setSetup] = useState<SetupStatus | null | undefined>(local ? undefined : null);
  useEffect(() => { const on = () => setInstall(onInstall()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => { if (local) void loadSetup((u, i) => fetch(u, i)).then(setSetup); }, []);
  if (install) return <InstallView />;
  if (setup === undefined) return null; // one loopback round trip
  if (setup?.needed) return <Onboarding initial={setup} onDone={(hash) => { location.hash = hash; setSetup(null); }} />;
  return <App />;
}

render(<Root />, document.getElementById('app')!);

/** Offline shell and notifications; secure contexts only (https, or localhost). @req FR:pwa/offline.sw */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined); });
}
