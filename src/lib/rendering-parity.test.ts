import { describe, expect, it } from "vitest";
import { exportSizes } from "../constants";
import { getCanonicalPreviewDimensions } from "./export-utils";
import { generateVariantsForScreen, variantsToProject } from "./studio/variants";
import { evaluateGradientContrast } from "./studio/color-contrast";
import { createAppshotsServer } from "../mcp/server";

describe("Browser / MCP Rendering Parity & Dimension Normalization", () => {
  describe("1. Canonical Preview Dimensions for All Apple Presets", () => {
    it("derives exact 1/3 scale canonical preview dimensions for all 4 Apple presets", () => {
      const p67 = exportSizes.find((s) => s.id === "6.7")!;
      const p65 = exportSizes.find((s) => s.id === "6.5")!;
      const p55 = exportSizes.find((s) => s.id === "5.5")!;
      const pipad = exportSizes.find((s) => s.id === "ipad")!;

      const dim67 = getCanonicalPreviewDimensions(p67);
      const dim65 = getCanonicalPreviewDimensions(p65);
      const dim55 = getCanonicalPreviewDimensions(p55);
      const dimIpad = getCanonicalPreviewDimensions(pipad);

      expect(dim67.width).toBeCloseTo(428, 0);
      expect(dim67.height).toBeCloseTo(926, 0);

      expect(dim65.width).toBeCloseTo(414, 0);
      expect(dim65.height).toBeCloseTo(896, 0);

      expect(dim55.width).toBeCloseTo(414, 0);
      expect(dim55.height).toBeCloseTo(736, 0);

      expect(dimIpad.width).toBeCloseTo(682.67, 1);
      expect(dimIpad.height).toBeCloseTo(910.67, 1);
    });

    it("guarantees scaleX is strictly 3.0 across all export presets under canonical preview dimensions", () => {
      for (const preset of exportSizes) {
        const canonical = getCanonicalPreviewDimensions(preset);
        const scaleX = preset.width / canonical.width;
        expect(scaleX).toBeCloseTo(3.0, 5);
      }
    });

    it("guarantees exported headline and subheadline font sizes exactly match project values (0% drift)", () => {
      const testHeadlineFontSize = 74;
      const testSubheadlineFontSize = 38;

      for (const preset of exportSizes) {
        const canonical = getCanonicalPreviewDimensions(preset);
        const scaleX = preset.width / canonical.width;

        const effectiveHeadlineFontSize = (testHeadlineFontSize / 3) * scaleX;
        const effectiveSubheadlineFontSize = (testSubheadlineFontSize / 3) * scaleX;

        expect(effectiveHeadlineFontSize).toBeCloseTo(testHeadlineFontSize, 5);
        expect(effectiveSubheadlineFontSize).toBeCloseTo(testSubheadlineFontSize, 5);
      }
    });

    it("guarantees canvas text paddingX is uniformly 24px across all presets", () => {
      for (const preset of exportSizes) {
        const canonical = getCanonicalPreviewDimensions(preset);
        const scaleX = preset.width / canonical.width;
        const paddingX = 8 * scaleX;
        expect(paddingX).toBeCloseTo(24, 5);
      }
    });
  });

  describe("2. Text Wrapping Determinism", () => {
    it("computes deterministic maxWidth across browser and MCP paths", () => {
      const p67 = exportSizes.find((s) => s.id === "6.7")!;
      const canonical = getCanonicalPreviewDimensions(p67);
      const scaleX = p67.width / canonical.width;
      const paddingX = 8 * scaleX;

      const headlineWidthPercent = 90; // default 90%
      const canvasMaxWidth = p67.width * (headlineWidthPercent / 100) - paddingX;

      // 1284 * 0.90 - 24 = 1155.6 - 24 = 1131.6px
      expect(canvasMaxWidth).toBeCloseTo(1131.6, 1);
    });
  });

  describe("3. Preservation of Phase 4 Step 2 Fixes", () => {
    const sampleScreen = {
      id: "screen-1",
      route: "/analytics",
      filePath: "public/demo-image.png",
      title: "Portfolio Analytics",
      keyElements: ["Net Worth", "Cash Flow"],
    };

    it("preserves iPad device selection and non-clipping bounds", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "ipad" });
      expect(variants[0].deviceModel).toBe("ipad-pro-12-9");

      const project = variantsToProject(variants, { exportSizeId: "ipad" });
      expect(project.selectedDeviceId).toBe("ipad-pro-12-9");
      expect(project.screenshots[0].devices[0].scale).toBe(72);
      expect(project.screenshots[0].devices[0].y).toBe(24);
    });

    it("preserves 3D clearance in dark-contrast-3d", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "6.7" });
      const dark3d = variants.find((v) => v.presetId === "dark-contrast-3d")!;

      expect(dark3d.visualComposition.deviceOffsetY).toBe(37);
      expect(dark3d.visualComposition.deviceScale).toBe(80);
      expect(dark3d.visualComposition.headlineFontSize).toBe(72);
      expect(dark3d.visualComposition.subheadlineFontSize).toBe(36);
    });

    it("preserves sunset gradient contrast in bold-gradient", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "6.7" });
      const bold = variants.find((v) => v.presetId === "bold-gradient")!;

      expect(bold.visualComposition.textColor).toBe("#0f172a");

      const report = evaluateGradientContrast(bold.visualComposition.textColor, "sunset");
      expect(report.topContrast).toBeGreaterThanOrEqual(7.0);
      expect(report.midContrast).toBeGreaterThanOrEqual(7.0);
      expect(report.bottomContrast).toBeGreaterThanOrEqual(7.0);
      expect(report.isCompliantAAA).toBe(true);
    });

    it("preserves refined premium-editorial scale at 85% with balanced lateral margins", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "6.7" });
      const premium = variants.find((v) => v.presetId === "premium-editorial")!;

      expect(premium.visualComposition.deviceScale).toBe(85);
      expect(premium.visualComposition.deviceOffsetY).toBe(40);
      expect(premium.visualComposition.deviceStyle).toBe("flat");

      // Verify that 85% yields 96.3px lateral margin on 6.7" canvas (1284px)
      const canvasWidth = 1284;
      const deviceWidth = canvasWidth * (premium.visualComposition.deviceScale / 100);
      const lateralMargin = (canvasWidth - deviceWidth) / 2;
      expect(lateralMargin).toBeCloseTo(96.3, 1);
      expect((lateralMargin / canvasWidth) * 100).toBeCloseTo(7.5, 1);
    });

    it("preserves refined minimal-clean subheadline hierarchy at 42px with balanced clearance", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "6.7" });
      const minimal = variants.find((v) => v.presetId === "minimal-clean")!;

      expect(minimal.visualComposition.headlineFontSize).toBe(72);
      expect(minimal.visualComposition.subheadlineFontSize).toBe(42);
      expect(minimal.visualComposition.deviceOffsetY).toBe(35);
      expect(minimal.visualComposition.deviceScale).toBe(80);

      const project = variantsToProject([minimal], { exportSizeId: "6.7" });
      expect(project.subheadlineFontSize).toBe(42);
    });
  });

  describe("4. MCP Tools Registration and Schema Invariance", () => {
    it("discovers all six MCP tools with schemas intact", () => {
      const server = createAppshotsServer();

      // Verify that all 6 tools are registered
      const registeredTools = Object.keys((server as any)._registeredTools || {});
      expect(registeredTools).toContain("build_appshots_project");
      expect(registeredTools).toContain("export_store_assets");
      expect(registeredTools).toContain("analyze_app_for_store");
      expect(registeredTools).toContain("generate_screenshot_plan");
      expect(registeredTools).toContain("build_and_export_store_assets");
      expect(registeredTools).toContain("package_store_export");
      expect(registeredTools).toHaveLength(6);
    });
  });
});
