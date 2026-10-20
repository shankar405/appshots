/**
 * AppShots MCP Tool: build_and_export_store_assets
 *
 * Connects an explicitly reviewed screenshot plan with the project builder and
 * headless canvas exporter to produce verified, full-resolution store-ready PNGs.
 */

import fs from "node:fs";
import { z } from "zod";
import {
  GenerateScreenshotPlanOutputSchema,
  VALID_EXPORT_SIZE_IDS,
  VALID_GRADIENT_PRESETS,
  type GenerateScreenshotPlanOutput,
} from "../ai/schemas";
import {
  buildAppshotsProject,
  type BuildProjectInput,
} from "../project-builder";
import {
  exportStoreAssets,
  type ExportStoreAssetsResult,
} from "../asset-exporter";
import {
  validateInputFilePath,
  validateOutputDirectoryPath,
  validateFilenamePrefix,
} from "../security";
import type { ExportedFileRecord } from "../../lib/headless-export";

export const BuildAndExportStoreAssetsInputSchema = z.object({
  projectName: z
    .string()
    .min(1)
    .optional()
    .describe("Name of the project (defaults to plan.projectName if omitted)"),
  plan: z
    .union([
      GenerateScreenshotPlanOutputSchema,
      z.record(z.string(), z.unknown()),
      z.string(),
    ])
    .describe(
      "Validated GenerateScreenshotPlanOutput data object or JSON string reviewed by the user",
    ),
  preset: z
    .string()
    .optional()
    .describe(
      "Supported export preset ID ('6.7', '6.5', '5.5', 'ipad'). Defaults to plan.exportSizeId",
    ),
  exportSizeId: z
    .string()
    .optional()
    .describe("Alias for preset"),
  outputDir: z
    .string()
    .min(1)
    .describe(
      "Target local filesystem directory to write exported PNG screenshots (must reside within allowed output roots)",
    ),
  filenamePrefix: z
    .string()
    .optional()
    .default("appstore-screenshot")
    .describe("Optional safe filename prefix for exported files (default: 'appstore-screenshot')"),
  appUrl: z
    .string()
    .optional()
    .describe(
      "Optional URL of a running AppShots instance (if omitted, spins up an ephemeral local server)",
    ),
});

export type BuildAndExportStoreAssetsInput = z.input<
  typeof BuildAndExportStoreAssetsInputSchema
>;

export interface BuildAndExportStoreAssetsResult {
  success: boolean;
  projectName: string;
  planId: string;
  targetStore: string;
  outputDir: string;
  exportSize: {
    id: string;
    label: string;
    width: number;
    height: number;
  };
  deviceModel: string;
  slideCount: number;
  files: ExportedFileRecord[];
  slides: Array<{
    slideNumber: number;
    headline: string;
    subheadline: string;
    sourcePath: string;
    exportedFile: string;
    marketingAngle?: {
      mainMessage: string;
      userBenefit: string;
      supportingEvidence: string;
    };
  }>;
  summary: string;
}

/**
 * Builds and exports store-ready assets from an approved screenshot plan.
 */
