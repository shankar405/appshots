/**
 * AppShots MCP Project Builder
 *
 * Programmatically constructs validated AppShots Project structures
 * from local assets and structured specifications without requiring manual UI interaction.
 */

import { z } from "zod";
import type { Project, Screenshot, DeviceStyle } from "../types";
import { exportSizes, gradientPresets } from "../constants";
import {
  createDefaultScreenshot,
} from "../context/EditorContext";
import {
  createDeviceInstance,
  getDeviceColorById,
  getDeviceSpecById,
} from "../lib/device-instances";
import { localImageToDataUrl } from "../lib/headless-export";
import { validateInputFilePath } from "./security";

const validDeviceIds = [
  "iphone-15-pro-max",
  "iphone-15-pro",
  "iphone-14",
  "ipad-pro-12-9",
  "samsung-galaxy-s24-ultra",
  "samsung-galaxy-tab-s9",
] as const;

const validExportSizeIds = ["6.7", "6.5", "5.5", "ipad"] as const;

export const SlideInputSchema = z.object({
  screenshotPath: z.string().describe("Local filesystem path to the screenshot image file (PNG, JPEG, WebP, SVG)"),
  headline: z.string().optional().default("Showcase Your App").describe("Marketing headline (supports HTML tags like <b>, <span>)"),
  subheadline: z.string().optional().default("Create stunning App Store screenshots in minutes.").describe("Supporting subheadline text"),
  backgroundMode: z.enum(["solid", "gradient"]).optional().default("gradient").describe("Background style: solid color or gradient preset"),
  gradientPresetId: z.enum(["sunset", "ocean", "mint", "berry", "royal", "rose"]).optional().default("sunset").describe("Gradient preset ID"),
  backgroundColor: z.string().optional().default("#8b5cf6").describe("Hex background color (used when backgroundMode is 'solid')"),
  textColor: z.string().optional().default("#ffffff").describe("Hex text color for headlines and subheadlines"),
  deviceStyle: z.enum(["flat", "3d"]).optional().default("flat").describe("Device mockup render style"),
  deviceScale: z.number().min(20).max(150).optional().default(80).describe("Device frame scale percentage (default: 80)"),
  deviceOffsetY: z.number().min(-50).max(100).optional().default(35).describe("Device vertical position percentage (default: 35)"),
  deviceRotation: z.number().min(-180).max(180).optional().default(0).describe("2D rotation in degrees"),
  rotateY: z.number().min(-45).max(45).optional().default(0).describe("3D yaw angle in degrees (-45 to 45)"),
  rotateX: z.number().min(-45).max(45).optional().default(0).describe("3D pitch angle in degrees (-45 to 45)"),
});

export const BuildProjectInputSchema = z.object({
  projectName: z.string().min(1).describe("Name of the project"),
  deviceId: z.enum(validDeviceIds).optional().default("iphone-15-pro-max").describe("Target device mockup model"),
  deviceColorId: z.string().optional().describe("Device color ID (defaults to primary color for selected device)"),
  exportSizeId: z.enum(validExportSizeIds).optional().default("6.7").describe("Target export dimension preset (6.7, 6.5, 5.5, ipad)"),
  headlineFontSize: z.number().min(20).max(160).optional().default(72).describe("Base headline font size in px"),
  subheadlineFontSize: z.number().min(14).max(100).optional().default(42).describe("Base subheadline font size in px"),
  slides: z.array(SlideInputSchema).min(1).describe("List of slides to include in the project (minimum 1)"),
});

export type BuildProjectInput = z.infer<typeof BuildProjectInputSchema>;

export interface BuildProjectResult {
  project: Project;
  summary: {
    projectName: string;
    slideCount: number;
    deviceModel: string;
    deviceColor: string;
    exportSize: string;
    slides: Array<{
      index: number;
      headline: string;
      sourcePath: string;
    }>;
  };
}

/**
 * Builds an AppShots Project structure from input parameters.
 */
export function buildAppshotsProject(
  input: BuildProjectInput,
  options?: { allowedRoots?: string[] },
): BuildProjectResult {
  const validated = BuildProjectInputSchema.parse(input);

  const deviceSpec = getDeviceSpecById(validated.deviceId);
  const colorSpec = getDeviceColorById(
    deviceSpec.id,
    validated.deviceColorId ?? deviceSpec.colors[0].id,
  );
  const exportPreset =
    exportSizes.find((s) => s.id === validated.exportSizeId) ?? exportSizes[0];

  const projectId = `project_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const screenshots: Screenshot[] = [];
  const slideSummaries: BuildProjectResult["summary"]["slides"] = [];

  for (let i = 0; i < validated.slides.length; i++) {
    const slide = validated.slides[i];
    const canonicalPath = validateInputFilePath(slide.screenshotPath, options);
    const dataUrl = localImageToDataUrl(canonicalPath);

    const deviceInstance = createDeviceInstance({
      deviceId: deviceSpec.id,
      colorId: colorSpec.id,
      screenshotSrc: dataUrl,
      x: 50,
      y: slide.deviceOffsetY,
      scale: slide.deviceScale,
      rotation: slide.deviceRotation,
      style: slide.deviceStyle as DeviceStyle,
      rotateY: slide.rotateY,
      rotateX: slide.rotateX,
    });

    const screenshot = createDefaultScreenshot(deviceSpec.id, colorSpec.id);
    screenshot.headline = slide.headline;
    screenshot.subheadline = slide.subheadline;
    screenshot.backgroundMode = slide.backgroundMode;
    screenshot.gradientPresetId =
      slide.backgroundMode === "gradient"
        ? (gradientPresets.some((p) => p.id === slide.gradientPresetId)
            ? slide.gradientPresetId
            : "sunset")
        : null;
    screenshot.backgroundColor = slide.backgroundColor;
    screenshot.textColor = slide.textColor;
    screenshot.devices = [deviceInstance];
    screenshot.activeDeviceId = deviceInstance.id;

    screenshots.push(screenshot);
    slideSummaries.push({
      index: i + 1,
      headline: slide.headline,
      sourcePath: canonicalPath,
    });
  }

  const project: Project = {
    id: projectId,
    name: validated.projectName,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    screenshots,
    selectedDeviceId: deviceSpec.id,
    selectedColorId: colorSpec.id,
    exportSizeId: exportPreset.id,
    activeScreenshotId: screenshots[0].id,
    headlineFontSize: validated.headlineFontSize,
    subheadlineFontSize: validated.subheadlineFontSize,
  };

  return {
    project,
    summary: {
      projectName: project.name,
      slideCount: screenshots.length,
      deviceModel: deviceSpec.label,
      deviceColor: colorSpec.label,
      exportSize: exportPreset.label,
      slides: slideSummaries,
    },
  };
}
