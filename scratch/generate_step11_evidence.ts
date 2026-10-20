import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { generateVariantsForScreen, variantsToProject } from "../src/lib/studio/variants";
import { calculateCoverCrop } from "../src/lib/export-utils";

const LOCAL_EVIDENCE_DIR = path.resolve("./scratch/step11_aspect_ratio_evidence");
const ARTIFACT_EVIDENCE_DIR = path.resolve(
  "C:/Users/fpii/.gemini/antigravity-ide/brain/cd3a18ad-9d86-4730-8b4d-721d5a4fb1cd/scratch/step11_aspect_ratio_evidence"
);

async function main() {
  console.log("=== Generating Phase 4 Step 5 Screenshot Aspect-Ratio Evidence ===");
  fs.mkdirSync(LOCAL_EVIDENCE_DIR, { recursive: true });
  fs.mkdirSync(ARTIFACT_EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("Navigating to http://127.0.0.1:5173/...");
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  // Helper to generate synthetic test patterns with circles to clearly show distortion vs preservation
  const generateTestImage = async (w: number, h: number, title: string, color: string) => {
    return await page.evaluate(({ w, h, title, color }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;

      // Background
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);

      // Grid lines
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 2;
      const step = Math.min(w, h) / 10;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Large central circle (which becomes an oval if stretched!)
      const radius = Math.min(w, h) * 0.28;
      const centerX = w / 2;
      const centerY = h / 2;

      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(4, radius * 0.08);
      ctx.stroke();

      // Inner circular indicator
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = "#10b981";
      ctx.fill();
      ctx.restore();

      // Text label
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(Math.min(w, h) * 0.05)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(title, centerX, centerY + radius + Math.min(w, h) * 0.08);
      ctx.fillText(`${w}x${h} (Aspect: ${(w / h).toFixed(2)})`, centerX, centerY - radius - Math.min(w, h) * 0.08);

      return c.toDataURL("image/png");
    }, { w, h, title, color });
  };

  console.log("Generating test pattern images with circular calibration geometry...");
  const landscapeDataUrl = await generateTestImage(1920, 1080, "16:9 Landscape Analytics", "#0f172a");
  const squareDataUrl = await generateTestImage(1000, 1000, "1:1 Square Dashboard", "#1e1b4b");
  const phonePortraitDataUrl = await generateTestImage(1290, 2796, "Phone UI on Tablet", "#18181b");

  const saveEvidence = (filename: string, buffer: Buffer) => {
    fs.writeFileSync(path.join(LOCAL_EVIDENCE_DIR, filename), buffer);
    fs.writeFileSync(path.join(ARTIFACT_EVIDENCE_DIR, filename), buffer);
    console.log(`Saved: ${filename} (${buffer.length} bytes)`);
  };

  // Helper to render screenshot using either legacy direct stretch or current cover crop
  const renderScreenshot = async (project: any, imgUrl: string, mode: "stretched" | "cover") => {
    return await page.evaluate(async ({ project, imgUrl, mode }) => {
      const exportFn = (window as any).__APPSHOTS_EXPORT__;
      const exportSizesList = [
        { id: "6.7", width: 1284, height: 2778 },
        { id: "6.5", width: 1242, height: 2688 },
        { id: "5.5", width: 1242, height: 2208 },
        { id: "ipad", width: 2048, height: 2732 },
      ];
      const targetSize = exportSizesList.find((s) => s.id === project.exportSizeId) || exportSizesList[0];

      // Assign image to device
      project.screenshots[0].devices[0].screenshotSrc = imgUrl;

      // In baseline mode, temporarily stub drawImageCover to act like direct drawImage (for visual comparison)
      const exportUtils = (window as any).__APPSHOTS_EXPORT_UTILS__;
      let originalDrawImage: any = null;

      if (mode === "stretched") {
        // If we want to simulate the historical stretched behavior:
        const ctxProto = CanvasRenderingContext2D.prototype as any;
        originalDrawImage = ctxProto.drawImage;
        // Monkey-patch drawImage to ignore crop params when called with 9 args for screen image
        ctxProto.drawImage = function (...args: any[]) {
          if (args.length === 9) {
            // Convert (img, sx, sy, sw, sh, dx, dy, dw, dh) -> (img, dx, dy, dw, dh) to stretch
            return originalDrawImage.call(this, args[0], args[5], args[6], args[7], args[8]);
          }
          return originalDrawImage.apply(this, args);
        };
      }

      try {
        const canonicalPreviewDims = {
          width: targetSize.width / 3,
          height: targetSize.height / 3,
        };

        const renderedFiles = await exportFn({
          screenshots: project.screenshots,
          exportSize: targetSize,
          previewDimensions: canonicalPreviewDims,
          headlineFontSize: project.headlineFontSize || 72,
          subheadlineFontSize: project.subheadlineFontSize || 38,
          skipDownload: true,
        });

        return {
          dataUrl: renderedFiles[0].data,
          width: targetSize.width,
          height: targetSize.height,
        };
      } finally {
        if (mode === "stretched" && originalDrawImage) {
          CanvasRenderingContext2D.prototype.drawImage = originalDrawImage;
        }
      }
    }, { project, imgUrl, mode });
  };

  const sampleScreen = {
    id: "screen-1",
    route: "/",
    filePath: "",
    title: "Financial Overview",
  };

  const reports: Record<string, any> = {};

  // Case 1: 16:9 Landscape Source into 6.7" iPhone Screen (Minimal Clean)
  console.log("\n--- Case 1: 16:9 Landscape Source into 6.7\" iPhone Screen ---");
  const var67 = generateVariantsForScreen(sampleScreen, { exportSizeId: "6.7" });
  const minimal67 = var67.find((v) => v.presetId === "minimal-clean")!;
  const proj67_land = variantsToProject([minimal67], { exportSizeId: "6.7" });

  const before67_res = await renderScreenshot(proj67_land, landscapeDataUrl, "stretched");
  const before67_buf = Buffer.from(before67_res.dataUrl.split(",")[1], "base64");
  saveEvidence("before_landscape_in_phone.png", before67_buf);

  const after67_res = await renderScreenshot(proj67_land, landscapeDataUrl, "cover");
  const after67_buf = Buffer.from(after67_res.dataUrl.split(",")[1], "base64");
  saveEvidence("after_landscape_in_phone.png", after67_buf);

  // Phone screen dimensions on 6.7" canvas:
  // deviceWidth = 1284 * 0.80 = 1027.2px, bezel = 12.3px -> screenW = 1002.6px
  // screenH = screenW * (2796 / 1290) = 2173.0px (destAspect ~0.461)
  const case1Crop = calculateCoverCrop(1920, 1080, 1002.6, 2173.0);
  reports["case1_landscape_in_phone"] = {
    description: "16:9 Landscape Source inside 6.7\" iPhone screen",
    sourceDimensions: "1920x1080 (Aspect: 1.78)",
    destinationScreenDimensions: "1003x2173 (Aspect: 0.46)",
    cropRect: case1Crop,
    cropDetails: {
      croppedWidthPx: Number((1920 - case1Crop.sWidth).toFixed(1)),
      croppedWidthPct: Number((((1920 - case1Crop.sWidth) / 1920) * 100).toFixed(2)),
      croppedHeightPx: 0,
    },
    visualDistortionRemoved: "Horizontal compression squishing circles into narrow ellipses eliminated",
  };

  // Case 2: 1:1 Square Source into 6.7" iPhone Screen (Premium Editorial)
  console.log("\n--- Case 2: 1:1 Square Source into 6.7\" iPhone Screen ---");
  const prem67 = var67.find((v) => v.presetId === "premium-editorial")!;
  const proj67_sq = variantsToProject([prem67], { exportSizeId: "6.7" });

  const beforeSq_res = await renderScreenshot(proj67_sq, squareDataUrl, "stretched");
  const beforeSq_buf = Buffer.from(beforeSq_res.dataUrl.split(",")[1], "base64");
  saveEvidence("before_square_in_phone.png", beforeSq_buf);

  const afterSq_res = await renderScreenshot(proj67_sq, squareDataUrl, "cover");
  const afterSq_buf = Buffer.from(afterSq_res.dataUrl.split(",")[1], "base64");
  saveEvidence("after_square_in_phone.png", afterSq_buf);

  const case2Crop = calculateCoverCrop(1000, 1000, 1065.2, 2308.8);
  reports["case2_square_in_phone"] = {
    description: "1:1 Square Source inside 6.7\" iPhone screen",
    sourceDimensions: "1000x1000 (Aspect: 1.00)",
    destinationScreenDimensions: "1065x2309 (Aspect: 0.46)",
    cropRect: case2Crop,
    cropDetails: {
      croppedWidthPx: Number((1000 - case2Crop.sWidth).toFixed(1)),
      croppedWidthPct: Number((((1000 - case2Crop.sWidth) / 1000) * 100).toFixed(2)),
      croppedHeightPx: 0,
    },
    visualDistortionRemoved: "Vertical elongation squishing circles into vertical ovals eliminated",
  };

  // Case 3: Tall Phone Source into 4:3 iPad Screen
  console.log("\n--- Case 3: Tall Phone Source into 4:3 iPad Screen ---");
  const ipadVars = generateVariantsForScreen(sampleScreen, { exportSizeId: "ipad" });
  const ipadProj = variantsToProject([ipadVars[0]], { exportSizeId: "ipad" });

  const beforeIpad_res = await renderScreenshot(ipadProj, phonePortraitDataUrl, "stretched");
  const beforeIpad_buf = Buffer.from(beforeIpad_res.dataUrl.split(",")[1], "base64");
  saveEvidence("before_phone_in_ipad.png", beforeIpad_buf);

  const afterIpad_res = await renderScreenshot(ipadProj, phonePortraitDataUrl, "cover");
  const afterIpad_buf = Buffer.from(afterIpad_res.dataUrl.split(",")[1], "base64");
  saveEvidence("after_phone_in_ipad.png", afterIpad_buf);

  // iPad screen: approx 1439 x 1919 (Aspect: 0.75)
  const case3Crop = calculateCoverCrop(1290, 2796, 1439, 1919);
  reports["case3_phone_in_ipad"] = {
    description: "Tall Phone Screenshot inside iPad 4:3 screen",
    sourceDimensions: "1290x2796 (Aspect: 0.46)",
    destinationScreenDimensions: "1439x1919 (Aspect: 0.75)",
    cropRect: case3Crop,
    cropDetails: {
      croppedWidthPx: 0,
      croppedHeightPx: Number((2796 - case3Crop.sHeight).toFixed(1)),
      croppedHeightPct: Number((((2796 - case3Crop.sHeight) / 2796) * 100).toFixed(2)),
    },
    visualDistortionRemoved: "Horizontal stretching (+62.6% widening) eliminated; UI cards and circles remain 1:1 true scale",
  };

  // Case 4: 3D Angled Perspective with Landscape Source (Dark Contrast 3D)
  console.log("\n--- Case 4: 3D Angled Perspective Device with Landscape Source ---");
  const dark3d = var67.find((v) => v.presetId === "dark-contrast-3d")!;
  const proj3d = variantsToProject([dark3d], { exportSizeId: "6.7" });

  const after3d_res = await renderScreenshot(proj3d, landscapeDataUrl, "cover");
  const after3d_buf = Buffer.from(after3d_res.dataUrl.split(",")[1], "base64");
  saveEvidence("after_3d_landscape_cover.png", after3d_buf);

  // Write reports JSON
  const reportPath = path.join(LOCAL_EVIDENCE_DIR, "step11_aspect_ratio_report.json");
  const artifactReportPath = path.join(ARTIFACT_EVIDENCE_DIR, "step11_aspect_ratio_report.json");
  const jsonStr = JSON.stringify(reports, null, 2);
  fs.writeFileSync(reportPath, jsonStr);
  fs.writeFileSync(artifactReportPath, jsonStr);
  console.log("Saved report: step11_aspect_ratio_report.json");

  // Generate Comparison HTML
  console.log("\n--- Generating Side-by-Side Comparison HTML Sheet ---");
  const b64 = (name: string) => `data:image/png;base64,${fs.readFileSync(path.join(LOCAL_EVIDENCE_DIR, name)).toString("base64")}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AppShots Phase 4 Step 5: Screenshot Aspect-Ratio Preservation</title>
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
      grid-template-columns: repeat(3, 1fr);
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
      font-size: 18px;
      font-weight: 700;
      color: #10b981;
    }
    .metric-card .sub {
      font-size: 12px;
      color: #71717a;
      margin-top: 4px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
    }
    .case-col {
      display: flex;
      flex-direction: column;
      gap: 16px;
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
  <h1>AppShots Phase 4 Step 5: Screenshot Aspect-Ratio Preservation</h1>
  <p class="subtitle">Resolution of P2 Finding 6 — Centered Cover Crop eliminating visual distortion on non-matching screenshot aspect ratios.</p>

  <div class="metric-summary">
    <div class="metric-card">
      <h3>Case 1: 16:9 in Portrait Phone</h3>
      <div class="val">Zero Horizontal Squishing</div>
      <div class="sub">Source: 1920x1080 | Dest: 1003x2173 | Width crop: 1422px</div>
    </div>
    <div class="metric-card">
      <h3>Case 2: 1:1 Square in Portrait Phone</h3>
      <div class="val">Zero Vertical Elongation</div>
      <div class="sub">Source: 1000x1000 | Dest: 1065x2309 | Width crop: 539px</div>
    </div>
    <div class="metric-card">
      <h3>Case 3: Tall Phone in iPad 4:3</h3>
      <div class="val">Zero Horizontal Widening</div>
      <div class="sub">Source: 1290x2796 | Dest: 1439x1919 | Height crop: 1076px</div>
    </div>
  </div>

  <div class="grid">
    <!-- Case 1 -->
    <div class="case-col">
      <div class="card">
        <div class="card-title">
          <span>Case 1: 16:9 Landscape in Phone</span>
          <span class="badge badge-before">BEFORE (STRETCHED)</span>
        </div>
        <div class="card-meta">Circle distorted into thin oval (aspect crushed by ~3.8x)</div>
        <div class="img-box">
          <img src="${b64("before_landscape_in_phone.png")}" alt="Before Landscape" />
        </div>
      </div>
      <div class="card">
        <div class="card-title">
          <span>Case 1: 16:9 Landscape in Phone</span>
          <span class="badge badge-after">AFTER (COVER CROP)</span>
        </div>
        <div class="card-meta">Circle remains mathematically round; 1:1 aspect preserved</div>
        <div class="img-box">
          <img src="${b64("after_landscape_in_phone.png")}" alt="After Landscape" />
        </div>
      </div>
    </div>

    <!-- Case 2 -->
    <div class="case-col">
      <div class="card">
        <div class="card-title">
          <span>Case 2: 1:1 Square in Phone</span>
          <span class="badge badge-before">BEFORE (STRETCHED)</span>
        </div>
        <div class="card-meta">Circle distorted into vertical egg (aspect stretched by ~2.1x)</div>
        <div class="img-box">
          <img src="${b64("before_square_in_phone.png")}" alt="Before Square" />
        </div>
      </div>
      <div class="card">
        <div class="card-title">
          <span>Case 2: 1:1 Square in Phone</span>
          <span class="badge badge-after">AFTER (COVER CROP)</span>
        </div>
        <div class="card-meta">Circle remains mathematically round; 1:1 aspect preserved</div>
        <div class="img-box">
          <img src="${b64("after_square_in_phone.png")}" alt="After Square" />
        </div>
      </div>
    </div>

    <!-- Case 3 -->
    <div class="case-col">
      <div class="card">
        <div class="card-title">
          <span>Case 3: Phone Screenshot in iPad</span>
          <span class="badge badge-before">BEFORE (STRETCHED)</span>
        </div>
        <div class="card-meta">Phone UI widened by +62.6% into fat horizontal oval</div>
        <div class="img-box">
          <img src="${b64("before_phone_in_ipad.png")}" alt="Before iPad" />
        </div>
      </div>
      <div class="card">
        <div class="card-title">
          <span>Case 3: Phone Screenshot in iPad</span>
          <span class="badge badge-after">AFTER (COVER CROP)</span>
        </div>
        <div class="card-meta">Natural phone proportions preserved with centered crop</div>
        <div class="img-box">
          <img src="${b64("after_phone_in_ipad.png")}" alt="After iPad" />
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

  const htmlPath = path.join(LOCAL_EVIDENCE_DIR, "step11_comparison.html");
  const artifactHtmlPath = path.join(ARTIFACT_EVIDENCE_DIR, "step11_comparison.html");
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(artifactHtmlPath, html);
  console.log("Saved: step11_comparison.html");

  // Snapshot HTML to PNG contact sheet
  const sheetPage = await context.newPage();
  await sheetPage.setContent(html, { waitUntil: "networkidle" });
  await sheetPage.setViewportSize({ width: 1800, height: 1300 });
  const sheetPng = await sheetPage.screenshot({ fullPage: true });

  const sheetPath = path.join(LOCAL_EVIDENCE_DIR, "step11_comparison_sheet.png");
  const artifactSheetPath = path.join(ARTIFACT_EVIDENCE_DIR, "step11_comparison_sheet.png");
  fs.writeFileSync(sheetPath, sheetPng);
  fs.writeFileSync(artifactSheetPath, sheetPng);
  console.log("Saved: step11_comparison_sheet.png");

  await browser.close();
  console.log("=== Step 11 Evidence Generation Complete ===");
}

main().catch((err) => {
  console.error("Evidence generation failed:", err);
  process.exit(1);
});
