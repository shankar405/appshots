/**
 * AppShots MCP Tool: package_store_export
 *
 * Connects approved variant designs or a finalized project with the headless
 * canvas rendering engine and ZIP packaging pipeline to export a structured,
 * verified store-ready archive with portable project data, manifest, and assets.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Project } from "../../types";
import { exportSizes } from "../../constants";
import { exportStoreAssets } from "../asset-exporter";
import { validateOutputDirectoryPath, validateFilenamePrefix } from "../security";
import {
  createStudioZipArchive,
  type PackageStudioArchiveResult,
} from "../../lib/studio/zip-packager";
import { variantsToProject, type DesignVariant } from "../../lib/studio/variants";
import { localImageToDataUrl } from "../../lib/headless-export";

const validExportSizeIds = ["6.7", "6.5", "5.5", "ipad"] as const;

export const PackageStoreExportInputSchema = z.object({
  projectName: z
    .string()
    .min(1)
    .optional()
    .describe("Name of the project or export bundle"),
  project: z
    .union([z.record(z.string(), z.unknown()), z.string()])
    .optional()
    .describe("AppShots Project data object or JSON string"),
  variants: z
    .union([z.array(z.record(z.string(), z.unknown())), z.string()])
    .optional()
    .describe("Array of DesignVariant objects or serialized JSON string from Studio"),
  preset: z
    .enum(validExportSizeIds)
    .optional()
    .default("6.7")
    .describe("Supported export preset ID ('6.7', '6.5', '5.5', 'ipad'). Default is '6.7'"),
  exportSizeId: z
    .enum(validExportSizeIds)
    .optional()
    .describe("Alias for preset"),
  targetStore: z
    .string()
    .optional()
    .default("apple-app-store")
    .describe("Target app store listing ('apple-app-store' or 'google-play')"),
  outputDir: z
    .string()
    .min(1)
    .describe(
      "Target local filesystem directory to write the exported ZIP archive (must reside within allowed output roots)",
    ),
  archiveName: z
    .string()
    .optional()
    .default("appshots-store-export")
    .describe("Filename for the ZIP archive (e.g. 'appshots-store-export')"),
  appUrl: z
    .string()
    .optional()
    .describe("Optional URL of a running AppShots instance (if omitted, spins up an ephemeral local server)"),
});

export type PackageStoreExportInput = z.input<typeof PackageStoreExportInputSchema>;

export interface PackageStoreExportResult {
  success: boolean;
  projectName: string;
  targetStore: string;
  outputDir: string;
  archivePath: string;
  archiveFilename: string;
  bytes: number;
  exportSize: {
    id: string;
    label: string;
    width: number;
    height: number;
  };
  fileCount: number;
  manifest: PackageStudioArchiveResult["manifest"];
  summary: string;
}

/**
 * Packages an approved screenshot studio project into a verified ZIP archive.
 */
