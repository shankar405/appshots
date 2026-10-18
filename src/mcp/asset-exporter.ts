/**
 * AppShots MCP Asset Exporter
 *
 * Exposes the headless export pipeline through the MCP tool interface,
 * rendering store-ready PNG assets directly to disk with strict path and prefix validation.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Project } from "../types";
import { exportSizes } from "../constants";
import {
  exportProjectHeadless,
  verifyPngBuffer,
  type ExportedFileRecord,
} from "../lib/headless-export";
import { validateOutputDirectoryPath, validateFilenamePrefix } from "./security";

const validExportSizeIds = ["6.7", "6.5", "5.5", "ipad"] as const;

export const ExportStoreAssetsInputSchema = z.object({
  project: z.union([z.record(z.string(), z.unknown()), z.string()]).describe("AppShots Project data object or JSON string (produced by build_appshots_project)"),
  outputDir: z.string().min(1).describe("Target local filesystem directory to write exported PNG screenshots"),
  exportSizeId: z.enum(validExportSizeIds).optional().describe("Optional export size override (6.7, 6.5, 5.5, ipad)"),
  filenamePrefix: z
    .string()
    .optional()
    .default("appstore-screenshot")
    .describe("Prefix for exported screenshot files (default: 'appstore-screenshot')"),
  appUrl: z.string().optional().describe("Optional URL of a running AppShots instance (if omitted, spins up an ephemeral local server)"),
});

export type ExportStoreAssetsInput = z.infer<typeof ExportStoreAssetsInputSchema>;

export interface ExportStoreAssetsResult {
  success: boolean;
  outputDir: string;
  exportSize: {
    id: string;
    label: string;
    width: number;
    height: number;
  };
  files: ExportedFileRecord[];
  summary: string;
}

/**
 * Validates and exports a project to disk.
 */
export async function exportStoreAssets(
  input: ExportStoreAssetsInput,
  options?: { allowedRoots?: string[] },
): Promise<ExportStoreAssetsResult> {
  const validated = ExportStoreAssetsInputSchema.parse(input);

  // Parse project if passed as string
  let project: Project;
  if (typeof validated.project === "string") {
    try {
      project = JSON.parse(validated.project) as Project;
    } catch {
      throw new Error("Invalid project JSON string: failed to parse.");
    }
  } else {
    project = validated.project as unknown as Project;
  }

  if (!project || !Array.isArray(project.screenshots) || project.screenshots.length === 0) {
    throw new Error("Project must contain a valid 'screenshots' array with at least one screenshot.");
  }

  // Validate output directory with boundary and safety checks
  const canonicalOutputDir = validateOutputDirectoryPath(validated.outputDir, options);

  // Validate filename prefix to prevent path traversal
  const safePrefix = validateFilenamePrefix(validated.filenamePrefix);

  // Apply export size override if supplied
  if (validated.exportSizeId) {
    project = {
      ...project,
      exportSizeId: validated.exportSizeId,
    };
  }

  const exportPreset =
    exportSizes.find((s) => s.id === project.exportSizeId) ?? exportSizes[0];

  // Execute headless export
  const exportResult = await exportProjectHeadless({
    project,
    outputDir: canonicalOutputDir,
    appUrl: validated.appUrl,
    headless: true,
  });

  const finalFiles: ExportedFileRecord[] = [];

  for (let i = 0; i < exportResult.files.length; i++) {
    const original = exportResult.files[i];
    const targetFilename = `${safePrefix}-${i + 1}.png`;
    const targetPath = path.join(canonicalOutputDir, targetFilename);

    if (original.filepath !== targetPath) {
      fs.renameSync(original.filepath, targetPath);
    }

    const fileBuffer = fs.readFileSync(targetPath);
    const { width, height } = verifyPngBuffer(fileBuffer);

    finalFiles.push({
      filename: targetFilename,
      filepath: targetPath,
      width,
      height,
      bytes: fileBuffer.length,
    });
  }

  return {
    success: true,
    outputDir: canonicalOutputDir,
    exportSize: {
      id: exportPreset.id,
      label: exportPreset.label,
      width: exportPreset.width,
      height: exportPreset.height,
    },
    files: finalFiles,
    summary: `Successfully exported ${finalFiles.length} screenshot(s) (${exportPreset.width}x${exportPreset.height}) to ${canonicalOutputDir}`,
  };
}
