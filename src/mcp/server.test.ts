/**
 * AppShots MCP Server Integration Tests
 *
 * Verifies that an MCP client session over standard I/O can:
 * 1. Start the server over stdio.
 * 2. Discover all 5 available tools:
 *    - build_appshots_project
 *    - export_store_assets
 *    - analyze_app_for_store
 *    - generate_screenshot_plan
 *    - build_and_export_store_assets
 * 3. Call build_appshots_project with a deterministic fixture.
 * 4. Call export_store_assets and verify output PNGs on disk.
 * 5. Call analyze_app_for_store against a local test fixture and return schema-valid analysis.
 * 6. Call generate_screenshot_plan and return an ordered, reviewable plan with rich text.
 * 7. Call build_and_export_store_assets with an approved plan and export store-ready PNGs.
 * 8. Handle invalid inputs and errors gracefully without crashing.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { verifyPngBuffer } from "../lib/headless-export";

const TEST_OUTPUT_DIR = path.resolve("./tmp/mcp-integration-output");

describe("AppShots MCP Server - Stdio Client Integration", () => {
  let client: Client;
  let transport: StdioClientTransport;
  let fixtureServer: http.Server;
  let fixtureBaseUrl: string;

  beforeAll(async () => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

    // 1. Start local deterministic HTTP test fixture server
    await new Promise<void>((resolve) => {
      fixtureServer = http.createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");

        if (url.pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html lang="en">
              <head>
                <title>TaskMaster Pro - Agile Task Boards</title>
                <meta name="description" content="Organize team projects with real-time sprint tracking.">
              </head>
              <body>
                <header>
                  <nav><a href="/">Home</a><a href="/dashboard">Dashboard</a></nav>
                </header>
                <main>
                  <h1>Organize Projects with Speed</h1>
                  <h2>Real-Time Collaboration</h2>
                  <button>Create New Project</button>
                </main>
              </body>
            </html>
          `);
        } else if (url.pathname === "/dashboard") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html lang="en">
              <head><title>Team Dashboard - TaskMaster Pro</title></head>
              <body>
                <h1>Your Active Projects</h1>
                <button>New Sprint</button>
              </body>
            </html>
          `);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      });

      fixtureServer.listen(0, "127.0.0.1", () => {
        const addr = fixtureServer.address() as AddressInfo;
        fixtureBaseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // 2. Start MCP server over stdio
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
  }, 60000);

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore cleanup error if already closed
    }
    await new Promise<void>((resolve) => fixtureServer?.close(() => resolve()));
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it("discovers all six available tools", async () => {
    const listResult = await client.listTools();
    const toolNames = listResult.tools.map((t) => t.name);

    expect(toolNames).toContain("build_appshots_project");
    expect(toolNames).toContain("export_store_assets");
    expect(toolNames).toContain("analyze_app_for_store");
    expect(toolNames).toContain("generate_screenshot_plan");
    expect(toolNames).toContain("build_and_export_store_assets");
    expect(toolNames).toContain("package_store_export");

    expect(toolNames.length).toBe(6);

    const analyzeTool = listResult.tools.find((t) => t.name === "analyze_app_for_store");
    expect(analyzeTool?.description).toContain("factual App Store product analysis");

    const planTool = listResult.tools.find((t) => t.name === "generate_screenshot_plan");
    expect(planTool?.description).toContain("ordered, reviewable screenshot plan");

    const bridgeTool = listResult.tools.find((t) => t.name === "build_and_export_store_assets");
    expect(bridgeTool?.description).toContain("approved screenshot plan");

    const packageTool = listResult.tools.find((t) => t.name === "package_store_export");
    expect(packageTool?.description).toContain("ZIP archive");
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
  }, 75000);

  it("calls analyze_app_for_store against local fixture and returns schema-valid analysis", async () => {
    const rawCapturesDir = path.join(TEST_OUTPUT_DIR, "raw-captures");
    fs.mkdirSync(rawCapturesDir, { recursive: true });

    const callResult = (await client.callTool({
      name: "analyze_app_for_store",
      arguments: {
        url: fixtureBaseUrl,
        routes: ["/", "/dashboard"],
        outputDir: rawCapturesDir,
        viewport: "iphone-15-pro",
        userProvidedContext: {
          productName: "TaskMaster Pro",
          category: "Productivity",
        },
      },
    })) as { content: Array<{ type: string; text: string }> };

    expect(callResult.content[0].type).toBe("text");
    const analysis = JSON.parse(callResult.content[0].text);

    expect(analysis.product).toBeDefined();
    expect(analysis.product.name).toBe("TaskMaster Pro");
    expect(analysis.screens.length).toBe(2);
    expect(analysis.screens[0].status).toBe("captured");
    expect(analysis.screens[0].filePath).toContain("screen-1-home.png");
    expect(fs.existsSync(analysis.screens[0].filePath)).toBe(true);

    expect(analysis.features.length).toBeGreaterThan(0);
    expect(analysis.features[0].evidenceSource).toBeDefined();
    expect(analysis.features[0].evidence.length).toBeGreaterThan(0);
    expect(analysis.targetAudience).toBeDefined();
  }, 45000);

  it("calls generate_screenshot_plan and returns an ordered reviewable plan", async () => {
    const rawCapturesDir = path.join(TEST_OUTPUT_DIR, "raw-captures");

    // 1. Analyze first to produce valid analysis
    const analyzeResult = (await client.callTool({
      name: "analyze_app_for_store",
      arguments: {
        url: fixtureBaseUrl,
        routes: ["/"],
        outputDir: rawCapturesDir,
      },
    })) as { content: Array<{ type: string; text: string }> };

    const analysis = JSON.parse(analyzeResult.content[0].text);

    // 2. Generate screenshot plan from analysis
    const planResult = (await client.callTool({
      name: "generate_screenshot_plan",
      arguments: {
        analysis,
        targetStore: "apple-app-store",
        targetDevice: "iphone-15-pro-max",
        slideCount: 3,
        customCopyOverrides: [
          {
            slideIndex: 1,
            headline: "Ship features with <b>confidence</b>",
          },
        ],
      },
    })) as { content: Array<{ type: string; text: string }> };

    expect(planResult.content[0].type).toBe("text");
    const plan = JSON.parse(planResult.content[0].text);

    expect(plan.planId).toBeDefined();
    expect(plan.targetStore).toBe("apple-app-store");
    expect(plan.deviceModel).toBe("iphone-15-pro-max");
    expect(plan.slides.length).toBe(3);

    // Verify custom override applied
    expect(plan.slides[0].copy.headline).toBe("Ship features with <b>confidence</b>");

    // Verify slide 2 headline has rich text <b> tag
    expect(plan.slides[1].copy.headline).toContain("<b>");

    // Verify visual composition options
    expect(["flat", "3d"]).toContain(plan.slides[0].visualComposition.deviceStyle);
    expect(plan.slides[0].visualComposition.gradientPresetId).toBeDefined();
    expect(plan.readyForProjectBuilder).toBe(true);
  }, 45000);

  it("calls build_and_export_store_assets over stdio with an approved plan and generates store assets", async () => {
    const rawCapturesDir = path.join(TEST_OUTPUT_DIR, "pipeline-raw-captures");
    const exportOutputDir = path.join(TEST_OUTPUT_DIR, "pipeline-store-assets");

    // 1. Analyze
    const analyzeResult = (await client.callTool({
      name: "analyze_app_for_store",
      arguments: {
        url: fixtureBaseUrl,
        routes: ["/"],
        outputDir: rawCapturesDir,
      },
    })) as { content: Array<{ type: string; text: string }> };

    const analysis = JSON.parse(analyzeResult.content[0].text);

    // 2. Generate plan
    const planResult = (await client.callTool({
      name: "generate_screenshot_plan",
      arguments: {
        analysis,
        targetStore: "apple-app-store",
        targetDevice: "iphone-15-pro-max",
        slideCount: 1,
        customCopyOverrides: [
          {
            slideIndex: 1,
            headline: "Approved <b>Pipeline Copy</b>",
            subheadline: "Directly reviewed and verified by user",
          },
        ],
      },
    })) as { content: Array<{ type: string; text: string }> };

    const plan = JSON.parse(planResult.content[0].text);

    // 3. User reviews and approves plan -> Agent invokes build_and_export_store_assets
    const pipelineResult = (await client.callTool({
      name: "build_and_export_store_assets",
      arguments: {
        projectName: "TaskMaster End-To-End Store Assets",
        plan,
        outputDir: exportOutputDir,
        preset: "6.7",
        filenamePrefix: "approved-store-shot",
      },
    })) as { content: Array<{ type: string; text: string }> };

    expect(pipelineResult.content[0].type).toBe("text");
    const parsedPipeline = JSON.parse(pipelineResult.content[0].text);

    expect(parsedPipeline.success).toBe(true);
    expect(parsedPipeline.projectName).toBe("TaskMaster End-To-End Store Assets");
    expect(parsedPipeline.files.length).toBe(3);
    expect(parsedPipeline.files[0].filename).toBe("approved-store-shot-1.png");
    expect(parsedPipeline.files[0].width).toBe(1284);
    expect(parsedPipeline.files[0].height).toBe(2778);
    expect(parsedPipeline.files[1].filename).toBe("approved-store-shot-2.png");
    expect(parsedPipeline.files[2].filename).toBe("approved-store-shot-3.png");

    // Preserved reviewed copy
    expect(parsedPipeline.slides[0].headline).toBe("Approved <b>Pipeline Copy</b>");
    expect(parsedPipeline.slides[0].subheadline).toBe("Directly reviewed and verified by user");

    // Verify on disk
    const onDiskFile = path.join(exportOutputDir, "approved-store-shot-1.png");
    expect(fs.existsSync(onDiskFile)).toBe(true);
    const verified = verifyPngBuffer(fs.readFileSync(onDiskFile));
    expect(verified.width).toBe(1284);
    expect(verified.height).toBe(2778);
  }, 60000);

  it("calls build_and_export_store_assets with google-play store and receives clear error", async () => {
    const rawCapturesDir = path.join(TEST_OUTPUT_DIR, "pipeline-raw-captures");
    const exportOutputDir = path.join(TEST_OUTPUT_DIR, "pipeline-google-play-assets");

    const analyzeResult = (await client.callTool({
      name: "analyze_app_for_store",
      arguments: {
        url: fixtureBaseUrl,
        routes: ["/"],
        outputDir: rawCapturesDir,
      },
    })) as { content: Array<{ type: string; text: string }> };

    const analysis = JSON.parse(analyzeResult.content[0].text);

    const planResult = (await client.callTool({
      name: "generate_screenshot_plan",
      arguments: {
        analysis,
        targetStore: "google-play",
        slideCount: 1,
      },
    })) as { content: Array<{ type: string; text: string }> };

    const plan = JSON.parse(planResult.content[0].text);

    const callResult = (await client.callTool({
      name: "build_and_export_store_assets",
      arguments: {
        plan,
        outputDir: exportOutputDir,
      },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(callResult.isError).toBe(true);
    expect(callResult.content[0].text).toContain("Google Play export is not currently supported");
  });

  it("calls package_store_export over stdio with approved variants and generates a verified ZIP archive", async () => {
    const demoImage = path.resolve("public/demo-image.png");
    const zipOutputDir = path.join(TEST_OUTPUT_DIR, "stdio-zip-export");

    const variantsPayload = [
      {
        id: "var-1",
        presetId: "minimal-clean",
        name: "Minimal Clean",
        description: "Centered flat frame",
        sourceScreen: {
          id: "screen-1",
          route: "/",
          filePath: demoImage,
          title: "Home",
        },
        copy: {
          headline: "TaskMaster <b>Pro</b>",
          subheadline: "Organize sprints effortlessly",
        },
        visualComposition: {
          deviceStyle: "flat",
          deviceScale: 80,
          deviceOffsetY: 35,
          deviceRotation: 0,
          rotateY: 0,
          rotateX: 0,
          backgroundMode: "solid",
          gradientPresetId: null,
          backgroundColor: "#18181b",
          textColor: "#ffffff",
        },
        deviceModel: "iphone-15-pro-max",
        deviceColorId: "black",
      },
    ];

    const callResult = (await client.callTool({
      name: "package_store_export",
      arguments: {
        projectName: "TaskMaster Pro Bundle",
        variants: variantsPayload,
        outputDir: zipOutputDir,
        archiveName: "stdio-export-bundle",
        preset: "6.7",
      },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(callResult.isError).toBeFalsy();
    const result = JSON.parse(callResult.content[0].text);
    expect(result.success).toBe(true);
    expect(result.archiveFilename).toBe("stdio-export-bundle.zip");
    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(result.fileCount).toBe(1);
    expect(result.manifest.totalScreenshots).toBe(1);
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
    expect(toolsAfterError.tools.length).toBe(6);

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

    // 4. Generate plan with invalid analysis
    const invalidPlan = (await client.callTool({
      name: "generate_screenshot_plan",
      arguments: {
        analysis: "not a valid json string",
      },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(invalidPlan.isError).toBe(true);
    expect(invalidPlan.content[0].text).toContain("Invalid analysis JSON string");

    // 5. Build and export with invalid plan
    const invalidPipeline = (await client.callTool({
      name: "build_and_export_store_assets",
      arguments: {
        plan: "not a valid json string",
        outputDir: TEST_OUTPUT_DIR,
      },
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(invalidPipeline.isError).toBe(true);
    expect(invalidPipeline.content[0].text).toContain("Invalid screenshot plan");
  });
});
