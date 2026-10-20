import { describe, expect, it } from "vitest";
import {
  hexToRgb,
  getRelativeLuminance,
  getContrastRatio,
  interpolateRgb,
  rgbToHex,
  evaluateGradientContrast,
} from "./color-contrast";

describe("Studio Color Contrast & WCAG Compliance Helper", () => {
  describe("hexToRgb", () => {
    it("parses 6-character hex strings correctly", () => {
      expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#ff7e5f")).toEqual({ r: 255, g: 126, b: 95 });
      expect(hexToRgb("#0f172a")).toEqual({ r: 15, g: 23, b: 42 });
    });

    it("parses 3-character hex shorthand correctly", () => {
      expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb("#000")).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb("#f00")).toEqual({ r: 255, g: 0, b: 0 });
    });

    it("throws an error for invalid hex formats", () => {
      expect(() => hexToRgb("invalid")).toThrow(/Invalid hex color string/);
      expect(() => hexToRgb("#12")).toThrow(/Invalid hex color string/);
      expect(() => hexToRgb("#12345")).toThrow(/Invalid hex color string/);
    });
  });

  describe("getRelativeLuminance", () => {
    it("calculates exact WCAG boundary values for black and white", () => {
      expect(getRelativeLuminance(hexToRgb("#000000"))).toBe(0);
      expect(getRelativeLuminance(hexToRgb("#ffffff"))).toBe(1);
    });

    it("calculates higher luminance for bright colors than dark colors", () => {
      const lumCoral = getRelativeLuminance(hexToRgb("#ff7e5f"));
      const lumSlate = getRelativeLuminance(hexToRgb("#0f172a"));
      expect(lumCoral).toBeGreaterThan(lumSlate);
    });
  });

  describe("getContrastRatio", () => {
    it("returns 21:1 for black against white", () => {
      expect(getContrastRatio("#000000", "#ffffff")).toBe(21.0);
      expect(getContrastRatio("#ffffff", "#000000")).toBe(21.0);
    });

    it("returns 1:1 for identical colors", () => {
      expect(getContrastRatio("#ff7e5f", "#ff7e5f")).toBe(1.0);
    });

    it("confirms white text on sunset coral fails WCAG AA 4.5:1", () => {
      const whiteRatio = getContrastRatio("#ffffff", "#ff7e5f");
      expect(whiteRatio).toBeLessThan(4.5);
      expect(whiteRatio).toBe(2.5); // 2.50:1 fails WCAG AA
    });

    it("confirms deep slate text on sunset coral exceeds WCAG AAA 7.0:1", () => {
      const slateRatio = getContrastRatio("#0f172a", "#ff7e5f");
      expect(slateRatio).toBeGreaterThan(7.0);
      expect(slateRatio).toBe(7.14); // 7.14:1 satisfies AAA
    });
  });

  describe("interpolateRgb & rgbToHex", () => {
    it("computes midpoint RGB accurately", () => {
      const from = hexToRgb("#ff7e5f");
      const to = hexToRgb("#feb47b");
      const mid = interpolateRgb(from, to, 0.5);
      const midHex = rgbToHex(mid);
      expect(midHex).toBe("#ff996d");
    });
  });

  describe("evaluateGradientContrast", () => {
    it("detects non-compliance for white text on sunset gradient", () => {
      const report = evaluateGradientContrast("#ffffff", "sunset");
      expect(report.gradientId).toBe("sunset");
      expect(report.topContrast).toBeLessThan(4.5);
      expect(report.midContrast).toBeLessThan(4.5);
      expect(report.bottomContrast).toBeLessThan(4.5);
      expect(report.isCompliantAA).toBe(false);
      expect(report.isCompliantAAA).toBe(false);
    });

    it("confirms compliance for deep slate text on sunset gradient across all stops", () => {
      const report = evaluateGradientContrast("#0f172a", "sunset");
      expect(report.gradientId).toBe("sunset");
      expect(report.topContrast).toBeGreaterThanOrEqual(7.0); // 7.23:1
      expect(report.midContrast).toBeGreaterThanOrEqual(7.0); // 8.70:1
      expect(report.bottomContrast).toBeGreaterThanOrEqual(7.0); // 10.34:1
      expect(report.minContrast).toBeGreaterThanOrEqual(4.5);
      expect(report.isCompliantAA).toBe(true);
      expect(report.isCompliantAAA).toBe(true);
    });
  });
});
