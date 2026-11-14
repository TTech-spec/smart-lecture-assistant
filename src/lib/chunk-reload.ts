/**
 * After a new deploy, a browser holding the old page asks for page pieces
 * (code chunks) that no longer exist and the page fails to open. Instead of
 * showing an error, reload once to pick up the new version.
 */
const KEY = "att.chunk-reload-at";

export function isChunkLoadError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk [\w-]+ failed|Unable to preload CSS/i.test(m);
}

/** Reload the page, at most once every 30 seconds (so a real outage can't loop). Returns true if it reloads. */
export function reloadForNewVersion(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < 30_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // storage blocked: still reload once
  }
  window.location.reload();
  return true;
}

// Vite reports a failed page-piece preload with this event; reload before the page breaks
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (e) => {
    if (reloadForNewVersion()) e.preventDefault();
  });
}
