/**
 * AppShots AI Provider Abstraction & Schemas Unit Tests
 *
 * Verifies that:
 * 1. Zod schemas enforce strict validation, required evidence sources, string bounds, and slide limits.
 * 2. Unsupported or missing evidence fields are rejected.
 * 3. MockAIProvider generates valid, deterministic fixtures for analysis and plan generation.
 * 4. Error classes, timeouts, and cancellation are handled correctly.
 * 5. Secret redaction masks API keys, bearer tokens, and sensitive query parameters.
 */

import { describe, expect, it } from "vitest";
import {
  AnalyzeAppOutputSchema,
  GenerateScreenshotPlanOutputSchema,
  type AnalyzeAppOutput,
  type GenerateScreenshotPlanOutput,
} from "./schemas";
import {
  MockAIProvider,
} from "./mock-provider";
import {
  AIInvalidOutputError,
  AITimeoutError,
  AIRateLimitError,
  AIUnavailableError,
  sanitizeSecrets,
} from "./provider";

describe("AppShots AI Schemas & Validation", () => {
  const validAnalysisFixture: AnalyzeAppOutput = {
    product: {
      name: "TaskMaster Pro",
      nameSource: "observed_dom",
      category: "Productivity",
      categorySource: "inferred",
      tagline: "Speed up agile project delivery",
      summary: "Collaborative project management tool for modern software teams.",
    },
    screens: [
      {
        id: "screen-1-home",
        route: "/",
        filePath: "output/raw-captures/screen-1-home.png",
        title: "TaskMaster Pro",
        keyElements: ["Velocity chart", "Project header", "Sprint button"],
        status: "captured",
      },
    ],
    features: [
      {
        featureTitle: "Sprint Velocity",
        description: "Track team burndown rates in real time.",
        evidence: "Found interactive sprint velocity chart on screen-1-home",
        evidenceSource: "observed_dom",
        screenId: "screen-1-home",
      },
    ],
    targetAudience: {
      description: "Software developers and agile teams.",
      source: "inferred",
      confidence: "high",
      rationale: "Evidence from sprint velocity charts and burndown metrics.",
    },
    assumptionsAndUnknowns: {
      unverifiedClaims: ["Multi-tenant pricing was not observable."],
      authRequiredRoutes: ["/billing"],
      areasRequiringUserConfirmation: ["Verify Jira integration."],
    },
    summary: "Complete analysis of TaskMaster Pro based on observable DOM evidence.",
  };

  const validPlanFixture: GenerateScreenshotPlanOutput = {
    planId: "plan-123",
    projectName: "TaskMaster App Store Launch",
    targetStore: "apple-app-store",
    deviceModel: "iphone-15-pro-max",
    deviceColor: "black",
    exportSizeId: "6.7",
    overallTheme: {
      fontFamily: "Inter",
      headlineFontSize: 72,
      subheadlineFontSize: 42,
      primaryGradientId: "sunset",
      dominantColor: "#1c1c1e",
    },
    slides: [
      {
        slideNumber: 1,
        screenshotRef: {
          screenId: "screen-1-home",
          filePath: "output/raw-captures/screen-1-home.png",
          route: "/",
        },
        marketingAngle: {
          mainMessage: "Core Value Proposition",
          userBenefit: "Organize projects with speed and clarity.",
          supportingEvidence: "Observed velocity chart on screen-1-home",
        },
        copy: {
          headline: "Organize projects with <b>speed</b>",
          subheadline: "Real-time task tracking and collaboration built for modern teams.",
        },
        visualComposition: {
          deviceStyle: "flat",
          deviceScale: 85,
          deviceOffsetY: 35,
          deviceRotation: 0,
          rotateY: 0,
          rotateX: 0,
          backgroundMode: "gradient",
          gradientPresetId: "sunset",
          backgroundColor: "#ff7e5f",
          textColor: "#ffffff",
        },
        missingInformationOrAction: null,
      },
    ],
    summary: "Single hero slide plan showcasing sprint velocity.",
    readyForProjectBuilder: true,
  };

  describe("AnalyzeAppOutputSchema", () => {
    it("accepts valid, fully populated analysis output", () => {
      const parsed = AnalyzeAppOutputSchema.parse(validAnalysisFixture);
      expect(parsed.product.name).toBe("TaskMaster Pro");
      expect(parsed.features[0].evidenceSource).toBe("observed_dom");
    });

    it("rejects analysis with missing evidenceSource", () => {
      const invalid = JSON.parse(JSON.stringify(validAnalysisFixture));
      delete invalid.features[0].evidenceSource;

      expect(() => AnalyzeAppOutputSchema.parse(invalid)).toThrow();
    });

    it("rejects analysis with missing required evidence in features", () => {
      const invalid = JSON.parse(JSON.stringify(validAnalysisFixture));
      invalid.features[0].evidence = ""; // min length is 5

      expect(() => AnalyzeAppOutputSchema.parse(invalid)).toThrow();
    });

    it("rejects analysis with empty screens array", () => {
      const invalid = JSON.parse(JSON.stringify(validAnalysisFixture));
      invalid.screens = [];

      expect(() => AnalyzeAppOutputSchema.parse(invalid)).toThrow();
    });
  });

  describe("GenerateScreenshotPlanOutputSchema", () => {
    it("accepts valid screenshot plan output", () => {
      const parsed = GenerateScreenshotPlanOutputSchema.parse(validPlanFixture);
      expect(parsed.planId).toBe("plan-123");
      expect(parsed.slides.length).toBe(1);
      expect(parsed.slides[0].copy.headline).toContain("<b>speed</b>");
    });

    it("rejects plan with 0 slides", () => {
      const invalid = JSON.parse(JSON.stringify(validPlanFixture));
      invalid.slides = [];

      expect(() => GenerateScreenshotPlanOutputSchema.parse(invalid)).toThrow();
    });

    it("rejects plan with more than 7 slides", () => {
      const invalid = JSON.parse(JSON.stringify(validPlanFixture));
      const baseSlide = validPlanFixture.slides[0];
      invalid.slides = Array(8).fill(baseSlide).map((s, idx) => ({
        ...s,
        slideNumber: idx + 1,
      }));

      expect(() => GenerateScreenshotPlanOutputSchema.parse(invalid)).toThrow();
    });

    it("rejects invalid hex colors", () => {
      const invalid = JSON.parse(JSON.stringify(validPlanFixture));
      invalid.slides[0].visualComposition.backgroundColor = "not-a-hex";

      expect(() => GenerateScreenshotPlanOutputSchema.parse(invalid)).toThrow();
    });
  });
});

