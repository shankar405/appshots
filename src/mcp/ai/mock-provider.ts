/**
 * Deterministic Mock AI Provider for AppShots
 *
 * Implements the AIProvider interface for offline, hermetic, zero-cost unit
 * and integration testing. Generates schema-valid fixtures based on input evidence
 * without calling external APIs or requiring secrets.
 */

import type {
  AIProvider,
  StructuredGenerateOptions,
  StructuredGenerateResult,
} from "./provider";
import {
  AITimeoutError,
  AIInvalidOutputError,
  AIUnavailableError,
  AIRateLimitError,
} from "./provider";
import {
  AnalyzeAppOutputSchema,
  GenerateScreenshotPlanOutputSchema,
  type AnalyzeAppOutput,
  type GenerateScreenshotPlanOutput,
} from "./schemas";

export interface MockAIProviderOptions {
  /** Override fixture returned by generateStructured */
  fixtureOverride?: unknown;
  /** Force simulation of a request timeout */
  simulateTimeout?: boolean;
  /** Force simulation of invalid/malformed model output */
  simulateMalformedOutput?: boolean;
  /** Force simulation of a provider rate limit (HTTP 429) */
  simulateRateLimit?: boolean;
  /** Force simulation of an unavailable provider or service outage */
  simulateProviderError?: boolean;
  /** Artificial latency delay in ms (default: 0) */
  delayMs?: number;
}

/**
 * Deterministic Mock AI Provider implementation.
 */
export class MockAIProvider implements AIProvider {
  public readonly id = "mock";
  public readonly name = "Deterministic Mock AI Provider";

  constructor(private readonly options: MockAIProviderOptions = {}) {}

  /**
   * Generates a deterministic, schema-valid structured response.
   */
  public async generateStructured<T>(
    options: StructuredGenerateOptions<T>,
  ): Promise<StructuredGenerateResult<T>> {
    // 1. Check for immediate cancellation
    if (options.signal?.aborted) {
      throw new AITimeoutError("Operation aborted before execution.", this.id);
    }

    // 2. Artificial latency simulation
    if (this.options.delayMs && this.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }

    // 3. Error simulations for test suites
    if (this.options.simulateTimeout) {
      throw new AITimeoutError(
        `Model generation timed out after ${options.timeoutMs ?? 10000}ms.`,
        this.id,
      );
    }

    if (this.options.simulateRateLimit) {
      throw new AIRateLimitError("Provider quota / rate limit exceeded.", this.id, 10);
    }

    if (this.options.simulateProviderError) {
      throw new AIUnavailableError(
        "AI provider service temporarily unavailable (HTTP 503).",
        this.id,
        true,
      );
    }

    if (this.options.simulateMalformedOutput) {
      throw new AIInvalidOutputError(
        "Model produced malformed JSON that failed schema validation.",
        "{ invalid_json: true, missing_required_fields: [product, screens] }",
        ["Required field 'product' is missing", "Expected array for 'screens'"],
        this.id,
      );
    }

    // 4. Return fixture override if explicitly supplied
    if (this.options.fixtureOverride !== undefined) {
      const validated = options.schema.parse(this.options.fixtureOverride);
      return {
        data: validated,
        rawText: JSON.stringify(validated, null, 2),
        providerId: this.id,
        model: "mock-fixture-v1",
        usage: { promptTokens: 100, completionTokens: 250 },
      };
    }

    // 5. Generate deterministic mock output matching requested schema
    let generatedObject: unknown;

    if (options.schemaName === "AnalyzeAppOutput") {
      generatedObject = this.generateDeterministicAnalysis(options);
    } else if (options.schemaName === "GenerateScreenshotPlanOutput") {
      generatedObject = this.generateDeterministicPlan(options);
    } else {
      // Default generic fallback
      generatedObject = {
        mockGenerated: true,
        schemaName: options.schemaName,
      };
    }

    // 6. Validate generated fixture against requested Zod schema
    let parsedData: T;
    try {
      parsedData = options.schema.parse(generatedObject);
    } catch (err) {
      const validationErrors =
        err instanceof Error ? [err.message] : ["Schema parsing failure"];
      throw new AIInvalidOutputError(
        `Mock output failed validation for schema '${options.schemaName}'.`,
        JSON.stringify(generatedObject),
        validationErrors,
        this.id,
      );
    }

    return {
      data: parsedData,
      rawText: JSON.stringify(parsedData, null, 2),
      providerId: this.id,
      model: "mock-deterministic-v1",
      usage: { promptTokens: 140, completionTokens: 380 },
    };
  }

