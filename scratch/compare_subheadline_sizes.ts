import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { exportSizes } from "../src/constants";

interface TextAnalysisResult {
  presetId: string;
  copyType: "short" | "medium" | "long";
  subheadlineSize: number;
  subheadlineText: string;
  maxWidth: number;
  lineCount: number;
  lines: string[];
  lineWidths: number[];
  textBlockHeight: number;
  subheadlineTopY: number;
  subheadlineBottomY: number;
  headlineBottomY: number;
  gapBetweenHeadlines: number;
  deviceTopY: number;
  clearanceToDevice: number;
}

const copySamples = {
  short: "Intuitive access designed for daily speed.",
  medium: "Intuitive, clutter-free access designed for effortless daily performance.",
  long: "Intuitive, clutter-free access designed for effortless daily performance across all your projects, workflows, and team devices without compromise.",
};

const subheadlineSizes = [38, 42, 44];

async function main() {
  console.log("=== Evaluating Subheadline Sizes (38px, 42px, 44px) ===");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript("window.__name = window.__name || function(target) { return target; };");
  const page = await context.newPage();

  // Load a blank HTML page with Inter font loaded from Google Fonts / system
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
      </head>
      <body>
        <canvas id="testCanvas" width="3000" height="3000"></canvas>
      </body>
    </html>
  `);

  await page.evaluate(() => document.fonts.ready);

  const results: TextAnalysisResult[] = await page.evaluate(
    ({ copySamples, subheadlineSizes, exportSizes }) => {
      var __name: any = (target: any) => target;
      void __name;

      const canvas = document.getElementById("testCanvas") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;

      function measureAndWrap(text: string, fontSize: number, maxWidth: number, fontWeight = 600) {
        ctx.font = `${fontWeight} ${fontSize}px 'Inter', sans-serif`;
        const words = text.split(" ");
        const lines: string[] = [];
        let currentLine = "";

        for (const word of words) {
          const testLine = currentLine ? `${currentLine} ${word}` : word;
          const width = ctx.measureText(testLine).width;
          if (width <= maxWidth || !currentLine) {
            currentLine = testLine;
          } else {
            lines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) {
          lines.push(currentLine);
        }

        const lineWidths = lines.map((l) => ctx.measureText(l).width);
        return { lines, lineWidths };
      }

      const out: any[] = [];
      const presetsToTest = ["6.7", "6.5", "5.5", "ipad"];

      for (const presetId of presetsToTest) {
        const sizeInfo = exportSizes.find((s: any) => s.id === presetId)!;
        const canvasW = sizeInfo.width;
        const canvasH = sizeInfo.height;

        const paddingX = 24;
        const headlineWidth = 80;
        const subheadlineWidth = 80;
        const headlineMaxWidth = canvasW * (headlineWidth / 100) - paddingX;
        const subheadlineMaxWidth = canvasW * (subheadlineWidth / 100) - paddingX;

        // Headline metrics
        const headlineText = "Simplify your Workflow";
        const headlineFontSize = presetId === "ipad" ? 76 : 72;
        const headlineY = canvasH * 0.10; // 10%
        const headlineWrap = measureAndWrap(headlineText, headlineFontSize, headlineMaxWidth, 700);
        const headlineHeight = headlineWrap.lines.length * headlineFontSize * 1.1;
        const headlineBottomY = headlineY + headlineHeight;

        // Subheadline Y & Device Y
        const subheadlineTopY = canvasH * 0.18; // 18%
        const deviceOffsetY = presetId === "ipad" ? 24 : 35; // 35% on phones, 24% on iPad
        const deviceTopY = canvasH * (deviceOffsetY / 100);

        for (const [copyType, copyText] of Object.entries(copySamples)) {
          for (const size of subheadlineSizes) {
            const wrap = measureAndWrap(copyText, size, subheadlineMaxWidth, 600);
            const textBlockHeight = wrap.lines.length * size * 1.1;
            const subheadlineBottomY = subheadlineTopY + textBlockHeight;
            const gapBetweenHeadlines = subheadlineTopY - headlineBottomY;
            const clearanceToDevice = deviceTopY - subheadlineBottomY;

            out.push({
              presetId,
              copyType,
              subheadlineSize: size,
              subheadlineText: copyText,
              maxWidth: subheadlineMaxWidth,
              lineCount: wrap.lines.length,
              lines: wrap.lines,
              lineWidths: wrap.lineWidths,
              textBlockHeight,
              subheadlineTopY,
              subheadlineBottomY,
              headlineBottomY,
              gapBetweenHeadlines,
              deviceTopY,
              clearanceToDevice,
            });
          }
        }
      }

      return out;
    },
    { copySamples, subheadlineSizes, exportSizes },
  );

  await browser.close();

  // Print results table
  console.log("\n--- Comparison Results ---");
  for (const presetId of ["6.7", "6.5", "5.5", "ipad"]) {
    console.log(`\n=== Preset: ${presetId} ===`);
    for (const copyType of ["short", "medium", "long"] as const) {
      console.log(`  [Copy: ${copyType}] ("${copySamples[copyType].slice(0, 35)}...")`);
      for (const size of subheadlineSizes) {
        const item = results.find(
          (r) => r.presetId === presetId && r.copyType === copyType && r.subheadlineSize === size,
        )!;
        console.log(
          `    - ${size}px: lines=${item.lineCount}, height=${item.textBlockHeight.toFixed(
            1,
          )}px, clearance=${item.clearanceToDevice.toFixed(1)}px | Lines: [${item.lines
            .map((l) => `"${l}"`)
            .join(" / ")}]`,
        );
      }
    }
  }

  const outPath = path.resolve("./scratch/subheadline_comparison_results.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved comparison data to: ${outPath}`);
}

main().catch(console.error);
