/**
 * Local-only gate for the time console.
 * Do not use `import.meta.env.DEV` here: prebundled deps (Clerk) can leave
 * that flag false even under `vite`, which silently skipped the console.
 */
export function isDebugHost(): boolean {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}
