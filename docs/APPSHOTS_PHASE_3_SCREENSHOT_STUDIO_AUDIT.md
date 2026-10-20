# AppShots Phase 3 — Screenshot Studio Capability & Architecture Audit

**Date**: October 20, 2026  
**Auditor**: Antigravity / Cursor IDE Agent  
**Status**: Completed  
**Objective**: Comprehensive audit of the AppShots repository to assess existing capabilities, identify missing features, establish data-model and security constraints, and formulate the minimal safe implementation plan for Phase 3 (AI-Assisted Screenshot Studio).

---

## 1. Executive Summary

AppShots was designed as a browser-based canvas editor for generating App Store screenshots and was recently extended in Phase 2 with Playwright web crawling, headless canvas rendering, and an MCP server with 5 core tools (`build_appshots_project`, `export_store_assets`, `analyze_app_for_store`, `generate_screenshot_plan`, and `build_and_export_store_assets`).

Phase 3 aims to upgrade AppShots into an **AI-Assisted App Store Screenshot Design Studio** that enables:
1. Receiving a running web application URL, inspecting routes, and observing DOM evidence.
2. Allowing the user to select, deselect, and reorder captured application screens.
3. Generating 3–4 distinct visual design variants per selected screen (e.g. Minimal Centered, Bold Gradient, Dark Contrast 3D, and Premium Composition) using the IDE agent's AI model without external paid API keys.
4. Comparing variants in a comparison gallery, editing headlines, colors, device frames, and positioning, and opening chosen designs in the native AppShots editor.
5. Exporting a structured, self-contained ZIP archive containing high-resolution PNGs, a portable project representation, a detailed manifest, and documentation.

This audit establishes that **no existing application architecture needs to be rewritten**. The existing canvas renderer, device frame specs, gradient presets, project builder, and MCP server provide the core execution engine. The additions will focus strictly on variant generation, comparison UI, project portability, and safe ZIP archive packaging.

---

## 2. Existing Repository Capabilities

