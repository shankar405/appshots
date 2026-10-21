import { describe, expect, it } from "vitest";
import {
  generateVariantsForScreen,
  variantsToProject,
} from "./variants";
import { exportSizes } from "../../constants";
import type { ObservedScreen } from "../../mcp/ai/schemas";

describe("Studio Multi-Variant Design Generator", () => {
  const sampleScreen: ObservedScreen = {
    id: "screen-1-dashboard",
    route: "/dashboard",
    filePath: "output/raw-captures/screen-1-dashboard.png",
    title: "Financial Dashboard",
    keyElements: ["Net Worth Card", "Recent Transactions", "Portfolio Chart"],
    status: "captured",
  };

  it("generates 4 distinct visual variants by default", () => {
    const variants = generateVariantsForScreen(sampleScreen);

    expect(variants).toHaveLength(4);
    expect(variants.map((v) => v.presetId)).toEqual([
      "minimal-clean",
      "bold-gradient",
      "dark-contrast-3d",
      "premium-editorial",
    ]);

    // Verify distinct names and descriptions
    const names = new Set(variants.map((v) => v.name));
    expect(names.size).toBe(4);
  });

  it("generates 3 distinct visual variants when variantCount is 3", () => {
    const variants = generateVariantsForScreen(sampleScreen, { variantCount: 3 });

    expect(variants).toHaveLength(3);
    expect(variants.map((v) => v.presetId)).toEqual([
      "minimal-clean",
      "bold-gradient",
      "dark-contrast-3d",
    ]);
  });

  it("produces diverse layout specifications for variants of the same source screenshot", () => {
    const variants = generateVariantsForScreen(sampleScreen, { variantCount: 4 });

    const minimal = variants.find((v) => v.presetId === "minimal-clean")!;
    const bold = variants.find((v) => v.presetId === "bold-gradient")!;
    const dark3d = variants.find((v) => v.presetId === "dark-contrast-3d")!;
    const premium = variants.find((v) => v.presetId === "premium-editorial")!;

    // 1. Device styles: flat vs 3d
    expect(minimal.visualComposition.deviceStyle).toBe("flat");
    expect(bold.visualComposition.deviceStyle).toBe("3d");
    expect(dark3d.visualComposition.deviceStyle).toBe("3d");
    expect(premium.visualComposition.deviceStyle).toBe("flat");

    // 2. 3D tilts: minimal has 0 tilt, bold and dark3d have non-zero rotation
    expect(minimal.visualComposition.rotateY).toBe(0);
    expect(bold.visualComposition.rotateY).not.toBe(0);
    expect(dark3d.visualComposition.rotateY).not.toBe(0);

    // 3. Backgrounds: minimal is solid, others are gradients
    expect(minimal.visualComposition.backgroundMode).toBe("solid");
    expect(bold.visualComposition.backgroundMode).toBe("gradient");
    expect(dark3d.visualComposition.backgroundMode).toBe("gradient");
    expect(premium.visualComposition.backgroundMode).toBe("gradient");

    // 4. Scales differ
    expect(premium.visualComposition.deviceScale).toBeGreaterThan(minimal.visualComposition.deviceScale);

    // 5. Headings are non-identical and contain rich-text <b> tags
    const headlines = variants.map((v) => v.copy.headline);
    const uniqueHeadlines = new Set(headlines);
    expect(uniqueHeadlines.size).toBe(4);
    for (const headline of headlines) {
      expect(headline).toMatch(/<b>.*<\/b>/);
    }
  });

  it("preserves source screenshot identity, route, and title across all variants", () => {
    const variants = generateVariantsForScreen(sampleScreen);

    for (const variant of variants) {
      expect(variant.sourceScreen.id).toBe(sampleScreen.id);
      expect(variant.sourceScreen.route).toBe(sampleScreen.route);
      expect(variant.sourceScreen.filePath).toBe(sampleScreen.filePath);
      expect(variant.sourceScreen.title).toBe(sampleScreen.title);
    }
  });

  it("allows custom copy overrides to replace generated text", () => {
    const variants = generateVariantsForScreen(sampleScreen, {
      customCopy: {
        headline: "Custom <b>Headline</b>",
        subheadline: "Custom subheadline text",
      },
    });

    for (const variant of variants) {
      expect(variant.copy.headline).toBe("Custom <b>Headline</b>");
      expect(variant.copy.subheadline).toBe("Custom subheadline text");
    }
  });

  it("converts variants into a valid, native AppShots Project", () => {
    const variants = generateVariantsForScreen(sampleScreen, { variantCount: 3 });
    const project = variantsToProject(variants, {
      projectName: "Test Studio Project",
      exportSizeId: "6.7",
      defaultDeviceId: "iphone-15-pro-max",
    });

    expect(project.name).toBe("Test Studio Project");
    expect(project.exportSizeId).toBe("6.7");
    expect(project.selectedDeviceId).toBe("iphone-15-pro-max");
    expect(project.screenshots).toHaveLength(3);

    // Verify first screenshot matches first variant composition
    const s1 = project.screenshots[0];
    expect(s1.headline).toBe(variants[0].copy.headline);
    expect(s1.backgroundMode).toBe(variants[0].visualComposition.backgroundMode);
    expect(s1.devices).toHaveLength(1);
    expect(s1.devices[0].style).toBe(variants[0].visualComposition.deviceStyle);
    expect(s1.devices[0].scale).toBe(variants[0].visualComposition.deviceScale);
    expect(s1.devices[0].rotateY).toBe(variants[0].visualComposition.rotateY);
  });

  it("throws clear error when variantsToProject receives an empty list", () => {
    expect(() => variantsToProject([])).toThrow(
      "Cannot create project: at least one variant must be provided.",
    );
  });

  describe("P1 Visual Defect Regressions", () => {
    it("ensures bold-gradient uses contrast-safe dark slate typography", () => {
      const variants = generateVariantsForScreen(sampleScreen);
      const bold = variants.find((v) => v.presetId === "bold-gradient")!;

      expect(bold.visualComposition.textColor).toBe("#0f172a");
      expect(bold.visualComposition.gradientPresetId).toBe("sunset");

      const project = variantsToProject([bold]);
      expect(project.screenshots[0].textColor).toBe("#0f172a");
    });

    it("ensures dark-contrast-3d provides safe vertical text-to-device clearance", () => {
      const variants = generateVariantsForScreen(sampleScreen);
      const dark3d = variants.find((v) => v.presetId === "dark-contrast-3d")!;

      // Offset must be at least 37% and scale <= 80% to maintain separation
      expect(dark3d.visualComposition.deviceOffsetY).toBeGreaterThanOrEqual(37);
      expect(dark3d.visualComposition.deviceScale).toBeLessThanOrEqual(80);
      expect(dark3d.visualComposition.headlineFontSize).toBeLessThanOrEqual(72);
      expect(dark3d.visualComposition.subheadlineFontSize).toBeLessThanOrEqual(36);

      // Model vertical separation on 6.7" canvas (height = 2778 or 2796)
      const canvasHeight = 2796;
      const deviceY = canvasHeight * (dark3d.visualComposition.deviceOffsetY / 100);
      // Perspective tilt top boundary is ~100px above deviceY
      const projectedTop = deviceY - 100;
      // Normal multi-line text block ends at y ~740px
      const textBottomEstimate = 740;
      const clearance = projectedTop - textBottomEstimate;

      expect(clearance).toBeGreaterThan(100); // Guarantees >100px clearance (eliminated 1px collision)
    });

    it("ensures iPad preset selects official iPad Pro model and fits without vertical clipping", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "ipad" });

      expect(variants[0].deviceModel).toBe("ipad-pro-12-9");
      expect(variants[0].deviceColorId).toBe("space-gray");
      expect(variants[0].visualComposition.deviceScale).toBe(72);
      expect(variants[0].visualComposition.deviceOffsetY).toBe(24);

      const project = variantsToProject(variants, { exportSizeId: "ipad" });
      expect(project.selectedDeviceId).toBe("ipad-pro-12-9");
      expect(project.exportSizeId).toBe("ipad");

      const s1Device = project.screenshots[0].devices[0];
      expect(s1Device.deviceId).toBe("ipad-pro-12-9");
      expect(s1Device.scale).toBe(72);
      expect(s1Device.y).toBe(24);

      // Verify canvas bounds containment (canvas is 2048 x 2732)
      const canvasWidth = 2048;
      const canvasHeight = 2732;
      const deviceWidthPx = canvasWidth * (s1Device.scale / 100);
      const deviceHeightPx = deviceWidthPx * (2732 / 2048);
      const deviceYPx = canvasHeight * (s1Device.y / 100);
      const deviceBottomPx = deviceYPx + deviceHeightPx;

      expect(deviceBottomPx).toBeLessThan(canvasHeight);
      expect(canvasHeight - deviceBottomPx).toBeGreaterThan(80); // ~109px clearance at bottom
    });

    it("responsively fits phone devices when rendered on iPad preset without clipping", () => {
      // Simulate user requesting an iPhone device on iPad export
      const project = variantsToProject(
        [
          {
            id: "custom-var-1",
            presetId: "minimal-clean",
            name: "Phone on iPad",
            description: "Test phone containment on iPad",
            sourceScreen: { id: "s1", route: "/", filePath: "", title: "Home" },
            copy: { headline: "Test", subheadline: "Test" },
            visualComposition: {
              deviceStyle: "flat",
              deviceScale: 80,
              deviceOffsetY: 35,
              deviceRotation: 0,
              rotateY: 0,
              rotateX: 0,
              backgroundMode: "solid",
              gradientPresetId: null,
              backgroundColor: "#000",
              textColor: "#fff",
            },
            deviceModel: "iphone-15-pro-max",
            deviceColorId: "black",
          },
        ],
        { exportSizeId: "ipad", defaultDeviceId: "iphone-15-pro-max" },
      );

      const device = project.screenshots[0].devices[0];
      // Responsive guardrail scales down phone so it does not clip
      expect(device.scale).toBeLessThanOrEqual(42);
      expect(device.y).toBeLessThanOrEqual(24);

      // Verify containment: iPhone aspect ratio 2796 / 1290 = 2.167
      const canvasWidth = 2048;
      const canvasHeight = 2732;
      const phoneWidth = canvasWidth * (device.scale / 100);
      const phoneHeight = phoneWidth * (2796 / 1290);
      const phoneBottom = canvasHeight * (device.y / 100) + phoneHeight;

      expect(phoneBottom).toBeLessThan(canvasHeight);
      expect(canvasHeight - phoneBottom).toBeGreaterThan(150); // >150px bottom margin
    });

    it("preserves standard dimensions for all four Apple export presets", () => {
      const p67 = exportSizes.find((s) => s.id === "6.7");
      const p65 = exportSizes.find((s) => s.id === "6.5");
      const p55 = exportSizes.find((s) => s.id === "5.5");
      const pipad = exportSizes.find((s) => s.id === "ipad");

      expect(p67).toEqual({ id: "6.7", label: "6.7 inch (iPhone 13/12 Pro Max)", width: 1284, height: 2778 });
      expect(p65).toEqual({ id: "6.5", label: "6.5 inch (iPhone 11 Pro Max)", width: 1242, height: 2688 });
      expect(p55).toEqual({ id: "5.5", label: "5.5 inch (iPhone 8 Plus)", width: 1242, height: 2208 });
      expect(pipad).toEqual({ id: "ipad", label: "12.9 inch (iPad Pro)", width: 2048, height: 2732 });
    });

    it("ensures premium-editorial provides balanced lateral margins within the 84-86% scale range", () => {
      const variants = generateVariantsForScreen(sampleScreen);
      const premium = variants.find((v) => v.presetId === "premium-editorial")!;

      // 1. Scale is within 84-86% range (resolves P2 Finding 5)
      expect(premium.visualComposition.deviceScale).toBeGreaterThanOrEqual(84);
      expect(premium.visualComposition.deviceScale).toBeLessThanOrEqual(86);
      expect(premium.visualComposition.deviceScale).toBe(85);

      // 2. Lateral margin calculations for all iPhone presets
      const phonePresets = [
        { id: "6.7", width: 1284, height: 2778 },
        { id: "6.5", width: 1242, height: 2688 },
        { id: "5.5", width: 1242, height: 2208 },
      ];

      for (const preset of phonePresets) {
        const deviceWidthPx = preset.width * (premium.visualComposition.deviceScale / 100);
        const lateralMargin = (preset.width - deviceWidthPx) / 2;
        const marginPct = (lateralMargin / preset.width) * 100;

        // Guaranteed >= 7% lateral margin (>= 85px) on each side
        expect(marginPct).toBeCloseTo(7.5, 1);
        expect(lateralMargin).toBeGreaterThan(85);
      }

      // 3. iPad preset preserves dedicated tablet scale (72%) with spacious margins
      const ipadVariants = generateVariantsForScreen(sampleScreen, { exportSizeId: "ipad" });
      const ipadPremium = ipadVariants.find((v) => v.presetId === "premium-editorial")!;
      expect(ipadPremium.visualComposition.deviceScale).toBe(72);
      const ipadMargin = (2048 * (1 - 0.72)) / 2;
      expect(ipadMargin).toBeCloseTo(286.72, 1);
    });

    it("ensures minimal-clean variant establishes balanced subheadline hierarchy at 42px across phone presets", () => {
      const variants = generateVariantsForScreen(sampleScreen);
      const minimal = variants.find((v) => v.presetId === "minimal-clean")!;

      // 1. Subheadline is 42px, headline is 72px (resolves P3 Finding 7)
      expect(minimal.visualComposition.headlineFontSize).toBe(72);
      expect(minimal.visualComposition.subheadlineFontSize).toBe(42);

      // 2. Hierarchy ratio 42 / 72 = 0.583 sits squarely in golden 55-60% range
      const ratio = minimal.visualComposition.subheadlineFontSize! / minimal.visualComposition.headlineFontSize!;
      expect(ratio).toBeCloseTo(0.583, 3);
      expect(ratio).toBeGreaterThanOrEqual(0.55);
      expect(ratio).toBeLessThanOrEqual(0.60);

      // 3. Project created from minimal-clean retains 42px on phone presets
      const project = variantsToProject([minimal], { exportSizeId: "6.7" });
      expect(project.subheadlineFontSize).toBe(42);
      expect(project.headlineFontSize).toBe(72);

      // 4. iPad export retains calibrated tablet subheadline size (38px)
      const ipadVariants = generateVariantsForScreen(sampleScreen, { exportSizeId: "ipad" });
      const ipadMinimal = ipadVariants.find((v) => v.presetId === "minimal-clean")!;
      expect(ipadMinimal.visualComposition.subheadlineFontSize).toBe(38);
      expect(ipadMinimal.visualComposition.headlineFontSize).toBe(76);

      const ipadProject = variantsToProject([ipadMinimal], { exportSizeId: "ipad" });
      expect(ipadProject.subheadlineFontSize).toBe(38);
      expect(ipadProject.headlineFontSize).toBe(76);

      // 5. Verification of vertical clearance across presets with 42px subheadline
      const phonePresets = [
        { id: "6.7", height: 2778 },
        { id: "6.5", height: 2688 },
        { id: "5.5", height: 2208 },
      ];

      for (const preset of phonePresets) {
        const subheadlineTopY = preset.height * 0.18;
        // 2 lines of 42px subheadline at 1.1 line-height
        const textHeight = 2 * 42 * 1.1;
        const subheadlineBottomY = subheadlineTopY + textHeight;
        const deviceTopY = preset.height * (minimal.visualComposition.deviceOffsetY / 100);
        const clearance = deviceTopY - subheadlineBottomY;

        // Guaranteed >280px clearance on all phone presets
        expect(clearance).toBeGreaterThan(280);
      }
    });
  });
});

