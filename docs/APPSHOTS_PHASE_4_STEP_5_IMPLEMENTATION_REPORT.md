# AppShots Phase 4 — Step 5: Screenshot Aspect-Ratio Preservation Implementation Report

## Executive Summary

This report documents the resolution of **P2 Finding 6: Unconstrained Image Aspect Ratio inside Device Screens** identified in `docs/APPSHOTS_PHASE_4_STEP_1_VISUAL_QUALITY_AUDIT.md`.

In the Step 1 visual quality audit, code inspection identified that `drawDeviceInstance` in [src/lib/export-utils.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/export-utils.ts) drew source screenshots directly into the device-screen bounding box using:
```typescript
ctx.drawImage(img, screenX, screenY, screenWidthPx, screenHeightPx);
```
Likewise, `renderDeviceToOffscreen` (used by the 3D perspective projection pipeline) executed:
```typescript
ctx.drawImage(img, screenX, screenY, screenW, screenH);
```
Furthermore, the interactive React preview in [src/components/DeviceFrame/ScreenContent.tsx](file:///c:/Users/fpii/Desktop/shankar/appshots/src/components/DeviceFrame/ScreenContent.tsx) utilized `className="w-full h-full object-fill"`.

Whenever an imported screenshot's aspect ratio differed from the destination device screen's aspect ratio (e.g. 16:9 desktop/analytics into a 9:19.5 phone, 1:1 square into a phone, or phone screenshot into a 4:3 iPad screen), the image was stretched non-uniformly. Circular UI elements were squished into distorted ovals, and card layouts suffered significant geometric distortion.

In Step 5, we implemented an aspect-ratio-preserving **centered `cover` crop** algorithm across all rendering paths (flat devices, 3D perspective devices, and the live DOM preview). True source proportions are preserved, circular elements remain 1:1 circles, destination screens are 100% filled without unintended blank bars, and rounded corner clippings remain intact.

---

## 1. Confirmed Root Cause Analysis

### Direct Non-Uniform Scaling in Both Rendering Engines
1. **Flat Device Rendering Path** (`src/lib/export-utils.ts` line 858):
   - `drawDeviceInstance` computed the physical pixel screen rectangle (`screenWidthPx`, `screenHeightPx`).
   - It executed `ctx.drawImage(img, screenX, screenY, screenWidthPx, screenHeightPx)`.
   - Because `drawImage` was passed both destination dimensions without source crop bounds (`sx`, `sy`, `sWidth`, `sHeight`), the HTML Canvas 2D context performed an unconditional, non-uniform affine scaling from `img.width` -> `screenWidthPx` and `img.height` -> `screenHeightPx`.
2. **3D Perspective Device Rendering Path** (`src/lib/export-utils.ts` line 357):
   - `renderDeviceToOffscreen` rendered an offscreen canvas representation of the device and screen before projective bilinear texture mapping (`drawPerspectiveImage`).
   - It executed `ctx.drawImage(img, screenX, screenY, screenW, screenH)` with the same unconstrained stretching flaw.
3. **Live React Editor Preview** (`src/components/DeviceFrame/ScreenContent.tsx` line 44):
   - The DOM preview used `<img src={screenshot} className="w-full h-full object-fill" />`.
   - `object-fill` forces non-uniform stretching in CSS, creating parity desynchronization if the canvas export was corrected without updating the DOM preview.

---

## 2. Chosen Strategy & Mathematical Implementation

### Strategy Selection: Centered `cover`
We selected centered **`cover`** cropping based on product requirements:
- **Store Screenshot Standard**: App Store submission guidelines and professional marketing practices require mockup screens to be fully occupied without awkward letterboxing or pillarboxing (empty black/white bars around screenshots).
- **Aspect-Ratio Preservation**: All elements (icons, charts, circles, typography) maintain their original 1:1 aspect ratio.
- **Symmetric Centering**: Any excess width or height is cropped equally from both sides or top/bottom, keeping the primary focus of the screenshot centered.
- **Zero-Crop Bypass**: When the source and destination aspect ratios match (within `1e-4` floating point tolerance), no pixels are cropped.

### Mathematical Definition of `calculateCoverCrop`
For source image dimensions $(W_s, H_s)$ with aspect ratio $A_s = W_s / H_s$, and destination screen dimensions $(W_d, H_d)$ with aspect ratio $A_d = W_d / H_d$:

1. **Defensive Guard**: If any dimension is $\le 0$ or non-finite, fallback safely to `{ sx: 0, sy: 0, sWidth: W_s, sHeight: H_s }`.
2. **Case 1: Source is wider than screen ($A_s > A_d$)**:
   - The source height is fully utilized: $sHeight = H_s$.
   - The required source crop width is: $sWidth = H_s \times A_d$.
   - Symmetrical horizontal crop offset: $sx = \frac{W_s - sWidth}{2}$, $sy = 0$.
3. **Case 2: Source is taller than screen ($A_s < A_d$)**:
   - The source width is fully utilized: $sWidth = W_s$.
   - The required source crop height is: $sHeight = \frac{W_s}{A_d}$.
   - Symmetrical vertical crop offset: $sx = 0$, $sy = \frac{H_s - sHeight}{2}$.
4. **Boundary Clamping**: Clamped to $[0, W_s]$ and $[0, H_s]$ to strictly guarantee coordinates remain within the source image buffer.

### Drawing Helper `drawImageCover`
```typescript
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  dx: number,
  dy: number,
  dWidth: number,
  dHeight: number
): void {
  const crop = calculateCoverCrop(img.width, img.height, dWidth, dHeight);
  ctx.drawImage(img, crop.sx, crop.sy, crop.sWidth, crop.sHeight, dx, dy, dWidth, dHeight);
}
```

---

## 3. Files Changed and Technical Rationale

| File | Changes Made | Technical Rationale |
| :--- | :--- | :--- |
| [src/lib/export-utils.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/export-utils.ts) | Added `SourceCropRect`, `calculateCoverCrop`, and `drawImageCover`. Integrated `drawImageCover` in `renderDeviceToOffscreen` and `drawDeviceInstance`. | Centralizes reusable cover-crop calculation for both flat and 3D device paths, eliminating source image distortion. |
| [src/components/DeviceFrame/ScreenContent.tsx](file:///c:/Users/fpii/Desktop/shankar/appshots/src/components/DeviceFrame/ScreenContent.tsx) | Changed `object-fill` to `object-cover`. | Ensures the interactive React editor preview perfectly matches the canvas export engine. |
| [src/lib/aspect-ratio.test.ts](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/aspect-ratio.test.ts) | Added 11 focused unit tests covering identical, landscape, portrait, square, extreme, and zero dimensions, plus Apple export preset invariants. | Proves mathematical correctness, boundary bounds, and absence of regression across all presets. |
| [docs/APPSHOTS_PHASE_4_STEP_1_VISUAL_QUALITY_AUDIT.md](file:///c:/Users/fpii/Desktop/shankar/appshots/docs/APPSHOTS_PHASE_4_STEP_1_VISUAL_QUALITY_AUDIT.md) | Updated Finding 6 status to **RESOLVED IN STEP 5** with quantitative crop metrics. | Synchronizes repository visual quality audit documentation. |

---

## 4. Visual Evidence & Quantitative Measurements

Visual evidence was generated with circular calibration patterns (which distort into noticeable ellipses if stretched non-uniformly) in [scratch/step11_aspect_ratio_evidence/](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/) and mirrored to the Brain artifacts directory:

### Comparison Matrix
| Case | Source Dimensions | Screen Dimensions | Baseline (Stretched) Artifact | Resolved (Cover Crop) Artifact | Cropped Pixels | Distortion Removed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 16:9 Landscape in 6.7" iPhone** | 1920 × 1080 (1.78) | 1003 × 2173 (0.46) | [before_landscape_in_phone.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/before_landscape_in_phone.png) | [after_landscape_in_phone.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/after_landscape_in_phone.png) | Excess width: 1421.7 px (74.1%) cropped symmetrically | Severe horizontal compression squishing circles into thin upright ovals is 100% eliminated. Circles remain circular. |
| **2. 1:1 Square in 6.7" iPhone** | 1000 × 1000 (1.00) | 1065 × 2309 (0.46) | [before_square_in_phone.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/before_square_in_phone.png) | [after_square_in_phone.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/after_square_in_phone.png) | Excess width: 538.6 px (53.9%) cropped symmetrically | Severe vertical stretching is eliminated; square aspect ratio preserved. |
| **3. Phone UI in iPad 4:3 Screen** | 1290 × 2796 (0.46) | 1439 × 1919 (0.75) | [before_phone_in_ipad.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/before_phone_in_ipad.png) | [after_phone_in_ipad.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/after_phone_in_ipad.png) | Excess height: 1075.7 px (38.5%) cropped symmetrically | +62.6% horizontal widening squashing phone UI cards horizontally is eliminated. |
| **4. 3D Perspective Device with Landscape** | 1920 × 1080 (1.78) | Offscreen Canvas | N/A | [after_3d_landscape_cover.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/after_3d_landscape_cover.png) | Excess width: 1421.7 px cropped before 3D mapping | 3D angled device renders crisp, un-squished content projected onto perspective plane. |

All visual evidence and side-by-side comparisons are consolidated in [scratch/step11_aspect_ratio_evidence/step11_comparison_sheet.png](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/step11_comparison_sheet.png) and [scratch/step11_aspect_ratio_evidence/step11_comparison.html](file:///c:/Users/fpii/Desktop/shankar/appshots/scratch/step11_aspect_ratio_evidence/step11_comparison.html).

---

## 5. Verification & Test Suite Execution

### 1. Focused Unit Tests
Executed:
`npx vitest run src/lib/studio/variants.test.ts src/lib/rendering-parity.test.ts src/lib/studio/color-contrast.test.ts src/lib/aspect-ratio.test.ts --fileParallelism=false`
- **Result**: **46 passed across 4 test suites (100% pass)**
- **Duration**: 6.46s
- **Exit Code**: `0`

### 2. MCP Server Integration Tests
Executed:
`npx vitest run src/mcp/server.test.ts`
- **Result**: **9 passed across 1 test suite (100% pass)**
  - `export_store_assets`: Validated PNG disk generation.
  - `analyze_app_for_store`: Validated schema-valid analysis.
  - `generate_screenshot_plan`: Validated ordered reviewable plan.
  - `build_and_export_store_assets`: Validated approved plan execution.
  - `package_store_export`: Validated verified ZIP archive packaging.
- **Duration**: 69.18s
- **Exit Code**: `0`

### 3. Headless Export & Packaging Tests
Executed:
`npx vitest run src/lib/headless-export.test.ts src/mcp/tools/package-export.test.ts`
- **Result**: **10 passed across 2 test suites (100% pass)**
- **Duration**: 39.23s
- **Exit Code**: `0`

### 4. TypeScript Typecheck
Executed:
`npx tsc --noEmit`
- **Result**: **Zero type errors (100% clean)**
- **Exit Code**: `0`

### 5. Production Build
Executed:
`npm run build` (`vite build && tsc`)
- **Result**: **Production bundle successfully generated**
  - `dist/index.html`: 11.52 kB
  - `dist/assets/index-t-kjSP3w.css`: 47.72 kB
  - `dist/assets/index-BKuZW78N.js`: 236.43 kB
  - `dist/assets/index-BIjbJaEx.js`: 277.55 kB
- **Exit Code**: `0`

---

## 6. Parity & Invariant Preservations

1. **Official Apple Export Preset Dimensions**:
   - `6.7`: 1284 × 2778 px (exact)
   - `6.5`: 1242 × 2688 px (exact)
   - `5.5`: 1242 × 2208 px (exact)
   - `ipad`: 2048 × 2732 px (exact)
2. **Phase 4 Step 2 Fixes**:
   - iPad Pro 12.9" device frame selection and tablet containment (`deviceScale: 72`, `deviceOffsetY: 40`).
   - 3D text/device clearance maintained at >180px in `dark-contrast-3d`.
   - Sunset gradient text contrast (#0f172a, WCAG AAA compliant).
3. **Phase 4 Step 3 Parity**:
   - Canonical preview dimensions (`exportSize.width / 3 = 428px`) preserved, guaranteeing 100% pixel parity between browser and MCP pipelines.
4. **Phase 4 Step 4 Editorial Margins**:
   - `premium-editorial` lateral margins preserved at **85%** scale (`96.3px / 7.50%` clearance).
5. **MCP Tool Schemas and Discovery**:
   - All six MCP tools (`build_appshots_project`, `export_store_assets`, `analyze_app_for_store`, `generate_screenshot_plan`, `build_and_export_store_assets`, `package_store_export`) remain discoverable with untouched schemas.

---

## 7. Remaining Limitations

1. **Subject-Aware Saliency**: The cover-crop algorithm uses symmetric geometric centering ($sx = (W_s - sWidth)/2$, $sy = (H_s - sHeight)/2$). It does not perform computer-vision saliency detection to center specific faces or logos that may be off-center in the source screenshot.
2. **Contain Strategy Support**: The product default is `cover` (standard for App Store submissions). If a future requirement demands showing 100% of an uncropped screenshot with letterbox bars, an explicit user toggle would need to be introduced in the UI.

---

## 8. Safety & Integrity Confirmation

- `git status --short` confirms:
  - **Zero Git commits created**.
  - **Zero npm dependencies added**.
  - **No unrelated files deleted or modified**.
  - **All previous evidence directories intact**.
