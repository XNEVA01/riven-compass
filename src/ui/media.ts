import { useCallback, useSyncExternalStore } from "react";

/**
 * A live @media query: re-renders when it flips (a resize flips narrow, a docked phone flips coarse).
 * The server snapshot is false — no layout and no pointer there; the first client render fixes it up.
 */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const m = matchMedia(query);
      m.addEventListener("change", onStoreChange);
      return () => m.removeEventListener("change", onStoreChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => matchMedia(query).matches,
    () => false,
  );
}
