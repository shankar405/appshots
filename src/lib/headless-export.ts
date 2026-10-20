/**
 * Headless Export Adapter for AppShots
 *
 * Automates AppShots screenshot export using Playwright Chromium in headless mode.
 * Operates on standard AppShots Project data structures and writes PNGs directly
 * to a specified filesystem output directory.
 */

import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { createServer, type ViteDevServer } from "vite";
import type { Project, ExportSize } from "../types";
import { exportSizes } from "../constants";
import type { PersistedEditorState } from "./useLocalStorage";
import { registerResourceCleanup } from "../mcp/lifecycle";

export interface HeadlessExportOptions {
  /** Project configuration to export */
  project: Project;
  /** Destination directory on local filesystem */
  outputDir: string;
  /** Optional running app URL (if omitted, spins up an ephemeral local Vite server) */
  appUrl?: string;
  /** Headless mode flag (defaults to true) */
  headless?: boolean;
  /** Viewport size for the headless browser */
  viewport?: { width: number; height: number };
}

export interface ExportedFileRecord {
  filename: string;
  filepath: string;
  width: number;
  height: number;
  bytes: number;
}

export interface HeadlessExportResult {
  success: boolean;
  outputDir: string;
  files: ExportedFileRecord[];
  browserDownloadComparison?: {
    matched: boolean;
    browserExportPath: string;
    bytes: number;
  };
}

/**
 * Validates the 8-byte PNG signature and parses the IHDR dimensions.
 */
export function verifyPngBuffer(buffer: Buffer): { width: number; height: number } {
  if (buffer.length < 24) {
    throw new Error("File is too small to be a valid PNG (minimum 24 bytes required).");
  }

  // PNG Magic Header: 89 50 4E 47 0D 0A 1A 0A
  const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < pngHeader.length; i++) {
    if (buffer[i] !== pngHeader[i]) {
      throw new Error(`Invalid PNG signature at byte ${i}: expected 0x${pngHeader[i].toString(16)}, got 0x${buffer[i].toString(16)}`);
    }
  }

  // IHDR chunk begins at offset 12: 'IHDR' -> [0x49, 0x48, 0x44, 0x52]
  const ihdrType = buffer.toString("ascii", 12, 16);
  if (ihdrType !== "IHDR") {
    throw new Error(`Expected IHDR chunk at offset 12, got: ${ihdrType}`);
  }

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);

  if (width === 0 || height === 0) {
    throw new Error(`Invalid PNG dimensions in IHDR chunk: ${width}x${height}`);
  }

  return { width, height };
}

/**
 * Converts a local image file into a Data URL for embedding in DeviceInstance.
 */
