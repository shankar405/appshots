/**
 * AppShots Screenshot Studio - Multi-Variant Design Generator
 *
 * Generates 3-4 visually distinct design variants for any captured application screenshot
 * using deterministic, production-calibrated styling presets compatible with AppShots canvas renderer.
 */

import type { ObservedScreen } from "../../mcp/ai/schemas";
import type { Project, Screenshot, DeviceStyle } from "../../types";
import { exportSizes } from "../../constants";
import { createDefaultScreenshot } from "../../context/EditorContext";
import { createDeviceInstance, getDeviceColorById, getDeviceSpecById } from "../device-instances";

export type StudioVariantPresetId =
  | "minimal-clean"
  | "bold-gradient"
  | "dark-contrast-3d"
  | "premium-editorial";

export interface StudioVariantComposition {
  deviceStyle: DeviceStyle;
  deviceScale: number;
  deviceOffsetY: number;
  deviceRotation: number;
  rotateY: number;
  rotateX: number;
  backgroundMode: "solid" | "gradient";
  gradientPresetId: "sunset" | "ocean" | "mint" | "berry" | "royal" | "rose" | null;
  backgroundColor: string;
  textColor: string;
  headlineFontSize?: number;
  subheadlineFontSize?: number;
}

export interface DesignVariant {
  id: string;
  presetId: StudioVariantPresetId;
  name: string;
  description: string;
  sourceScreen: {
    id: string;
    route: string;
    filePath: string;
    title: string;
    keyElements?: string[];
  };
  copy: {
    headline: string;
    subheadline: string;
  };
  visualComposition: StudioVariantComposition;
  deviceModel: string;
  deviceColorId: string;
}

export interface GenerateVariantsOptions {
  variantCount?: 3 | 4;
  targetDevice?: string;
  deviceColorId?: string;
  exportSizeId?: string;
  customCopy?: {
    headline?: string;
    subheadline?: string;
  };
  targetStore?: "apple-app-store" | "google-play";
}

/**
 * Standard preset styling definitions crafted for balanced, high-converting store visuals.
 */
export const VARIANT_PRESET_DEFINITIONS: Record<
  StudioVariantPresetId,
  {
    name: string;
    description: string;
    composition: StudioVariantComposition;
    deviceModelFallback: string;
    deviceColorFallback: string;
    copyFormatter: (screenTitle: string, keyElement?: string) => { headline: string; subheadline: string };
  }
> = {
  "minimal-clean": {
    name: "Minimal Clean",
    description: "Centered device frame with subtle solid background and crisp typography.",
    composition: {
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
      headlineFontSize: 72,
      subheadlineFontSize: 38,
    },
    deviceModelFallback: "iphone-15-pro-max",
    deviceColorFallback: "black",
    copyFormatter: (title, element) => ({
      headline: `Simplify your <b>${sanitizeHeadlineKeyword(element || title)}</b>`,
      subheadline: `Intuitive, clutter-free access designed for effortless daily performance.`,
    }),
  },
  "bold-gradient": {
    name: "Bold Gradient",
    description: "Vibrant high-contrast gradient with prominent headline emphasis and dynamic posture.",
    composition: {
      deviceStyle: "3d",
      deviceScale: 82,
      deviceOffsetY: 32,
      deviceRotation: -2,
      rotateY: -8,
      rotateX: 6,
      backgroundMode: "gradient",
      gradientPresetId: "sunset",
      backgroundColor: "#ff7e5f",
      textColor: "#ffffff",
      headlineFontSize: 76,
      subheadlineFontSize: 40,
    },
    deviceModelFallback: "iphone-15-pro-max",
    deviceColorFallback: "natural",
    copyFormatter: (title, element) => ({
      headline: `Experience <b>powerful</b> ${sanitizeHeadlineKeyword(element || title)}`,
      subheadline: `Supercharge your workflow with real-time speed and modern visual clarity.`,
    }),
  },
  "dark-contrast-3d": {
    name: "Dark Contrast 3D",
    description: "Deep obsidian backdrop with angled perspective tilt and sleek titanium highlights.",
    composition: {
      deviceStyle: "3d",
      deviceScale: 85,
      deviceOffsetY: 30,
      deviceRotation: 3,
      rotateY: 12,
      rotateX: -4,
      backgroundMode: "gradient",
      gradientPresetId: "royal",
      backgroundColor: "#141E30",
      textColor: "#f8fafc",
      headlineFontSize: 74,
      subheadlineFontSize: 38,
    },
    deviceModelFallback: "iphone-15-pro-max",
    deviceColorFallback: "black",
    copyFormatter: (title, element) => ({
      headline: `Advanced <b>control</b> over ${sanitizeHeadlineKeyword(element || title)}`,
      subheadline: `Engineered for demanding users who prioritize precision, focus, and security.`,
    }),
  },
  "premium-editorial": {
    name: "Premium Editorial",
    description: "Expansive device composition with elegant ocean tones and magazine-style layout.",
    composition: {
      deviceStyle: "flat",
      deviceScale: 92,
      deviceOffsetY: 40,
      deviceRotation: 0,
      rotateY: 0,
      rotateX: 0,
      backgroundMode: "gradient",
      gradientPresetId: "ocean",
      backgroundColor: "#2b5876",
      textColor: "#ffffff",
      headlineFontSize: 80,
      subheadlineFontSize: 42,
    },
    deviceModelFallback: "iphone-15-pro-max",
    deviceColorFallback: "blue",
    copyFormatter: (title, element) => ({
      headline: `Everything you need for <b>${sanitizeHeadlineKeyword(element || title)}</b>`,
      subheadline: `A polished, all-in-one experience designed from the ground up.`,
    }),
  },
};

