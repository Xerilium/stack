/**
 * `/#/install`: get Stack onto the iPhone Home Screen, then turn on push from the installed app.
 * @req FR:iphone-access/install.@ui @req FR:iphone-access/install.steps @req FR:iphone-access/install.gesture @req FR:iphone-access/install.subscribe @req FR:iphone-access/install.pair
 */
import { useEffect, useState } from 'preact/hooks';
import { browserDeps, deviceStore, enablePush, loadDevice, platformOf, readPairing, saveDevice, stepFor, type Step } from './push';
import { isStandalone } from './install';
import './install.css';

const perm = (): NotificationPermission => ('Notification' in window ? Notification.permission : 'denied');

const ShareIcon = () => (
  <svg class="inst-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
);
const PlusIcon = () => (
  <svg class="inst-glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4" fill="none" stroke="currentColor" stroke-width="1.8" /><path d="M12 8.5v7M8.5 12h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
);

export function InstallView() {
  // A pairing link carries the device token in the hash: keep it and drop it from the address at once.
  const [token] = useState(() => {
    const p = readPairing(location.hash);
    if (p.token) { saveDevice(deviceStore(), p.token); history.replaceState(null, '', `${location.pathname}${location.search}${p.hash}`); }
    return loadDevice(deviceStore());
  });
  const platform = platformOf({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone: isStandalone(), push: 'PushManager' in window && 'serviceWorker' in navigator && 'Notification' in window });
  const [permission, setPermission] = useState<NotificationPermission>(perm);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Reads the current subscription only; never asks for permission. @req FR:iphone-access/install.gesture
  useEffect(() => {
    if (!platform.push || permission !== 'granted') return;
    let live = true;
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => { if (live) setSubscribed(!!s); }).catch(() => undefined);
    return () => { live = false; };
  }, [platform.push, permission]);

  const step: Step = stepFor(platform, { permission, paired: !!token, subscribed });

  /** The only caller of the permission prompt. @req FR:iphone-access/install.gesture */
  const onEnable = async () => {
    if (!token || busy) return;
    setBusy(true); setError('');
    const r = await enablePush(browserDeps(token));
    setBusy(false);
    setPermission(perm());
    if (r === 'on') setSubscribed(true);
    else if (r === 'error') setError('Could not turn on notifications. Try again, or pair this phone again.');
    else if (r === 'dismissed') setError('Notifications are still off.');
  };

  const enableBlock = (
    <>
      <p class="inst-lede">Stack pings this phone only when an ask is due within 1 hour.</p>
      {step === 'pair' && <p class="inst-note">Pair this phone first: open the pairing link from Stack on your computer.</p>}
      <button type="button" class="inst-cta" disabled={step === 'pair' || busy} onClick={() => void onEnable()}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>
      {error && <p class="inst-note err" role="status">{error}</p>}
    </>
  );

  return (
    <main class="inst" aria-labelledby="inst-h">
      <img class="inst-icon" src="/icons/icon-192.png" width="64" height="64" alt="" />
      {step === 'add-to-home' && (
        <>
          <h1 id="inst-h">Add Stack to your Home Screen</h1>
          <p class="inst-lede">Push works only from the Home Screen app on iPhone.</p>
          <ol class="inst-steps">
            <li><span class="inst-n">1</span><span>Tap <b>Share</b> <ShareIcon /> in the Safari toolbar.</span></li>
            <li><span class="inst-n">2</span><span>Scroll down and tap <b>Add to Home Screen</b> <PlusIcon />.</span></li>
            <li><span class="inst-n">3</span><span>Tap <b>Add</b>, then open <b>Stack</b> from the Home Screen.</span></li>
          </ol>
        </>
      )}
      {step === 'open-in-safari' && (
        <>
          <h1 id="inst-h">Open this page in Safari</h1>
          <p class="inst-lede">Use Safari to add Stack to the Home Screen. Push needs the Home Screen app.</p>
        </>
      )}
      {step === 'update-ios' && (
        <>
          <h1 id="inst-h">Update to iOS 16.4 or later</h1>
          <p class="inst-lede">This iOS version cannot get push in Home Screen apps.</p>
        </>
      )}
      {(step === 'enable' || step === 'pair') && <><h1 id="inst-h">Turn on notifications</h1>{enableBlock}</>}
      {step === 'blocked' && (
        <>
          <h1 id="inst-h">Notifications are off</h1>
          <p class="inst-note err" role="status">Blocked: allow notifications for Stack in Settings &gt; Notifications</p>
        </>
      )}
      {step === 'on' && (
        <>
          <h1 id="inst-h">Notifications are on</h1>
          <p class="inst-lede">You get a ping when an ask is due within 1 hour. Quiet hours hold all but critical asks.</p>
        </>
      )}
      {step === 'desktop-install' && (
        <>
          <h1 id="inst-h">Install Stack</h1>
          <p class="inst-lede">Install from your browser menu (Install app, or Add to Home Screen).</p>
        </>
      )}
      {step === 'desktop-done' && <><h1 id="inst-h">You are set</h1><p class="inst-lede">Stack is installed on this device.</p></>}
      <a class="inst-back" href="#/home">Back to Stack</a>
    </main>
  );
}