describe("Secret Redaction", () => {
  it("masks OpenAI sk- tokens, Google AIza keys, and Anthropic keys", () => {
    const raw = "Keys: sk-proj-1234567890abcdefghijk and AIzaSyD9876543210zyxwvutsrqponmlk and sk-ant-api03-abcdefghijklm";
    const redacted = sanitizeSecrets(raw);

    expect(redacted).not.toContain("1234567890abcdefghijk");
    expect(redacted).not.toContain("SyD9876543210zyxwvutsrqponmlk");
    expect(redacted).toContain("sk-[REDACTED]");
    expect(redacted).toContain("AIza[REDACTED]");
    expect(redacted).toContain("sk-ant-[REDACTED]");
  });

  it("masks bearer authorization headers and sensitive query parameters", () => {
    const text = "Request to https://api.example.com?api_key=my_secret_token with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz";
    const redacted = sanitizeSecrets(text);

    expect(redacted).not.toContain("my_secret_token");
    expect(redacted).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    expect(redacted).toContain("api_key=[REDACTED]");
    expect(redacted).toContain("Bearer [REDACTED]");
  });
});

describe("MockAIProvider", () => {
  it("generates deterministic, schema-valid AnalyzeAppOutput", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generateStructured({
      schemaName: "AnalyzeAppOutput",
      schema: AnalyzeAppOutputSchema,
      messages: [
        {
          role: "user",
          content: 'Analyze application with title: "TaskMaster Pro - Agile Task Boards"',
        },
      ],
    });

    expect(result.data.product.name).toBe("TaskMaster Pro - Agile Task Boards");
    expect(result.data.product.nameSource).toBe("observed_dom");
    expect(result.data.screens.length).toBeGreaterThan(0);
    expect(result.data.features.length).toBeGreaterThan(0);
    expect(result.providerId).toBe("mock");
  });

  it("produces identical output for identical requests (determinism)", async () => {
    const provider = new MockAIProvider();
    const req = {
      schemaName: "AnalyzeAppOutput",
      schema: AnalyzeAppOutputSchema,
      messages: [{ role: "user" as const, content: "Fixed input" }],
    };

    const res1 = await provider.generateStructured(req);
    const res2 = await provider.generateStructured(req);

    expect(res1.data).toEqual(res2.data);
    expect(res1.rawText).toBe(res2.rawText);
  });

  it("generates deterministic, schema-valid GenerateScreenshotPlanOutput", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generateStructured({
      schemaName: "GenerateScreenshotPlanOutput",
      schema: GenerateScreenshotPlanOutputSchema,
      messages: [{ role: "user", content: "Plan store screenshots for iPhone 15 Pro Max" }],
    });

    expect(result.data.planId).toBeDefined();
    expect(result.data.slides.length).toBe(3);
    expect(result.data.deviceModel).toBe("iphone-15-pro-max");
    expect(result.data.readyForProjectBuilder).toBe(true);
    expect(result.data.slides[0].copy.headline).toContain("<b>");
  });

  it("handles cancellation via AbortSignal", async () => {
    const provider = new MockAIProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateStructured({
        schemaName: "AnalyzeAppOutput",
        schema: AnalyzeAppOutputSchema,
        messages: [{ role: "user", content: "hello" }],
        signal: controller.signal,
      }),
    ).rejects.toThrow(AITimeoutError);
  });

  it("simulates timeout errors when configured", async () => {
    const provider = new MockAIProvider({ simulateTimeout: true });

    await expect(
      provider.generateStructured({
        schemaName: "AnalyzeAppOutput",
        schema: AnalyzeAppOutputSchema,
        messages: [{ role: "user", content: "hello" }],
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(AITimeoutError);
  });

  it("simulates rate limit errors when configured", async () => {
    const provider = new MockAIProvider({ simulateRateLimit: true });

    await expect(
      provider.generateStructured({
        schemaName: "AnalyzeAppOutput",
        schema: AnalyzeAppOutputSchema,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(AIRateLimitError);
  });

  it("simulates provider unavailable errors when configured", async () => {
    const provider = new MockAIProvider({ simulateProviderError: true });

    await expect(
      provider.generateStructured({
        schemaName: "AnalyzeAppOutput",
        schema: AnalyzeAppOutputSchema,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(AIUnavailableError);
  });

  it("simulates malformed output and schema validation errors", async () => {
    const provider = new MockAIProvider({ simulateMalformedOutput: true });

    await expect(
      provider.generateStructured({
        schemaName: "AnalyzeAppOutput",
        schema: AnalyzeAppOutputSchema,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(AIInvalidOutputError);
  });
});
