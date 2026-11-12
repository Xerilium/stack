import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { App } from './App';
import { InstallView } from './InstallView';
import { Onboarding } from './OnboardingView';
import { loadSetup, wantsSetup, type SetupStatus } from './onboarding';
import './styles.css';
import './polish.css';

/** `#/install` replaces the app shell. @req FR:iphone-access/install.@ui */
const onInstall = () => location.hash.startsWith('#/install');
/** A local host that marks the page needs setup; anything else shows the app at once. @req FR:first-run-onboarding/web.gate */
const ask = wantsSetup(document, location.hostname);
function Root() {
  const [install, setInstall] = useState(onInstall);
  const [setup, setSetup] = useState<SetupStatus | null | undefined>(ask ? undefined : null);
  useEffect(() => { const on = () => setInstall(onInstall()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => { if (ask) void loadSetup((u, i) => fetch(u, i)).then(setSetup); }, []);
  if (install) return <InstallView />;
  if (setup === undefined) return null; // one loopback round trip, only on a page marked for setup
  if (setup?.needed) return <Onboarding initial={setup} onDone={(hash) => { location.hash = hash; setSetup(null); }} />;
  return <App />;
}

render(<Root />, document.getElementById('app')!);

/** Offline shell and notifications; secure contexts only (https, or localhost). @req FR:pwa/offline.sw */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined); });
}