export async function buildAndExportStoreAssets(
  input: BuildAndExportStoreAssetsInput,
  options?: { allowedRoots?: string[]; allowedOutputRoots?: string[] },
): Promise<BuildAndExportStoreAssetsResult> {
  const validatedInput = BuildAndExportStoreAssetsInputSchema.parse(input);

  // 1. Parse and validate the screenshot plan schema
  let plan: GenerateScreenshotPlanOutput;
  if (typeof validatedInput.plan === "string") {
    try {
      const parsedJson = JSON.parse(validatedInput.plan);
      plan = GenerateScreenshotPlanOutputSchema.parse(parsedJson);
    } catch (err) {
      throw new Error(
        `Invalid screenshot plan JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    try {
      plan = GenerateScreenshotPlanOutputSchema.parse(validatedInput.plan);
    } catch (err) {
      throw new Error(
        `Invalid screenshot plan schema: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // 2. Enforce store and export preset support (Apple-only for now; reject Google Play)
  if (plan.targetStore === "google-play") {
    throw new Error(
      "Google Play export is not currently supported: Google Play screenshot dimensions and presets are not yet implemented or verified. Currently supported export presets are Apple App Store presets: 6.7, 6.5, 5.5, ipad.",
    );
  }

  const effectivePreset =
    validatedInput.preset ?? validatedInput.exportSizeId ?? plan.exportSizeId;

  if (!VALID_EXPORT_SIZE_IDS.includes(effectivePreset as (typeof VALID_EXPORT_SIZE_IDS)[number])) {
    throw new Error(
      `Unsupported export preset '${effectivePreset}'. Supported presets are: ${VALID_EXPORT_SIZE_IDS.join(
        ", ",
      )} (Apple App Store).`,
    );
  }

  // 3. Security validation of output directory and prefix
  const canonicalOutputDir = validateOutputDirectoryPath(
    validatedInput.outputDir,
    options ? { allowedRoots: options.allowedOutputRoots ?? options.allowedRoots } : undefined,
  );
  const safePrefix = validateFilenamePrefix(validatedInput.filenamePrefix);

  // 4. Validate slides and verify screenshot references exist on disk within allowed roots
  if (!plan.slides || plan.slides.length === 0) {
    throw new Error("Plan contains no slides to build and export.");
  }

  const validatedSlideInputs = plan.slides.map((slide) => {
    if (!slide.screenshotRef || !slide.screenshotRef.filePath) {
      throw new Error(
        `Slide ${slide.slideNumber} is missing a screenshot file reference.`,
      );
    }

    // Resolve and validate screenshot path against allowed input roots
    const canonicalScreenshotPath = validateInputFilePath(
      slide.screenshotRef.filePath,
      options,
    );

    // Validate background settings - reject unsupported values rather than silently dropping them
    const bgMode = slide.visualComposition.backgroundMode;
    if (bgMode === "gradient") {
      const gradientPresetId = slide.visualComposition.gradientPresetId;
      if (
        !gradientPresetId ||
        !VALID_GRADIENT_PRESETS.includes(gradientPresetId)
      ) {
        throw new Error(
          `Slide ${slide.slideNumber} specifies backgroundMode 'gradient' but has unsupported or missing gradientPresetId '${gradientPresetId}'. Supported presets are: ${VALID_GRADIENT_PRESETS.join(
            ", ",
          )}.`,
        );
      }
    } else if (bgMode === "solid") {
      const bgColor = slide.visualComposition.backgroundColor;
      if (!bgColor || !/^#[0-9a-fA-F]{6}$/.test(bgColor)) {
        throw new Error(
          `Slide ${slide.slideNumber} specifies backgroundMode 'solid' but has invalid hex backgroundColor '${bgColor}'.`,
        );
      }
    }

    // Preserve headline and subheadline exactly (including rich-text <b>, <span> tags)
    return {
      screenshotPath: canonicalScreenshotPath,
      headline: slide.copy.headline,
      subheadline: slide.copy.subheadline,
      backgroundMode: bgMode,
      gradientPresetId: slide.visualComposition.gradientPresetId ?? "sunset",
      backgroundColor: slide.visualComposition.backgroundColor,
      textColor: slide.visualComposition.textColor,
      deviceStyle: slide.visualComposition.deviceStyle,
      deviceScale: slide.visualComposition.deviceScale,
      deviceOffsetY: slide.visualComposition.deviceOffsetY,
      deviceRotation: slide.visualComposition.deviceRotation,
      rotateY: slide.visualComposition.rotateY,
      rotateX: slide.visualComposition.rotateX,
    };
  });

  // 5. Construct project via existing project builder
  const effectiveProjectName =
    validatedInput.projectName ?? plan.projectName ?? "App Store Screenshots";

  const projectInput: BuildProjectInput = {
    projectName: effectiveProjectName,
    deviceId: plan.deviceModel,
    deviceColorId: plan.deviceColor,
    exportSizeId: effectivePreset as (typeof VALID_EXPORT_SIZE_IDS)[number],
    headlineFontSize: plan.overallTheme.headlineFontSize,
    subheadlineFontSize: plan.overallTheme.subheadlineFontSize,
    slides: validatedSlideInputs,
  };

  const buildResult = buildAppshotsProject(projectInput, options);

  // 6. Export store assets via existing headless asset exporter
  const exportResult: ExportStoreAssetsResult = await exportStoreAssets(
    {
      project: buildResult.project,
      outputDir: canonicalOutputDir,
      exportSizeId: effectivePreset as (typeof VALID_EXPORT_SIZE_IDS)[number],
      filenamePrefix: safePrefix,
      appUrl: validatedInput.appUrl,
    },
    options,
  );

  // 7. Verify exported files on disk
  if (!exportResult.success || exportResult.files.length !== plan.slides.length) {
    throw new Error(
      `Export verification failed: expected ${plan.slides.length} files, but generated ${exportResult.files.length}.`,
    );
  }

  for (const file of exportResult.files) {
    if (!fs.existsSync(file.filepath)) {
      throw new Error(`Exported file not found on disk: ${file.filepath}`);
    }
  }

  // 8. Construct structured output metadata
  const slidesMetadata = plan.slides.map((slide, idx) => ({
    slideNumber: slide.slideNumber,
    headline: slide.copy.headline,
    subheadline: slide.copy.subheadline,
    sourcePath: validatedSlideInputs[idx].screenshotPath,
    exportedFile: exportResult.files[idx]?.filename ?? "",
    marketingAngle: slide.marketingAngle,
  }));

  return {
    success: true,
    projectName: effectiveProjectName,
    planId: plan.planId,
    targetStore: plan.targetStore,
    outputDir: canonicalOutputDir,
    exportSize: exportResult.exportSize,
    deviceModel: plan.deviceModel,
    slideCount: exportResult.files.length,
    files: exportResult.files,
    slides: slidesMetadata,
    summary: `Successfully built and exported ${exportResult.files.length} store screenshot(s) (${exportResult.exportSize.width}x${exportResult.exportSize.height}) for '${effectiveProjectName}' to ${canonicalOutputDir}`,
  };
}
