/**
 * Central Zod Schemas and Types for AppShots AI Analysis & Screenshot Planning
 *
 * Enforces strict validation, bounded strings, anti-hallucination evidence attribution,
 * and seamless alignment with AppShots project-builder data structures.
 */

import { z } from "zod";

/**
 * Origin of an extracted product claim, feature, or audience trait.
 */
export const EvidenceSourceEnum = z.enum([
  "observed_dom",
  "observed_visual",
  "user_provided",
  "inferred",
]);

export type EvidenceSource = z.infer<typeof EvidenceSourceEnum>;

/**
 * Observed DOM metadata schema corresponding to page crawler extraction.
 */
export const DomEvidenceSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(500).optional(),
  headings: z.array(
    z.object({
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      text: z.string().max(150),
    }),
  ).max(30),
  navigationLabels: z.array(z.string().max(80)).max(30),
  actionLabels: z.array(
    z.object({
      text: z.string().max(80),
      disabled: z.boolean().optional(),
    }),
  ).max(30),
  landmarks: z.array(z.string().max(80)).max(15),
});

export type DomEvidencePayload = z.infer<typeof DomEvidenceSchema>;

/**
 * Schema for an individual captured screen observation.
 */
export const ObservedScreenSchema = z.object({
  id: z.string().min(1).max(100).describe("Unique identifier for this captured screen (e.g. 'screen-1-home')"),
  route: z.string().min(1).max(300).describe("URL path or route identifier where screen was captured"),
  filePath: z.string().min(1).max(500).describe("Filesystem path to the captured screenshot PNG"),
  title: z.string().max(200).describe("Observed page title or prominent header"),
  keyElements: z.array(z.string().min(1).max(200)).max(30).describe("Observable visual and functional elements on screen"),
  status: z.enum(["captured", "auth_required", "failed"]).describe("Capture status of this screen"),
  error: z.string().max(500).nullable().optional().describe("Failure reason if capture was not successful"),
});

export type ObservedScreen = z.infer<typeof ObservedScreenSchema>;

/**
 * Verified application feature with mandatory observable evidence attribution.
 */
export const VerifiedFeatureSchema = z.object({
  featureTitle: z.string().min(2).max(100).describe("Concise feature name"),
  description: z.string().min(5).max(400).describe("User benefit and functional description"),
  evidence: z.string().min(5).max(500).describe("Specific observable DOM or visual evidence supporting this feature"),
  evidenceSource: EvidenceSourceEnum.describe("Origin of this feature verification"),
  screenId: z.string().min(1).max(100).describe("Screen ID where this feature is visibly demonstrated"),
});

export type VerifiedFeature = z.infer<typeof VerifiedFeatureSchema>;

/**
 * Complete application analysis output schema.
 * Enforces strict anti-hallucination rules and evidence attribution.
 */
export const AnalyzeAppOutputSchema = z.object({
  product: z.object({
    name: z.string().min(1).max(100).describe("Verified product or brand name"),
    nameSource: EvidenceSourceEnum,
    category: z.string().min(1).max(100).describe("App store category (e.g. 'Productivity', 'Finance')"),
    categorySource: EvidenceSourceEnum,
    tagline: z.string().max(200).nullable().describe("One-line punchline or primary headline"),
    summary: z.string().min(10).max(1000).describe("2-3 sentence overview of the application"),
  }),
  screens: z.array(ObservedScreenSchema).min(1).max(10).describe("List of captured screens"),
  features: z.array(VerifiedFeatureSchema).min(1).max(15).describe("List of verified features backed by evidence"),
  targetAudience: z.object({
    description: z.string().min(5).max(400).describe("Identified target user persona or demographic"),
    source: EvidenceSourceEnum,
    confidence: z.enum(["high", "medium", "low"]),
    rationale: z.string().min(5).max(500).describe("Evidence supporting this audience classification"),
  }),
  assumptionsAndUnknowns: z.object({
    unverifiedClaims: z.array(z.string().max(300)).max(20).describe("Claims or metrics that could not be corroborated from accessible screens"),
    authRequiredRoutes: z.array(z.string().max(300)).max(20).describe("Routes that require authentication and were not inspected"),
    areasRequiringUserConfirmation: z.array(z.string().max(300)).max(20).describe("Ambiguities or unconfirmed details requiring user review"),
  }),
  summary: z.string().min(10).max(1500).describe("Executive overview of analysis findings"),
});

