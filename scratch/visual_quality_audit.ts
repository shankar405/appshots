import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import JSZip from "jszip";
import { generateVariantsForScreen, variantsToProject, type DesignVariant } from "../src/lib/studio/variants";
import { packageStoreExport } from "../src/mcp/tools/package-export";
import { exportSizes } from "../src/constants";
import { verifyPngBytes } from "../src/lib/studio/browser-packager";

const EVIDENCE_DIR = path.resolve(
  "C:/Users/fpii/.gemini/antigravity-ide/brain/cd3a18ad-9d86-4730-8b4d-721d5a4fb1cd/scratch/step7_visual_audit_evidence"
);

async function runVisualQualityAudit() {
  console.log("=== AppShots Phase 4 Step 1: Visual Quality Audit ===");
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const demoImagePath = path.resolve("public/demo-image.png");
  if (!fs.existsSync(demoImagePath)) {
    throw new Error(`Demo image not found at ${demoImagePath}`);
  }
  const demoDataUrl = `data:image/png;base64,${fs.readFileSync(demoImagePath).toString("base64")}`;

  // 1. Prepare sample observed screen
  const observedScreen = {
    id: "screen-metrics",
    route: "/analytics/live-metrics",
    filePath: demoImagePath,
    title: "Financial Analytics & Portfolio Health",
    keyElements: ["Live Cash Flow", "Asset Allocation", "Risk Metrics"],
  };

  // Generate all 4 studio variants
  const variants = generateVariantsForScreen(observedScreen, {
    variantCount: 4,
    targetDevice: "iphone-15-pro-max",
    targetStore: "apple-app-store",
  });

  console.log(`Generated ${variants.length} design variants:`, variants.map((v) => v.presetId));

  // 2. Launch browser to perform both Browser Export and Headless MCP Export
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Navigate to local app
  console.log("Navigating to AppShots dev server at http://127.0.0.1:5173/...");
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const presetsToTest = ["6.7", "6.5", "5.5", "ipad"] as const;
  const auditInventory: Array<{
    presetId: string;
    variantPresetId: string;
    exportPipeline: "browser-zip" | "mcp-headless";
    filename: string;
    filePath: string;
    width: number;
    height: number;
    sizeBytes: number;
    headline: string;
    subheadline: string;
    deviceModel: string;
    deviceStyle: string;
    backgroundMode: string;
    backgroundColor: string;
  }> = [];

  // A. Generate exports for each variant in 6.7 preset using Browser ZIP Export Pipeline
  console.log("\n--- Testing 4 Variants under 6.7 preset (Browser Pipeline) ---");
  for (const variant of variants) {
    const singleVarProject = variantsToProject([variant], {
      projectName: `Audit-${variant.presetId}-6.7`,
      exportSizeId: "6.7",
      imageResolver: () => demoDataUrl,
    });

    const browserZipResult = await page.evaluate(async ({ project, variantData, demoImg }) => {
      const exportFn = (window as any).__APPSHOTS_EXPORT__;
      const exportSizesList = [
        { id: "6.7", width: 1284, height: 2778 },
        { id: "6.5", width: 1242, height: 2688 },
        { id: "5.5", width: 1242, height: 2208 },
        { id: "ipad", width: 2048, height: 2732 },
      ];
      const targetSize = exportSizesList.find((s) => s.id === project.exportSizeId) || exportSizesList[0];

      // Fix image URL in project for rendering
      project.screenshots[0].devices[0].screenshotSrc = demoImg;

      const renderedFiles = await exportFn({
        screenshots: project.screenshots,
        exportSize: targetSize,
        previewDimensions: { width: targetSize.width / 3, height: targetSize.height / 3 },
        headlineFontSize: project.headlineFontSize || 72,
        subheadlineFontSize: project.subheadlineFontSize || 38,
        skipDownload: true,
      });

      return {
        dataUrl: renderedFiles[0].data,
        name: renderedFiles[0].name,
      };
    }, { project: singleVarProject, variantData: variant, demoImg: demoDataUrl });

    const base64Data = browserZipResult.dataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const outFilename = `browser_${variant.presetId}_6.7.png`;
    const outPath = path.join(EVIDENCE_DIR, outFilename);
    fs.writeFileSync(outPath, buffer);

    const dims = verifyPngBytes(buffer);
    console.log(`Saved ${outFilename}: ${dims.width}x${dims.height}, ${buffer.length} bytes`);

    auditInventory.push({
      presetId: "6.7",
      variantPresetId: variant.presetId,
      exportPipeline: "browser-zip",
      filename: outFilename,
      filePath: outPath,
      width: dims.width,
      height: dims.height,
      sizeBytes: buffer.length,
      headline: variant.copy.headline,
      subheadline: variant.copy.subheadline,
      deviceModel: variant.deviceModel,
      deviceStyle: variant.visualComposition.deviceStyle,
      backgroundMode: variant.visualComposition.backgroundMode,
      backgroundColor: variant.visualComposition.backgroundColor,
    });
  }

  // B. Generate exports for each Apple preset (6.7, 6.5, 5.5, ipad)
  console.log("\n--- Testing Presets across Apple Sizes (6.7, 6.5, 5.5, ipad) ---");
  for (const presetId of presetsToTest) {
    // Test with bold-gradient or dark-contrast-3d to evaluate text and 3D device on each size
    const testVariant = variants.find((v) => v.presetId === "bold-gradient") || variants[0];
    const presetProject = variantsToProject([testVariant], {
      projectName: `Audit-Preset-${presetId}`,
      exportSizeId: presetId,
      imageResolver: () => demoDataUrl,
    });

    const exportPresetInfo = exportSizes.find((s) => s.id === presetId)!;

    const browserResult = await page.evaluate(async ({ project, targetSize, demoImg }) => {
      const exportFn = (window as any).__APPSHOTS_EXPORT__;
      project.screenshots[0].devices[0].screenshotSrc = demoImg;

      const renderedFiles = await exportFn({
        screenshots: project.screenshots,
        exportSize: targetSize,
        previewDimensions: { width: targetSize.width / 3, height: targetSize.height / 3 },
        headlineFontSize: project.headlineFontSize || 72,
        subheadlineFontSize: project.subheadlineFontSize || 38,
        skipDownload: true,
      });

      return {
        dataUrl: renderedFiles[0].data,
      };
    }, { project: presetProject, targetSize: exportPresetInfo, demoImg: demoDataUrl });

    const base64Data = browserResult.dataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const outFilename = `browser_bold-gradient_${presetId}.png`;
    const outPath = path.join(EVIDENCE_DIR, outFilename);
    fs.writeFileSync(outPath, buffer);

    const dims = verifyPngBytes(buffer);
    console.log(`Saved ${outFilename}: ${dims.width}x${dims.height}, ${buffer.length} bytes`);

    auditInventory.push({
      presetId,
      variantPresetId: testVariant.presetId,
      exportPipeline: "browser-zip",
      filename: outFilename,
      filePath: outPath,
      width: dims.width,
      height: dims.height,
      sizeBytes: buffer.length,
      headline: testVariant.copy.headline,
      subheadline: testVariant.copy.subheadline,
      deviceModel: testVariant.deviceModel,
      deviceStyle: testVariant.visualComposition.deviceStyle,
      backgroundMode: testVariant.visualComposition.backgroundMode,
      backgroundColor: testVariant.visualComposition.backgroundColor,
    });
  }

  // C. Generate MCP Headless Export for Parity Comparison (6.7 bold-gradient)
  console.log("\n--- Testing MCP Headless Export Parity (6.7 bold-gradient) ---");
  const mcpTestDir = path.join(EVIDENCE_DIR, "mcp_export_output");
  fs.mkdirSync(mcpTestDir, { recursive: true });

  const parityVariant = variants.find((v) => v.presetId === "bold-gradient") || variants[0];
  const parityProject = variantsToProject([parityVariant], {
    projectName: "Parity Test",
    exportSizeId: "6.7",
    imageResolver: () => demoDataUrl,
  });

  const mcpResult = await packageStoreExport(
    {
      projectName: "MCP Parity Test",
      project: parityProject as any,
      preset: "6.7",
      outputDir: mcpTestDir,
      archiveName: "mcp-parity-archive",
      appUrl: "http://127.0.0.1:5173/",
    },
    { allowedRoots: [mcpTestDir, EVIDENCE_DIR], allowedOutputRoots: [mcpTestDir] }
  );

  console.log("MCP Export archive created:", mcpResult.archivePath);
  const mcpZip = await JSZip.loadAsync(fs.readFileSync(mcpResult.archivePath));
  const mcpPngFile = mcpZip.file("appshots-export/screenshots/appstore-screenshot-1.png");
  if (mcpPngFile) {
    const mcpPngBuffer = await mcpPngFile.async("nodebuffer");
    const mcpOutFilename = "mcp_bold-gradient_6.7.png";
    const mcpOutPath = path.join(EVIDENCE_DIR, mcpOutFilename);
    fs.writeFileSync(mcpOutPath, mcpPngBuffer);
    const mcpDims = verifyPngBytes(mcpPngBuffer);
    console.log(`Saved ${mcpOutFilename}: ${mcpDims.width}x${mcpDims.height}, ${mcpPngBuffer.length} bytes`);

    auditInventory.push({
      presetId: "6.7",
      variantPresetId: parityVariant.presetId,
      exportPipeline: "mcp-headless",
      filename: mcpOutFilename,
      filePath: mcpOutPath,
      width: mcpDims.width,
      height: mcpDims.height,
      sizeBytes: mcpPngBuffer.length,
      headline: parityVariant.copy.headline,
      subheadline: parityVariant.copy.subheadline,
      deviceModel: parityVariant.deviceModel,
      deviceStyle: parityVariant.visualComposition.deviceStyle,
      backgroundMode: parityVariant.visualComposition.backgroundMode,
      backgroundColor: parityVariant.visualComposition.backgroundColor,
    });
  }

  // D. Build an HTML Contact Sheet and capture an image for side-by-side inspection
  console.log("\n--- Generating Visual Contact Sheet ---");
  const contactSheetHtml = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <title>AppShots Phase 4 Step 1: Visual Quality Audit Contact Sheet</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        background: #09090b;
        color: #f4f4f5;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      h1 {
        font-size: 28px;
        margin-bottom: 8px;
        font-weight: 700;
        color: #fafafa;
      }
      p.subtitle {
        color: #a1a1aa;
        margin-bottom: 32px;
        font-size: 14px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 24px;
      }
      .card {
        background: #18181b;
        border: 1px solid #27272a;
        border-radius: 12px;
        padding: 16px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .card-title {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 4px;
        color: #e4e4e7;
      }
      .card-meta {
        font-size: 12px;
        color: #71717a;
        margin-bottom: 12px;
      }
      .image-container {
        background: #000;
        border-radius: 8px;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 520px;
        border: 1px solid #3f3f46;
      }
      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
        display: block;
      }
      .badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        background: #27272a;
        color: #38bdf8;
        margin-right: 6px;
      }
    </style>
  </head>
  <body>
    <h1>AppShots Phase 4: Visual Quality Audit Contact Sheet</h1>
    <p class="subtitle">Generated from actual exported PNGs: variants, preset sizes, and export pipelines.</p>
    <div class="grid">
      ${auditInventory
        .map((item) => {
          const imgBase64 = fs.readFileSync(item.filePath).toString("base64");
          return `
          <div class="card">
            <div class="card-title">
              <span class="badge">${item.presetId}</span>
              ${item.variantPresetId}
            </div>
            <div class="card-meta">
              Pipeline: <b>${item.exportPipeline}</b> | ${item.width}x${item.height} | ${(item.sizeBytes / 1024).toFixed(0)} KB
            </div>
            <div class="image-container">
              <img src="data:image/png;base64,${imgBase64}" alt="${item.filename}" />
            </div>
          </div>
          `;
        })
        .join("")}
    </div>
  </body>
  </html>
  `;

  const contactSheetHtmlPath = path.join(EVIDENCE_DIR, "contact_sheet.html");
  fs.writeFileSync(contactSheetHtmlPath, contactSheetHtml);

  // Render contact sheet in browser and capture screenshot
  const contactSheetPage = await context.newPage();
  await contactSheetPage.setContent(contactSheetHtml, { waitUntil: "networkidle" });
  await contactSheetPage.setViewportSize({ width: 1920, height: 1600 });
  const contactSheetPngPath = path.join(EVIDENCE_DIR, "contact_sheet.png");
  await contactSheetPage.screenshot({ path: contactSheetPngPath, fullPage: true });

  console.log("Contact sheet saved to:", contactSheetPngPath);

  // Write inventory JSON
  const inventoryPath = path.join(EVIDENCE_DIR, "audit_inventory.json");
  fs.writeFileSync(inventoryPath, JSON.stringify(auditInventory, null, 2));

  await browser.close();
  console.log("Visual quality audit evidence generation finished successfully.");
}

runVisualQualityAudit().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
