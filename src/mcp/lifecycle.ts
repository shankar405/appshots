/**
 * Process Lifecycle and Active Resource Management for AppShots MCP Server
 *
 * Ensures graceful shutdown on SIGINT, SIGTERM, and stdin disconnects,
 * preventing orphan Playwright browser processes and dangling Vite dev servers.
 */

type CleanupFunction = () => Promise<void> | void;

const activeCleanups = new Set<CleanupFunction>();
let isShuttingDown = false;
let handlersRegistered = false;

/**
 * Registers a resource cleanup callback to be executed during graceful shutdown.
 * Returns an unregister function to call when the resource is released normally.
 */
export function registerResourceCleanup(cleanup: CleanupFunction): () => void {
  activeCleanups.add(cleanup);
  return () => {
    activeCleanups.delete(cleanup);
  };
}

/**
 * Executes all registered cleanup functions and exits the process cleanly.
 */
export async function cleanupAndExit(code = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const cleanups = Array.from(activeCleanups);
  activeCleanups.clear();

  // Run cleanups in parallel with a 3-second hard timeout
  await Promise.race([
    Promise.allSettled(cleanups.map((fn) => Promise.resolve().then(() => fn()))),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).catch(() => {});

  process.exit(code);
}

/**
 * Attaches process signal and stdio disconnect listeners for the MCP server.
 */
export function setupLifecycleHandlers(additionalCleanup?: CleanupFunction): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  if (additionalCleanup) {
    activeCleanups.add(additionalCleanup);
  }

  const handleTermination = () => {
    cleanupAndExit(0);
  };

  process.on("SIGINT", () => handleTermination());
  process.on("SIGTERM", () => handleTermination());

  // When standard input closes (e.g. IDE client process exits or terminates the pipe)
  if (process.stdin) {
    process.stdin.on("close", () => handleTermination());
    process.stdin.on("end", () => handleTermination());
  }
}
