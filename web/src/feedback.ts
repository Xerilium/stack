/** Feedback panel helpers: page context and the browser screenshot. @req FR:feedback-button/ui.shot */
import type { FeedbackBody } from './api';

export const MAX_PNG_BYTES = 700 * 1024;

/** The desktop app's window (Electron) is captured by the host, not the page. */
export const isDesktopApp = (ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean => /\bElectron\//.test(ua);

/** Route (no query string), viewport, theme. @req FR:feedback-button/store.line */
export function pageContext(w: Pick<Window, 'location' | 'innerWidth' | 'innerHeight' | 'matchMedia'> & { document?: Document } = window): Pick<FeedbackBody, 'route' | 'viewport' | 'theme'> {
  const forced = w.document?.documentElement.getAttribute('data-theme');
  const dark = forced ? forced === 'dark' : !!w.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return { route: `${w.location.pathname}${w.location.hash}`.slice(0, 500), viewport: `${Math.round(w.innerWidth)}x${Math.round(w.innerHeight)}`, theme: dark ? 'dark' : 'light' };
}

/** Bytes a base64 string decodes to. */
export const b64Bytes = (b64: string): number => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

/** Widths to try, largest first, until the PNG fits the cap. */
export const FIT_WIDTHS = [1280, 960, 720, 480];

/**
 * Asks for this tab through the Screen Capture API right away (while the click still counts as a user gesture), and
 * returns a grab that takes one frame as a base64 PNG under the cap, then stops the stream. Null when the API is absent
 * or the prompt is denied; the grab gives null when no size fits. @req FR:feedback-button/ui.shot
 */
export async function startShot(): Promise<(() => Promise<string | null>) | null> {
  const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!md?.getDisplayMedia) return null;
  let stream: MediaStream;
  try { stream = await md.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions); } catch { return null; }
  return async () => {
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      for (const max of FIT_WIDTHS) {
        const scale = Math.min(1, max / (video.videoWidth || max));
        const c = document.createElement('canvas');
        c.width = Math.round((video.videoWidth || max) * scale);
        c.height = Math.round((video.videoHeight || max) * scale);
        c.getContext('2d')?.drawImage(video, 0, 0, c.width, c.height);
        const b64 = c.toDataURL('image/png').split(',')[1] ?? '';
        if (b64 && b64Bytes(b64) <= MAX_PNG_BYTES) return b64;
      }
      return null;
    } catch { return null; } finally { stream.getTracks().forEach((t) => t.stop()); }
  };
}
