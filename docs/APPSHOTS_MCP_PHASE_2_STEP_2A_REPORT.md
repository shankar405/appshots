# AppShots MCP — Phase 2, Step 2A: Playwright Capture & DOM Evidence Engine Report

**Document Version**: 1.0.0  
**Date**: October 19, 2026  
**Status**: Step 2A Implementation Complete  
**Target Environment**: Node.js / Bun MCP Runtime, Playwright Chromium  

---

## 1. Executive Summary

Phase 2, Step 2A implements the foundational **mobile screen capture and observable DOM evidence extraction engine** in [`src/mcp/capture/page-crawler.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/capture/page-crawler.ts), backed by an automated test suite in [`src/mcp/capture/page-crawler.test.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/capture/page-crawler.test.ts).

The engine operates on running web applications (`http://` / `https://`), emulates authentic mobile viewports (e.g. iPhone 15 Pro @ 3x retina, Pixel 7 @ 2.625x), captures pixel-perfect PNG screenshots written safely into configured allowed output roots, and extracts observable DOM metadata (titles, descriptions, visible headings, navigation tabs, action buttons with disabled states, semantic landmarks) while strictly ignoring hidden elements and script contents.

Network boundaries prevent unintended access to cloud metadata services (`169.254.169.254`, `metadata.google.internal`) and private networks, and subresource request interception prevents pages from escaping to forbidden endpoints. Authentication-required pages (401, login redirects with password forms) are classified as `auth_required` without crashing the process.

---

## 2. Changed & Created Files