export function localImageToDataUrl(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Local image asset not found at path: ${resolvedPath}`);
  }

  const stat = fs.statSync(resolvedPath);
  if (stat.size === 0) {
    throw new Error(`Local image asset is empty (0 bytes): ${resolvedPath}`);
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  let mimeType = "image/png";
  if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
  else if (ext === ".webp") mimeType = "image/webp";
  else if (ext === ".svg") mimeType = "image/svg+xml";

  const buffer = fs.readFileSync(resolvedPath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * Executes a headless export of an AppShots project to a local directory.
 */
export async function exportProjectHeadless(
  options: HeadlessExportOptions,
): Promise<HeadlessExportResult> {
  const { project, outputDir } = options;

  if (!project || !project.screenshots || project.screenshots.length === 0) {
    throw new Error("Project must contain at least one screenshot to export.");
  }

  // Validate output directory
  const resolvedOutputDir = path.resolve(outputDir);
  try {
    fs.mkdirSync(resolvedOutputDir, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create output directory '${resolvedOutputDir}': ${err instanceof Error ? err.message : String(err)}`);
  }

  // Lookup target export specification
  const exportSize =
    exportSizes.find((s) => s.id === project.exportSizeId) ?? exportSizes[0];

  let viteServer: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let appUrl = options.appUrl;

  const unregisterCleanup = registerResourceCleanup(async () => {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (viteServer) {
      await viteServer.close().catch(() => {});
    }
  });

  try {
    // 1. Ensure Vite server is available
    if (!appUrl) {
      viteServer = await createServer({
        server: { port: 0 },
        logLevel: "silent",
      });
      const serverInstance = await viteServer.listen();
      const port = serverInstance.config.server.port;
      appUrl = `http://localhost:${port}`;
    }

    // 2. Launch headless Chromium
    browser = await chromium.launch({
      headless: options.headless ?? true,
    });

    const context = await browser.newContext({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      acceptDownloads: true,
    });

    const page: Page = await context.newPage();

    // 3. Seed project into localStorage before scripts run
    const persistedState: PersistedEditorState = {
      version: 2,
      projects: [project],
      activeProjectId: project.id,
      lastSaved: Date.now(),
    };

    await page.addInitScript((stateToSeed) => {
      window.localStorage.setItem(
        "app-screenshot-editor-state",
        JSON.stringify(stateToSeed),
      );
    }, persistedState);

    // 4. Navigate to editor and ensure assets/fonts settle
    await page.goto(appUrl, { waitUntil: "networkidle" });

    // 5. Wait for fonts and editor to mount
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForSelector('[data-screenshot-card="true"]', { timeout: 10000 });

    // 6. Invoke headless canvas export via window bridge
    interface RenderedFile {
      name: string;
      data: string;
    }

    const exportedFiles: RenderedFile[] = await page.evaluate(
      async (targetExportSize: ExportSize) => {
        const editor = (window as unknown as { __APPSHOTS_EDITOR__?: Record<string, unknown> }).__APPSHOTS_EDITOR__;
        const exportFn = (window as unknown as { __APPSHOTS_EXPORT__?: (...args: unknown[]) => Promise<RenderedFile[]> }).__APPSHOTS_EXPORT__;

        if (!editor || !exportFn) {
          throw new Error("AppShots headless bridge not initialized on window.");
        }

        // Canonical 1/3 scale preview dimensions derived from export preset ensure
        // identical typography scaling, line wrapping, and parity with browser Studio export.
        const canonicalPreviewDims = {
          width: targetExportSize.width / 3,
          height: targetExportSize.height / 3,
        };
        const headlineFontSize = editor.headlineFontSize as number;
        const subheadlineFontSize = editor.subheadlineFontSize as number;
        const screenshots = editor.screenshots as unknown[];

        // Render directly without browser download dialog
        return await exportFn({
          screenshots,
          exportSize: targetExportSize,
          previewDimensions: canonicalPreviewDims,
          headlineFontSize,
          subheadlineFontSize,
          skipDownload: true,
        });
      },
      exportSize,
    );

    if (!exportedFiles || exportedFiles.length === 0) {
      throw new Error("Canvas export produced no files.");
    }

    // 7. Write files to output directory and verify
    const fileRecords: ExportedFileRecord[] = [];

    for (const file of exportedFiles) {
      const match = file.data.match(/^data:image\/png;base64,(.+)$/);
      if (!match) {
        throw new Error(`File '${file.name}' did not return valid PNG data URL.`);
      }

      const buffer = Buffer.from(match[1], "base64");
      const targetPath = path.join(resolvedOutputDir, file.name);

      fs.writeFileSync(targetPath, buffer);

      // Verify file on disk
      const { width, height } = verifyPngBuffer(buffer);

      if (width !== exportSize.width || height !== exportSize.height) {
        throw new Error(
          `Exported dimensions for '${file.name}' (${width}x${height}) do not match expected exportSize (${exportSize.width}x${exportSize.height}).`,
        );
      }

      fileRecords.push({
        filename: file.name,
        filepath: targetPath,
        width,
        height,
        bytes: buffer.length,
      });
    }

    // 8. Normal browser export comparison for single-screenshot projects
    let browserComparison: HeadlessExportResult["browserDownloadComparison"] | undefined;
    if (project.screenshots.length === 1) {
      const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
      await page.click('button:has-text("Export All")');
      const download = await downloadPromise;

      const browserExportPath = path.join(resolvedOutputDir, "browser-ui-export.png");
      await download.saveAs(browserExportPath);

      const browserBuffer = fs.readFileSync(browserExportPath);
      const browserDims = verifyPngBuffer(browserBuffer);

      browserComparison = {
        matched:
          browserDims.width === exportSize.width &&
          browserDims.height === exportSize.height &&
          browserBuffer.length > 0,
        browserExportPath,
        bytes: browserBuffer.length,
      };
    }

    return {
      success: true,
      outputDir: resolvedOutputDir,
      files: fileRecords,
      browserDownloadComparison: browserComparison,
    };
  } finally {
    unregisterCleanup();
    // Guaranteed cleanup of browser and server resources
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (viteServer) {
      await viteServer.close().catch(() => {});
    }
  }
}