function sanitizeHeadlineKeyword(input: string): string {
  const cleaned = input.replace(/[^\w\s-]/g, "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "workflow";
  return words.slice(0, 3).join(" ").toLowerCase();
}

/**
 * Generates 3 or 4 distinct visual variants for a single captured screen.
 */
export function generateVariantsForScreen(
  screen: ObservedScreen | { id: string; route: string; filePath: string; title: string; keyElements?: string[] },
  options?: GenerateVariantsOptions,
): DesignVariant[] {
  const count = options?.variantCount ?? 4;
  const presets: StudioVariantPresetId[] =
    count === 3
      ? ["minimal-clean", "bold-gradient", "dark-contrast-3d"]
      : ["minimal-clean", "bold-gradient", "dark-contrast-3d", "premium-editorial"];

  const targetDevice = options?.targetDevice ?? "iphone-15-pro-max";
  const defaultColor = options?.deviceColorId ?? "black";

  const keyElement = screen.keyElements && screen.keyElements.length > 0 ? screen.keyElements[0] : undefined;

  return presets.map((presetId, idx) => {
    const def = VARIANT_PRESET_DEFINITIONS[presetId];
    const defaultCopy = def.copyFormatter(screen.title, keyElement);

    const headline = options?.customCopy?.headline || defaultCopy.headline;
    const subheadline = options?.customCopy?.subheadline || defaultCopy.subheadline;

    return {
      id: `${screen.id}-variant-${idx + 1}-${presetId}`,
      presetId,
      name: def.name,
      description: def.description,
      sourceScreen: {
        id: screen.id,
        route: screen.route,
        filePath: screen.filePath,
        title: screen.title,
        keyElements: screen.keyElements,
      },
      copy: {
        headline,
        subheadline,
      },
      visualComposition: { ...def.composition },
      deviceModel: targetDevice,
      deviceColorId: options?.deviceColorId || def.deviceColorFallback || defaultColor,
    };
  });
}

/**
 * Converts a single variant or multiple approved variants into a valid, native AppShots Project.
 */
export function variantsToProject(
  variants: DesignVariant[],
  options?: {
    projectName?: string;
    exportSizeId?: string;
    defaultDeviceId?: string;
    imageResolver?: (filePath: string) => string;
  },
): Project {
  if (!variants || variants.length === 0) {
    throw new Error("Cannot create project: at least one variant must be provided.");
  }

  const firstVariant = variants[0];
  const deviceSpec = getDeviceSpecById(options?.defaultDeviceId || firstVariant.deviceModel || "iphone-15-pro-max");
  const exportPreset = exportSizes.find((s) => s.id === (options?.exportSizeId || "6.7")) || exportSizes[0];

  const projectId = `studio_project_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const screenshots: Screenshot[] = [];

  for (const variant of variants) {
    // Resolve screenshot image
    let screenshotSrc: string | null = null;
    const rawPath = variant.sourceScreen.filePath;
    if (rawPath) {
      if (rawPath.startsWith("data:")) {
        screenshotSrc = rawPath;
      } else if (options?.imageResolver) {
        try {
          screenshotSrc = options.imageResolver(rawPath);
        } catch {
          screenshotSrc = rawPath;
        }
      } else {
        screenshotSrc = rawPath;
      }
    }

    const deviceColor = getDeviceColorById(deviceSpec.id, variant.deviceColorId);

    const deviceInstance = createDeviceInstance({
      deviceId: deviceSpec.id,
      colorId: deviceColor.id,
      screenshotSrc,
      x: 50,
      y: variant.visualComposition.deviceOffsetY,
      scale: variant.visualComposition.deviceScale,
      rotation: variant.visualComposition.deviceRotation,
      style: variant.visualComposition.deviceStyle,
      rotateY: variant.visualComposition.rotateY,
      rotateX: variant.visualComposition.rotateX,
    });

    const screenshot = createDefaultScreenshot(deviceSpec.id, deviceColor.id);
    screenshot.id = `screen_${variant.id}`;
    screenshot.headline = variant.copy.headline;
    screenshot.subheadline = variant.copy.subheadline;
    screenshot.backgroundMode = variant.visualComposition.backgroundMode;
    screenshot.gradientPresetId = variant.visualComposition.gradientPresetId;
    screenshot.backgroundColor = variant.visualComposition.backgroundColor;
    screenshot.textColor = variant.visualComposition.textColor;
    screenshot.devices = [deviceInstance];
    screenshot.activeDeviceId = deviceInstance.id;

    screenshots.push(screenshot);
  }

  return {
    id: projectId,
    name: options?.projectName || `AppShots Studio - ${variants.length} Screen(s)`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    screenshots,
    selectedDeviceId: deviceSpec.id,
    selectedColorId: firstVariant.deviceColorId || deviceSpec.colors[0].id,
    exportSizeId: exportPreset.id,
    activeScreenshotId: screenshots[0].id,
    headlineFontSize: firstVariant.visualComposition.headlineFontSize || 72,
    subheadlineFontSize: firstVariant.visualComposition.subheadlineFontSize || 38,
  };
}
