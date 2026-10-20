/**
 * Browser-Compatible Studio ZIP Packager & PNG Verifier
 *
 * Runs entirely in the client-side browser context without Node.js built-ins.
 * Packages genuine rendered PNG screenshots, self-contained project data,
 * manifest with verified dimensions, and README instructions into a ZIP blob.
 */

import JSZip from "jszip";
import type { Project } from "../../types";
import { exportSizes } from "../../constants";
import type { DesignVariant } from "./variants";

export interface RenderedVariantAsset {
  variant: DesignVariant;
  dataUrl: string;
}

export interface BrowserStudioZipOptions {
  project: Project;
  renderedAssets: RenderedVariantAsset[];
  archiveName?: string;
  targetStore?: "apple-app-store" | "google-play";
  exportSizeId?: string;
}

export interface BrowserStudioZipResult {
  blob: Blob;
  uint8array?: Uint8Array;
  archiveFilename: string;
  fileCount: number;
  manifest: {
    exportVersion: string;
    generatedAt: string;
    projectName: string;
    targetStore: string;
    exportSize: {
      id: string;
      label: string;
      width: number;
      height: number;
    };
    totalScreenshots: number;
    slides: Array<{
      slideNumber: number;
      variantId: string;
      sourceRoute: string;
      filename: string;
      archivePath: string;
      width: number;
      height: number;
      bytes: number;
      headline: string;
      subheadline: string;
      deviceModel: string;
      deviceStyle?: string;
    }>;
  };
}

/**
 * Validates the 8-byte PNG signature and parses IHDR dimensions using pure typed arrays.
 * Safe to execute in any modern browser or Node.js runtime without external dependencies.
 */
export function verifyPngBytes(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.length < 24) {
    throw new Error("File is too small to be a valid PNG (minimum 24 bytes required).");
  }

  // PNG magic header: 89 50 4E 47 0D 0A 1A 0A
  const expectedHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < expectedHeader.length; i++) {
    if (bytes[i] !== expectedHeader[i]) {
      throw new Error(
        `Invalid PNG signature at byte ${i}: expected 0x${expectedHeader[i].toString(16)}, got 0x${bytes[i].toString(16)}`,
      );
    }
  }

  // Offset 12: IHDR chunk identifier (0x49, 0x48, 0x44, 0x52)
  if (
    bytes[12] !== 0x49 ||
    bytes[13] !== 0x48 ||
    bytes[14] !== 0x44 ||
    bytes[15] !== 0x52
  ) {
    throw new Error("Expected IHDR chunk marker at offset 12 in PNG file.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  if (width === 0 || height === 0) {
    throw new Error(`Invalid PNG dimensions encountered: ${width}x${height}`);
  }

  return { width, height };
}

