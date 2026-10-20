/**
 * AppShots Screenshot Studio - ZIP Archive Packager
 *
 * Packages final approved screenshot designs into a structured, portable,
 * production-ready ZIP archive with verified PNG files, editable native project data,
 * complete manifest, and plain-text README instructions.
 */

import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import type { Project } from "../../types";
import { verifyPngBuffer } from "../headless-export";
import { validateOutputDirectoryPath, validateFilenamePrefix } from "../../mcp/security";

export interface StudioArchiveManifestSlide {
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
  deviceModel?: string;
  deviceStyle?: string;
}

export interface StudioArchiveManifest {
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
  slides: StudioArchiveManifestSlide[];
}

export interface PackageStudioArchiveOptions {
  project: Project;
  renderedFiles: Array<{
    filepath: string;
    variantId?: string;
    sourceRoute?: string;
    headline?: string;
    subheadline?: string;
    deviceModel?: string;
    deviceStyle?: string;
  }>;
  outputDir: string;
  archiveName?: string;
  targetStore?: string;
  exportSize?: {
    id: string;
    label: string;
    width: number;
    height: number;
  };
  allowedRoots?: string[];
}

export interface PackageStudioArchiveResult {
  success: boolean;
  archivePath: string;
  archiveFilename: string;
  bytes: number;
  manifest: StudioArchiveManifest;
  fileCount: number;
}

const FORBIDDEN_ARCHIVE_PATTERNS = [
  /^\./,
  /\.\./,
  /\.env/i,
  /\.git/i,
  /node_modules/i,
  /id_rsa/i,
  /\.pem$/i,
];

/**
 * Validates that an archive path is safe, relative, and does not perform path traversal.
 */
export function sanitizeArchivePath(entryPath: string): string {
  const normalized = entryPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) {
    throw new Error(`Insecure archive entry path rejected: '${entryPath}'`);
  }
  for (const pattern of FORBIDDEN_ARCHIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      throw new Error(`Forbidden archive entry path pattern: '${entryPath}'`);
    }
  }
  return normalized;
}

/**
 * Builds a plain-text README for the export archive.
 */