| Component / Layer | Existing Implementation | Reusability in Phase 3 |
| :--- | :--- | :--- |
| **Mobile Capture Engine** | `src/mcp/capture/page-crawler.ts`: Playwright mobile crawler supporting iPhone 15 Pro (1179x2556) and Pixel 7 (1080x2400) emulation, DOM evidence extraction (H1–H3, navigation, action labels, landmarks), and auth redirection detection. | **100% Reusable**: Directly provides raw screenshots and evidence for Step A and Step B. |
| **AI Provider & Schemas** | `src/mcp/ai/`: Central Zod schemas (`AnalyzeAppOutputSchema`, `GenerateScreenshotPlanOutputSchema`), provider-neutral `AIProvider` interface, and deterministic `MockAIProvider`. | **100% Reusable**: The Cursor IDE agent provides reasoning in chat; `MockAIProvider` ensures deterministic offline test execution. |
| **Project Builder** | `src/mcp/project-builder.ts`: `buildAppshotsProject` converts structured slide specifications into full AppShots `Project` objects, resolving local image paths into base64 Data URLs. | **100% Reusable**: Constructs native project models for variants and approved sets. |
| **Headless Canvas Renderer** | `src/lib/headless-export.ts`: Automates full-resolution canvas rendering using Playwright Chromium with browser font synchronization and IHDR PNG verification. | **100% Reusable**: Renders pixel-perfect 1284x2778 (6.7"), 1242x2688 (6.5"), 1242x2208 (5.5"), or 2048x2732 (iPad) screenshots. |
| **MCP Server & Security** | `src/mcp/server.ts`, `src/mcp/security.ts`: Exposes 5 MCP tools over stdio with rigorous boundary checks, symlink resolution, path traversal prevention, and root protection. | **100% Reusable**: Preserves all 5 existing MCP tool contracts without breaking changes. |
| **Canvas & Editor UI** | `src/components/`, `src/context/EditorContext.tsx`: Full interactive React canvas with 3D device rotation (`rotateX`, `rotateY`, `deviceRotation`), scale, offsets, multi-device support, rich text bolding (`<b>`), and gradient backgrounds. | **100% Reusable**: Existing editor handles detailed manual adjustments. |
| **Project Persistence** | `src/lib/useLocalStorage.ts`: Versioned schema (`version: 2`) with debounced auto-save, quota handling, and multi-project management. | **100% Reusable**: Will be extended with an explicit `importProject` action. |
| **Archive Dependency** | `package.json`: `jszip` (^3.10.1) is already installed. | **Ready**: Zero new external dependencies required for ZIP creation. |

---

## 3. Missing Capabilities & Gap Analysis

1. **Multi-Variant Generation Logic (Step D)**:
   - *Current state*: `generate_screenshot_plan` creates a single linear slide plan (1 slide per feature).
   - *Requirement*: Ability to generate 3 to 4 visually distinct design alternatives for each selected screen (e.g. Minimal Clean, Bold Gradient, Dark Contrast 3D, and Premium Editorial) while preserving the original screenshot image and route attribution.
   - *Solution*: Implement a dedicated variant generation module (`src/lib/studio/variants.ts`) that programmatically constructs schema-valid design variants adhering to AppShots' layout and styling capabilities.

2. **Screen Selection & Review Interface (Step B)**:
   - *Current state*: Raw captures are written to disk, but there is no dedicated selection gallery in AppShots to choose, reorder, or filter screens before generating designs.
   - *Solution*: Provide both an agent-driven selection format (with Markdown image embeds and checklists) and an in-app Studio Gallery component (`src/components/Studio/`) that allows visual screen selection, inspection of observed DOM evidence, and reordering.

3. **Variant Comparison Gallery & In-Place Tuning (Step E)**:
   - *Current state*: The AppShots editor displays a single project with a linear slide reel. There is no side-by-side variant comparison view.
   - *Solution*: Build a modal/gallery in AppShots (`src/components/Studio/VariantComparisonModal.tsx`) that displays 3–4 variants side-by-side, allows fast tweaking (headlines, colors, gradients, device models, scale, offsets, 3D tilts), allows selecting a favorite, and provides a direct "Open in Editor" button to load the design into the canvas.

4. **Project Import Action**:
   - *Current state*: `EditorContext.tsx` supports `createProject`, `deleteProject`, `renameProject`, and `switchProject`, but lacks a clean `importProject(project: Project)` method to inject a newly generated or loaded project into state and active view without page reload.
   - *Solution*: Add `importProject` to `EditorContext.tsx`.

5. **Portable Project Packaging & ZIP Export (Step 5)**:
   - *Current state*: `exportStoreAssets` only outputs loose PNGs to a directory.
   - *Requirement*: Package final approved variants into a structured ZIP archive containing:
     - `screenshots/` (store-ready PNGs)
     - `project/` (editable native project data and embedded/portable assets)
     - `previews/` (optional comparison previews)
     - `manifest.json` (verified dimensions, file sizes, route attribution, variant IDs)
     - `README.txt` (instructions for opening and understanding assets)
   - *Solution*: Implement `src/lib/studio/zip-packager.ts` and expose it via a dedicated MCP tool `package_store_export` (or studio archive export) and UI export button.

6. **Google Play Rejection Guardrail**:
   - *Current state*: AppShots device frames and canvas aspect ratios are calibrated for Apple App Store sizes (6.7", 6.5", 5.5", iPad).
   - *Requirement*: Explicitly reject Google Play store exports with a clear descriptive error message explaining that Google Play presets are not yet supported. Never silently output Apple-sized images labeled as Google Play assets.

---

## 4. Data-Model Constraints & Invariants

1. **Native Project Schema Compatibility**:
   - Every generated variant must strictly conform to the `Project` type in `src/types/index.ts` and `BuildProjectInputSchema` in `src/mcp/project-builder.ts`.
   - Device IDs must belong to `validDeviceIds`: `iphone-15-pro-max`, `iphone-15-pro`, `iphone-14`, `ipad-pro-12-9`, `samsung-galaxy-s24-ultra`, `samsung-galaxy-tab-s9`.
   - Gradient IDs must belong to `validGradientPresets`: `sunset`, `ocean`, `mint`, `berry`, `royal`, `rose`.
   - Export size IDs must belong to `validExportSizeIds`: `6.7`, `6.5`, `5.5`, `ipad`.

2. **Source Screenshot Integrity**:
   - The source screenshot image captured from the web application is the immutable ground truth.
   - Variants alter framing, typography, 3D angles, background gradients, and copy, but **never redraw, hallucinate, stretch, or alter the application UI itself**.

3. **Project Portability Invariant**:
   - In memory and `localStorage`, screenshots are stored as base64 Data URLs inside `DeviceInstance.screenshotSrc`.
   - When exported to disk or packaged in a ZIP archive, the project must either:
     a) Retain self-contained data URLs, or
     b) Package relative image assets in `project/assets/` with relative paths that resolve cleanly upon re-import.
   - The project must open in AppShots without requiring access to temporary Playwright cache directories.

