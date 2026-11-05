/** Install-as-app command state. Pure core plus a thin window wiring. @req FR:desktop-app/install.prompt @req FR:desktop-app/install.prompt.done @req FR:desktop-app/install.prompt.none */
export interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

export function createInstall(standalone: boolean) {
  let saved: InstallEvent | null = null;
  let done = standalone;
  return {
    available: () => !done && saved !== null,
    onBeforeInstall(e: InstallEvent) { e.preventDefault(); if (!done) saved = e; },
    onInstalled() { done = true; saved = null; },
    /** The browser allows one prompt per event, so the event is dropped first. */
    async run() {
      const e = saved;
      saved = null;
      if (!e) return;
      await e.prompt();
      await e.userChoice;
    },
  };
}

export const isStandalone = (w: Partial<Window> = globalThis as never): boolean =>
  !!w.matchMedia?.('(display-mode: standalone)').matches || (w.navigator as { standalone?: boolean } | undefined)?.standalone === true;
