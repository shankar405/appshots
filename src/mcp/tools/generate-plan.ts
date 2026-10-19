/**
 * AppShots MCP Tool: generate_screenshot_plan
 *
 * Synthesizes marketing messaging, high-converting headlines (with rich-text <b> tags),
 * device framing, and gradient styling to produce an ordered, reviewable screenshot plan
 * mapped directly into AppShots project-builder format.
 */

import { z } from "zod";
import {
  AnalyzeAppOutputSchema,
  GenerateScreenshotPlanOutputSchema,
  VALID_DEVICE_IDS,
  VALID_EXPORT_SIZE_IDS,
  VALID_GRADIENT_PRESETS,
  type AnalyzeAppOutput,
  type GenerateScreenshotPlanOutput,
} from "../ai/schemas";
import { getActiveAIProvider } from "../ai/provider-factory";
import type { AIProvider } from "../ai/provider";

export const GenerateScreenshotPlanToolInputSchema = z.object({
  analysis: z.union([
    AnalyzeAppOutputSchema,
    z.record(z.string(), z.unknown()),
    z.string(),
  ]).describe("AppAnalysisResult data object or JSON string from analyze_app_for_store"),
  targetStore: z.enum(["apple-app-store", "google-play"]).optional().default("apple-app-store").describe("Target app store listing"),
  targetDevice: z.enum(VALID_DEVICE_IDS).optional().default("iphone-15-pro-max").describe("Target device mockup model"),
  deviceColorId: z.string().optional().default("black").describe("Device color variant ID (defaults to primary color for selected device)"),
  exportSizeId: z.enum(VALID_EXPORT_SIZE_IDS).optional().default("6.7").describe("Target export dimension preset (6.7, 6.5, 5.5, ipad)"),
  slideCount: z.number().int().min(1).max(7).optional().default(3).describe("Desired number of screenshot slides in the plan (1-7, default 3)"),
  themePreference: z.object({
    style: z.enum(["vibrant-gradient", "minimal-dark", "clean-light", "custom"]).optional().default("vibrant-gradient"),
    primaryGradientPresetId: z.enum(VALID_GRADIENT_PRESETS).optional().default("sunset"),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default("#ff7e5f"),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().default("#ffffff"),
    fontFamily: z.string().optional().default("Inter"),
  }).optional(),
  customCopyOverrides: z.array(z.object({
    slideIndex: z.number().int().min(1).max(7),
    headline: z.string().optional(),
    subheadline: z.string().optional(),
  })).optional().describe("Optional user overrides for specific slide headlines or subheadlines"),
});

export type GenerateScreenshotPlanToolInput = z.infer<typeof GenerateScreenshotPlanToolInputSchema>;

/**
 * Executes the generate_screenshot_plan tool workflow.
 */
export async function generateScreenshotPlan(
  input: GenerateScreenshotPlanToolInput,
  options?: { provider?: AIProvider },
): Promise<GenerateScreenshotPlanOutput> {
  const validated = GenerateScreenshotPlanToolInputSchema.parse(input);
  const provider = options?.provider ?? getActiveAIProvider();

  // 1. Parse and validate input analysis object
  let analysis: AnalyzeAppOutput;
  if (typeof validated.analysis === "string") {
    try {
      analysis = AnalyzeAppOutputSchema.parse(JSON.parse(validated.analysis));
    } catch {
      throw new Error("Invalid analysis JSON string: failed to parse or validate schema.");
    }
  } else {
    analysis = AnalyzeAppOutputSchema.parse(validated.analysis);
  }

  // 2. Ensure analysis has valid screens to plan with
  const availableScreens = analysis.screens.filter((s) => s.status === "captured");
  if (availableScreens.length === 0) {
    throw new Error(
      "Supplied analysis contains no successfully captured screens to construct a screenshot plan.",
    );
  }

  const systemPrompt = [
    "You are an expert app-store copywriter and visual designer.",
    "Your objective is to generate an ordered, reviewable screenshot plan conforming to AppShots project parameters.",
    "RULES:",
    "1. Each slide must reference a valid screenId and actual filePath from the provided analysis.",
    "2. Every marketing claim and headline must be traceable to verified features in the analysis.",
    "3. Headlines must be punchy (3-8 words) and selectively wrap 1-2 key words in <b> tags for emphasis (e.g. 'Organize your <b>projects</b>').",
    "4. Assign visual compositions using supported AppShots device styles ('flat' or '3d') and gradient presets ('sunset', 'ocean', 'mint', 'berry', 'royal', 'rose').",
    "5. Note any missing mock data or manual confirmation in 'missingInformationOrAction'.",
  ].join("\n");

  const promptContent = JSON.stringify(
    {
      analysis,
      targetStore: validated.targetStore,
      targetDevice: validated.targetDevice,
      deviceColorId: validated.deviceColorId,
      exportSizeId: validated.exportSizeId,
      slideCount: validated.slideCount,
      themePreference: validated.themePreference,
    },
    null,
    2,
  );

  // 3. Generate plan via AIProvider
  const aiResult = await provider.generateStructured<GenerateScreenshotPlanOutput>({
    systemPrompt,
    messages: [{ role: "user", content: promptContent }],
    schema: GenerateScreenshotPlanOutputSchema,
    schemaName: "GenerateScreenshotPlanOutput",
  });

  // 4. Reconcile screenshot references with actual on-disk files from analysis
  const reconciledSlides = aiResult.data.slides.map((slide, idx) => {
    // Match by screenId or fallback to available screen at matching index
    const matchedScreen =
      availableScreens.find((s) => s.id === slide.screenshotRef.screenId) ||
      availableScreens[idx % availableScreens.length];

    return {
      ...slide,
      screenshotRef: {
        screenId: matchedScreen.id,
        filePath: matchedScreen.filePath,
        route: matchedScreen.route,
      },
    };
  });

  // 5. Apply user copy overrides if specified
  if (validated.customCopyOverrides && validated.customCopyOverrides.length > 0) {
    for (const override of validated.customCopyOverrides) {
      const slide = reconciledSlides.find((s) => s.slideNumber === override.slideIndex);
      if (slide) {
        if (override.headline) {
          slide.copy.headline = override.headline;
        }
        if (override.subheadline) {
          slide.copy.subheadline = override.subheadline;
        }
      }
    }
  }

  const finalPlan: GenerateScreenshotPlanOutput = {
    ...aiResult.data,
    targetStore: validated.targetStore,
    deviceModel: validated.targetDevice,
    deviceColor: validated.deviceColorId,
    exportSizeId: validated.exportSizeId,
    slides: reconciledSlides,
  };

  return GenerateScreenshotPlanOutputSchema.parse(finalPlan);
}
