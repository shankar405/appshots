/**
 * Unit & Integration Tests for AppShots MCP Tool: build_and_export_store_assets
 *
 * Verifies that:
 * 1. A valid reviewed plan builds an AppShots project and exports valid PNG files.
 * 2. Multiple slides produce the expected count and dimensions of exported files.
 * 3. Headlines, subheadlines, rich-text tags (<b>...</b>), backgrounds, and device settings are preserved.
 * 4. Missing screenshots and invalid plan references are rejected.
 * 5. Invalid schemas and unsupported export presets fail clearly.
 * 6. Google Play requests are rejected with a clear unsupported-preset error.
 * 7. Out-of-root files and output paths are rejected.
 * 8. Invalid background gradient presets are rejected rather than silently dropped.
 * 9. String JSON plan input is parsed and validated correctly.
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildAndExportStoreAssets,
} from "./build-and-export";
import type { GenerateScreenshotPlanOutput } from "../ai/schemas";
import { verifyPngBuffer } from "../../lib/headless-export";

const TEST_OUTPUT_DIR = path.resolve("./tmp/build-and-export-test-output");
const DEMO_IMAGE_PATH = path.resolve("public/demo-image.png");

describe("build_and_export_store_assets Tool", () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  const createSamplePlan = (
    overrides?: Partial<GenerateScreenshotPlanOutput>,
  ): GenerateScreenshotPlanOutput => ({
    planId: "plan-test-101",
    projectName: "TaskMaster Pro Screenshots",
    targetStore: "apple-app-store",
    deviceModel: "iphone-15-pro-max",
    deviceColor: "natural",
    exportSizeId: "6.7",
    overallTheme: {
      fontFamily: "Inter",
      headlineFontSize: 72,
      subheadlineFontSize: 42,
      primaryGradientId: "sunset",
      dominantColor: "#ff7e5f",
    },
    slides: [
      {
        slideNumber: 1,
        screenshotRef: {
          screenId: "screen-1-home",
          filePath: DEMO_IMAGE_PATH,
          route: "/",
        },
        marketingAngle: {
          mainMessage: "Speedy Task Planning",
          userBenefit: "Organize projects faster with team sprints",
          supportingEvidence: "Observed sprint boards and quick actions",
        },
        copy: {
          headline: "Plan projects with <b>speed</b>",
          subheadline: "Real-time task synchronization across teams",
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
          filePath: DEMO_IMAGE_PATH,
          route: "/dashboard",
        },
        marketingAngle: {
          mainMessage: "Active Dashboard",
          userBenefit: "Monitor team velocity at a glance",
          supportingEvidence: "Observed active sprint metrics",
        },
        copy: {
          headline: "Track <b>velocity</b> in real time",
          subheadline: "Deep performance insights for engineering teams",
        },
        visualComposition: {
          deviceStyle: "3d",
          deviceScale: 80,
          deviceOffsetY: 40,
          deviceRotation: 5,
          rotateY: 15,
          rotateX: -5,
          backgroundMode: "gradient",
          gradientPresetId: "ocean",
          backgroundColor: "#3a7bd5",
          textColor: "#ffffff",
        },
        missingInformationOrAction: null,
      },
    ],
    summary: "Two-slide high-conversion App Store sequence",
    readyForProjectBuilder: true,
    ...overrides,
  });

  it("builds and exports valid PNG screenshots from a multi-slide reviewed plan", async () => {
    const plan = createSamplePlan();
    const outputDir = path.join(TEST_OUTPUT_DIR, "valid-run");

    const result = await buildAndExportStoreAssets({
      projectName: "TaskMaster Pro - App Store Assets",
      plan,
      outputDir,
      preset: "6.7",
      filenamePrefix: "tm-screen",
    });

    expect(result.success).toBe(true);
    expect(result.projectName).toBe("TaskMaster Pro - App Store Assets");
    expect(result.planId).toBe("plan-test-101");
    expect(result.slideCount).toBe(2);
    expect(result.files.length).toBe(2);

    // Verify first file
    const file1 = result.files[0];
    expect(file1.filename).toBe("tm-screen-1.png");
    expect(file1.width).toBe(1284);
    expect(file1.height).toBe(2778);
    expect(fs.existsSync(file1.filepath)).toBe(true);

    const buffer1 = fs.readFileSync(file1.filepath);
    const verified1 = verifyPngBuffer(buffer1);
    expect(verified1.width).toBe(1284);
    expect(verified1.height).toBe(2778);

    // Verify second file
    const file2 = result.files[1];
    expect(file2.filename).toBe("tm-screen-2.png");
    expect(file2.width).toBe(1284);
    expect(file2.height).toBe(2778);
    expect(fs.existsSync(file2.filepath)).toBe(true);

    // Verify slide metadata and preserved copy
    expect(result.slides[0].headline).toBe("Plan projects with <b>speed</b>");
    expect(result.slides[0].subheadline).toBe("Real-time task synchronization across teams");
    expect(result.slides[1].headline).toBe("Track <b>velocity</b> in real time");
  }, 45000);

  it("accepts stringified JSON plan and preserves custom copy and rich text", async () => {
    const plan = createSamplePlan({
      slides: [
        {
          slideNumber: 1,
          screenshotRef: {
            screenId: "screen-1-home",
            filePath: DEMO_IMAGE_PATH,
            route: "/",
          },
          marketingAngle: {
            mainMessage: "Custom Message",
            userBenefit: "Custom Benefit",
            supportingEvidence: "Observed DOM",
          },
          copy: {
            headline: "Accelerate <b>Delivery</b> Instantly",
            subheadline: "Proven <span>10x</span> workflow efficiency",
          },
          visualComposition: {
            deviceStyle: "flat",
            deviceScale: 85,
            deviceOffsetY: 35,
            deviceRotation: 0,
            rotateY: 0,
            rotateX: 0,
            backgroundMode: "solid",
            gradientPresetId: null,
            backgroundColor: "#4f46e5",
            textColor: "#ffffff",
          },
          missingInformationOrAction: null,
        },
      ],
    });

    const outputDir = path.join(TEST_OUTPUT_DIR, "json-string-run");

    const result = await buildAndExportStoreAssets({
      plan: JSON.stringify(plan),
      outputDir,
      preset: "6.7",
      filenamePrefix: "json-test",
    });

    expect(result.success).toBe(true);
    expect(result.files.length).toBe(1);
    expect(result.slides[0].headline).toBe("Accelerate <b>Delivery</b> Instantly");
    expect(result.slides[0].subheadline).toBe("Proven <span>10x</span> workflow efficiency");
  }, 45000);

  it("rejects plan when targetStore is google-play", async () => {
    const plan = createSamplePlan({
      targetStore: "google-play" as any,
    });
    const outputDir = path.join(TEST_OUTPUT_DIR, "google-play-reject");

    await expect(
      buildAndExportStoreAssets({
        plan,
        outputDir,
      }),
    ).rejects.toThrow(/Google Play export is not currently supported/i);
  });

  it("rejects unsupported export preset IDs", async () => {
    const plan = createSamplePlan();
    const outputDir = path.join(TEST_OUTPUT_DIR, "unsupported-preset-reject");

    await expect(
      buildAndExportStoreAssets({
        plan,
        outputDir,
        preset: "google-play-phone",
      }),
    ).rejects.toThrow(/Unsupported export preset 'google-play-phone'/i);
  });

  it("rejects missing screenshot file references with a clear error", async () => {
    const plan = createSamplePlan({
      slides: [
        {
          slideNumber: 1,
          screenshotRef: {
            screenId: "screen-1-home",
            filePath: "non-existent-screenshot-file-123.png",
            route: "/",
          },
          marketingAngle: {
            mainMessage: "Test Message",
            userBenefit: "Test Benefit Long Enough",
            supportingEvidence: "Test Evidence Long Enough",
          },
          copy: {
            headline: "Missing file test",
            subheadline: "Should fail gracefully",
          },
          visualComposition: {
            deviceStyle: "flat",
            deviceScale: 80,
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
    });

    const outputDir = path.join(TEST_OUTPUT_DIR, "missing-file-reject");

    await expect(
      buildAndExportStoreAssets({
        plan,
        outputDir,
      }),
    ).rejects.toThrow(/Input file does not exist/i);
  });

  it("rejects invalid screenshot plan schemas", async () => {
    const outputDir = path.join(TEST_OUTPUT_DIR, "invalid-schema-reject");

    await expect(
      buildAndExportStoreAssets({
        plan: { not: "a valid plan" },
        outputDir,
      }),
    ).rejects.toThrow(/Invalid screenshot plan/i);
  });

  it("rejects output paths outside allowed roots", async () => {
    const plan = createSamplePlan();

    await expect(
      buildAndExportStoreAssets({
        plan,
        outputDir: "../../outside-workspace-dir",
      }),
    ).rejects.toThrow(/outside the allowed output root directories/i);
  });

  it("rejects input files outside allowed roots", async () => {
    const plan = createSamplePlan({
      slides: [
        {
          slideNumber: 1,
          screenshotRef: {
            screenId: "screen-1-home",
            filePath: "C:/Windows/System32/calc.exe",
            route: "/",
          },
          marketingAngle: {
            mainMessage: "Test Message",
            userBenefit: "Test Benefit Long Enough",
            supportingEvidence: "Test Evidence Long Enough",
          },
          copy: {
            headline: "Out of root",
            subheadline: "Should fail",
          },
          visualComposition: {
            deviceStyle: "flat",
            deviceScale: 80,
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
    });

    const outputDir = path.join(TEST_OUTPUT_DIR, "out-of-root-reject");

    await expect(
      buildAndExportStoreAssets({
        plan,
        outputDir,
      }),
    ).rejects.toThrow();
  });

  it("rejects unsupported gradient preset instead of silently ignoring it", async () => {
    const plan = createSamplePlan();
    // gradientPresetId is null when backgroundMode is gradient (allowed by schema but rejected by bridge)
    plan.slides[0].visualComposition.gradientPresetId = null;

    const outputDir = path.join(TEST_OUTPUT_DIR, "invalid-gradient-reject");

    await expect(
      buildAndExportStoreAssets({
        plan,
        outputDir,
      }),
    ).rejects.toThrow(/unsupported or missing gradientPresetId/i);
  });
});
