/**
 * AppShots MCP Server Integration Tests
 *
 * Verifies that an MCP client session over standard I/O can:
 * 1. Start the server over stdio.
 * 2. Discover available tools.
 * 3. Call build_appshots_project with a deterministic fixture.
 * 4. Call export_store_assets and verify output PNGs on disk.
 * 5. Handle invalid inputs and errors gracefully without crashing.
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { verifyPngBuffer } from "../lib/headless-export";

const TEST_OUTPUT_DIR = path.resolve("./tmp/mcp-integration-output");

describe("AppShots MCP Server - Stdio Client Integration", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

    // Use platform-appropriate npx executable (npx.cmd on Windows, npx on POSIX)
    const command = process.platform === "win32" ? "npx.cmd" : "npx";
    transport = new StdioClientTransport({
      command,
      args: ["tsx", path.resolve("src/mcp/index.ts")],
    });

    client = new Client({
      name: "mcp-test-client",
      version: "1.0.0",
    });

    await client.connect(transport);
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore cleanup error if already closed
    }
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it("discovers build_appshots_project and export_store_assets tools", async () => {
    const listResult = await client.listTools();
    const toolNames = listResult.tools.map((t) => t.name);

    expect(toolNames).toContain("build_appshots_project");
    expect(toolNames).toContain("export_store_assets");

    const buildTool = listResult.tools.find((t) => t.name === "build_appshots_project");
    expect(buildTool?.description).toContain("Build a valid AppShots project");

    const exportTool = listResult.tools.find((t) => t.name === "export_store_assets");
    expect(exportTool?.description).toContain("Export an AppShots project");
  });

  it("calls build_appshots_project with deterministic fixture and returns valid project JSON", async () => {
    const sampleImage = path.resolve("public/demo-image.png");
    expect(fs.existsSync(sampleImage)).toBe(true);

    const callResult = (await client.callTool({
      name: "build_appshots_project",
      arguments: {
        projectName: "MCP Integration Project",
        deviceId: "iphone-15-pro-max",
        exportSizeId: "6.7",
        slides: [
          {
            screenshotPath: sampleImage,
            headline: "Seamless <b>MCP Automation</b>",
            subheadline: "Direct tool execution from Antigravity & Cursor",
            backgroundMode: "gradient",
            gradientPresetId: "sunset",
            deviceStyle: "flat",
            deviceScale: 85,
          },
        ],
      },
    })) as { content: Array<{ type: string; text: string }> };

    expect(callResult.content[0].type).toBe("text");
    const parsed = JSON.parse(callResult.content[0].text);

    expect(parsed.project).toBeDefined();
    expect(parsed.project.name).toBe("MCP Integration Project");
    expect(parsed.project.screenshots.length).toBe(1);
    expect(parsed.project.screenshots[0].headline).toBe("Seamless <b>MCP Automation</b>");
    expect(parsed.project.screenshots[0].devices[0].screenshotSrc).toMatch(/^data:image\/png;base64,/);

    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.projectName).toBe("MCP Integration Project");
    expect(parsed.summary.deviceModel).toBe("iPhone 15 Pro Max");
  });

  it("calls export_store_assets and generates verified PNG files on disk", async () => {
    const sampleImage = path.resolve("public/demo-image.png");

    // 1. Build project
    const buildResult = (await client.callTool({
      name: "build_appshots_project",
      arguments: {
        projectName: "MCP Export Test",
        deviceId: "iphone-15-pro-max",
        exportSizeId: "6.7",
        slides: [
          {
            screenshotPath: sampleImage,
            headline: "Production <b>Store Assets</b>",
            subheadline: "Rendered at full 1284x2778 resolution",
            gradientPresetId: "ocean",
          },
        ],
      },
    })) as { content: Array<{ type: string; text: string }> };

    const { project } = JSON.parse(buildResult.content[0].text);

    // 2. Export project
    const exportResult = (await client.callTool({
      name: "export_store_assets",
      arguments: {
        project,
        outputDir: TEST_OUTPUT_DIR,
        exportSizeId: "6.7",
        filenamePrefix: "mcp-test-screen",
      },
    })) as { content: Array<{ type: string; text: string }> };

    const parsedExport = JSON.parse(exportResult.content[0].text);

    expect(parsedExport.success).toBe(true);
    expect(parsedExport.outputDir).toBe(TEST_OUTPUT_DIR);
    expect(parsedExport.files.length).toBe(1);

    const file = parsedExport.files[0];
    expect(file.filename).toBe("mcp-test-screen-1.png");
    expect(file.width).toBe(1284);
    expect(file.height).toBe(2778);
    expect(file.bytes).toBeGreaterThan(50000);

    // 3. Inspect generated file directly on filesystem
    const diskPath = path.join(TEST_OUTPUT_DIR, "mcp-test-screen-1.png");
    expect(fs.existsSync(diskPath)).toBe(true);

    const buffer = fs.readFileSync(diskPath);
    const dims = verifyPngBuffer(buffer);
    expect(dims.width).toBe(1284);
    expect(dims.height).toBe(2778);
  }, 45000);

  it("handles invalid inputs and errors gracefully without crashing the server", async () => {
    // 1. Build with missing screenshot file
    const invalidBuild = (await client.callTool({
      name: "build_appshots_project",
      arguments: {
        projectName: "Broken Project",
        slides: [
          {
            screenshotPath: "does_not_exist_image_xyz.png",
          },
        ],
      },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(invalidBuild.isError).toBe(true);
    expect(invalidBuild.content[0].text).toContain("Input file does not exist");

    // 2. Server remains alive and responsive after error: list tools still works
    const toolsAfterError = await client.listTools();
    expect(toolsAfterError.tools.length).toBe(2);

    // 3. Export with empty/invalid project
    const invalidExport = (await client.callTool({
      name: "export_store_assets",
      arguments: {
        project: { screenshots: [] },
        outputDir: TEST_OUTPUT_DIR,
      },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(invalidExport.isError).toBe(true);
    expect(invalidExport.content[0].text).toContain("screenshots");
  });
});
