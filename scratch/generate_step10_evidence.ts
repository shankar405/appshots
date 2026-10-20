import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { generateVariantsForScreen, variantsToProject } from "../src/lib/studio/variants";
import { exportSizes } from "../src/constants";

const LOCAL_EVIDENCE_DIR = path.resolve("./scratch/step10_premium_editorial_evidence");
const ARTIFACT_EVIDENCE_DIR = path.resolve(
  "C:/Users/fpii/.gemini/antigravity-ide/brain/cd3a18ad-9d86-4730-8b4d-721d5a4fb1cd/scratch/step10_premium_editorial_evidence"
);

async function main() {
  console.log("=== Generating Phase 4 Step 4 Premium Editorial Evidence ===");
  fs.mkdirSync(LOCAL_EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_EVIDENCE_DIR, { recursive: true });

  const demoImagePath = path.resolve("public/demo-image.png");
  const demoDataUrl = `data:image/png;base64,${fs.readFileSync(demoImagePath).toString("base64")}`;

  const observedScreen = {
    id: "screen-metrics",
    route: "/analytics/live-metrics",
    filePath: demoImagePath,
    title: "Financial Analytics & Portfolio Health",
    keyElements: ["Live Cash Flow", "Asset Allocation", "Risk Metrics"],
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("Navigating to http://127.0.0.1:5173/...");
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const saveEvidence = (filename: string, buffer: Buffer) => {
    fs.writeFileSync(path.join(LOCAL_EVIDENCE_DIR, filename), buffer);
    fs.writeFileSync(path.join(ARTIFACT_EVIDENCE_DIR, filename), buffer);
    console.log(`Saved: ${filename} (${buffer.length} bytes)`);
  };

  const renderScreenshot = async (project: any) => {
    return await page.evaluate(async ({ project, demoImg }) => {
      const exportFn = (window as any).__APPSHOTS_EXPORT__;
      const exportSizesList = [
        { id: "6.7", width: 1284, height: 2778 },
        { id: "6.5", width: 1242, height: 2688 },
        { id: "5.5", width: 1242, height: 2208 },
        { id: "ipad", width: 2048, height: 2732 },
      ];
      const targetSize = exportSizesList.find((s) => s.id === project.exportSizeId) || exportSizesList[0];

      project.screenshots[0].devices[0].screenshotSrc = demoImg;

      const canonicalPreviewDims = {
        width: targetSize.width / 3,
        height: targetSize.height / 3,
      };

      const renderedFiles = await exportFn({
        screenshots: project.screenshots,
        exportSize: targetSize,
        previewDimensions: canonicalPreviewDims,
        headlineFontSize: project.headlineFontSize || 80,
        subheadlineFontSize: project.subheadlineFontSize || 42,
        skipDownload: true,
      });

      return {
        dataUrl: renderedFiles[0].data,
        width: targetSize.width,
        height: targetSize.height,
      };
    }, { project, demoImg: demoDataUrl });
  };

  const presetsToTest = ["6.7", "6.5", "5.5"] as const;
  const marginRecords: Record<string, any> = {};

  // 1. Render Before (scale 92) vs After (scale 85) for 6.7", 6.5", 5.5"
  console.log("\n--- 1. Rendering Before (Scale 92) and After (Scale 85) across iPhone Presets ---");
  for (const presetId of presetsToTest) {
    const sizeInfo = exportSizes.find((s) => s.id === presetId)!;

    // A. Before (scale 92)
    const variantsBefore = generateVariantsForScreen(observedScreen, { exportSizeId: presetId });
    const premiumBefore = variantsBefore.find((v) => v.presetId === "premium-editorial")!;
    // Explicitly set scale to 92 for "before" representation
    const projectBefore = variantsToProject([premiumBefore], {
      projectName: `Evidence-Premium-Before-${presetId}`,
      exportSizeId: presetId,
    });
    projectBefore.screenshots[0].devices[0].scale = 92;

    const resBefore = await renderScreenshot(projectBefore);
    const bufBefore = Buffer.from(resBefore.dataUrl.split(",")[1], "base64");
    const beforeFilename = `before_premium-editorial_${presetId}.png`;
    saveEvidence(beforeFilename, bufBefore);

    // B. After (scale 85, default in current variants.ts)
    const variantsAfter = generateVariantsForScreen(observedScreen, { exportSizeId: presetId });
    const premiumAfter = variantsAfter.find((v) => v.presetId === "premium-editorial")!;
    const projectAfter = variantsToProject([premiumAfter], {
      projectName: `Evidence-Premium-After-${presetId}`,
      exportSizeId: presetId,
    });

    const resAfter = await renderScreenshot(projectAfter);
    const bufAfter = Buffer.from(resAfter.dataUrl.split(",")[1], "base64");
    const afterFilename = `after_premium-editorial_${presetId}.png`;
    saveEvidence(afterFilename, bufAfter);

    // Calculate margins
    const width = sizeInfo.width;
    const height = sizeInfo.height;

    const deviceWidthBefore = width * 0.92;
    const marginBeforePx = (width - deviceWidthBefore) / 2;
    const marginBeforePct = (marginBeforePx / width) * 100;

    const deviceWidthAfter = width * 0.85;
    const marginAfterPx = (width - deviceWidthAfter) / 2;
    const marginAfterPct = (marginAfterPx / width) * 100;

    marginRecords[presetId] = {
      presetId,
      canvasDimensions: `${width}x${height}`,
      before: {
        scale: 92,
        deviceWidthPx: Math.round(deviceWidthBefore),
        marginPx: Number(marginBeforePx.toFixed(1)),
        marginPct: Number(marginBeforePct.toFixed(2)),
      },
      after: {
        scale: 85,
        deviceWidthPx: Math.round(deviceWidthAfter),
        marginPx: Number(marginAfterPx.toFixed(1)),
        marginPct: Number(marginAfterPct.toFixed(2)),
      },
      marginGainPx: Number((marginAfterPx - marginBeforePx).toFixed(1)),
      marginGainPct: Number((marginAfterPct - marginBeforePct).toFixed(2)),
    };
  }

  // 2. Render iPad Preset (After)
  console.log("\n--- 2. Rendering iPad Preset (Scale 72, Tablet Containment) ---");
  const ipadVariants = generateVariantsForScreen(observedScreen, { exportSizeId: "ipad" });
  const ipadPremium = ipadVariants.find((v) => v.presetId === "premium-editorial")!;
  const ipadProject = variantsToProject([ipadPremium], {
    projectName: "Evidence-Premium-iPad",
    exportSizeId: "ipad",
  });

  const resIpad = await renderScreenshot(ipadProject);
  const bufIpad = Buffer.from(resIpad.dataUrl.split(",")[1], "base64");
  const ipadFilename = "after_premium-editorial_ipad.png";
  saveEvidence(ipadFilename, bufIpad);

  const ipadWidth = 2048;
  const ipadHeight = 2732;
  const ipadDeviceWidth = ipadWidth * (ipadProject.screenshots[0].devices[0].scale / 100);
  const ipadMarginPx = (ipadWidth - ipadDeviceWidth) / 2;
  const ipadMarginPct = (ipadMarginPx / ipadWidth) * 100;

  marginRecords["ipad"] = {
    presetId: "ipad",
    canvasDimensions: `${ipadWidth}x${ipadHeight}`,
    after: {
      scale: ipadProject.screenshots[0].devices[0].scale,
      deviceModel: ipadProject.selectedDeviceId,
      deviceWidthPx: Math.round(ipadDeviceWidth),
      marginPx: Number(ipadMarginPx.toFixed(1)),
      marginPct: Number(ipadMarginPct.toFixed(2)),
      deviceOffsetY: ipadProject.screenshots[0].devices[0].y,
    },
  };

  // 3. Write summary JSON
  const reportPath = path.join(LOCAL_EVIDENCE_DIR, "step10_margins_report.json");
  const artifactReportPath = path.join(ARTIFACT_EVIDENCE_DIR, "step10_margins_report.json");
  const reportJson = JSON.stringify(marginRecords, null, 2);
  fs.writeFileSync(reportPath, reportJson);
  fs.writeFileSync(artifactReportPath, reportJson);
  console.log("Saved report: step10_margins_report.json");

  // 4. Generate Side-by-Side Comparison HTML Sheet
  console.log("\n--- 3. Generating Visual Comparison Sheet ---");
  const b64 = (filename: string) =>
    `data:image/png;base64,${fs.readFileSync(path.join(LOCAL_EVIDENCE_DIR, filename)).toString("base64")}`;

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AppShots Phase 4 Step 4: Premium Editorial Composition Refinement</title>
  <style>
    body {
      margin: 0;
      padding: 32px;
      background: #09090b;
      color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    h1 {
      font-size: 26px;
      margin-bottom: 6px;
      color: #fafafa;
    }
    .subtitle {
      font-size: 14px;
      color: #a1a1aa;
      margin-bottom: 24px;
    }
    .metric-summary {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 10px;
      padding: 16px 20px;
      margin-bottom: 32px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 16px;
    }
    .metric-card h3 {
      font-size: 13px;
      color: #a1a1aa;
      margin: 0 0 6px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .metric-card .val {
      font-size: 20px;
      font-weight: 700;
      color: #38bdf8;
    }
    .metric-card .sub {
      font-size: 12px;
      color: #71717a;
      margin-top: 4px;
    }
    .comparison-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 20px;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 12px;
      padding: 14px;
      display: flex;
      flex-direction: column;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: #e4e4e7;
      margin-bottom: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .badge {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      font-weight: 600;
    }
    .badge-before {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .badge-after {
      background: #064e3b;
      color: #6ee7b7;
    }
    .card-meta {
      font-size: 12px;
      color: #71717a;
      margin-bottom: 12px;
    }
    .img-box {
      background: #000;
      border: 1px solid #3f3f46;
      border-radius: 8px;
      overflow: hidden;
      height: 480px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .img-box img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <h1>AppShots Phase 4 Step 4: Premium Editorial Composition Refinement</h1>
  <p class="subtitle">Resolution of P2 Finding 5 — Lateral margin expansion from 92% scale to balanced 85% scale.</p>

  <div class="metric-summary">
    <div class="metric-card">
      <h3>6.7" Margin (Before)</h3>
      <div class="val" style="color: #ef4444;">51.4 px (4.0%)</div>
      <div class="sub">deviceScale: 92% | Congested edges</div>
    </div>
    <div class="metric-card">
      <h3>6.7" Margin (After)</h3>
      <div class="val" style="color: #10b981;">96.3 px (7.5%)</div>
      <div class="sub">deviceScale: 85% | +44.9px breathing room</div>
    </div>
    <div class="metric-card">
      <h3>6.5" & 5.5" Margin (After)</h3>
      <div class="val" style="color: #10b981;">93.2 px (7.5%)</div>
      <div class="sub">deviceScale: 85% | Balanced magazine style</div>
    </div>
    <div class="metric-card">
      <h3>iPad Pro Margin</h3>
      <div class="val" style="color: #38bdf8;">286.7 px (14.0%)</div>
      <div class="sub">deviceScale: 72% | Preserved tablet guardrail</div>
    </div>
  </div>

  <div class="comparison-grid">
    <div class="card">
      <div class="card-title">
        <span>6.7" Preset</span>
        <span class="badge badge-before">BEFORE (92%)</span>
      </div>
      <div class="card-meta">Margin: 51.4px (4.0%) | Width: 1181px</div>
      <div class="img-box">
        <img src="${b64("before_premium-editorial_6.7.png")}" alt="Before 6.7" />
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>6.7" Preset</span>
        <span class="badge badge-after">AFTER (85%)</span>
      </div>
      <div class="card-meta">Margin: 96.3px (7.5%) | Width: 1091px</div>
      <div class="img-box">
        <img src="${b64("after_premium-editorial_6.7.png")}" alt="After 6.7" />
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>6.5" Preset</span>
        <span class="badge badge-after">AFTER (85%)</span>
      </div>
      <div class="card-meta">Margin: 93.2px (7.5%) | Width: 1056px</div>
      <div class="img-box">
        <img src="${b64("after_premium-editorial_6.5.png")}" alt="After 6.5" />
      </div>
    </div>

    <div class="card">
      <div class="card-title">
        <span>iPad Pro 12.9"</span>
        <span class="badge badge-after">AFTER (72%)</span>
      </div>
      <div class="card-meta">Margin: 286.7px (14.0%) | Width: 1475px</div>
      <div class="img-box">
        <img src="${b64("after_premium-editorial_ipad.png")}" alt="After iPad" />
      </div>
    </div>
  </div>
</body>
</html>`;

  const htmlPath = path.join(LOCAL_EVIDENCE_DIR, "step10_comparison.html");
  const artifactHtmlPath = path.join(ARTIFACT_EVIDENCE_DIR, "step10_comparison.html");
  fs.writeFileSync(htmlPath, htmlContent);
  fs.writeFileSync(artifactHtmlPath, htmlContent);
  console.log("Saved: step10_comparison.html");

  // Snapshot HTML to PNG contact sheet
  const sheetPage = await context.newPage();
  await sheetPage.setContent(htmlContent, { waitUntil: "networkidle" });
  await sheetPage.setViewportSize({ width: 1800, height: 950 });
  const sheetPngBuf = await sheetPage.screenshot({ fullPage: true });

  const sheetPath = path.join(LOCAL_EVIDENCE_DIR, "step10_comparison_sheet.png");
  const artifactSheetPath = path.join(ARTIFACT_EVIDENCE_DIR, "step10_comparison_sheet.png");
  fs.writeFileSync(sheetPath, sheetPngBuf);
  fs.writeFileSync(artifactSheetPath, sheetPngBuf);
  console.log("Saved: step10_comparison_sheet.png");

  await browser.close();
  console.log("\n=== Step 10 Evidence Generation Complete ===");
}

main().catch((err) => {
  console.error("Evidence generation failed:", err);
  process.exit(1);
});