| File | Status | Description |
| :--- | :---: | :--- |
| [`src/mcp/capture/page-crawler.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/capture/page-crawler.ts) | **Created** | Reusable Playwright mobile screen capture & DOM metadata extraction engine with security controls and lifecycle cleanup. |
| [`src/mcp/capture/page-crawler.test.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/capture/page-crawler.test.ts) | **Created** | Automated test suite (15 tests) with local deterministic HTTP test fixture, viewport verification, DOM filtering, error handling, and security tests. |
| [`docs/APPSHOTS_MCP_PHASE_2_STEP_2A_REPORT.md`](file:///c:/Users/shank/OneDrive/Desktop/appshots/docs/APPSHOTS_MCP_PHASE_2_STEP_2A_REPORT.md) | **Created** | This verification report. |

---

## 3. API Signatures & Return Schema

### 3.1 Primary Capture Function
```typescript
export async function captureApplicationScreens(
  options: CaptureAppOptions,
): Promise<CaptureAppResult>;
```

### 3.2 Options (`CaptureAppOptions`)
```typescript
export interface CaptureAppOptions {
  /** Target HTTP/HTTPS URL of the running application */
  targetUrl: string;
  /** Optional explicit list of route paths to inspect (e.g. ['/', '/dashboard']) */
  routes?: string[];
  /** Maximum number of routes to capture (default: 5, max: 10) */
  maxScreens?: number;
  /** Viewport preset ('iphone-15-pro' | 'pixel-7') or custom mobile viewport */
  viewport?: ViewportPreset | CaptureViewport;
  /** Destination directory for captured PNGs (must be in allowed output roots) */
  outputDir: string;
  /** Navigation timeout in ms (default: 10000, max: 30000) */
  timeoutMs?: number;
  /** Capture full scrollable page height instead of viewport (default: false) */
  fullPage?: boolean;
  /** Optional custom allowed output roots */
  allowedOutputRoots?: string[];
  /** Explicit whitelist of external hostnames permitted for capture */
  allowedHosts?: string[];
  /** Allow non-localhost private IP networks (e.g. 192.168.x, 10.x) - default: false */
  allowPrivateNetworks?: boolean;
  /** Headless browser mode (default: true) */
  headless?: boolean;
}
```

### 3.3 Result Schema (`CaptureAppResult` & `CapturedRouteResult`)
```typescript
export interface DomEvidence {
  title: string;
  description?: string;
  headings: Array<{ level: 1 | 2 | 3; text: string }>;
  navigationLabels: string[];
  actionLabels: Array<{ text: string; disabled?: boolean }>;
  landmarks: string[];
}

export type NavigationStatus =
  | "success"
  | "auth_required"
  | "http_error"
  | "timeout"
  | "network_error"
  | "blocked";

export type CaptureStatus = "captured" | "failed" | "skipped";

export interface CapturedRouteResult {
  requestedUrl: string;
  finalUrl: string;
  navigationStatus: NavigationStatus;
  httpStatus?: number;
  captureStatus: CaptureStatus;
  screenshot?: {
    filePath: string;
    width: number;
    height: number;
    bytes: number;
  };
  domEvidence?: DomEvidence;
  warnings?: string[];
  error?: string;
}

export interface CaptureAppResult {
  success: boolean;
  targetUrl: string;
  outputDir: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  routes: CapturedRouteResult[];
  summary: {
    totalAttempted: number;
    capturedCount: number;
    failedCount: number;
    authRequiredCount: number;
    durationMs: number;
  };
}
```

---

## 4. Verified Capture & Extraction Behavior

1. **Mobile Viewport Emulation**:
   - `iphone-15-pro` preset: CSS viewport 393 × 852 @ `deviceScaleFactor: 3`. Generates verified PNG files of dimension **1179 × 2556 px** (or 2555 px due to subpixel rendering rounding), verified with `verifyPngBuffer`.
   - `pixel-7` preset: CSS viewport 412 × 915 @ `deviceScaleFactor: 2.625`. Generates verified PNG files exceeding **1080 × 2400 px**.
2. **Observable DOM Evidence Extraction**:
   - Extracted: Page `<title>`, `<meta name="description">`, visible `<h1>`-`<h3>` with hierarchy levels, navigation links (`<nav>`, `<header>`, `[role="navigation"]`), interactive action buttons with disabled flags, and landmark sections (`<main>`, `<aside>`).
   - Normalization: Consecutive whitespace collapsed, lengths capped (titles: 180 chars, descriptions: 300 chars, headings/labels: 120 chars, max 20 headings, max 25 navigation labels, max 25 action labels).
3. **Strict Exclusion of Hidden Content**:
   - `display: none`: Excluded.
   - `visibility: hidden`: Excluded.
   - `hidden` attribute: Excluded.
   - `aria-hidden="true"`: Excluded.
   - Zero-opacity / zero-bounding-rect elements: Excluded.
   - `<script>`, `<style>`, `<noscript>` contents: Excluded.
4. **Auth Classification & Error Recovery**:
   - 302 Redirect to `/login` containing `<input type="password">`: Classified as `navigationStatus: "auth_required"`, `captureStatus: "captured"`, with warning.
   - HTTP 401 Unauthorized: Classified as `navigationStatus: "auth_required"`, `httpStatus: 401`, `captureStatus: "failed"`.
   - HTTP 404 Not Found: Classified as `navigationStatus: "http_error"`, `httpStatus: 404`, `captureStatus: "failed"`.
   - Navigation timeout: Classified as `navigationStatus: "timeout"`, `captureStatus: "failed"`, without crashing.
   - Unreachable server (`127.0.0.1:59123` closed port): Classified as `navigationStatus: "network_error"`, `captureStatus: "failed"`.

---

## 5. Security Policy & Limitations

### 5.1 Enforced Security Controls
- **Protocol Whitelist**: Only `http:` and `https:` URLs are permitted. Schemes such as `file:`, `javascript:`, `data:`, `ftp:` are rejected before process execution.
- **Cloud Metadata Blocking**: Hostnames `169.254.169.254`, `metadata.google.internal`, `100.100.100.200`, and all link-local addresses (`169.254.0.0/16`) are blocked at both initial URL validation and network subresource route interception.
- **Private Network Confinement**: RFC 1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) are blocked by default unless `allowPrivateNetworks: true` is explicitly configured. Localhost (`localhost`, `127.0.0.1`, `::1`) is allowed for local dev server workflows.
- **Subresource Route Interception**: Playwright `page.route('**/*', ...)` inspects all child HTTP requests (fetch, XHR, images, iframes). Any subresource targeting a blocked host is aborted with `blockedbyclient`.
- **URL Credential & Token Redaction**: In outputs, error messages, and logs, embedded credentials (`user:pass@`) are stripped, and sensitive query parameters (`token`, `auth`, `key`, `password`, `secret`, `api_key`) have their values masked with `[REDACTED]`.
- **Filesystem Output Sandboxing**: Destination directories must pass [`validateOutputDirectoryPath()`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/security.ts#L251). Root filesystem directories (`C:\`, `/`) and protected workspace directories (`.git`, `node_modules`, `src`) are rejected.
- **Sanitized Filenames**: Screenshot filenames are generated via `slugifyRoute(route, index)` (e.g. `screen-1-home.png`, `screen-2-dashboard.png`), strictly filtering characters to `[a-zA-Z0-9_-]`. Raw URL paths containing `/`, `\`, or `..` are never used as filenames.
- **Lifecycle Cleanup**: Integrates with [`registerResourceCleanup()`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/lifecycle.ts#L18) ensuring browser context and process close cleanly upon process termination signals (`SIGINT`, `SIGTERM`, stdin close).

### 5.2 Security Limitations & Operational Boundaries
- **DNS Rebinding**: Hostname checks evaluate the hostname string. If a malicious public domain uses short TTL DNS rebinding pointing to an internal IP, Playwright relies on OS DNS resolution. For highest security environments, outbound proxy rules or firewall egress filtering should be applied.
- **Authentication**: No credentials or tokens are injected automatically. Authentication bypass is not attempted, adhering strictly to store compliance rules.

---

## 6. Test Results & Command Verification

### 6.1 Page Crawler Engine Test Suite
Command: `npx vitest run src/mcp/capture/page-crawler.test.ts`
```
 ✓ src/mcp/capture/page-crawler.test.ts (15 tests) 2984ms
   ✓ AppShots Playwright Capture Engine > Security: URL Validation and Network Boundaries > accepts valid localhost and http/https URLs
   ✓ AppShots Playwright Capture Engine > Security: URL Validation and Network Boundaries > rejects invalid protocols (ftp, file, javascript, data)
   ✓ AppShots Playwright Capture Engine > Security: URL Validation and Network Boundaries > blocks cloud metadata services
   ✓ AppShots Playwright Capture Engine > Security: URL Validation and Network Boundaries > blocks non-localhost private IP networks by default
   ✓ AppShots Playwright Capture Engine > Security: URL Validation and Network Boundaries > sanitizes URLs by stripping credentials and sensitive tokens
   ✓ AppShots Playwright Capture Engine > Screen Capture & Observable DOM Evidence > captures mobile screenshot with default iPhone 15 Pro viewport dimensions (1179x2556)
   ✓ AppShots Playwright Capture Engine > Screen Capture & Observable DOM Evidence > extracts observable DOM evidence and excludes hidden content
   ✓ AppShots Playwright Capture Engine > Screen Capture & Observable DOM Evidence > captures multiple requested routes sequentially
   ✓ AppShots Playwright Capture Engine > Navigation, Error Handling, and Auth Classification > classifies login redirects and password forms as auth_required
   ✓ AppShots Playwright Capture Engine > Navigation, Error Handling, and Auth Classification > classifies HTTP 401 responses as auth_required without crashing
   ✓ AppShots Playwright Capture Engine > Navigation, Error Handling, and Auth Classification > classifies HTTP 404 responses as http_error without crashing
   ✓ AppShots Playwright Capture Engine > Navigation, Error Handling, and Auth Classification > handles navigation timeouts gracefully
   ✓ AppShots Playwright Capture Engine > Navigation, Error Handling, and Auth Classification > handles unreachable application servers gracefully
   ✓ AppShots Playwright Capture Engine > Filesystem Security Boundaries > rejects output paths outside allowed roots or targeting protected directories
   ✓ AppShots Playwright Capture Engine > Filesystem Security Boundaries > captures mobile screenshot with Pixel 7 preset dimensions

Test Files  1 passed (1)
     Tests  15 passed (15)
  Duration  3.87s
```

### 6.2 Full Repository Test Suite
Command: `npx vitest run`
```
Test Files  13 passed (13)
     Tests  115 passed (115)
  Duration  10.73s
```

### 6.3 Production Build & TypeScript Check
Command: `bun run build`
```
vite v7.3.1 building client environment for production...
✓ 1851 modules transformed.
dist/index.html                  11.52 kB │ gzip:  3.11 kB
dist/assets/index-B6TwJiEM.css   40.79 kB │ gzip:  8.01 kB
dist/assets/index-uiFuYAG7.js   202.95 kB │ gzip: 61.42 kB
dist/assets/index-9UGQzWiL.js   277.55 kB │ gzip: 89.24 kB
✓ built in 3.49s
```

---

## 7. Remaining Issues & Next Step

There are **0 remaining blockers** for Step 2A.

### Recommended Next Implementation Task:
**Phase 2, Step 2B: Provider Abstraction & Deterministic Mock Provider**.
- Implement `src/mcp/ai/provider.ts` defining the `AIProvider` interface, message formatting, and structured generation contracts.
- Implement `src/mcp/ai/mock-provider.ts` returning deterministic test fixtures matching `AnalyzeAppOutputSchema` and `GenerateScreenshotPlanOutputSchema` for offline testing.
- Add unit tests verifying provider abstraction and schema compliance.
