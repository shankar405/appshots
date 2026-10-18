#!/usr/bin/env node
/**
 * AppShots MCP Server Executable Entry Point
 *
 * Runs over standard input/output (stdio) transport for direct
 * subprocess connection from Antigravity, Cursor, and other MCP clients.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createAppshotsServer } from "./server";
import { setupLifecycleHandlers } from "./lifecycle";

async function main() {
  const server = createAppshotsServer();
  const transport = new StdioServerTransport();

  // Attach graceful termination hooks for SIGINT, SIGTERM, and stdin disconnects
  setupLifecycleHandlers(async () => {
    try {
      await server.close();
    } catch {
      // Ignore server close error during process termination
    }
  });

  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error in AppShots MCP Server:", error);
  process.exit(1);
});
