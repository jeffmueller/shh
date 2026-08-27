"use client";

import { useSyncExternalStore } from "react";

/**
 * Reads the URL fragment — which carries the decryption key — without an
 * effect.
 *
 * The fragment is deliberately never sent to the server, so it simply does not
 * exist during server rendering. `useSyncExternalStore` is the primitive React
 * provides for exactly this: it renders the server snapshot during hydration,
 * then immediately re-renders with the client value, without the
 * setState-in-an-effect cascade.
 *
 * The server snapshot is `null` rather than `""` so callers can tell "not
 * known yet" from "genuinely absent". Without that distinction the first
 * client render would flash a "missing decryption key" error before the real
 * fragment arrived.
 *
 * Returns `null` while rendering on the server and during hydration, then the
 * fragment *including* its leading `#` (or `""` when the URL has none).
 */
export function useUrlHash(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

// Returns a primitive, so React's Object.is comparison stays stable between
// renders as long as the URL itself hasn't changed.
function getSnapshot(): string {
  return window.location.hash;
}

function getServerSnapshot(): string | null {
  return null;
}

/** The fragment with its leading `#` removed, or `null` if not yet known. */
export function useUrlFragment(): string | null {
  const hash = useUrlHash();
  return hash === null ? null : hash.replace(/^#/, "");
}