/**
 * Converts a data URL (e.g. data:image/png;base64,...) to Uint8Array bytes.
 */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  if (!dataUrl || typeof dataUrl !== "string") {
    throw new Error("Invalid data URL provided: expected non-empty string.");
  }

  const base64Match = dataUrl.match(/^data:image\/png;base64,(.+)$/i);
  const base64String = base64Match ? base64Match[1] : dataUrl;

  try {
    const binary = atob(base64String.trim());
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    throw new Error(`Failed to decode base64 PNG data: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Sanitizes an archive filename prefix to prevent path traversal.
 */
export function sanitizeArchivePrefix(rawName: string): string {
  const cleaned = rawName.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return cleaned || "appshots-studio-export";
}

/**
 * Builds a plain-text README.txt for the export archive.
 */
function buildReadme(manifest: BrowserStudioZipResult["manifest"]): string {
  return [
    `================================================================================`,
    `AppShots Screenshot Studio — Store Asset Export`,
    `================================================================================`,
    ``,
    `Project Name:    ${manifest.projectName}`,
    `Generated At:    ${manifest.generatedAt}`,
    `Target Store:    ${manifest.targetStore}`,
    `Dimensions:      ${manifest.exportSize.width} x ${manifest.exportSize.height} px (${manifest.exportSize.label})`,
    `Screenshots:     ${manifest.totalScreenshots}`,
    ``,
    `--------------------------------------------------------------------------------`,
    `Archive Structure:`,
    `--------------------------------------------------------------------------------`,
    `  appshots-export/`,
    `    ├── screenshots/        Store-ready, full-resolution PNG files`,
    `    ├── project/`,
    `    │   └── project.json    Self-contained AppShots project file for continued editing`,
    `    ├── manifest.json       Complete technical manifest with verified dimensions`,
    `    └── README.txt          This guide`,
    ``,
    `--------------------------------------------------------------------------------`,
    `How to Reopen and Edit in AppShots:`,
    `--------------------------------------------------------------------------------`,
    `1. Launch AppShots in your browser (e.g. http://localhost:5173).`,
    `2. Open the Project Switcher in the left sidebar or top navigation.`,
    `3. Choose 'Import Project (.json)' and select 'project/project.json' from this archive.`,
    `4. All screenshots, headlines, colors, device models, and 3D angles will load instantly.`,
    ``,
    `Exported Screenshots:`,
    ...manifest.slides.map(
      (s) =>
        `  [Slide ${s.slideNumber}] ${s.filename} (${s.width}x${s.height}, ${(s.bytes / 1024).toFixed(1)} KB) - Route: ${s.sourceRoute}`,
    ),
    ``,
    `================================================================================`,
  ].join("\n");
}

/**
 * Assembles and verifies a complete, portable ZIP archive in the browser.
 * Ensures all PNGs are genuine and verified before generating the archive Blob.
 */
export async function packageBrowserStudioZip(
  options: BrowserStudioZipOptions,
): Promise<BrowserStudioZipResult> {
  const { project, renderedAssets, archiveName, targetStore = "apple-app-store", exportSizeId } = options;

  // 1. Target store guardrail
  if (targetStore === "google-play" || targetStore.toLowerCase().includes("google")) {
    throw new Error(
      "Google Play export is not currently supported: Google Play screenshot dimensions and presets are not yet implemented or verified. Currently supported export presets are Apple App Store presets: 6.7, 6.5, 5.5, ipad.",
    );
  }

  if (!project || !project.screenshots || project.screenshots.length === 0) {
    throw new Error("Cannot package export: project contains no screenshots.");
  }

  if (!renderedAssets || renderedAssets.length === 0) {
    throw new Error("Cannot package export: no rendered screenshot assets provided.");
  }

  // 2. Resolve export size
  const effectiveSizeId = exportSizeId || project.exportSizeId || "6.7";
  const exportPreset = exportSizes.find((s) => s.id === effectiveSizeId) || exportSizes[0];

  const safePrefix = sanitizeArchivePrefix((archiveName || "appshots-studio-export").replace(/\.zip$/i, ""));
  const archiveFilename = `${safePrefix}.zip`;

  const zip = new JSZip();
  const rootFolder = zip.folder("appshots-export");
  if (!rootFolder) {
    throw new Error("Failed to initialize zip root folder.");
  }

  const screenshotsFolder = rootFolder.folder("screenshots");
  const projectFolder = rootFolder.folder("project");

  const manifestSlides: BrowserStudioZipResult["manifest"]["slides"] = [];

  // 3. Verify and add every rendered PNG
  for (let idx = 0; idx < renderedAssets.length; idx++) {
    const item = renderedAssets[idx];
    const { variant, dataUrl } = item;

    // Decode and verify PNG bytes
    const pngBytes = dataUrlToUint8Array(dataUrl);
    const verifiedDims = verifyPngBytes(pngBytes);

    // Dimension check
    if (verifiedDims.width !== exportPreset.width || verifiedDims.height !== exportPreset.height) {
      console.warn(
        `Rendered PNG dimensions (${verifiedDims.width}x${verifiedDims.height}) differ from configured preset ${exportPreset.id} (${exportPreset.width}x${exportPreset.height}).`,
      );
    }

    const safeFileBase = `screen-${String(idx + 1).padStart(2, "0")}-${variant.presetId || `variant-${idx + 1}`}.png`;

    // Add binary PNG to zip
    screenshotsFolder?.file(safeFileBase, pngBytes, { binary: true });

    manifestSlides.push({
      slideNumber: idx + 1,
      variantId: variant.id,
      sourceRoute: variant.sourceScreen.route || "/",
      filename: safeFileBase,
      archivePath: `screenshots/${safeFileBase}`,
      width: verifiedDims.width,
      height: verifiedDims.height,
      bytes: pngBytes.length,
      headline: variant.copy.headline,
      subheadline: variant.copy.subheadline,
      deviceModel: variant.deviceModel || project.selectedDeviceId,
      deviceStyle: variant.visualComposition?.deviceStyle || "flat",
    });
  }

  // 4. Build manifest metadata from actual bytes & dimensions
  const manifest: BrowserStudioZipResult["manifest"] = {
    exportVersion: "1.0",
    generatedAt: new Date().toISOString(),
    projectName: project.name || "AppShots Studio Export",
    targetStore: "apple-app-store",
    exportSize: {
      id: exportPreset.id,
      label: exportPreset.label,
      width: exportPreset.width,
      height: exportPreset.height,
    },
    totalScreenshots: manifestSlides.length,
    slides: manifestSlides,
  };

  // 5. Add manifest, project.json, and README
  rootFolder.file("manifest.json", JSON.stringify(manifest, null, 2));
  projectFolder?.file("project.json", JSON.stringify(project, null, 2));
  rootFolder.file("README.txt", buildReadme(manifest));

  // 6. Generate ZIP Blob and Uint8Array
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/zip" });
  const uint8array = await zip.generateAsync({ type: "uint8array" });

  return {
    blob,
    uint8array,
    archiveFilename,
    fileCount: manifestSlides.length + 3, // screenshots + manifest + project.json + README
    manifest,
  };
}
