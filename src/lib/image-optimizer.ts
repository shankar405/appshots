/**
 * Client-Side Image Optimizer
 *
 * Provides utilities for downscaling, recompressing, and validating images
 * before storing them in editor state / localStorage.
 */

export interface ImageOptimizationOptions {
  /** Maximum width or height in pixels. Proportions are preserved. */
  maxDimension?: number;
  /** Compression quality between 0.0 and 1.0 (for lossy formats like WebP / JPEG). */
  quality?: number;
  /** Maximum allowed input file size in bytes before processing. */
  maxInputBytes?: number;
  /** Target MIME format for raster exports. Defaults to "image/webp". */
  outputFormat?: "image/webp" | "image/png" | "image/jpeg";
}

export interface OptimizationResult {
  /** Optimized image as a data URL. */
  dataUrl: string;
  /** Image width in pixels. */
  width: number;
  /** Image height in pixels. */
  height: number;
  /** Result MIME type (e.g. "image/webp", "image/png", "image/svg+xml"). */
  format: string;
  /** Approximate binary byte length of the encoded image data. */
  byteLength: number;
}

const DEFAULT_SCREENSHOT_MAX_DIMENSION = 2560;
const DEFAULT_QUALITY = 0.85;
const DEFAULT_MAX_INPUT_BYTES = 15 * 1024 * 1024; // 15MB
const SVG_MAX_BYTES = 250 * 1024; // 250KB

/**
 * Calculates proportional target dimensions preserving aspect ratio without upscaling.
 *
 * @param width Original image width
 * @param height Original image height
 * @param maxDimension Maximum allowed width or height
 * @returns Target width and height as positive integers
 */
export function calculateTargetDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxDimension) ||
    width <= 0 ||
    height <= 0 ||
    maxDimension <= 0
  ) {
    throw new Error(
      "Invalid dimensions: width, height, and maxDimension must be positive finite numbers.",
    );
  }

  // Do not upscale if both dimensions are already within the allowed limit
  if (width <= maxDimension && height <= maxDimension) {
    return {
      width: Math.round(width),
      height: Math.round(height),
    };
  }

  const scale = Math.min(maxDimension / width, maxDimension / height);
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  return {
    width: targetWidth,
    height: targetHeight,
  };
}

/**
 * Helper to parse intrinsic dimensions from SVG XML text.
 */
function parseSvgDimensions(svgText: string): { width: number; height: number } {
  let width = 0;
  let height = 0;

  const viewBoxMatch = svgText.match(
    /viewBox=["']\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)["']/i,
  );
  if (viewBoxMatch) {
    width = parseFloat(viewBoxMatch[3]) || 0;
    height = parseFloat(viewBoxMatch[4]) || 0;
  }

  const widthMatch = svgText.match(/<svg[^>]*\bwidth=["']([0-9.]+)(?:px)?["']/i);
  const heightMatch = svgText.match(/<svg[^>]*\bheight=["']([0-9.]+)(?:px)?["']/i);
  if (widthMatch) {
    const w = parseFloat(widthMatch[1]);
    if (w > 0) width = w;
  }
  if (heightMatch) {
    const h = parseFloat(heightMatch[1]);
    if (h > 0) height = h;
  }

  return { width, height };
}

/**
 * Helper to read a File as a data URL using FileReader.
 */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file as a data URL."));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("FileReader error reading file."));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Helper to load an image source into an HTMLImageElement with an optional timeout.
 */
function loadImageElement(src: string, timeoutMs = 5000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
    };

    img.onload = () => {
      cleanup();
      resolve(img);
    };

    img.onerror = () => {
      cleanup();
      reject(new Error("Failed to load image element."));
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("Image load timed out."));
      }, timeoutMs);
    }

    img.src = src;
  });
}

/**
 * Optimizes an uploaded image file before storing in editor state:
 * - Validates file size and image MIME type.
 * - For SVGs under 250KB: retains original vector SVG data URL without rasterizing.
 * - For raster images: proportionally downscales to maxDimension and re-encodes (WebP preferred).
 * - Always cleans up temporary object URLs.
 */