export type AnalyzeAppOutput = z.infer<typeof AnalyzeAppOutputSchema>;

// Reusable preset constants matching AppShots core definitions
export const VALID_DEVICE_IDS = [
  "iphone-15-pro-max",
  "iphone-15-pro",
  "iphone-14",
  "ipad-pro-12-9",
  "samsung-galaxy-s24-ultra",
  "samsung-galaxy-tab-s9",
] as const;

export const VALID_EXPORT_SIZE_IDS = ["6.7", "6.5", "5.5", "ipad"] as const;

export const VALID_GRADIENT_PRESETS = [
  "sunset",
  "ocean",
  "mint",
  "berry",
  "royal",
  "rose",
] as const;

/**
 * Individual planned screenshot slide schema.
 * Maps 1:1 into AppShots SlideInputSchema for zero-friction project building.
 */
export const PlannedSlideSchema = z.object({
  slideNumber: z.number().int().min(1).max(7).describe("Slide sequence position (1-based index)"),
  screenshotRef: z.object({
    screenId: z.string().min(1).max(100).describe("Referenced screen ID from analysis"),
    filePath: z.string().min(1).max(500).describe("Filesystem path to the screenshot image file"),
    route: z.string().min(1).max(300).describe("Associated route of this screen"),
  }),
  marketingAngle: z.object({
    mainMessage: z.string().min(2).max(150).describe("Core marketing theme for this slide"),
    userBenefit: z.string().min(5).max(300).describe("Direct user benefit conveyed"),
    supportingEvidence: z.string().min(5).max(400).describe("Observed app evidence backing this message"),
  }),
  copy: z.object({
    headline: z.string().min(2).max(120).describe("Marketing headline (supports rich-text HTML <b>, <span>)"),
    subheadline: z.string().min(5).max(250).describe("Supporting subheadline text"),
  }),
  visualComposition: z.object({
    deviceStyle: z.enum(["flat", "3d"]).describe("Device mockup render style"),
    deviceScale: z.number().min(20).max(150).describe("Device frame scale percentage"),
    deviceOffsetY: z.number().min(-50).max(100).describe("Device vertical position percentage"),
    deviceRotation: z.number().min(-180).max(180).describe("2D rotation in degrees"),
    rotateY: z.number().min(-45).max(45).describe("3D yaw angle in degrees (-45 to 45)"),
    rotateX: z.number().min(-45).max(45).describe("3D pitch angle in degrees (-45 to 45)"),
    backgroundMode: z.enum(["solid", "gradient"]).describe("Background style"),
    gradientPresetId: z.enum(VALID_GRADIENT_PRESETS).nullable().describe("Gradient preset ID"),
    backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("Hex background color"),
    textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("Hex text color"),
  }),
  missingInformationOrAction: z.string().max(400).nullable().describe("Any missing mock data or manual review action required"),
});

export type PlannedSlide = z.infer<typeof PlannedSlideSchema>;

/**
 * Complete screenshot plan output schema.
 */
export const GenerateScreenshotPlanOutputSchema = z.object({
  planId: z.string().min(1).max(100).describe("Unique plan identifier"),
  projectName: z.string().min(1).max(100).describe("Generated project name"),
  targetStore: z.enum(["apple-app-store", "google-play"]),
  deviceModel: z.enum(VALID_DEVICE_IDS),
  deviceColor: z.string().min(1).max(50),
  exportSizeId: z.enum(VALID_EXPORT_SIZE_IDS),
  overallTheme: z.object({
    fontFamily: z.string().min(1).max(50),
    headlineFontSize: z.number().min(20).max(160),
    subheadlineFontSize: z.number().min(14).max(100),
    primaryGradientId: z.enum(VALID_GRADIENT_PRESETS).nullable(),
    dominantColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  slides: z.array(PlannedSlideSchema).min(1).max(7).describe("Ordered list of planned screenshot slides"),
  summary: z.string().min(10).max(1500).describe("Strategic rationale explaining slide order and copy progression"),
  readyForProjectBuilder: z.boolean().describe("Whether this plan is ready for build_appshots_project"),
});

export type GenerateScreenshotPlanOutput = z.infer<typeof GenerateScreenshotPlanOutputSchema>;
