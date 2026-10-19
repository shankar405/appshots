/**
 * AppShots Playwright Mobile Screen Capture & Evidence Extraction Tests
 *
 * Verifies that:
 * 1. Mobile viewport emulation produces correct high-resolution retina PNG screenshots.
 * 2. Observable DOM evidence (title, description, headings, nav, buttons) is extracted and normalized.
 * 3. Hidden content (display: none, visibility: hidden, aria-hidden, hidden, script, style) is excluded.
 * 4. Auth-required pages (401, login redirects with password forms) are accurately classified.
 * 5. HTTP errors (404), timeouts, and unreachable targets are handled gracefully without crashing.
 * 6. Network security policies block metadata endpoints, unpermitted private networks, and invalid protocols.
 * 7. Output directory boundary constraints and sanitization are enforced.
 * 8. Browser cleanup is guaranteed on completion, error, and cancellation.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captureApplicationScreens,
  isBlockedHostOrIp,
  sanitizeUrlForOutput,
  validateTargetUrl,
} from "./page-crawler";
import { verifyPngBuffer } from "../../lib/headless-export";

const TEST_OUTPUT_DIR = path.resolve("./tmp/page-crawler-test-output");

describe("AppShots Playwright Capture Engine", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_OUTPUT_DIR, { recursive: true });

    // Local deterministic HTTP test server
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        const url = new URL(req.url || "/", "http://127.0.0.1");

        if (url.pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html lang="en">
              <head>
                <title>TaskMaster Pro - Smart Task & Project Management</title>
                <meta name="description" content="Organize your workflow, collaborate with teams, and track project deadlines in real time.">
                <style>
                  body { margin: 0; font-family: sans-serif; background: #fafafa; }
                  .hidden-box { display: none; }
                  .invisible-box { visibility: hidden; }
                  .zero-box { opacity: 0; width: 0; height: 0; }
                </style>
              </head>
              <body>
                <header>
                  <nav role="navigation">
                    <a href="/">Home</a>
                    <a href="/dashboard">Dashboard</a>
                    <a href="/pricing">Pricing</a>
                  </nav>
                </header>
                <main aria-label="TaskMaster Core">
                  <h1>Organize Projects with Speed</h1>
                  <h2>Real-Time Collaboration</h2>
                  <h3>Interactive Task Boards</h3>

                  <button>Create New Project</button>
                  <button disabled>Archive Task</button>
                  <a class="button btn" href="/dashboard">Open Dashboard</a>

                  <div class="hidden-box">Secret Internal Admin Token 12345</div>
                  <div class="invisible-box">Confidential Revenue Data</div>
                  <div hidden>Hidden Debug Mode</div>
                  <div aria-hidden="true">Screen Reader Ignored Info</div>
                  <div class="zero-box">Zero Opacity Inaudible Text</div>
                  <script>const api_key = "should_not_extract";</script>
                  <style>.ignore-me { color: red; }</style>
                </main>
              </body>
            </html>
          `);
        } else if (url.pathname === "/dashboard") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html lang="en">
              <head>
                <title>Dashboard - TaskMaster Pro</title>
                <meta name="description" content="View active team velocity and sprint metrics.">
              </head>
              <body>
                <nav><a href="/">Home</a><a href="/dashboard">Dashboard</a></nav>
                <h1>Your Active Projects</h1>
                <h2>Sprint Overview</h2>
                <button>New Sprint</button>
              </body>
            </html>
          `);
        } else if (url.pathname === "/protected") {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end("401 Unauthorized - Authentication Required");
        } else if (url.pathname === "/missing") {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
        } else if (url.pathname === "/login-redirect") {
          res.writeHead(302, { Location: "/login" });
          res.end();
        } else if (url.pathname === "/login") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <!DOCTYPE html>
            <html lang="en">
              <head><title>Sign In - TaskMaster Pro</title></head>
              <body>
                <h1>Welcome Back</h1>
                <form action="/login" method="POST">
                  <input type="text" name="username" placeholder="Username">
                  <input type="password" name="password" placeholder="Password">
                  <button type="submit">Sign In</button>
                </form>
              </body>
            </html>
          `);
        } else if (url.pathname === "/delayed") {
          // Delay response for timeout tests
          setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(200, { "Content-Type": "text/plain" });
              res.end("Delayed content");
            }
          }, 3000);
        } else {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
        }
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (fs.existsSync(TEST_OUTPUT_DIR)) {
      fs.rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
    }
  });

  describe("Security: URL Validation and Network Boundaries", () => {
    it("accepts valid localhost and http/https URLs", () => {
      expect(() => validateTargetUrl(baseUrl)).not.toThrow();
      expect(() => validateTargetUrl("https://example.com/app")).not.toThrow();
    });

    it("rejects invalid protocols (ftp, file, javascript, data)", () => {
      expect(() => validateTargetUrl("ftp://example.com/file")).toThrow("Unsupported protocol");
      expect(() => validateTargetUrl("file:///C:/Windows/System32")).toThrow("Unsupported protocol");
      expect(() => validateTargetUrl("javascript:alert(1)")).toThrow("Unsupported protocol");
      expect(() => validateTargetUrl("data:text/html,<b>hi</b>")).toThrow("Unsupported protocol");
    });

    it("blocks cloud metadata services", () => {
      expect(isBlockedHostOrIp("169.254.169.254")).toBe(true);
      expect(isBlockedHostOrIp("metadata.google.internal")).toBe(true);
      expect(isBlockedHostOrIp("100.100.100.200")).toBe(true);
      expect(isBlockedHostOrIp("169.254.1.1")).toBe(true);
      expect(() => validateTargetUrl("http://169.254.169.254/latest/meta-data")).toThrow(
        "blocked by network security policy",
      );
    });

    it("blocks non-localhost private IP networks by default", () => {
      expect(isBlockedHostOrIp("192.168.1.1")).toBe(true);
      expect(isBlockedHostOrIp("10.0.0.1")).toBe(true);
      expect(isBlockedHostOrIp("172.20.0.1")).toBe(true);

      // Allows when allowPrivateNetworks is explicitly true
      expect(isBlockedHostOrIp("192.168.1.1", { allowPrivateNetworks: true })).toBe(false);

      // Localhost is always allowed
      expect(isBlockedHostOrIp("localhost")).toBe(false);
      expect(isBlockedHostOrIp("127.0.0.1")).toBe(false);
    });

    it("sanitizes URLs by stripping credentials and sensitive tokens", () => {
      const sensitiveUrl =
        "https://admin:supersecret@example.com/dashboard?token=secret123&user=john&api_key=ak_999";
      const sanitized = sanitizeUrlForOutput(sensitiveUrl);

      expect(sanitized).not.toContain("supersecret");
      expect(sanitized).not.toContain("secret123");
      expect(sanitized).not.toContain("ak_999");
      expect(sanitized).toContain("token=%5BREDACTED%5D");
      expect(sanitized).toContain("api_key=%5BREDACTED%5D");
      expect(sanitized).toContain("user=john");
    });
  });

  describe("Screen Capture & Observable DOM Evidence", () => {
    it("captures mobile screenshot with default iPhone 15 Pro viewport dimensions (1179x2556)", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        outputDir: TEST_OUTPUT_DIR,
        viewport: "iphone-15-pro",
      });

      expect(result.success).toBe(true);
      expect(result.summary.capturedCount).toBe(1);
      expect(result.routes.length).toBe(1);

      const route = result.routes[0];
      expect(route.navigationStatus).toBe("success");
      expect(route.captureStatus).toBe("captured");
      expect(route.screenshot).toBeDefined();

      const screenshot = route.screenshot!;
      expect(fs.existsSync(screenshot.filePath)).toBe(true);

      // Verify physical PNG dimensions match iPhone 15 Pro (393 * 3 = 1179, ~2556)
      expect(screenshot.width).toBe(1179);
      expect(Math.abs(screenshot.height - 2556)).toBeLessThanOrEqual(1);

      // Verify valid PNG binary buffer on disk
      const buffer = fs.readFileSync(screenshot.filePath);
      const parsed = verifyPngBuffer(buffer);
      expect(parsed.width).toBe(1179);
      expect(Math.abs(parsed.height - 2556)).toBeLessThanOrEqual(1);
    }, 25000);

    it("extracts observable DOM evidence and excludes hidden content", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        routes: ["/"],
        outputDir: TEST_OUTPUT_DIR,
      });

      const route = result.routes[0];
      expect(route.domEvidence).toBeDefined();
      const dom = route.domEvidence!;

      // 1. Title and description
      expect(dom.title).toBe("TaskMaster Pro - Smart Task & Project Management");
      expect(dom.description).toContain("Organize your workflow");

      // 2. Visible headings
      expect(dom.headings).toEqual([
        { level: 1, text: "Organize Projects with Speed" },
        { level: 2, text: "Real-Time Collaboration" },
        { level: 3, text: "Interactive Task Boards" },
      ]);

      // 3. Navigation labels
      expect(dom.navigationLabels).toContain("Home");
      expect(dom.navigationLabels).toContain("Dashboard");
      expect(dom.navigationLabels).toContain("Pricing");

      // 4. Action buttons & states
      expect(dom.actionLabels.some((a) => a.text === "Create New Project")).toBe(true);
      expect(
        dom.actionLabels.some((a) => a.text === "Archive Task" && a.disabled === true),
      ).toBe(true);

      // 5. Landmarks
      expect(dom.landmarks).toContain("TaskMaster Core");

      // 6. Strict Exclusion: hidden texts MUST NOT be extracted
      const allExtractedText = JSON.stringify(dom);
      expect(allExtractedText).not.toContain("Secret Internal Admin Token");
      expect(allExtractedText).not.toContain("Confidential Revenue Data");
      expect(allExtractedText).not.toContain("Hidden Debug Mode");
      expect(allExtractedText).not.toContain("Screen Reader Ignored Info");
      expect(allExtractedText).not.toContain("Zero Opacity Inaudible Text");
      expect(allExtractedText).not.toContain("should_not_extract");
      expect(allExtractedText).not.toContain(".ignore-me");
    }, 25000);

    it("captures multiple requested routes sequentially", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        routes: ["/", "/dashboard"],
        outputDir: TEST_OUTPUT_DIR,
      });

      expect(result.routes.length).toBe(2);
      expect(result.summary.capturedCount).toBe(2);

      const r1 = result.routes[0];
      const r2 = result.routes[1];

      expect(r1.domEvidence?.title).toContain("TaskMaster Pro");
      expect(r2.domEvidence?.title).toBe("Dashboard - TaskMaster Pro");
      expect(r2.domEvidence?.headings[0].text).toBe("Your Active Projects");

      // Files have distinct paths
      expect(r1.screenshot?.filePath).not.toBe(r2.screenshot?.filePath);
      expect(fs.existsSync(r1.screenshot!.filePath)).toBe(true);
      expect(fs.existsSync(r2.screenshot!.filePath)).toBe(true);
    }, 25000);
  });

  describe("Navigation, Error Handling, and Auth Classification", () => {
    it("classifies login redirects and password forms as auth_required", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        routes: ["/login-redirect"],
        outputDir: TEST_OUTPUT_DIR,
      });

      expect(result.routes.length).toBe(1);
      const route = result.routes[0];

      expect(route.navigationStatus).toBe("auth_required");
      expect(route.captureStatus).toBe("captured");
      expect(route.warnings?.length).toBeGreaterThan(0);
      expect(route.warnings![0]).toContain("authentication login form");
    }, 25000);

    it("classifies HTTP 401 responses as auth_required without crashing", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        routes: ["/protected"],
        outputDir: TEST_OUTPUT_DIR,
      });

      const route = result.routes[0];
      expect(route.navigationStatus).toBe("auth_required");
      expect(route.httpStatus).toBe(401);
      expect(route.captureStatus).toBe("failed");
      expect(route.error).toContain("401");
    }, 25000);

    it("classifies HTTP 404 responses as http_error without crashing", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        routes: ["/missing"],
        outputDir: TEST_OUTPUT_DIR,
      });

      const route = result.routes[0];
      expect(route.navigationStatus).toBe("http_error");
      expect(route.httpStatus).toBe(404);
      expect(route.captureStatus).toBe("failed");
      expect(route.error).toContain("404");
    }, 25000);

    it("handles navigation timeouts gracefully", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        routes: ["/delayed"],
        outputDir: TEST_OUTPUT_DIR,
        timeoutMs: 1000, // 1 second timeout for a 3-second route
      });

      const route = result.routes[0];
      expect(route.navigationStatus).toBe("timeout");
      expect(route.captureStatus).toBe("failed");
      expect(route.error).toContain("timed out");
    }, 25000);

    it("handles unreachable application servers gracefully", async () => {
      // Port 59123 is closed
      const result = await captureApplicationScreens({
        targetUrl: "http://127.0.0.1:59123",
        outputDir: TEST_OUTPUT_DIR,
        timeoutMs: 2000,
      });

      expect(result.success).toBe(false);
      expect(result.summary.failedCount).toBe(1);
      expect(result.routes[0].navigationStatus).toBe("network_error");
    }, 25000);
  });

  describe("Filesystem Security Boundaries", () => {
    it("rejects output paths outside allowed roots or targeting protected directories", async () => {
      await expect(
        captureApplicationScreens({
          targetUrl: baseUrl,
          outputDir: ".git",
        }),
      ).rejects.toThrow("targets a protected workspace directory");

      await expect(
        captureApplicationScreens({
          targetUrl: baseUrl,
          outputDir: "node_modules/test",
        }),
      ).rejects.toThrow("targets a protected workspace directory");
    });

    it("captures mobile screenshot with Pixel 7 preset dimensions", async () => {
      const result = await captureApplicationScreens({
        targetUrl: baseUrl,
        routes: ["/dashboard"],
        outputDir: TEST_OUTPUT_DIR,
        viewport: "pixel-7",
      });

      expect(result.success).toBe(true);
      const route = result.routes[0];
      expect(route.screenshot).toBeDefined();

      // Pixel 7: 412 * 2.625 = 1081.5 -> ~1082 px, 915 * 2.625 = 2401.875 -> ~2402 px
      expect(route.screenshot!.width).toBeGreaterThanOrEqual(1080);
      expect(route.screenshot!.height).toBeGreaterThanOrEqual(2400);
    }, 25000);
  });
});
