import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { App } from './App';
import { InstallView } from './InstallView';
import { LivePanel } from './LivePanel';
import { Onboarding } from './OnboardingView';
import { authSaysSetup, isLocalHost, loadSetup, wantsSetup, type SetupStatus } from './onboarding';
import './styles.css';
import './polish.css';
import './fluent2.css';

/** `#/install` replaces the app shell. @req FR:iphone-access/install.@ui */
const onInstall = () => location.hash.startsWith('#/install');
/** `#/live` shows the live validation checklist in place of the shell. @req FR:pr-review-lane/panel.view */
const onLane = () => /^#\/live(\?|$)/.test(location.hash);
/** A local host that marks the page needs setup; anything else shows the app at once. @req FR:first-run-onboarding/web.gate */
const ask = wantsSetup(document, location.hostname);
function Root() {
  const [install, setInstall] = useState(onInstall);
  const [lane, setLane] = useState(onLane);
  const [setup, setSetup] = useState<SetupStatus | null | undefined>(ask ? undefined : null);
  useEffect(() => { const on = () => { setInstall(onInstall()); setLane(onLane()); }; window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  useEffect(() => {
    const f = (u: string, i?: RequestInit) => fetch(u, i);
    if (ask) void loadSetup(f).then(setSetup);
    // A page served from the service worker cache may lack the tag: ask the host too (local only).
    else if (isLocalHost(location.hostname)) void authSaysSetup(f).then((yes) => (yes ? loadSetup(f) : null)).then((s) => { if (s?.needed) setSetup(s); });
  }, []);
  if (install) return <InstallView />;
  if (lane) return <LivePanel />;
  if (setup === undefined) return null; // one loopback round trip, only on a page marked for setup
  if (setup?.needed) return <Onboarding initial={setup} onDone={(hash) => { location.hash = hash; setSetup(null); }} />;
  return <App />;
}

render(<Root />, document.getElementById('app')!);

/** Offline shell and notifications; secure contexts only (https, or localhost). @req FR:pwa/offline.sw */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined); });
}