---

## 5. Security & Isolation Guidelines

1. **Filesystem Confinement**:
   - All input reads and output writes must pass through `validateInputFilePath`, `validateOutputDirectoryPath`, and `validateFilenamePrefix`.
   - Writes directly to repository source directories (`.git`, `node_modules`, `src`) or system roots (`C:\`, `/`) are strictly prevented.

2. **Archive Safety (Zip Slip Prevention)**:
   - When generating ZIP archives, all internal entry paths must be normalized, relative, and verified not to contain `..` or leading slashes.
   - Exclude sensitive files: `.env*`, credentials, `.git/`, and `node_modules/`.

3. **Prompt Injection & Web Content Isolation**:
   - Observable DOM strings and page text extracted from inspected applications must be treated as untrusted data.
   - Text from crawled pages must never be executed or passed directly into system instructions without strict JSON isolation (conforming to the Phase 2, Step 2C pattern).

4. **Resource Lifecycle**:
   - All Playwright browsers and ephemeral Vite servers spawned during analysis, variant rendering, or archive generation must be registered with `registerResourceCleanup` and closed in `finally` blocks.

---

## 6. Smallest Safe Implementation Plan

### Step 1: Studio Types & Multi-Variant Generator (`src/lib/studio/variants.ts`)
- Define `StudioVariantPreset` types:
  1. **Minimal Clean**: Centered flat device, subtle solid/minimal gradient, clear headline, balanced padding.
  2. **Bold Gradient**: Vibrant gradient background (`sunset`/`royal`), 3D tilt, prominent headline with `<b>` emphasis tags, angled device.
  3. **Dark Contrast 3D**: Dark background (`#0f172a` or `#18181b`), 3D pitch/yaw (`rotateX`, `rotateY`), crisp light typography, high-tech aesthetic.
  4. **Premium Editorial**: Large scaled device (`deviceScale: 95+`), offset composition, deep supporting subheadline, luxury palette.
- Function `generateScreenVariants(screen, count)` returning 3–4 validated slide specifications per screen.

### Step 2: Portable Archive & ZIP Packager (`src/lib/studio/zip-packager.ts`)
- Implements `createStudioZipArchive({ project, renderedFiles, manifestData, outputDir, archiveName })`.
- Builds:
  - `screenshots/`: Final PNG assets.
  - `project/project.json`: Native editable AppShots project.
  - `manifest.json`: Slide number, source route, variant ID, filename, width, height, bytes, and marketing summary.
  - `README.txt`: Plain-text documentation for re-opening in AppShots.
- Uses `jszip` with safe relative paths and input validation.

### Step 3: MCP Tool `package_store_export` (`src/mcp/tools/package-export.ts`)
- Registers new MCP tool `package_store_export` on `server.ts`.
- Accepts project data or approved variants, export preset, target output directory, and archive name.
- Renders final PNGs headlessly using existing `exportStoreAssets` pipeline and bundles the ZIP archive.
- Rejects Google Play presets with descriptive error.

### Step 4: Editor Integration & Studio Comparison UI (`src/components/Studio/`)
- Add `importProject(project: Project)` to `EditorContext.tsx`.
- Create `StudioModal` / `VariantComparisonModal`:
  - Step 1: Screen selector with captured screenshot previews, routes, and DOM evidence summaries.
  - Step 2: Variant comparison gallery showing 3–4 variants per screen side-by-side.
  - Step 3: Fast customization panel for selected variant (headline, subheadline, gradient, device, scale, tilts).
  - Step 4: "Open in Editor" button to load chosen variant into the active canvas.
  - Step 5: "Export ZIP" button for immediate packaging.
- Add "Studio" entry button in `EditorLayout` / header.

### Step 5: Automated Testing & Verification
- Unit and integration tests in `src/lib/studio/variants.test.ts`, `src/lib/studio/zip-packager.test.ts`, and `src/mcp/tools/package-export.test.ts`.
- Verify all existing 15 test suites and 146 tests continue to pass.
- Verify production build (`npx vite build && npx tsc`) passes without type errors.
- Document exact verification steps and findings in `docs/APPSHOTS_PHASE_3_SCREENSHOT_STUDIO_REPORT.md`.
