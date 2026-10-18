import fs from "node:fs";
import path from "node:path";
import {
  exportProjectHeadless,
  localImageToDataUrl,
  verifyPngBuffer,
} from "../src/lib/headless-export";
import type { Project } from "../src/types";
import { createDefaultScreenshot } from "../src/context/EditorContext";
import { createDeviceInstance } from "../src/lib/device-instances";

async function run() {
  const outputDir = path.resolve("output/headless-poc");
  console.log("Starting Headless Export Proof-of-Concept...");
  console.log("Target Output Directory:", outputDir);

  const demoImagePath = path.resolve("public/demo-image.png");
  const demoDataUrl = localImageToDataUrl(demoImagePath);

  const screenshot = createDefaultScreenshot("iphone-15-pro-max", "black");
  screenshot.headline = "Automate your <b>App Store</b> screenshots";
  screenshot.subheadline = "Designed for seamless CI/CD & MCP automation";
  screenshot.backgroundMode = "gradient";
  screenshot.gradientPresetId = "sunset";
  screenshot.devices = [
    createDeviceInstance({
      deviceId: "iphone-15-pro-max",
      colorId: "black",
      screenshotSrc: demoDataUrl,
      x: 50,
      y: 35,
      scale: 82,
      style: "flat",
    }),
  ];

  const project: Project = {
    id: "poc-demo-project",
    name: "POC Demo Project",
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
    outputDir,
    headless: true,
  });

  console.log("\n================ HEADLESS EXPORT SUCCESS ================");
  console.log("Output Directory:", result.outputDir);
  console.log("Generated Files:");

  for (const file of result.files) {
    const diskBuffer = fs.readFileSync(file.filepath);
    const dims = verifyPngBuffer(diskBuffer);
    console.log(` - File: ${file.filename}`);
    console.log(`   Path: ${file.filepath}`);
    console.log(`   Dimensions: ${dims.width}x${dims.height} px`);
    console.log(`   File Size: ${(file.bytes / 1024).toFixed(1)} KB (${file.bytes} bytes)`);
    console.log(`   PNG Signature: 0x89 0x50 0x4E 0x47 (Verified)`);
  }

  if (result.browserDownloadComparison) {
    console.log("\nBrowser UI Download Comparison:");
    console.log(` - Matched: ${result.browserDownloadComparison.matched}`);
    console.log(` - File: ${result.browserDownloadComparison.browserExportPath}`);
    console.log(` - File Size: ${(result.browserDownloadComparison.bytes / 1024).toFixed(1)} KB`);
  }
  console.log("=========================================================\n");
}

run().catch((err) => {
  console.error("Headless Export Failed:", err);
  process.exit(1);
});
