/**
 * AppShots Model Context Protocol (MCP) Server
 *
 * Exposes headless AppShots tools for integration with Antigravity and Cursor:
 * 1. build_appshots_project
 * 2. export_store_assets
 * 3. analyze_app_for_store
 * 4. generate_screenshot_plan
 * 5. build_and_export_store_assets
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
import {
  AnalyzeAppToolInputSchema,
  analyzeAppForStore,
} from "./tools/analyze-app";
import {
  GenerateScreenshotPlanToolInputSchema,
  generateScreenshotPlan,
} from "./tools/generate-plan";
import {
  BuildAndExportStoreAssetsInputSchema,
  buildAndExportStoreAssets,
} from "./tools/build-and-export";
import type { AIProvider } from "./ai/provider";
import { getActiveAIProvider } from "./ai/provider-factory";

export interface AppshotsServerOptions {
  provider?: AIProvider;
}

/**
 * Creates and configures the AppShots MCP Server with all tools.
 */
export function createAppshotsServer(options?: AppshotsServerOptions): McpServer {
  const provider = options?.provider ?? getActiveAIProvider();

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

  // Tool 3: analyze_app_for_store
  server.tool(
    "analyze_app_for_store",
    "Navigate a running web application, capture representative mobile screenshots, extract observable DOM evidence, and produce a factual App Store product analysis.",
    AnalyzeAppToolInputSchema.shape,
    async (args) => {
      try {
        const result = await analyzeAppForStore(args, { provider });
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
              text: `Failed to analyze application: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  );

  // Tool 4: generate_screenshot_plan
  server.tool(
    "generate_screenshot_plan",
    "Synthesize marketing headlines (with rich-text <b> tags), visual compositions, and device framing from app analysis to generate an ordered, reviewable screenshot plan.",
    GenerateScreenshotPlanToolInputSchema.shape,
    async (args) => {
      try {
        const result = await generateScreenshotPlan(args, { provider });
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
              text: `Failed to generate screenshot plan: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  );

  // Tool 5: build_and_export_store_assets
  server.tool(
    "build_and_export_store_assets",
    "Build and export verified, full-resolution store-ready PNG screenshots directly from an explicitly approved screenshot plan.",
    BuildAndExportStoreAssetsInputSchema.shape,
    async (args) => {
      try {
        const result = await buildAndExportStoreAssets(args);
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
              text: `Failed to build and export store assets: ${
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