  /**
   * Deterministically constructs an AnalyzeAppOutput fixture using evidence from messages.
   */
  private generateDeterministicAnalysis(
    options: StructuredGenerateOptions<unknown>,
  ): AnalyzeAppOutput {
    let userProvidedName: string | undefined;
    let userCategory: string | undefined;
    let observedTitle: string | undefined;

    for (const msg of options.messages) {
      const text = typeof msg.content === "string" ? msg.content : "";
      try {
        const parsed = JSON.parse(text);
        if (parsed.userProvidedContext?.productName) {
          userProvidedName = String(parsed.userProvidedContext.productName).trim();
        }
        if (parsed.userProvidedContext?.category) {
          userCategory = String(parsed.userProvidedContext.category).trim();
        }
        if (Array.isArray(parsed.observedScreens) && parsed.observedScreens[0]?.title) {
          observedTitle = String(parsed.observedScreens[0].title).trim();
        }
      } catch {
        // Fallback: simple text match if not JSON
        const match = text.match(/title["':\s]+([^"',}\n]+)/i);
        if (match && match[1].trim()) {
          observedTitle = match[1].trim();
        }
      }
    }

    const discoveredName =
      (userProvidedName && userProvidedName.length > 0 ? userProvidedName : undefined) ||
      (observedTitle && observedTitle.length > 0 ? observedTitle : undefined) ||
      "AppShots Showcase";

    const nameSource: "user_provided" | "observed_dom" | "inferred" = userProvidedName
      ? "user_provided"
      : observedTitle
      ? "observed_dom"
      : "inferred";

    const category = userCategory && userCategory.length > 0 ? userCategory : "Productivity";
    const categorySource: "user_provided" | "observed_dom" | "inferred" = userCategory
      ? "user_provided"
      : "inferred";

    return AnalyzeAppOutputSchema.parse({
      product: {
        name: discoveredName,
        nameSource,
        category,
        categorySource,
        tagline: "Streamline workflows and deliver faster results",
        summary:
          "A modern mobile-first productivity platform enabling teams to track tasks, organize projects, and collaborate in real time.",
      },
      screens: [
        {
          id: "screen-1-home",
          route: "/",
          filePath: "output/raw-captures/screen-1-home.png",
          title: discoveredName,
          keyElements: [
            "Project summary header",
            "Sprint velocity chart",
            "Quick action navigation bar",
          ],
          status: "captured",
        },
        {
          id: "screen-2-dashboard",
          route: "/dashboard",
          filePath: "output/raw-captures/screen-2-dashboard.png",
          title: "Team Dashboard",
          keyElements: [
            "Active task list",
            "Deadline indicators",
            "Filter and sort controls",
          ],
          status: "captured",
        },
      ],
      features: [
        {
          featureTitle: "Sprint Velocity Tracking",
          description: "Visualizes team output and milestone completion in real time.",
          evidence: "Observed interactive velocity chart and sprint metrics on screen-1-home",
          evidenceSource: "observed_dom",
          screenId: "screen-1-home",
        },
        {
          featureTitle: "Active Task Management",
          description: "Organizes pending tasks with visual priority badges and deadlines.",
          evidence: "Observed task card list with deadline indicators on screen-2-dashboard",
          evidenceSource: "observed_dom",
          screenId: "screen-2-dashboard",
        },
      ],
      targetAudience: {
        description: "Agile product teams, project managers, and collaborative developers.",
        source: "inferred",
        confidence: "medium",
        rationale: "Inferred from sprint management terminology, velocity charts, and team dashboard UI.",
      },
      assumptionsAndUnknowns: {
        unverifiedClaims: [
          "No multi-tenant enterprise pricing data was observable on accessible screens.",
        ],
        authRequiredRoutes: [
          "/admin/billing",
        ],
        areasRequiringUserConfirmation: [
          "Confirm whether third-party Jira and GitHub integrations are enabled for this listing.",
        ],
      },
      summary:
        "Mock analysis completed. Identified 2 representative screens and verified core sprint tracking features from observable DOM evidence.",
    });
  }

  /**
   * Deterministically constructs a GenerateScreenshotPlanOutput fixture.
   */
  private generateDeterministicPlan(
    _options: StructuredGenerateOptions<unknown>,
  ): GenerateScreenshotPlanOutput {
    return GenerateScreenshotPlanOutputSchema.parse({
      planId: "plan-mock-101",
      projectName: "AppStore Production Screenshots",
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
            mainMessage: "Hero Value Proposition",
            userBenefit: "Instantly organize projects and boost sprint speed.",
            supportingEvidence: "Observed interactive velocity chart on screen-1-home",
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
        {
          slideNumber: 2,
          screenshotRef: {
            screenId: "screen-2-dashboard",
            filePath: "output/raw-captures/screen-2-dashboard.png",
            route: "/dashboard",
          },
          marketingAngle: {
            mainMessage: "Team Velocity & Metrics",
            userBenefit: "Stay aligned with clear milestone deadlines.",
            supportingEvidence: "Observed sprint deadline indicators on screen-2-dashboard",
          },
          copy: {
            headline: "Track every <b>milestone</b>",
            subheadline: "Never miss a deadline with automated sprint status updates.",
          },
          visualComposition: {
            deviceStyle: "3d",
            deviceScale: 80,
            deviceOffsetY: 38,
            deviceRotation: 0,
            rotateY: -15,
            rotateX: 10,
            backgroundMode: "gradient",
            gradientPresetId: "ocean",
            backgroundColor: "#2b5876",
            textColor: "#ffffff",
          },
          missingInformationOrAction: null,
        },
        {
          slideNumber: 3,
          screenshotRef: {
            screenId: "screen-1-home",
            filePath: "output/raw-captures/screen-1-home.png",
            route: "/",
          },
          marketingAngle: {
            mainMessage: "Cross-Platform Sync",
            userBenefit: "Access all your projects anywhere, anytime.",
            supportingEvidence: "Observed mobile-first responsive layout",
          },
          copy: {
            headline: "Sync seamlessly across <b>devices</b>",
            subheadline: "Your workflows stay updated in real time on mobile and desktop.",
          },
          visualComposition: {
            deviceStyle: "flat",
            deviceScale: 82,
            deviceOffsetY: 32,
            deviceRotation: 0,
            rotateY: 0,
            rotateX: 0,
            backgroundMode: "gradient",
            gradientPresetId: "royal",
            backgroundColor: "#141E30",
            textColor: "#ffffff",
          },
          missingInformationOrAction: "Verify whether push notifications are active before submission.",
        },
      ],
      summary:
        "Generated a 3-slide screenshot plan featuring a hero value slide, a 3D perspective dashboard view, and a responsive sync overview.",
      readyForProjectBuilder: true,
    });
  }
}