export async function packageStoreExport(
  input: PackageStoreExportInput,
  options?: { allowedRoots?: string[]; allowedOutputRoots?: string[] },
): Promise<PackageStoreExportResult> {
  const validated = PackageStoreExportInputSchema.parse(input);

  // 1. Google Play Guardrail Check
  if (validated.targetStore === "google-play" || (validated.targetStore && validated.targetStore.toLowerCase().includes("google"))) {
    throw new Error(
      "Google Play export is not currently supported: Google Play screenshot dimensions and presets are not yet implemented or verified. Currently supported export presets are Apple App Store presets: 6.7, 6.5, 5.5, ipad.",
    );
  }

  const effectivePresetId = validated.exportSizeId || validated.preset || "6.7";
  const exportPreset = exportSizes.find((s) => s.id === effectivePresetId) || exportSizes[0];

  // 2. Resolve Project: from variants or direct project input
  let project: Project;

  if (validated.variants) {
    let rawVariants: DesignVariant[];
    if (typeof validated.variants === "string") {
      try {
        rawVariants = JSON.parse(validated.variants);
      } catch (err) {
        throw new Error(`Invalid variants JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      rawVariants = validated.variants as unknown as DesignVariant[];
    }

    if (!Array.isArray(rawVariants) || rawVariants.length === 0) {
      throw new Error("Variants array must contain at least one design variant.");
    }

    project = variantsToProject(rawVariants, {
      projectName: validated.projectName,
      exportSizeId: effectivePresetId,
      imageResolver: localImageToDataUrl,
    });
  } else if (validated.project) {
    if (typeof validated.project === "string") {
      try {
        project = JSON.parse(validated.project);
      } catch (err) {
        throw new Error(`Invalid project JSON: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      project = validated.project as unknown as Project;
    }
  } else {
    throw new Error("Either 'project' or 'variants' must be provided to package a store export.");
  }

  if (!project.screenshots || project.screenshots.length === 0) {
    throw new Error("Project must contain at least one screenshot to export.");
  }

  // Ensure export size ID matches
  project.exportSizeId = effectivePresetId;
  if (validated.projectName) {
    project.name = validated.projectName;
  }

  // 3. Validate output directory security
  const canonicalOutputDir = validateOutputDirectoryPath(validated.outputDir, {
    allowedRoots: options?.allowedOutputRoots || options?.allowedRoots,
  });

  const stagingDir = path.join(
    canonicalOutputDir,
    `__staging_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
  );
  fs.mkdirSync(stagingDir, { recursive: true });

  try {
    // 4. Render store-ready PNG screenshots using headless canvas export pipeline
    const exportResult = await exportStoreAssets(
      {
        project,
        outputDir: stagingDir,
        exportSizeId: effectivePresetId,
        filenamePrefix: "appstore-screen",
        appUrl: validated.appUrl,
      },
      { allowedRoots: [stagingDir, ...(options?.allowedRoots || [])] },
    );

    // 5. Match rendered files with screenshot metadata
    const renderedFiles = exportResult.files.map((file, idx) => {
      const slide = project.screenshots[idx];
      return {
        filepath: file.filepath,
        variantId: slide ? `variant-${idx + 1}` : undefined,
        sourceRoute: "/",
        headline: slide?.headline || "",
        subheadline: slide?.subheadline || "",
        deviceModel: project.selectedDeviceId,
        deviceStyle: slide?.devices[0]?.style || "flat",
      };
    });

    // 6. Build ZIP archive with manifest, README, PNGs, and portable project
    const safeArchiveName = validateFilenamePrefix(
      (validated.archiveName || "appshots-store-export").replace(/\.zip$/i, ""),
    );

    const archiveResult = await createStudioZipArchive({
      project,
      renderedFiles,
      outputDir: canonicalOutputDir,
      archiveName: safeArchiveName,
      targetStore: "apple-app-store",
      exportSize: {
        id: exportPreset.id,
        label: exportPreset.label,
        width: exportPreset.width,
        height: exportPreset.height,
      },
      allowedRoots: options?.allowedOutputRoots || options?.allowedRoots,
    });

    return {
      success: true,
      projectName: project.name,
      targetStore: "apple-app-store",
      outputDir: canonicalOutputDir,
      archivePath: archiveResult.archivePath,
      archiveFilename: archiveResult.archiveFilename,
      bytes: archiveResult.bytes,
      exportSize: {
        id: exportPreset.id,
        label: exportPreset.label,
        width: exportPreset.width,
        height: exportPreset.height,
      },
      fileCount: archiveResult.fileCount,
      manifest: archiveResult.manifest,
      summary: `Successfully packaged ${archiveResult.fileCount} store screenshot(s) (${exportPreset.width}x${exportPreset.height}) into ZIP archive '${archiveResult.archiveFilename}' at ${canonicalOutputDir}`,
    };
  } finally {
    // Clean up temporary staging directory
    try {
      if (fs.existsSync(stagingDir)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore staging cleanup errors
    }
  }
}
