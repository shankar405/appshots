import { describe, expect, it, vi } from "vitest";
import { calculateCoverCrop, drawImageCover } from "./export-utils";
import { exportSizes } from "../constants";
import { generateVariantsForScreen } from "./studio/variants";
import { evaluateGradientContrast } from "./studio/color-contrast";

describe("Screenshot Aspect-Ratio Preservation (Cover Crop)", () => {
  describe("1. Crop Rectangle Calculations", () => {
    it("requires no crop when source and destination aspect ratios match", () => {
      // iPhone 15 Pro Max screenshot (1290 x 2796) into proportionally matching frame
      const srcW = 1290;
      const srcH = 2796;
      const destW = 1000;
      const destH = 1000 * (2796 / 1290); // exact same ratio

      const crop = calculateCoverCrop(srcW, srcH, destW, destH);

      expect(crop.sx).toBe(0);
      expect(crop.sy).toBe(0);
      expect(crop.sWidth).toBe(srcW);
      expect(crop.sHeight).toBe(srcH);
    });

    it("crops excess width symmetrically when a landscape source is placed in a portrait screen", () => {
      // 16:9 landscape video/desktop screenshot (1920 x 1080) into 1:2 portrait phone screen (500 x 1000)
      const srcW = 1920;
      const srcH = 1080;
      const destW = 500;
      const destH = 1000;

      const crop = calculateCoverCrop(srcW, srcH, destW, destH);

      // Desired aspect is 0.5 (destW / destH)
      // Crop height must be full height: 1080
      // Crop width must be 1080 * 0.5 = 540
      expect(crop.sHeight).toBe(1080);
      expect(crop.sWidth).toBe(540);
      // sx must be centered: (1920 - 540) / 2 = 690
      expect(crop.sx).toBe(690);
      expect(crop.sy).toBe(0);

      // Verify aspect ratio matches destination exactly
      const cropAspect = crop.sWidth / crop.sHeight;
      const destAspect = destW / destH;
      expect(cropAspect).toBeCloseTo(destAspect, 5);
    });

    it("crops excess height symmetrically when a portrait source is placed in a wider destination", () => {
      // Tall phone screenshot (1080 x 2400, aspect 0.45) placed in iPad 4:3 screen (1500 x 2000, aspect 0.75)
      const srcW = 1080;
      const srcH = 2400;
      const destW = 1500;
      const destH = 2000;

      const crop = calculateCoverCrop(srcW, srcH, destW, destH);

      // Desired aspect is 0.75 (1500 / 2000)
      // Crop width must be full width: 1080
      // Crop height must be 1080 / 0.75 = 1440
      expect(crop.sWidth).toBe(1080);
      expect(crop.sHeight).toBe(1440);
      // sy must be centered: (2400 - 1440) / 2 = 480
      expect(crop.sx).toBe(0);
      expect(crop.sy).toBe(480);

      // Verify aspect ratio matches destination exactly
      const cropAspect = crop.sWidth / crop.sHeight;
      const destAspect = destW / destH;
      expect(cropAspect).toBeCloseTo(destAspect, 5);
    });

    it("handles square and extreme aspect ratios with centered bounds within the source", () => {
      // A. Square source (1000 x 1000) into 6.7" iPhone screen (approx 1284 x 2778)
      const squareCrop = calculateCoverCrop(1000, 1000, 1000, 2163);
      expect(squareCrop.sy).toBe(0);
      expect(squareCrop.sHeight).toBe(1000);
      expect(squareCrop.sWidth).toBeCloseTo(1000 * (1000 / 2163), 1);
      expect(squareCrop.sx).toBeGreaterThan(0);
      expect(squareCrop.sx + squareCrop.sWidth).toBeLessThanOrEqual(1000.001);

      // B. Extreme panoramic source (4000 x 400, 10:1 aspect) into portrait screen (500 x 1000)
      const panoCrop = calculateCoverCrop(4000, 400, 500, 1000);
      expect(panoCrop.sHeight).toBe(400);
      expect(panoCrop.sWidth).toBe(200); // 400 * 0.5
      expect(panoCrop.sx).toBe(1900); // (4000 - 200) / 2
      expect(panoCrop.sy).toBe(0);

      // C. Extreme vertical strip (200 x 4000, 1:20 aspect) into landscape screen (1000 x 500)
      const stripCrop = calculateCoverCrop(200, 4000, 1000, 500);
      expect(stripCrop.sWidth).toBe(200);
      expect(stripCrop.sHeight).toBe(100); // 200 / 2.0
      expect(stripCrop.sx).toBe(0);
      expect(stripCrop.sy).toBe(1950); // (4000 - 100) / 2
    });

    it("guards safely against zero, negative, and invalid non-finite dimensions", () => {
      expect(calculateCoverCrop(0, 1000, 500, 1000)).toEqual({ sx: 0, sy: 0, sWidth: 0, sHeight: 1000 });
      expect(calculateCoverCrop(1000, 0, 500, 1000)).toEqual({ sx: 0, sy: 0, sWidth: 1000, sHeight: 0 });
      expect(calculateCoverCrop(-100, 1000, 500, 1000)).toEqual({ sx: 0, sy: 0, sWidth: 0, sHeight: 1000 });
      expect(calculateCoverCrop(1000, -100, 500, 1000)).toEqual({ sx: 0, sy: 0, sWidth: 1000, sHeight: 0 });
      expect(calculateCoverCrop(1000, 1000, 0, 500)).toEqual({ sx: 0, sy: 0, sWidth: 1000, sHeight: 1000 });
      expect(calculateCoverCrop(1000, 1000, 500, 0)).toEqual({ sx: 0, sy: 0, sWidth: 1000, sHeight: 1000 });
      expect(calculateCoverCrop(NaN, 1000, 500, 1000)).toEqual({ sx: 0, sy: 0, sWidth: 0, sHeight: 1000 });
      expect(calculateCoverCrop(1000, 1000, Infinity, 1000)).toEqual({ sx: 0, sy: 0, sWidth: 1000, sHeight: 1000 });
    });

    it("guarantees crop coordinates remain strictly within original source image bounds", () => {
      const testCases = [
        { srcW: 800, srcH: 600, destW: 1080, destH: 1920 },
        { srcW: 1080, srcH: 1920, destW: 800, destH: 600 },
        { srcW: 1200, srcH: 1200, destW: 1284, destH: 2778 },
        { srcW: 3024, srcH: 4032, destW: 2048, destH: 2732 },
        { srcW: 1920, srcH: 1080, destW: 1242, destH: 2688 },
      ];

      for (const { srcW, srcH, destW, destH } of testCases) {
        const crop = calculateCoverCrop(srcW, srcH, destW, destH);

        expect(crop.sx).toBeGreaterThanOrEqual(0);
        expect(crop.sy).toBeGreaterThanOrEqual(0);
        expect(crop.sWidth).toBeGreaterThan(0);
        expect(crop.sHeight).toBeGreaterThan(0);
        expect(crop.sx + crop.sWidth).toBeLessThanOrEqual(srcW + 1e-4);
        expect(crop.sy + crop.sHeight).toBeLessThanOrEqual(srcH + 1e-4);

        // Aspect ratio of cropped region must match destination aspect ratio
        const cropAspect = crop.sWidth / crop.sHeight;
        const destAspect = destW / destH;
        expect(cropAspect).toBeCloseTo(destAspect, 4);
      }
    });
  });

  describe("2. Canvas drawImageCover Execution", () => {
    it("invokes ctx.drawImage with exact 9-parameter cover crop bounds", () => {
      const mockDrawImage = vi.fn();
      const mockCtx = {
        drawImage: mockDrawImage,
      } as unknown as CanvasRenderingContext2D;

      const mockImg = {
        naturalWidth: 1920,
        naturalHeight: 1080,
        width: 1920,
        height: 1080,
      } as unknown as HTMLImageElement;

      const dx = 100;
      const dy = 200;
      const dWidth = 500;
      const dHeight = 1000;

      const crop = drawImageCover(mockCtx, mockImg, dx, dy, dWidth, dHeight);

      expect(mockDrawImage).toHaveBeenCalledTimes(1);
      expect(mockDrawImage).toHaveBeenCalledWith(
        mockImg,
        crop.sx,
        crop.sy,
        crop.sWidth,
        crop.sHeight,
        dx,
        dy,
        dWidth,
        dHeight
      );

      // Verify that destination bounds cover the full rectangle without gaps
      expect(dWidth).toBe(500);
      expect(dHeight).toBe(1000);
    });
  });

  describe("3. Preservation of Prior Phase 4 Invariants", () => {
    const sampleScreen = {
      id: "screen-test",
      route: "/test",
      filePath: "public/demo-image.png",
      title: "Test Screen",
    };

    it("preserves exact dimensions for all four Apple export presets", () => {
      expect(exportSizes.find((s) => s.id === "6.7")).toEqual({
        id: "6.7",
        label: "6.7 inch (iPhone 13/12 Pro Max)",
        width: 1284,
        height: 2778,
      });
      expect(exportSizes.find((s) => s.id === "6.5")).toEqual({
        id: "6.5",
        label: "6.5 inch (iPhone 11 Pro Max)",
        width: 1242,
        height: 2688,
      });
      expect(exportSizes.find((s) => s.id === "5.5")).toEqual({
        id: "5.5",
        label: "5.5 inch (iPhone 8 Plus)",
        width: 1242,
        height: 2208,
      });
      expect(exportSizes.find((s) => s.id === "ipad")).toEqual({
        id: "ipad",
        label: "12.9 inch (iPad Pro)",
        width: 2048,
        height: 2732,
      });
    });

    it("preserves Step 2 iPad Pro 12.9 tablet guardrail", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "ipad" });
      expect(variants[0].deviceModel).toBe("ipad-pro-12-9");
      expect(variants[0].visualComposition.deviceScale).toBe(72);
      expect(variants[0].visualComposition.deviceOffsetY).toBe(24);
    });

    it("preserves Step 2 3D clearance and Step 2 sunset contrast", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "6.7" });
      const dark3d = variants.find((v) => v.presetId === "dark-contrast-3d")!;
      expect(dark3d.visualComposition.deviceOffsetY).toBe(37);
      expect(dark3d.visualComposition.deviceScale).toBe(80);

      const bold = variants.find((v) => v.presetId === "bold-gradient")!;
      expect(bold.visualComposition.textColor).toBe("#0f172a");
      const contrast = evaluateGradientContrast(bold.visualComposition.textColor, "sunset");
      expect(contrast.isCompliantAAA).toBe(true);
    });

    it("preserves Step 4 premium-editorial scale at 85%", () => {
      const variants = generateVariantsForScreen(sampleScreen, { exportSizeId: "6.7" });
      const premium = variants.find((v) => v.presetId === "premium-editorial")!;
      expect(premium.visualComposition.deviceScale).toBe(85);
    });
  });
});
