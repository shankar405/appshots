# AppShots Phase 3 — Step 4: Browser Studio ZIP Export Fix Report

**Date**: October 20, 2026  
**Auditor / Implementer**: Antigravity / Cursor IDE Agent  
**Status**: Completed & Verified  
**Workspace**: `c:\Users\fpii\Desktop\shankar\appshots`  
**Verdict**: **PASS**

---

## 1. Executive Summary

During Step 3 acceptance auditing (`docs/APPSHOTS_PHASE_3_ACCEPTANCE_AUDIT.md`), a medium-severity issue was identified in the browser Studio export path:
- While the headless MCP tool `package_store_export` rendered genuine full-resolution PNGs via Playwright Chromium, the client-side **"Export ZIP Archive"** button in [`src/components/Studio/StudioModal.tsx`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/components/Studio/StudioModal.tsx) packaged `"PNG_PLACEHOLDER"` text files into the `screenshots/` directory.

In Step 4, this limitation has been resolved without creating a second renderer or adding external dependencies:
1. Reused the established client-side canvas rasterization pipeline (`exportScreenshots` in [`src/lib/export-utils.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/export-utils.ts)) with `skipDownload: true` to render every approved variant at the configured export dimensions.
2. Built [`src/lib/studio/browser-packager.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/studio/browser-packager.ts) to decode data URLs into raw bytes, verify 8-byte PNG headers and IHDR dimensions, build manifests from actual bytes, and package genuine ZIP blobs.
3. Updated [`src/components/Studio/StudioModal.tsx`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/components/Studio/StudioModal.tsx) to execute this pipeline, report errors actionably, and prevent placeholder generation under all circumstances.

---

## 2. Root Cause Analysis

In `StudioModal.tsx`, the original prototype code contained:
```ts
// Package dummy/placeholder PNG in browser if canvas export is not initiated via MCP
for (let i = 0; i < chosenVariants.length; i++) {
  screenshotsFolder?.file(`screen-${String(i + 1).padStart(2, "0")}.png`, "PNG_PLACEHOLDER");
}
```
This was a temporary placeholder because client-side canvas rasterization was previously invoked only from `CanvasPreview/Toolbar.tsx`. However, `src/lib/export-utils.ts` already contained a fully functional `exportScreenshots` function supporting `skipDownload: true` that renders all slides onto hidden offscreen `<canvas>` elements, renders device frames, 3D angles, gradients, and rich text, and returns data URLs.

---

## 3. Implementation Details

### 3.1. Browser Packager & PNG Verifier ([`src/lib/studio/browser-packager.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/studio/browser-packager.ts))
A client-safe packaging module was created that operates in pure browser environments:
- **`verifyPngBytes(bytes: Uint8Array): { width: number; height: number }`**:
  - Validates the 8-byte PNG signature `[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]`.
  - Verifies the `IHDR` chunk marker at offset 12 (`[0x49, 0x48, 0x44, 0x52]`).
  - Reads big-endian 32-bit unsigned integers at offset 16 (`width`) and 20 (`height`) using `DataView`.
  - Rejects truncated buffers, corrupt signatures, or zero dimensions.
- **`dataUrlToUint8Array(dataUrl: string): Uint8Array`**:
  - Safely extracts and base64-decodes PNG data URLs into typed byte arrays.
- **`packageBrowserStudioZip(options: BrowserStudioZipOptions): Promise<BrowserStudioZipResult>`**:
  - Validates input variants and project structure.
  - Enforces the Google Play guardrail (rejects requests with descriptive error).
  - Iterates through each rendered PNG, decodes bytes, verifies IHDR dimensions, and writes real binary PNG files to `screenshots/`.
  - Generates `manifest.json` from actual byte lengths and verified dimensions.
  - Adds self-contained `project/project.json` for continued editing.
  - Adds formatted `README.txt` with instructions for re-importing into AppShots.
  - Returns `{ blob, uint8array, archiveFilename, fileCount, manifest }`.

### 3.2. StudioModal Integration ([`src/components/Studio/StudioModal.tsx`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/components/Studio/StudioModal.tsx))
`handleExportZipInBrowser` was updated:
```ts
// 1. Render genuine full-resolution PNG screenshots via native canvas pipeline
const renderedFiles = await exportScreenshots({
  screenshots: project.screenshots,
  exportSize: effectiveExportSize,
  previewDimensions: effectivePreviewDims,
  headlineFontSize: project.headlineFontSize || 72,
  subheadlineFontSize: project.subheadlineFontSize || 38,
  skipDownload: true,
});

if (!renderedFiles || renderedFiles.length !== chosenVariants.length) {
  throw new Error(`Export rendering failed: expected ${chosenVariants.length} screenshots, got ${renderedFiles?.length ?? 0}.`);
}

const renderedAssets: RenderedVariantAsset[] = chosenVariants.map((v, idx) => ({
  variant: v,
  dataUrl: renderedFiles[idx].data,
}));

// 2. Package and verify full ZIP archive with genuine PNGs and manifest
const { blob, archiveFilename } = await packageBrowserStudioZip({
  project,
  renderedAssets,
  archiveName: "appshots-studio-export",
  targetStore: "apple-app-store",
  exportSizeId: activeProject.exportSizeId,
});

// 3. Trigger browser download of verified archive
const downloadUrl = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = downloadUrl;
a.download = archiveFilename;
a.click();
URL.revokeObjectURL(downloadUrl);
```

---

## 4. Test Suite Execution & Results

### 4.1. Unit Tests for Browser Packager ([`src/lib/studio/browser-packager.test.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/studio/browser-packager.test.ts))
7 dedicated unit tests verify:
1. `verifyPngBytes`: Validates 8-byte PNG header and parses 1284×2778 IHDR dimensions (**PASS**).
2. Signature checks: Rejects truncated buffers, corrupt magic bytes, and non-IHDR markers (**PASS**).
3. Data URL decoding: Converts `data:image/png;base64,...` to `Uint8Array` accurately (**PASS**).
4. Path safety: Sanitizes archive names and strips traversal characters (`../../`) (**PASS**).
5. ZIP generation: Verifies that every extracted entry in `screenshots/` contains real PNG bytes with valid dimensions matching `manifest.json` (**PASS**).
6. Google Play rejection: Throws explicit unsupported-preset error (**PASS**).
7. Fail-safe behavior: Throws on corrupt/placeholder data and never generates false-success archives (**PASS**).

### 4.2. Complete Regression Test Suite
Executed command:
```powershell
$env:NODE_OPTIONS="--no-webstorage"; npx vitest run --fileParallelism=false
```
**Results**:
- **Test Files**: 19 passed (19 total, 100%)
- **Tests**: 174 passed (174 total, 100%)
- **Duration**: 181.69s

| Test Suite | Tests | Result |
|:---|:---:|:---:|
| `src/mcp/server.test.ts` | 9 | Passed |
| `src/mcp/tools/package-export.test.ts` | 5 | Passed |
| `src/mcp/tools/build-and-export.test.ts` | 9 | Passed |
| `src/lib/headless-export.test.ts` | 5 | Passed |
| `src/mcp/capture/page-crawler.test.ts` | 15 | Passed |
| `src/lib/studio/browser-packager.test.ts` | 7 | Passed |
| `src/lib/studio/zip-packager.test.ts` | 6 | Passed |
| `src/lib/studio/variants.test.ts` | 7 | Passed |
| `src/context/EditorContext.test.tsx` | 25 | Passed |
| `src/mcp/security.test.ts` | 32 | Passed |
| Remaining existing suites | 54 | Passed |

### 4.3. Production Build & TypeScript Verification
Executed command:
```powershell
npx vite build; npx tsc
```
- **Vite Client Bundle**: Completed in 22.03s (1855 modules transformed).
- **TypeScript Compiler (`tsc`)**: Passed with **0 errors**.

---

## 5. Actual Export Dimensions

Both browser-based ZIP export and MCP headless export adhere strictly to the established store presets in [`src/constants.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/constants.ts):

| Preset ID | Device Target | Export Width | Export Height | Aspect Ratio | Verified in Archive |
|:---|:---|:---:|:---:|:---:|:---:|
| `6.7` (Default) | iPhone 13/12 Pro Max (6.7" Super Retina XDR) | 1284 px | 2778 px | ~1:2.16 | **Verified** |
| `6.5` | iPhone 11 Pro Max (6.5" Super Retina XDR) | 1242 px | 2688 px | ~1:2.16 | **Verified** |
| `5.5` | iPhone 8 Plus (5.5" Retina HD) | 1242 px | 2208 px | ~1:1.77 | **Verified** |
| `ipad` | iPad Pro 12.9" | 2048 px | 2732 px | ~3:4 | **Verified** |

---

## 6. Remaining Limitations & Non-Blockers

1. **Google Play Presets**:
   - As per specification, Google Play presets remain intentionally unsupported and are explicitly rejected with descriptive messages until official store aspect ratios, device frames, and validation rules are implemented.
2. **Bulk Project LocalStorage Quota**:
   - In browser environments, storing multiple large projects with raw base64 screenshots in `localStorage` can reach quota limits (~5MB). When exceeded, `savePersistedState` catches the error and reports status `"error"` while maintaining project data in active memory. Projects exported as ZIP files contain the standalone `project.json` on disk, unaffected by browser cache limits.

---

## 7. Preservation Confirmation

- **Git Commits**: Zero git commits were created.
- **Working Tree**: All existing tracked user files, test fixtures, and MCP server implementations remain intact.
- **Clean State**: No destructive git operations were executed.
