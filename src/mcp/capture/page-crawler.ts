/**
 * AppShots Playwright Mobile Screen Capture & DOM Evidence Extraction Engine
 *
 * Automates mobile web screenshot capture and observable DOM metadata extraction
 * from user-authorized web applications. Enforces strict network security boundaries,
 * mobile viewport emulation, and sandboxed filesystem output.
 */

import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { validateOutputDirectoryPath, sanitizePathForError } from "../security";
import { registerResourceCleanup } from "../lifecycle";
import { verifyPngBuffer } from "../../lib/headless-export";

export interface CaptureViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  userAgent?: string;
}

export const CAPTURE_VIEWPORTS = {
  "iphone-15-pro": {
    width: 393,
    height: 852,
    deviceScaleFactor: 3, // 1179 x 2556 px
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  "pixel-7": {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625, // 1080 x 2400 px
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
} as const;

export type ViewportPreset = keyof typeof CAPTURE_VIEWPORTS;

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

export interface CaptureAppOptions {
  /** Target HTTP/HTTPS URL of the running application */
  targetUrl: string;
  /** Optional explicit list of route paths to inspect (e.g. ['/', '/dashboard']) */
  routes?: string[];
  /** Maximum number of routes to capture (default: 5, max: 10) */
  maxScreens?: number;
  /** Viewport preset or custom mobile viewport */
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

/**
 * Checks whether a given hostname is a forbidden cloud metadata service or unpermitted private IP.
 */
export function isBlockedHostOrIp(
  hostname: string,
  options?: { allowPrivateNetworks?: boolean; allowedHosts?: string[] },
): boolean {
  const host = hostname.toLowerCase().trim().replace(/^\[|\]$/g, "");

  if (options?.allowedHosts?.some((allowed) => allowed.toLowerCase() === host)) {
    return false;
  }

  // Cloud metadata services (AWS, GCP, Azure, DigitalOcean, Alibaba)
  if (
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host === "100.100.100.200" ||
    host.startsWith("169.254.") ||
    host === "fd00:ec2::254"
  ) {
    return true;
  }

  // Localhost targets are allowed for local development
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return false;
  }

  // IPv4 loopback (127.0.0.0/8)
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) {
    return false;
  }

  // Non-routable meta address
  if (host === "0.0.0.0") {
    return true;
  }

  // Block private RFC 1918 networks unless explicitly enabled
  if (!options?.allowPrivateNetworks) {
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    const match172 = host.match(/^172\.(\d+)\.\d+\.\d+$/);
    if (match172) {
      const secondOctet = parseInt(match172[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }
  }

  return false;
}

/**
 * Validates and normalizes target URL against protocol and network boundary rules.
 */
export function validateTargetUrl(
  rawUrl: string,
  options?: { allowPrivateNetworks?: boolean; allowedHosts?: string[] },
): URL {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Target URL must be a non-empty string.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid URL format: '${sanitizePathForError(rawUrl)}'`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Unsupported protocol '${parsed.protocol}'. Only http: and https: URLs are permitted.`,
    );
  }

  if (isBlockedHostOrIp(parsed.hostname, options)) {
    throw new Error(
      `Target host '${parsed.hostname}' is blocked by network security policy (cloud metadata or unapproved private network).`,
    );
  }

  return parsed;
}

/**
 * Sanitizes URLs for output and logs by stripping credentials and sensitive query tokens.
 */
export function sanitizeUrlForOutput(urlString: string): string {
  try {
    const url = new URL(urlString);
    url.username = "";
    url.password = "";

    const sensitiveParamKeys = [
      "token",
      "auth",
      "key",
      "password",
      "secret",
      "access_token",
      "refresh_token",
      "api_key",
      "apikey",
    ];

    for (const key of Array.from(url.searchParams.keys())) {
      if (sensitiveParamKeys.some((s) => key.toLowerCase().includes(s))) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }

    return url.toString();
  } catch {
    return urlString;
  }
}

/**
 * Derives a clean, safe filename slug from a route path.
 */
function slugifyRoute(routePath: string, index: number): string {
  let clean = routePath.split("?")[0].split("#")[0].trim();
  if (clean === "" || clean === "/") {
    return `screen-${index + 1}-home.png`;
  }

  // Remove leading slashes and replace non-alphanumeric characters with dashes
  clean = clean.replace(/^\/+/, "").replace(/[^a-zA-Z0-9_-]+/g, "-");
  clean = clean.replace(/^-+|-+$/g, "").slice(0, 40);

  if (!clean) {
    clean = "page";
  }

  return `screen-${index + 1}-${clean}.png`;
}

/**
 * In-browser evaluation function to extract visible, observable DOM evidence.
 */
async function extractDomEvidence(page: Page): Promise<DomEvidence> {
  return await page.evaluate(() => {
    var __name: any = (target: any) => target;
    void __name;

    function isVisible(el: Element): boolean {
      if (!(el instanceof HTMLElement)) return false;
      if (el.hasAttribute("hidden")) return false;
      if (el.getAttribute("aria-hidden") === "true") return false;

      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        parseFloat(style.opacity) === 0
      ) {
        return false;
      }

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;

      // Filter out zero-offset children unless body or fixed position
      if (el.offsetParent === null && el.tagName !== "BODY" && style.position !== "fixed") {
        return false;
      }

      return true;
    }

    function cleanText(text: string | null | undefined, maxLen = 120): string {
      if (!text) return "";
      return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
    }

    // 1. Page Title & Meta Description
    const title = cleanText(document.title, 180);
    const metaDesc =
      document.querySelector('meta[name="description"]')?.getAttribute("content") ||
      document.querySelector('meta[property="og:description"]')?.getAttribute("content") ||
      undefined;
    const description = metaDesc ? cleanText(metaDesc, 300) : undefined;

    // 2. Visible Headings (H1 - H3)
    const headings: Array<{ level: 1 | 2 | 3; text: string }> = [];
    const headingElements = Array.from(document.querySelectorAll("h1, h2, h3"));
    for (const el of headingElements) {
      if (headings.length >= 20) break;
      if (isVisible(el)) {
        const text = cleanText((el as HTMLElement).innerText);
        if (text) {
          const level = (parseInt(el.tagName.charAt(1), 10) || 1) as 1 | 2 | 3;
          if (!headings.some((h) => h.level === level && h.text === text)) {
            headings.push({ level, text });
          }
        }
      }
    }

    // 3. Visible Navigation Labels
    const navLabels: string[] = [];
    const navContainers = Array.from(
      document.querySelectorAll("nav, [role='navigation'], [role='tablist'], header"),
    );
    for (const container of navContainers) {
      if (!isVisible(container)) continue;
      const links = Array.from(container.querySelectorAll("a, button, [role='tab']"));
      for (const link of links) {
        if (navLabels.length >= 25) break;
        if (isVisible(link)) {
          const label = cleanText((link as HTMLElement).innerText || link.getAttribute("aria-label"));
          if (label && label.length >= 2 && !navLabels.includes(label)) {
            navLabels.push(label);
          }
        }
      }
    }

    // 4. Visible Action Buttons
    const actionLabels: Array<{ text: string; disabled?: boolean }> = [];
    const buttons = Array.from(
      document.querySelectorAll(
        "button, [role='button'], input[type='submit'], input[type='button'], a.btn, a[class*='button']",
      ),
    );
    for (const btn of buttons) {
      if (actionLabels.length >= 25) break;
      if (isVisible(btn)) {
        const text = cleanText(
          (btn as HTMLElement).innerText ||
            (btn as HTMLInputElement).value ||
            btn.getAttribute("aria-label"),
        );
        if (text && text.length >= 2) {
          const isDisabled =
            (btn as HTMLButtonElement).disabled ||
            btn.getAttribute("aria-disabled") === "true";
          if (!actionLabels.some((a) => a.text === text)) {
            actionLabels.push({ text, disabled: isDisabled ? true : undefined });
          }
        }
      }
    }

    // 5. Semantic Landmarks
    const landmarks: string[] = [];
    const landmarkEls = Array.from(
      document.querySelectorAll("main, section[aria-label], aside, footer"),
    );
    for (const l of landmarkEls) {
      if (landmarks.length >= 10) break;
      if (isVisible(l)) {
        const name = cleanText(l.getAttribute("aria-label") || l.tagName.toLowerCase(), 50);
        if (name && !landmarks.includes(name)) {
          landmarks.push(name);
        }
      }
    }

    return {
      title,
      description,
      headings,
      navigationLabels: navLabels,
      actionLabels,
      landmarks,
    };
  });
}