export async function optimizeImageFile(
  file: File,
  options?: ImageOptimizationOptions,
): Promise<OptimizationResult> {
  const maxDimension = options?.maxDimension ?? DEFAULT_SCREENSHOT_MAX_DIMENSION;
  const quality = options?.quality ?? DEFAULT_QUALITY;
  const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const outputFormat = options?.outputFormat ?? "image/webp";

  if (!file || file.size <= 0) {
    throw new Error("Selected file is empty.");
  }

  if (file.size > maxInputBytes) {
    const maxMb = (maxInputBytes / (1024 * 1024)).toFixed(1);
    const fileMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File size (${fileMb}MB) exceeds the maximum allowed size of ${maxMb}MB.`,
    );
  }

  const isImageMime = file.type.startsWith("image/");
  const isImageExtension = /\.(png|jpe?g|webp|svg|gif|avif|bmp|ico)$/i.test(
    file.name,
  );
  if (!isImageMime && !isImageExtension) {
    throw new Error(
      `Unsupported file type: ${file.type || file.name || "unknown"}`,
    );
  }

  const isSvg =
    file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");

  // SVG branch: preserve vector data URLs directly without rasterization
  if (isSvg) {
    if (file.size > SVG_MAX_BYTES) {
      const sizeKb = (file.size / 1024).toFixed(1);
      throw new Error(
        `SVG file exceeds the maximum allowed limit of 250KB (${sizeKb}KB).`,
      );
    }

    const dataUrl = await readFileAsDataURL(file);
    let width = 0;
    let height = 0;

    try {
      if (typeof file.text === "function") {
        const text = await file.text();
        const dims = parseSvgDimensions(text);
        width = dims.width;
        height = dims.height;
      }
    } catch {
      // Ignore text read error
    }

    if (!width || !height) {
      try {
        const img = await loadImageElement(dataUrl, 300);
        width = img.naturalWidth || img.width || 0;
        height = img.naturalHeight || img.height || 0;
      } catch {
        // Fallback to 0 if natural dimensions not detected
      }
    }

    const base64Part = dataUrl.split(",")[1] ?? "";
    const byteLength = Math.floor((base64Part.length * 3) / 4) || file.size;

    return {
      dataUrl,
      width,
      height,
      format: "image/svg+xml",
      byteLength,
    };
  }

  // Raster branch: downscale and re-encode via canvas
  let objectUrl: string | null = null;
  let imageSourceUrl: string;

  if (
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  ) {
    try {
      objectUrl = URL.createObjectURL(file);
      imageSourceUrl = objectUrl;
    } catch {
      imageSourceUrl = await readFileAsDataURL(file);
    }
  } else {
    imageSourceUrl = await readFileAsDataURL(file);
  }

  try {
    const img = await loadImageElement(imageSourceUrl);
    const naturalWidth = img.naturalWidth || img.width;
    const naturalHeight = img.naturalHeight || img.height;

    if (!naturalWidth || !naturalHeight) {
      throw new Error("Unable to determine image dimensions.");
    }

    const { width: targetWidth, height: targetHeight } =
      calculateTargetDimensions(naturalWidth, naturalHeight, maxDimension);

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Unable to create canvas 2D rendering context.");
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const dataUrl = canvas.toDataURL(outputFormat, quality);
    const mimeMatch = dataUrl.match(/^data:([^;]+);/);
    const actualFormat = mimeMatch ? mimeMatch[1] : outputFormat;

    const base64Index = dataUrl.indexOf(",");
    const base64Data = base64Index !== -1 ? dataUrl.slice(base64Index + 1) : "";
    const byteLength = Math.floor((base64Data.length * 3) / 4);

    return {
      dataUrl,
      width: targetWidth,
      height: targetHeight,
      format: actualFormat,
      byteLength,
    };
  } finally {
    if (objectUrl && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(objectUrl);
    }
  }
}
