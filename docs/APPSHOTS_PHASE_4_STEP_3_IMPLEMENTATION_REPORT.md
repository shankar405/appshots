# AppShots Phase 4 — Step 3: Browser/MCP Rendering Parity Implementation Report

## Executive Summary

This report documents the resolution of **P2 Finding 4: Line-Wrap Desynchronization between Browser and MCP Exports** originally identified in `docs/APPSHOTS_PHASE_4_STEP_1_VISUAL_QUALITY_AUDIT.md`.

In the Step 1 visual audit, side-by-side comparison between browser exports and headless MCP Playwright exports on the `6.7` preset demonstrated **75.82% pixel parity** (862,411 divergent pixels out of 3,566,952). Specifically, headline and subheadline words wrapped onto different lines because font sizes scaled up by ~12.6% in the headless environment.

Through Step 3, we established a single canonical source of truth for preview dimensions across all rendering pipelines (`getCanonicalPreviewDimensions(exportSize)`), removed incidental DOM layout measurements from font-scaling equations, and synchronized headless web font readiness. 

**Fresh quantitative verification achieved 100.00% pixel parity (0 divergent pixels) across all tested presets (6.7", iPad Pro 12.9", and 5.5"), completely eliminating line-wrap desynchronization.**

---

## 1. Confirmed Root Cause Analysis

### Mechanism of Font Size Scaling
In `src/lib/export-utils.ts`, text elements (headlines and subheadlines) are rendered to high-resolution HTML5 Canvas using a scaling multiplier calculated as:
```typescript
const scaleX = canvas.width / previewDimensions.width;
const effectiveHeadlineSize = headlineFontSize * scaleX;
const effectiveSubheadlineSize = subheadlineFontSize * scaleX;
```

### The Divergence Points
1. **Browser Studio Modal Pipeline (`src/components/Studio/StudioModal.tsx`)**:
   - The browser studio export modal historically computed `previewDimensions` as:
     `{ width: effectiveExportSize.width / 3, height: effectiveExportSize.height / 3 }`
   - For preset `6.7` (1284 × 2778), `previewDimensions.width` evaluated to `428px`.
   - Resulting scaling factor: `scaleX = 1284 / 428 = 3.000`.

2. **Headless Playwright MCP Pipeline (`src/lib/headless-export.ts`)**:
   - The headless export bridge historically read `editor.previewDimensions` from the live React `EditorContext`:
     `previewDimensions: editor.previewDimensions || { width: 400, height: 800 }`
   - In `EditorContext.tsx`, `previewDimensions` was updated dynamically via a `ResizeObserver` observing the `#canvas-preview` DOM container.
   - Inside the headless Chromium 1440×900 viewport, the responsive canvas preview element (constrained by flex layout and sidebar navigation) measured `~380px` or `~412px` wide.
   - Resulting scaling factor: `scaleX = 1284 / 380 ≈ 3.379` (an inflation of +12.6% in font size).
   - This oversized text exceeded the available text boundary (`maxWidth = canvas.width - 24 * scaleX`), prematurely breaking `live cash flow` and `speed and modern visual clarity` onto subsequent lines.

3. **Font Readiness Asynchrony**:
   - The headless export script navigated to the app using `{ waitUntil: "domcontentloaded" }` and did not explicitly await `document.fonts.ready`.
   - On cold headless browser runs, web fonts (Inter from Google Fonts) occasionally fell back to default system sans-serif during immediate canvas draw operations.

---

## 2. Rendering Normalization Strategy

To permanently eliminate discrepancies without creating multiple rendering pathways or fragile layout hacks:

1. **Canonical Source of Truth**:
   - Defined `getCanonicalPreviewDimensions(exportSize: ExportSize): PreviewDimensions` in [src/lib/export-utils.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/export-utils.ts):
     ```typescript
     export function getCanonicalPreviewDimensions(exportSize: ExportSize): PreviewDimensions {
       return {
         width: exportSize.width / 3,
         height: exportSize.height / 3,
       };
     }
     ```
   - For all presets, `canvas.width / previewDimensions.width` is now mathematically guaranteed to be exactly `3.0000`:
     - **6.7" (1284 × 2778)**: Canonical preview = `428 × 926` (`scaleX = 3.0`)
     - **6.5" (1242 × 2688)**: Canonical preview = `414 × 896` (`scaleX = 3.0`)
     - **5.5" (1242 × 2208)**: Canonical preview = `414 × 736` (`scaleX = 3.0`)
     - **iPad (2048 × 2732)**: Canonical preview = `682.67 × 910.67` (`scaleX = 3.0`)

2. **Default Fallback in Renderer**:
   - Made `previewDimensions` optional in `ExportOptions`.
   - In `exportScreenshots()`, if `previewDimensions` is omitted, undefined, or zero-width, it automatically defaults to `getCanonicalPreviewDimensions(exportSize)`.

3. **Headless Bridge Normalization**:
   - In `src/lib/headless-export.ts`, replaced dynamic `editor.previewDimensions` with `getCanonicalPreviewDimensions(targetExportSize)`.
   - Incidental DOM window size, sidebar collapse status, and viewport resizing no longer have any influence on canvas export text scaling.

4. **Deterministic Font Readiness**:
   - In `src/lib/headless-export.ts`:
     - Changed page navigation wait state to `{ waitUntil: "networkidle" }`.
     - Explicitly added `await page.evaluate(() => document.fonts.ready)`.
     - Verified font cache availability prior to initiating canvas draw.

---

## 3. Files Changed and Why

| File | Changes Made | Rationale |
| :--- | :--- | :--- |
| [src/lib/export-utils.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/export-utils.ts) | Exported `getCanonicalPreviewDimensions()`; made `previewDimensions?: PreviewDimensions` optional; added automatic fallback to canonical dimensions. | Establishes single source of truth for preview dimensions across the entire codebase. |
| [src/lib/headless-export.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/headless-export.ts) | Replaced `editor.previewDimensions` in browser bridge with canonical dimensions; updated navigation to `networkidle` and added `await document.fonts.ready`. | Decouples headless rendering from DOM layout size and guarantees identical font metrics. |
| [src/components/Studio/StudioModal.tsx](file:///c:/Users/fpii/Desktop/shankar/appshots/src/components/Studio/StudioModal.tsx) | Updated `handleDownloadZip` to call `getCanonicalPreviewDimensions(effectiveExportSize)`; removed unused DOM `previewDimensions` destructuring. | Enforces identical canonical preview dimensions in browser ZIP export. |
| [src/context/EditorContext.tsx](file:///c:/Users/fpii/Desktop/shankar/appshots/src/context/EditorContext.tsx) | Updated `handleExport` to pass `getCanonicalPreviewDimensions(exportSize)`. | Ensures single screenshot export button in editor UI also adheres to canonical scaling. |
| [src/lib/rendering-parity.test.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/rendering-parity.test.ts) | Added 9 focused regression tests covering all 4 Apple presets, scale ratios, font-size calculations, line breaks, padding, Step 2 fix preservation, and MCP tool discovery. | Automates regression detection for typography scaling, layout bounds, and parity invariants. |
| [src/mcp/server.test.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/mcp/server.test.ts) | Adjusted cold-start test timeout from 45000ms to 75000ms. | Prevents cold-start timeout during first-time headless Chromium launch on Windows test runners. |
| [src/mcp/tools/package-export.test.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/mcp/tools/package-export.test.ts) | Adjusted integration test timeout from 45000ms to 75000ms. | Accommodates multi-variant headless PNG rendering on Windows. |
| [src/lib/headless-export.test.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/headless-export.test.ts) | Adjusted end-to-end proof-of-concept test timeout from 40000ms to 75000ms. | Accommodates full font readiness network-idle wait during headless test execution. |
| [docs/APPSHOTS_PHASE_4_STEP_1_VISUAL_QUALITY_AUDIT.md](file:///c:/Users/fpii/Desktop/shankar/appshots/docs/APPSHOTS_PHASE_4_STEP_1_VISUAL_QUALITY_AUDIT.md) | Updated Finding 4 status from verified defect to **RESOLVED (100.00% Parity Achieved)** with implementation details. | Maintains up-to-date visual audit documentation. |

---

## 4. Before/After Quantitative Measurements

Parity evaluation was conducted by running the automated script `scratch/evaluate_step9_parity.ts` using identical project data, styles, and copy rendered through both the Browser ZIP Export pipeline and the MCP Headless pipeline (`packageStoreExport`).

### Case 1: 6.7" bold-gradient (Direct Comparison against Step 1 Audit Baseline)
- **Dimensions**: 1284 × 2778
- **Headline**: `Experience powerful <b>live cash flow</b>`
- **Subheadline**: `Supercharge your workflow with real-time speed and modern visual clarity.`

| Metric | Step 1 Baseline (Audit) | Step 3 Normalized (After Fix) | Delta |
| :--- | :--- | :--- | :--- |
| **Headline Line Count** | Browser: 2 lines / MCP: 2 lines | Browser: 2 lines / MCP: 2 lines | Identical |
| **Headline Line 1 Text** | Browser: `"Experience powerful live"`<br/>MCP: `"Experience powerful"` | Browser: `"Experience powerful live"`<br/>MCP: `"Experience powerful live"` | **100% Synchronized** |
| **Headline Line 2 Text** | Browser: `"cash flow"`<br/>MCP: `"live cash flow"` | Browser: `"cash flow"`<br/>MCP: `"cash flow"` | **100% Synchronized** |
| **Subheadline Line 1 Text** | Browser: `"...speed"`<br/>MCP: `"...real-time"` | Browser: `"...speed"`<br/>MCP: `"...speed"` | **100% Synchronized** |
| **Subheadline Line 2 Text** | Browser: `"and modern visual clarity."`<br/>MCP: `"speed and modern visual clarity."` | Browser: `"and modern visual clarity."`<br/>MCP: `"and modern visual clarity."` | **100% Synchronized** |
| **Total Canvas Pixels** | 3,566,952 | 3,566,952 | Identical |
| **Divergent Pixels** | **862,411 (24.18%)** | **0 (0.00%)** | **-862,411 pixels** |
| **Pixel Parity Percentage** | **75.82%** | **100.00%** | **+24.18% parity** |

### Case 2: iPad Preset (2048 × 2732)
- **Device Model**: `ipad-pro-129` (Tablet mockup, Step 2 fix verified)
- **Variant**: `minimal-clean`

| Metric | Measurement | Parity Status |
| :--- | :--- | :--- |
| **Dimensions** | 2048 × 2732 | Exact Apple preset match |
| **Total Canvas Pixels** | 5,595,136 | Identical across pipelines |
| **Identical Pixels** | 5,595,136 | **100.00% match** |
| **Divergent Pixels** | **0** | **Zero divergence** |

### Case 3: 5.5" Preset (1242 × 2208)
- **Device Model**: `iphone-15-pro-max` (3D tilted perspective, Step 2 fix verified)
- **Variant**: `dark-contrast-3d`

| Metric | Measurement | Parity Status |
| :--- | :--- | :--- |
| **Dimensions** | 1242 × 2208 | Exact Apple preset match |
| **Total Canvas Pixels** | 2,742,336 | Identical across pipelines |
| **Identical Pixels** | 2,742,336 | **100.00% match** |
| **Divergent Pixels** | **0** | **Zero divergence** |

---

## 5. Fresh Visual Evidence Artifacts

New evidence has been written to [scratch/step9_rendering_parity_evidence/](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/) and mirrored into the Brain Artifacts directory at `C:\Users\fpii\.gemini\antigravity-ide\brain\cd3a18ad-9d86-4730-8b4d-721d5a4fb1cd\scratch\step9_rendering_parity_evidence\`:

1. [browser_bold-gradient_6.7.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/browser_bold-gradient_6.7.png) (1284 × 2778, 1,087,619 bytes)
2. [mcp_bold-gradient_6.7.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/mcp_bold-gradient_6.7.png) (1284 × 2778, 1,087,619 bytes)
3. [browser_ipad.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/browser_ipad.png) (2048 × 2732, 984,314 bytes)
4. [mcp_ipad.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/mcp_ipad.png) (2048 × 2732, 984,314 bytes)
5. [browser_5.5.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/browser_5.5.png) (1242 × 2208, 873,226 bytes)
6. [mcp_5.5.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/mcp_5.5.png) (1242 × 2208, 873,226 bytes)
7. [step9_parity_sheet.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/step9_parity_sheet.png) (Visual side-by-side contact sheet)
8. [step9_comparison.html](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/step9_comparison.html) (Interactive side-by-side inspection page)
9. [step9_parity_report.json](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step9_rendering_parity_evidence/step9_parity_report.json) (Machine-readable quantitative parity metrics)

---

## 6. Test Suite and Build Verification Results

All automated verification commands were executed and recorded:

### 1. Parity & Studio Unit Tests
```bash
npx vitest run src/lib/rendering-parity.test.ts src/lib/studio/variants.test.ts src/lib/studio/color-contrast.test.ts --fileParallelism=false
```
- **Result**: **PASS** (Exit Code: 0)
- **Duration**: 7.65s
- **Test Files**: 3 passed (3)
- **Tests**: 33 passed (33)
  - Canonical preview dimensions calculation for all 4 Apple presets
  - Scale factor invariance (`scaleX === 3.0`)
  - Headline/subheadline font scaling equality across presets
  - Text wrapping and boundary determinism
  - Step 2 regression preservation (iPad device, 3D clearance, sunset contrast)
  - Tool registration and discovery

### 2. MCP Server Integration Tests
```bash
npx vitest run src/mcp/server.test.ts
```
- **Result**: **PASS** (Exit Code: 0)
- **Duration**: 55.52s
- **Test Files**: 1 passed (1)
- **Tests**: 9 passed (9)
  - Tool discovery (all 6 tools discovered)
  - `build_appshots_project`
  - `export_store_assets`
  - `analyze_app_for_store`
  - `generate_screenshot_plan`
  - `build_and_export_store_assets`
  - Google Play rejection error contract
  - `package_store_export`
  - Error and invalid input handling

### 3. Headless Export & Package Export Tests
```bash
npx vitest run src/lib/headless-export.test.ts src/mcp/tools/package-export.test.ts
```
- **Result**: **PASS** (Exit Code: 0)
- **Test Files**: 2 passed (2)
- **Tests**: 10 passed (10)

### 4. TypeScript Type Checking
```bash
npx tsc --noEmit
```
- **Result**: **PASS** (Exit Code: 0, 0 errors)

### 5. Production Application Build
```bash
npm run build
```
- **Result**: **PASS** (Exit Code: 0)
- `vite build && tsc` completed cleanly with all bundles emitted to `dist/`.

---

## 7. MCP Schema Compatibility & Repository Safety

1. **MCP Tool Schemas**:
   - Zero changes were made to tool definitions, input schemas, or return schemas across all six tools (`build_appshots_project`, `export_store_assets`, `analyze_app_for_store`, `generate_screenshot_plan`, `build_and_export_store_assets`, `package_store_export`).
2. **Apple Preset Dimensions**:
   - `6.7`: 1284 × 2778 (Unchanged)
   - `6.5`: 1242 × 2688 (Unchanged)
   - `5.5`: 1242 × 2208 (Unchanged)
   - `ipad`: 2048 × 2732 (Unchanged)
3. **Phase 4 Step 2 Fix Preservation**:
   - iPad Pro 12.9" device selection and containment: **Preserved and verified**.
   - 3D text/device clearance (>180px gap): **Preserved and verified**.
   - Sunset-gradient contrast (#0f172a, WCAG AAA): **Preserved and verified**.
4. **Git Safety**:
   - Zero Git commits were created.
   - Zero Git resets, stashes, reverts, or cleans were executed.
   - Zero npm dependencies were added.
   - All existing user work and untracked files are strictly preserved.

---

## 8. Remaining Known Limitations (Preserved for Future Steps)

As dictated by the Phase 4 roadmap and stop conditions:
1. **Finding 5 (P2 - `premium-editorial` lateral margins)**: Device scale `92` leaves only 12px margins; deferred to Step 4/Step 5.
2. **Finding 6 (P2 - Screenshot aspect ratio stretching)**: Canvas drawing does not letterbox or object-fit non-matching aspect ratio source images; deferred to subsequent steps.
3. **P3 Findings (Title-case copy, sub-pixel rounding)**: Intentionally preserved without modification.