/**
 * Checks if the loaded page exhibits signals of requiring authentication.
 */
async function detectAuthRequired(page: Page, finalUrl: string): Promise<boolean> {
  const urlLower = finalUrl.toLowerCase();
  const authUrlPatterns = [
    "/login",
    "/signin",
    "/sign-in",
    "/auth",
    "/account/login",
    "/users/sign_in",
  ];

  if (authUrlPatterns.some((pattern) => urlLower.includes(pattern))) {
    return true;
  }

  // Check DOM for password input or prominent login form
  try {
    const hasPasswordField = await page.evaluate(() => {
      const pwd = document.querySelector('input[type="password"]');
      if (!pwd) return false;
      const style = window.getComputedStyle(pwd);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    if (hasPasswordField) {
      return true;
    }
  } catch {
    // Evaluation error on disconnected page
  }

  return false;
}

/**
 * Captures mobile screenshots and extracts observable DOM evidence from a web application.
 */
export async function captureApplicationScreens(
  options: CaptureAppOptions,
): Promise<CaptureAppResult> {
  const startTime = Date.now();

  // 1. Validate target URL
  const parsedTarget = validateTargetUrl(options.targetUrl, {
    allowPrivateNetworks: options.allowPrivateNetworks,
    allowedHosts: options.allowedHosts,
  });

  // 2. Validate output directory against configured allowed output roots
  const canonicalOutputDir = validateOutputDirectoryPath(options.outputDir, {
    allowedRoots: options.allowedOutputRoots,
  });

  // 3. Resolve viewport settings
  let viewport: CaptureViewport;
  if (!options.viewport || typeof options.viewport === "string") {
    const presetKey = (options.viewport as ViewportPreset) || "iphone-15-pro";
    viewport = CAPTURE_VIEWPORTS[presetKey] || CAPTURE_VIEWPORTS["iphone-15-pro"];
  } else {
    viewport = {
      width: Math.min(Math.max(options.viewport.width, 320), 1600),
      height: Math.min(Math.max(options.viewport.height, 480), 3200),
      deviceScaleFactor: Math.min(Math.max(options.viewport.deviceScaleFactor, 1), 4),
      isMobile: options.viewport.isMobile ?? true,
      hasTouch: options.viewport.hasTouch ?? true,
      userAgent: options.viewport.userAgent || CAPTURE_VIEWPORTS["iphone-15-pro"].userAgent,
    };
  }

  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 10000, 1000), 30000);
  const maxScreens = Math.min(Math.max(options.maxScreens ?? 5, 1), 10);

  // 4. Resolve candidate route list
  const requestedRoutes =
    options.routes && options.routes.length > 0 ? options.routes.slice(0, maxScreens) : ["/"];

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  // Register cleanup in lifecycle registry so child browser terminates if process is killed
  const unregisterCleanup = registerResourceCleanup(async () => {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  });

  const capturedRoutes: CapturedRouteResult[] = [];

  try {
    browser = await chromium.launch({
      headless: options.headless ?? true,
    });

    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      userAgent: viewport.userAgent,
      acceptDownloads: false,
    });

    // Shim esbuild name helper in browser context to avoid ReferenceError: __name is not defined
    await context.addInitScript(
      "window.__name = window.__name || function(target) { return target; };",
    );

    const page = await context.newPage();

    // 5. Intercept subresources and redirects to enforce security boundary
    await page.route("**/*", (route) => {
      try {
        const reqUrl = new URL(route.request().url());
        if (
          isBlockedHostOrIp(reqUrl.hostname, {
            allowPrivateNetworks: options.allowPrivateNetworks,
            allowedHosts: options.allowedHosts,
          })
        ) {
          return route.abort("blockedbyclient");
        }
      } catch {
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });

    // 6. Iterate through requested routes sequentially
    for (let i = 0; i < requestedRoutes.length; i++) {
      const routeStr = requestedRoutes[i];
      let targetRouteUrl: URL;

      try {
        targetRouteUrl = new URL(routeStr, parsedTarget.origin);
      } catch {
        capturedRoutes.push({
          requestedUrl: routeStr,
          finalUrl: routeStr,
          navigationStatus: "network_error",
          captureStatus: "failed",
          error: `Malformed route path: '${routeStr}'`,
        });
        continue;
      }

      // Ensure route does not escape to another forbidden origin
      if (
        isBlockedHostOrIp(targetRouteUrl.hostname, {
          allowPrivateNetworks: options.allowPrivateNetworks,
          allowedHosts: options.allowedHosts,
        })
      ) {
        capturedRoutes.push({
          requestedUrl: sanitizeUrlForOutput(targetRouteUrl.toString()),
          finalUrl: sanitizeUrlForOutput(targetRouteUrl.toString()),
          navigationStatus: "blocked",
          captureStatus: "failed",
          error: `Navigation to '${targetRouteUrl.hostname}' blocked by network security policy.`,
        });
        continue;
      }

      const sanitizedRequestedUrl = sanitizeUrlForOutput(targetRouteUrl.toString());

      try {
        const response = await page.goto(targetRouteUrl.toString(), {
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });

        const httpStatus = response?.status();
        const currentUrl = page.url();
        const sanitizedFinalUrl = sanitizeUrlForOutput(currentUrl);

        // Check for HTTP errors (404, 500, etc.)
        if (httpStatus && httpStatus >= 400) {
          const isAuth = httpStatus === 401 || httpStatus === 403;
          capturedRoutes.push({
            requestedUrl: sanitizedRequestedUrl,
            finalUrl: sanitizedFinalUrl,
            navigationStatus: isAuth ? "auth_required" : "http_error",
            httpStatus,
            captureStatus: "failed",
            error: isAuth
              ? `HTTP ${httpStatus} - Authentication required to access route`
              : `HTTP ${httpStatus} error received during navigation`,
          });
          continue;
        }

        // Wait briefly for fonts and rendering to settle
        await page.evaluate(() => document.fonts.ready).catch(() => {});

        // Check for login redirect or auth forms
        const isAuthRedirect = await detectAuthRequired(page, currentUrl);

        // Extract DOM evidence
        const domEvidence = await extractDomEvidence(page);

        // Take mobile screenshot
        const screenshotFilename = slugifyRoute(routeStr, i);
        const screenshotPath = path.join(canonicalOutputDir, screenshotFilename);

        const screenshotBuffer = await page.screenshot({
          path: screenshotPath,
          fullPage: options.fullPage ?? false,
          type: "png",
        });

        const { width, height } = verifyPngBuffer(screenshotBuffer);

        capturedRoutes.push({
          requestedUrl: sanitizedRequestedUrl,
          finalUrl: sanitizedFinalUrl,
          navigationStatus: isAuthRedirect ? "auth_required" : "success",
          httpStatus: httpStatus ?? 200,
          captureStatus: "captured",
          screenshot: {
            filePath: screenshotPath,
            width,
            height,
            bytes: screenshotBuffer.length,
          },
          domEvidence,
          warnings: isAuthRedirect
            ? ["Route redirected to or contains an authentication login form."]
            : undefined,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const isTimeout = errMsg.toLowerCase().includes("timeout");

        capturedRoutes.push({
          requestedUrl: sanitizedRequestedUrl,
          finalUrl: sanitizedRequestedUrl,
          navigationStatus: isTimeout ? "timeout" : "network_error",
          captureStatus: "failed",
          error: isTimeout
            ? `Navigation timed out after ${timeoutMs}ms.`
            : `Navigation failed: ${errMsg}`,
        });
      }
    }
  } finally {
    unregisterCleanup();
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  const durationMs = Date.now() - startTime;
  const capturedCount = capturedRoutes.filter((r) => r.captureStatus === "captured").length;
  const failedCount = capturedRoutes.filter((r) => r.captureStatus === "failed").length;
  const authRequiredCount = capturedRoutes.filter((r) => r.navigationStatus === "auth_required").length;

  return {
    success: capturedCount > 0,
    targetUrl: sanitizeUrlForOutput(options.targetUrl),
    outputDir: canonicalOutputDir,
    viewport: {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
    },
    routes: capturedRoutes,
    summary: {
      totalAttempted: requestedRoutes.length,
      capturedCount,
      failedCount,
      authRequiredCount,
      durationMs,
    },
  };
}
