/**
 * AppShots Model Context Protocol (MCP) Server
 *
 * Exposes headless AppShots project building and asset export
 * tools for integration with Antigravity and Cursor.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  BuildProjectInputSchema,
  buildAppshotsProject,
} from "./project-builder";
import {
  ExportStoreAssetsInputSchema,
  exportStoreAssets,
} from "./asset-exporter";

/**
 * Creates and configures the AppShots MCP Server with tools.
 */
export function createAppshotsServer(): McpServer {
  const server = new McpServer({
    name: "appshots",
    version: "1.0.0",
  });

  // Tool 1: build_appshots_project
  server.tool(
    "build_appshots_project",
    "Build a valid AppShots project specification from local image assets and formatting options without manual UI interaction.",
    BuildProjectInputSchema.shape,
    async (args) => {
      try {
        const result = buildAppshotsProject(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to build AppShots project: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  );

  // Tool 2: export_store_assets
  server.tool(
    "export_store_assets",
    "Export an AppShots project to a local directory as full-resolution, store-ready PNG screenshots using the production canvas rendering pipeline.",
    ExportStoreAssetsInputSchema.shape,
    async (args) => {
      try {
        const result = await exportStoreAssets(args);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to export store assets: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  );

  return server;
}
