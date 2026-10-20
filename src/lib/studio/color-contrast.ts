/**
 * AppShots Studio - Color Contrast & WCAG Compliance Helper
 *
 * Implements WCAG 2.1 relative luminance and contrast ratio calculations
 * to verify readable typography against solid and gradient store backdrops.
 */

import { gradientPresets } from "../../constants";

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface GradientContrastReport {
  textColor: string;
  gradientId: string;
  fromColor: string;
  toColor: string;
  topContrast: number;
  midContrast: number;
  bottomContrast: number;
  minContrast: number;
  isCompliantAA: boolean;
  isCompliantAAA: boolean;
}

/**
 * Parses a 3-character or 6-character hex color string into RGB values [0..255].
 */
export function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace(/^#/, "").trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return { r, g, b };
  }
  throw new Error(`Invalid hex color string: "${hex}"`);
}

/**
 * Calculates the relative luminance of an sRGB color per WCAG 2.1 specification.
 * Returns a value in the range [0.0, 1.0].
 */
export function getRelativeLuminance(rgb: RgbColor): number {
  const transform = (channel: number): number => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };

  const r = transform(rgb.r);
  const g = transform(rgb.g);
  const b = transform(rgb.b);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculates the WCAG 2.1 contrast ratio between two hex colors.
 * Returns a value from 1.0 (identical) to 21.0 (black vs white).
 */
export function getContrastRatio(hexA: string, hexB: string): number {
  const lumA = getRelativeLuminance(hexToRgb(hexA));
  const lumB = getRelativeLuminance(hexToRgb(hexB));

  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);

  const ratio = (lighter + 0.05) / (darker + 0.05);
  return Number(ratio.toFixed(2));
}

/**
 * Linearly interpolates two RGB colors at factor t in [0..1].
 */
export function interpolateRgb(rgb1: RgbColor, rgb2: RgbColor, t: number): RgbColor {
  return {
    r: Math.round(rgb1.r + (rgb2.r - rgb1.r) * t),
    g: Math.round(rgb1.g + (rgb2.g - rgb1.g) * t),
    b: Math.round(rgb1.b + (rgb2.b - rgb1.b) * t),
  };
}

/**
 * Converts an RGB object to 6-digit hex format.
 */
export function rgbToHex(rgb: RgbColor): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

/**
 * Evaluates the contrast of a text color against the top, midpoint, and bottom
 * of a named gradient preset from constants.ts.
 */
export function evaluateGradientContrast(
  textColor: string,
  gradientId: string,
): GradientContrastReport {
  const preset = gradientPresets.find((g) => g.id === gradientId) ?? gradientPresets[0];
  const fromRgb = hexToRgb(preset.from);
  const toRgb = hexToRgb(preset.to);
  const midHex = rgbToHex(interpolateRgb(fromRgb, toRgb, 0.5));

  const topContrast = getContrastRatio(textColor, preset.from);
  const midContrast = getContrastRatio(textColor, midHex);
  const bottomContrast = getContrastRatio(textColor, preset.to);

  const minContrast = Math.min(topContrast, midContrast, bottomContrast);

  return {
    textColor,
    gradientId: preset.id,
    fromColor: preset.from,
    toColor: preset.to,
    topContrast,
    midContrast,
    bottomContrast,
    minContrast,
    isCompliantAA: minContrast >= 4.5,
    isCompliantAAA: minContrast >= 7.0,
  };
}
