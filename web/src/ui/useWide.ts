/** Shared hooks for views. @req FR:ui-kit/split */
import { useEffect, useState } from "preact/hooks";

/** True while `query` matches (for example a wide split view). */
export function useWide(query: string, on = true): boolean {
  const q = () =>
    on && typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [wide, setWide] = useState(q);
  useEffect(() => {
    if (!on || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const f = () => setWide(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query, on]);
  return wide;
}
