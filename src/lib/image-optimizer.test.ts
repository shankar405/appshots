/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateTargetDimensions,
  optimizeImageFile,
} from "./image-optimizer";

describe("calculateTargetDimensions", () => {
  it("keeps dimensions unchanged when already within maxDimension (no upscaling)", () => {
    const result = calculateTargetDimensions(1200, 800, 2560);
    expect(result).toEqual({ width: 1200, height: 800 });
  });

  it("downscales landscape images proportionally when width exceeds maxDimension", () => {
    const result = calculateTargetDimensions(4000, 2000, 2000);
    expect(result).toEqual({ width: 2000, height: 1000 });
  });

  it("downscales portrait images proportionally when height exceeds maxDimension", () => {
    const result = calculateTargetDimensions(1000, 3000, 1500);
    expect(result).toEqual({ width: 500, height: 1500 });
  });

  it("downscales square images proportionally", () => {
    const result = calculateTargetDimensions(3200, 3200, 1600);
    expect(result).toEqual({ width: 1600, height: 1600 });
  });

  it("handles exact match with maxDimension", () => {
    const result = calculateTargetDimensions(2560, 1440, 2560);
    expect(result).toEqual({ width: 2560, height: 1440 });
  });

  it("throws error for non-positive or non-finite dimensions", () => {
    expect(() => calculateTargetDimensions(0, 100, 1000)).toThrow(
      "Invalid dimensions",
    );
    expect(() => calculateTargetDimensions(100, -10, 1000)).toThrow(
      "Invalid dimensions",
    );
    expect(() => calculateTargetDimensions(100, 100, 0)).toThrow(
      "Invalid dimensions",
    );
    expect(() => calculateTargetDimensions(NaN, 100, 1000)).toThrow(
      "Invalid dimensions",
    );
  });
});

describe("optimizeImageFile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects empty files", async () => {
    const emptyFile = new File([], "empty.png", { type: "image/png" });
    await expect(optimizeImageFile(emptyFile)).rejects.toThrow(
      "Selected file is empty",
    );
  });

  it("rejects files exceeding maxInputBytes", async () => {
    // 16MB buffer
    const largeFile = new File([new Uint8Array(16 * 1024 * 1024)], "large.png", {
      type: "image/png",
    });
    await expect(
      optimizeImageFile(largeFile, { maxInputBytes: 15 * 1024 * 1024 }),
    ).rejects.toThrow("exceeds the maximum allowed size");
  });

  it("rejects unsupported MIME types", async () => {
    const docFile = new File(["dummy content"], "doc.pdf", {
      type: "application/pdf",
    });
    await expect(optimizeImageFile(docFile)).rejects.toThrow(
      "Unsupported file type",
    );
  });

  it("preserves SVG files under 250KB without canvas rasterization", async () => {
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>`;
    const svgFile = new File([svgContent], "badge.svg", {
      type: "image/svg+xml",
    });

    const result = await optimizeImageFile(svgFile);
    expect(result.format).toBe("image/svg+xml");
    expect(result.dataUrl).toContain("data:image/svg+xml");
    expect(result.byteLength).toBeGreaterThan(0);
  });

  it("rejects SVG files exceeding 250KB limit", async () => {
    // Create oversized SVG > 250KB
    const oversizedSvg = new File(
      [new Uint8Array(260 * 1024)],
      "huge-badge.svg",
      { type: "image/svg+xml" },
    );

    await expect(optimizeImageFile(oversizedSvg)).rejects.toThrow(
      "SVG file exceeds the maximum allowed limit of 250KB",
    );
  });

  it("processes and downscales raster image via canvas and revokes object URL", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], "test.png", {
      type: "image/png",
    });

    let revokedUrl: string | null = null;
    const originalRevoke = URL.revokeObjectURL;
    const originalCreate = URL.createObjectURL;

    URL.createObjectURL = vi.fn(() => "blob:mock-image-url");
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrl = url;
    });

    // Mock HTMLImageElement
    const originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      naturalWidth = 3000;
      naturalHeight = 2000;
      width = 3000;
      height = 2000;
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
    } as unknown as typeof Image;

    // Mock Canvas and Context
    const drawImageMock = vi.fn();
    const toDataURLMock = vi.fn(
      (format: string) => `data:${format};base64,mockoptimdata`,
    );

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      if (tagName === "canvas") {
        const canvas = originalCreateElement("canvas");
        canvas.getContext = vi.fn(() => ({
          drawImage: drawImageMock,
        })) as unknown as typeof canvas.getContext;
        canvas.toDataURL = toDataURLMock;
        return canvas;
      }
      return originalCreateElement(tagName);
    });

    try {
      const result = await optimizeImageFile(file, {
        maxDimension: 1500,
        quality: 0.8,
        outputFormat: "image/webp",
      });

      expect(result.width).toBe(1500);
      expect(result.height).toBe(1000);
      expect(result.format).toBe("image/webp");
      expect(result.dataUrl).toBe("data:image/webp;base64,mockoptimdata");
      expect(drawImageMock).toHaveBeenCalled();
      expect(toDataURLMock).toHaveBeenCalledWith("image/webp", 0.8);
      expect(revokedUrl).toBe("blob:mock-image-url");
    } finally {
      globalThis.Image = originalImage;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });

  it("handles image decoding error gracefully and cleans up object URL", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "corrupt.jpg", {
      type: "image/jpeg",
    });

    let revokedUrl: string | null = null;
    const originalRevoke = URL.revokeObjectURL;
    const originalCreate = URL.createObjectURL;

    URL.createObjectURL = vi.fn(() => "blob:corrupt-image-url");
    URL.revokeObjectURL = vi.fn((url: string) => {
      revokedUrl = url;
    });

    const originalImage = globalThis.Image;
    globalThis.Image = class CorruptImage {
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          if (this.onerror) this.onerror();
        }, 10);
      }
    } as unknown as typeof Image;

    try {
      await expect(optimizeImageFile(file)).rejects.toThrow(
        "Failed to load image element",
      );
      expect(revokedUrl).toBe("blob:corrupt-image-url");
    } finally {
      globalThis.Image = originalImage;
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
    }
  });
});
