import { render } from 'preact';
import { App } from './App';
import './styles.css';

render(<App />, document.getElementById('app')!);

/** Offline shell and notifications; secure contexts only (https, or localhost). @req FR:pwa/offline.sw */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined); });
}
