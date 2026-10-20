import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const EVIDENCE_DIR = path.resolve(
  "C:/Users/fpii/.gemini/antigravity-ide/brain/cd3a18ad-9d86-4730-8b4d-721d5a4fb1cd/scratch/step7_visual_audit_evidence"
);

async function analyzeScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const files = [
    "browser_minimal-clean_6.7.png",
    "browser_bold-gradient_6.7.png",
    "browser_dark-contrast-3d_6.7.png",
    "browser_premium-editorial_6.7.png",
    "browser_bold-gradient_6.5.png",
    "browser_bold-gradient_5.5.png",
    "browser_bold-gradient_ipad.png",
    "mcp_bold-gradient_6.7.png",
  ];

  console.log("Analyzing", files.length, "exported PNGs...");

  const analysisReport: Record<string, any> = {};

  for (const filename of files) {
    const filePath = path.join(EVIDENCE_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.warn("File missing:", filename);
      continue;
    }

    const dataUrl = `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;

    const metrics = await page.evaluate(async (src) => {
      return new Promise<any>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);

          const w = canvas.width;
          const h = canvas.height;
          const imgData = ctx.getImageData(0, 0, w, h);
          const data = imgData.data;

          // Check corner pixel colors to detect background
          const topLeft = [data[0], data[1], data[2], data[3]];
          const topRight = [data[(w - 1) * 4], data[(w - 1) * 4 + 1], data[(w - 1) * 4 + 2], data[(w - 1) * 4 + 3]];
          const botLeft = [data[(h - 1) * w * 4], data[(h - 1) * w * 4 + 1], data[(h - 1) * w * 4 + 2], data[(h - 1) * w * 4 + 3]];
          const botRight = [data[((h - 1) * w + w - 1) * 4], data[((h - 1) * w + w - 1) * 4 + 1], data[((h - 1) * w + w - 1) * 4 + 2], data[((h - 1) * w + w - 1) * 4 + 3]];

          // Analyze Top Header Zone (top 25% of height) for text
          // Text is generally white or near-white (r,g,b > 230)
          let topZoneTextPixels = 0;
          let minTextY = h;
          let maxTextY = 0;
          let minTextX = w;
          let maxTextX = 0;

          // Analyze Mid/Bottom Zone (y from 25% to 100%) for device frame & screen
          let minDeviceY = h;
          let maxDeviceY = 0;
          let minDeviceX = w;
          let maxDeviceX = 0;

          const topBoundary = Math.floor(h * 0.28);

          for (let y = 0; y < topBoundary; y += 4) {
            for (let x = 0; x < w; x += 4) {
              const idx = (y * w + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              // High contrast text detection relative to top background
              const bgDiff = Math.abs(r - topLeft[0]) + Math.abs(g - topLeft[1]) + Math.abs(b - topLeft[2]);
              if (bgDiff > 80) {
                topZoneTextPixels++;
                if (y < minTextY) minTextY = y;
                if (y > maxTextY) maxTextY = y;
                if (x < minTextX) minTextX = x;
                if (x > maxTextX) maxTextX = x;
              }
            }
          }

          // Device bounds detection (from topBoundary downwards)
          for (let y = topBoundary; y < h; y += 6) {
            for (let x = 0; x < w; x += 6) {
              const idx = (y * w + x) * 4;
              const r = data[idx];
              const g = data[idx + 1];
              const b = data[idx + 2];
              // Compare against expected background at this row (linear gradient interpolation between top and bottom)
              const t = y / h;
              const expectedR = topLeft[0] * (1 - t) + botLeft[0] * t;
              const expectedG = topLeft[1] * (1 - t) + botLeft[1] * t;
              const expectedB = topLeft[2] * (1 - t) + botLeft[2] * t;
              const bgDiff = Math.abs(r - expectedR) + Math.abs(g - expectedG) + Math.abs(b - expectedB);
              if (bgDiff > 45) {
                if (y < minDeviceY) minDeviceY = y;
                if (y > maxDeviceY) maxDeviceY = y;
                if (x < minDeviceX) minDeviceX = x;
                if (x > maxDeviceX) maxDeviceX = x;
              }
            }
          }

          // Check margin clearance
          const textMarginLeft = minTextX;
          const textMarginRight = w - maxTextX;
          const textMarginTop = minTextY;
          const deviceMarginBottom = h - maxDeviceY;
          const deviceMarginLeft = minDeviceX;
          const deviceMarginRight = w - maxDeviceX;

          // Check for clipping at canvas edges (within 10px of border)
          const textClipped = minTextX < 15 || maxTextX > w - 15 || minTextY < 15;
          const deviceClippedBottom = maxDeviceY >= h - 2;
          const deviceClippedSides = minDeviceX < 10 || maxDeviceX > w - 10;

          resolve({
            width: w,
            height: h,
            aspectRatio: (w / h).toFixed(3),
            bgTopLeft: topLeft,
            bgBotRight: botRight,
            textRegion: {
              minX: minTextX,
              maxX: maxTextX,
              minY: minTextY,
              maxY: maxTextY,
              width: maxTextX - minTextX,
              height: maxTextY - minTextY,
              marginLeft: textMarginLeft,
              marginRight: textMarginRight,
              marginTop: textMarginTop,
              isClipped: textClipped,
            },
            deviceRegion: {
              minX: minDeviceX,
              maxX: maxDeviceX,
              minY: minDeviceY,
              maxY: maxDeviceY,
              width: maxDeviceX - minDeviceX,
              height: maxDeviceY - minDeviceY,
              marginLeft: deviceMarginLeft,
              marginRight: deviceMarginRight,
              marginBottom: deviceMarginBottom,
              clippedBottom: deviceClippedBottom,
              clippedSides: deviceClippedSides,
            },
          });
        };
        img.src = src;
      });
    }, dataUrl);

    analysisReport[filename] = metrics;
    console.log(`\n[${filename}] ${metrics.width}x${metrics.height} (aspect ${metrics.aspectRatio})`);
    console.log(`  Text: [${metrics.textRegion.minX}, ${metrics.textRegion.minY}] to [${metrics.textRegion.maxX}, ${metrics.textRegion.maxY}] | M-Left: ${metrics.textRegion.marginLeft}px, M-Right: ${metrics.textRegion.marginRight}px, M-Top: ${metrics.textRegion.marginTop}px | Clipped: ${metrics.textRegion.isClipped}`);
    console.log(`  Device: [${metrics.deviceRegion.minX}, ${metrics.deviceRegion.minY}] to [${metrics.deviceRegion.maxX}, ${metrics.deviceRegion.maxY}] | M-Bottom: ${metrics.deviceRegion.marginBottom}px, M-Sides: L=${metrics.deviceRegion.marginLeft}px / R=${metrics.deviceRegion.marginRight}px | ClippedBottom: ${metrics.deviceRegion.clippedBottom}`);
  }

  // Compare Parity: browser_bold-gradient_6.7.png vs mcp_bold-gradient_6.7.png
  console.log("\n--- Pixel Parity Comparison (Browser vs MCP) ---");
  const bPath = path.join(EVIDENCE_DIR, "browser_bold-gradient_6.7.png");
  const mPath = path.join(EVIDENCE_DIR, "mcp_bold-gradient_6.7.png");

  const bDataUrl = `data:image/png;base64,${fs.readFileSync(bPath).toString("base64")}`;
  const mDataUrl = `data:image/png;base64,${fs.readFileSync(mPath).toString("base64")}`;

  const parityReport = await page.evaluate(`
    (async () => {
      const bSrc = "${bDataUrl}";
      const mSrc = "${mDataUrl}";
      const loadImg = (url) =>
        new Promise((res) => {
          const i = new Image();
          i.onload = () => res(i);
          i.src = url;
        });

      const bImg = await loadImg(bSrc);
      const mImg = await loadImg(mSrc);

      const w = bImg.width;
      const h = bImg.height;

      const bCanvas = document.createElement("canvas");
      bCanvas.width = w;
      bCanvas.height = h;
      const bCtx = bCanvas.getContext("2d");
      bCtx.drawImage(bImg, 0, 0);
      const bData = bCtx.getImageData(0, 0, w, h).data;

      const mCanvas = document.createElement("canvas");
      mCanvas.width = w;
      mCanvas.height = h;
      const mCtx = mCanvas.getContext("2d");
      mCtx.drawImage(mImg, 0, 0);
      const mData = mCtx.getImageData(0, 0, w, h).data;

      const totalPixels = w * h;
      let identicalPixels = 0;
      let diffPixels = 0;
      let maxColorDiff = 0;
      let sumColorDiff = 0;

      for (let i = 0; i < bData.length; i += 4) {
        const dr = Math.abs(bData[i] - mData[i]);
        const dg = Math.abs(bData[i + 1] - mData[i + 1]);
        const db = Math.abs(bData[i + 2] - mData[i + 2]);
        const da = Math.abs(bData[i + 3] - mData[i + 3]);
        const totalDiff = dr + dg + db + da;

        if (totalDiff === 0) {
          identicalPixels++;
        } else {
          diffPixels++;
          if (totalDiff > maxColorDiff) maxColorDiff = totalDiff;
          sumColorDiff += totalDiff;
        }
      }

      const matchPercent = (identicalPixels / totalPixels) * 100;
      const avgDiffPerDiffPixel = diffPixels > 0 ? sumColorDiff / (diffPixels * 4) : 0;

      return {
        width: w,
        height: h,
        totalPixels,
        identicalPixels,
        diffPixels,
        matchPercent: matchPercent.toFixed(2),
        maxColorDiff,
        avgDiffPerDiffPixel: avgDiffPerDiffPixel.toFixed(2),
      };
    })()
  `);

  console.log("Parity result:", parityReport);
  analysisReport["parity_browser_vs_mcp"] = parityReport;

  fs.writeFileSync(path.join(EVIDENCE_DIR, "detailed_analysis.json"), JSON.stringify(analysisReport, null, 2));

  // Regenerate contact sheet with MCP image included
  const inventoryData = JSON.parse(fs.readFileSync(path.join(EVIDENCE_DIR, "audit_inventory.json"), "utf8"));
  // If mcp item wasn't added earlier, ensure it's in inventory
  if (!inventoryData.some((i: any) => i.exportPipeline === "mcp-headless")) {
    const mcpBuf = fs.readFileSync(path.join(EVIDENCE_DIR, "mcp_bold-gradient_6.7.png"));
    inventoryData.push({
      presetId: "6.7",
      variantPresetId: "bold-gradient",
      exportPipeline: "mcp-headless",
      filename: "mcp_bold-gradient_6.7.png",
      filePath: path.join(EVIDENCE_DIR, "mcp_bold-gradient_6.7.png"),
      width: 1284,
      height: 2778,
      sizeBytes: mcpBuf.length,
      headline: "Experience <b>powerful</b> live metrics",
      subheadline: "Supercharge your workflow with real-time speed and modern visual clarity.",
      deviceModel: "iphone-15-pro-max",
      deviceStyle: "3d",
      backgroundMode: "gradient",
      backgroundColor: "#ff7e5f",
    });
    fs.writeFileSync(path.join(EVIDENCE_DIR, "audit_inventory.json"), JSON.stringify(inventoryData, null, 2));
  }

  // Update contact_sheet.html and contact_sheet.png
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
      h1 { font-size: 26px; margin-bottom: 6px; font-weight: 700; color: #fafafa; }
      p.subtitle { color: #a1a1aa; margin-bottom: 28px; font-size: 13px; }
      .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
      .card { background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; }
      .card-title { font-size: 14px; font-weight: 600; margin-bottom: 4px; color: #e4e4e7; }
      .card-meta { font-size: 11px; color: #71717a; margin-bottom: 10px; }
      .image-container { background: #000; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; height: 460px; border: 1px solid #3f3f46; }
      img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
      .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #27272a; color: #38bdf8; margin-right: 6px; }
      .badge-mcp { background: #1e1b4b; color: #a855f7; }
    </style>
  </head>
  <body>
    <h1>AppShots Phase 4 Step 1: Visual Quality Audit Contact Sheet</h1>
    <p class="subtitle">Side-by-side visual inspection of actual exported PNG assets across 4 Studio variants, 4 Apple presets, and Browser vs MCP export pipelines.</p>
    <div class="grid">
      ${inventoryData
        .map((item: any) => {
          const imgBase64 = fs.readFileSync(item.filePath).toString("base64");
          const isMcp = item.exportPipeline === "mcp-headless";
          return `
          <div class="card">
            <div class="card-title">
              <span class="badge ${isMcp ? "badge-mcp" : ""}">${item.presetId}</span>
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

  fs.writeFileSync(path.join(EVIDENCE_DIR, "contact_sheet.html"), contactSheetHtml);
  await page.setContent(contactSheetHtml, { waitUntil: "networkidle" });
  await page.setViewportSize({ width: 1920, height: 1400 });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "contact_sheet.png"), fullPage: true });

  await browser.close();
  console.log("Analysis completed successfully.");
}

analyzeScreenshots().catch((err) => {
  console.error("Analysis failed:", err);
  process.exit(1);
});