function generateReadmeContent(manifest: StudioArchiveManifest): string {
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
    `    ├── screenshots/        Store-ready PNG files for App Store Connect submission`,
    `    ├── project/`,
    `    │   ├── project.json    Native AppShots project file for continued editing`,
    `    │   └── assets/         Extracted source screenshot assets`,
    `    ├── manifest.json       Complete technical manifest with dimensions & copy`,
    `    └── README.txt          This guide`,
    ``,
    `--------------------------------------------------------------------------------`,
    `How to Reopen and Edit in AppShots:`,
    `--------------------------------------------------------------------------------`,
    `1. Launch your running AppShots instance (e.g., http://localhost:5173).`,
    `2. Open the Project Switcher in the left sidebar.`,
    `3. Choose 'Import Project' and select 'project/project.json' from this archive.`,
    `4. All screenshots, custom headlines, device 3D tilts, offsets, and colors`,
    `   will load instantly into the interactive canvas.`,
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
 * Creates a structured, portable ZIP archive from project and rendered screenshot files.
 */
export async function createStudioZipArchive(
  options: PackageStudioArchiveOptions,
): Promise<PackageStudioArchiveResult> {
  const { project, renderedFiles, outputDir } = options;

  if (!project || !project.screenshots || project.screenshots.length === 0) {
    throw new Error("Cannot package archive: project has no screenshots.");
  }

  if (!renderedFiles || renderedFiles.length === 0) {
    throw new Error("Cannot package archive: no rendered screenshot files provided.");
  }

  // Validate output directory with security boundaries
  const canonicalOutputDir = validateOutputDirectoryPath(outputDir, {
    allowedRoots: options.allowedRoots,
  });

  const rawArchiveName = options.archiveName || `appshots-export-${Date.now()}`;
  const safeArchivePrefix = validateFilenamePrefix(rawArchiveName.replace(/\.zip$/i, ""));
  const archiveFilename = `${safeArchivePrefix}.zip`;
  const archivePath = path.join(canonicalOutputDir, archiveFilename);

  const exportSize = options.exportSize || {
    id: project.exportSizeId,
    label: `Export Size ${project.exportSizeId}`,
    width: 1284,
    height: 2778,
  };

  const zip = new JSZip();
  const rootFolder = zip.folder("appshots-export");
  if (!rootFolder) {
    throw new Error("Failed to initialize zip root folder.");
  }

  const screenshotsFolder = rootFolder.folder("screenshots");
  const projectFolder = rootFolder.folder("project");
  const projectAssetsFolder = projectFolder?.folder("assets");

  const manifestSlides: StudioArchiveManifestSlide[] = [];

  // 1. Package rendered PNG files into screenshots/
  for (let idx = 0; idx < renderedFiles.length; idx++) {
    const item = renderedFiles[idx];
    const resolvedFilePath = path.resolve(item.filepath);

    if (!fs.existsSync(resolvedFilePath)) {
      throw new Error(`Rendered screenshot file not found on disk: '${resolvedFilePath}'`);
    }

    const buffer = fs.readFileSync(resolvedFilePath);
    const { width, height } = verifyPngBuffer(buffer);

    const safeFileBase = `screen-${String(idx + 1).padStart(2, "0")}-${item.variantId ? item.variantId.replace(/[^a-zA-Z0-9_-]/g, "-") : `variant-${idx + 1}`}.png`;
    const entryRelative = sanitizeArchivePath(`screenshots/${safeFileBase}`);

    screenshotsFolder?.file(safeFileBase, buffer);

    manifestSlides.push({
      slideNumber: idx + 1,
      variantId: item.variantId || `slide-${idx + 1}`,
      sourceRoute: item.sourceRoute || "/",
      filename: safeFileBase,
      archivePath: entryRelative,
      width,
      height,
      bytes: buffer.length,
      headline: item.headline || project.screenshots[idx]?.headline || "",
      subheadline: item.subheadline || project.screenshots[idx]?.subheadline || "",
      deviceModel: item.deviceModel || project.selectedDeviceId,
      deviceStyle: item.deviceStyle || project.screenshots[idx]?.devices[0]?.style || "flat",
    });
  }

  // 2. Package extracted image assets into project/assets/
  const portableProject: Project = JSON.parse(JSON.stringify(project));
  for (let sIdx = 0; sIdx < portableProject.screenshots.length; sIdx++) {
    const slide = portableProject.screenshots[sIdx];
    for (let dIdx = 0; dIdx < slide.devices.length; dIdx++) {
      const dev = slide.devices[dIdx];
      if (dev.screenshotSrc && dev.screenshotSrc.startsWith("data:image/")) {
        const matches = dev.screenshotSrc.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches) {
          const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
          const assetName = `screen-${String(sIdx + 1).padStart(2, "0")}-device-${dIdx + 1}.${ext}`;
          const assetBuffer = Buffer.from(matches[2], "base64");
          projectAssetsFolder?.file(assetName, assetBuffer);
        }
      }
    }
  }

  // 3. Package project/project.json
  const serializedProjectJson = JSON.stringify(portableProject, null, 2);
  projectFolder?.file("project.json", serializedProjectJson);

  // 4. Build manifest.json
  const manifest: StudioArchiveManifest = {
    exportVersion: "1.0",
    generatedAt: new Date().toISOString(),
    projectName: project.name,
    targetStore: options.targetStore || "apple-app-store",
    exportSize,
    totalScreenshots: manifestSlides.length,
    slides: manifestSlides,
  };

  rootFolder.file("manifest.json", JSON.stringify(manifest, null, 2));

  // 5. Build README.txt
  const readmeText = generateReadmeContent(manifest);
  rootFolder.file("README.txt", readmeText);

  // 6. Generate ZIP buffer and write to target output path
  let zipBuffer: Buffer;
  try {
    zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
  } catch (zipErr) {
    throw new Error(
      `Failed to generate ZIP archive: ${zipErr instanceof Error ? zipErr.message : String(zipErr)}`,
    );
  }

  fs.writeFileSync(archivePath, zipBuffer);

  return {
    success: true,
    archivePath,
    archiveFilename,
    bytes: zipBuffer.length,
    manifest,
    fileCount: manifestSlides.length,
  };
}
