/**
 * Headless Export Adapter Tests
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  exportProjectHeadless,
  localImageToDataUrl,
  verifyPngBuffer,
} from "./headless-export";
import type { Project } from "../types";
import { createDefaultScreenshot } from "../context/EditorContext";
import { createDeviceInstance } from "./device-instances";

describe("Headless Export Adapter - Unit & Validation", () => {
  it("verifyPngBuffer verifies valid PNG buffer and extracts dimensions", () => {
    // Construct a minimal valid PNG header with IHDR chunk
    const buffer = Buffer.alloc(30);
    // Signature
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    signature.forEach((byte, i) => buffer[i] = byte);
    // Length 13
    buffer.writeUInt32BE(13, 8);
    // Chunk type 'IHDR'
    buffer.write("IHDR", 12, "ascii");
    // Width 1284, Height 2778
    buffer.writeUInt32BE(1284, 16);
    buffer.writeUInt32BE(2778, 20);

    const result = verifyPngBuffer(buffer);
    expect(result.width).toBe(1284);
    expect(result.height).toBe(2778);
  });

  it("verifyPngBuffer rejects buffers with invalid signatures or truncated data", () => {
    const invalidSig = Buffer.from([0x00, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(() => verifyPngBuffer(invalidSig)).toThrow("Invalid PNG signature");

    const truncated = Buffer.from([0x89, 0x50, 0x4e]);
    expect(() => verifyPngBuffer(truncated)).toThrow("too small");
  });

  it("localImageToDataUrl converts valid existing image and rejects missing or empty files", () => {
    const sampleImage = path.resolve("public/demo-image.png");
    expect(fs.existsSync(sampleImage)).toBe(true);

    const dataUrl = localImageToDataUrl(sampleImage);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrl.length).toBeGreaterThan(100);

    // Missing file
    expect(() => localImageToDataUrl("non_existent_image_12345.png")).toThrow(
      "Local image asset not found",
    );
  });

  it("exportProjectHeadless rejects empty projects", async () => {
    const emptyProject = {
      id: "empty-proj",
      name: "Empty",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      screenshots: [],
      selectedDeviceId: "iphone-15-pro-max",
      selectedColorId: "black",
      exportSizeId: "6.7",
      activeScreenshotId: "",
      headlineFontSize: 72,
      subheadlineFontSize: 42,
    } as Project;

    await expect(
      exportProjectHeadless({
        project: emptyProject,
        outputDir: "./tmp/test-output",
      }),
    ).rejects.toThrow("Project must contain at least one screenshot");
  });
});

describe("Headless Export Adapter - End-to-End Proof of Concept", () => {
  const TEST_OUTPUT_DIR = path.resolve("./tmp/headless-export-poc");

  beforeAll(() => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  it("runs AppShots headlessly, builds project from local image, exports valid PNGs, and matches browser export", async () => {
    const demoImagePath = path.resolve("public/demo-image.png");
    const demoDataUrl = localImageToDataUrl(demoImagePath);

    const screenshot = createDefaultScreenshot("iphone-15-pro-max", "black");
    screenshot.headline = "Manage your <b>money</b> anywhere";
    screenshot.subheadline = "Smart financial tracking built for you";
    screenshot.backgroundMode = "gradient";
    screenshot.gradientPresetId = "sunset";
    screenshot.devices = [
      createDeviceInstance({
        deviceId: "iphone-15-pro-max",
        colorId: "black",
        screenshotSrc: demoDataUrl,
        x: 50,
        y: 35,
        scale: 80,
        style: "flat",
      }),
    ];

    const project: Project = {
      id: "poc-test-project",
      name: "POC Test Project",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      screenshots: [screenshot],
      selectedDeviceId: "iphone-15-pro-max",
      selectedColorId: "black",
      exportSizeId: "6.7", // 1284 x 2778
      activeScreenshotId: screenshot.id,
      headlineFontSize: 72,
      subheadlineFontSize: 42,
    };

    const result = await exportProjectHeadless({
      project,
      outputDir: TEST_OUTPUT_DIR,
      headless: true,
    });

    expect(result.success).toBe(true);
    expect(result.outputDir).toBe(TEST_OUTPUT_DIR);
    expect(result.files.length).toBe(1);

    const file = result.files[0];
    expect(file.filename).toBe("appstore-screenshot-1.png");
    expect(file.width).toBe(1284);
    expect(file.height).toBe(2778);
    expect(file.bytes).toBeGreaterThan(50000); // Realistic PNG size
    expect(fs.existsSync(file.filepath)).toBe(true);

    // Verify written file directly from disk
    const diskBuffer = fs.readFileSync(file.filepath);
    const diskDims = verifyPngBuffer(diskBuffer);
    expect(diskDims.width).toBe(1284);
    expect(diskDims.height).toBe(2778);

    // Verify browser UI download comparison was performed and matched
    expect(result.browserDownloadComparison).toBeDefined();
    expect(result.browserDownloadComparison?.matched).toBe(true);
    expect(result.browserDownloadComparison?.bytes).toBeGreaterThan(50000);
  }, 40000);
});
