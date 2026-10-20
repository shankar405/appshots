import { describe, expect, it } from "vitest";
import {
  generateVariantsForScreen,
  variantsToProject,
} from "./variants";
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
});
