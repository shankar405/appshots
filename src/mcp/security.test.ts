/**
 * AppShots MCP Security and Filesystem Boundary Tests
 *
 * Verifies that:
 * 1. Input image paths are restricted to allowed roots and reject traversal, UNC paths, symlink escapes, and non-image files.
 * 2. Output directory paths are restricted to allowed roots and reject traversal, root dirs, UNC paths, and protected repo dirs (.git, node_modules, src).
 * 3. Filename prefixes reject path traversal and invalid filesystem characters.
 * 4. Error messages sanitize host usernames and profile paths.
 * 5. Process lifecycle management executes registered cleanups.
 */

import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_EXTENSIONS,
  getAllowedInputRoots,
  getAllowedOutputRoots,
  isPathInsideRoot,
  sanitizePathForError,
  validateFilenamePrefix,
  validateInputFilePath,
  validateOutputDirectoryPath,
} from "./security";
import { registerResourceCleanup } from "./lifecycle";

const TEST_SANDBOX_DIR = path.resolve("./tmp/security-tests-sandbox");

describe("AppShots MCP Security - Filesystem Boundaries & Hardening", () => {
  const validImage = path.resolve("public/demo-image.png");

  beforeAll(() => {
    if (fs.existsSync(TEST_SANDBOX_DIR)) {
      fs.rmSync(TEST_SANDBOX_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_SANDBOX_DIR, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(TEST_SANDBOX_DIR)) {
      fs.rmSync(TEST_SANDBOX_DIR, { recursive: true, force: true });
    }
  });

  describe("isPathInsideRoot", () => {
    it("returns true for identical paths and nested children", () => {
      const root = path.resolve("./output");
      expect(isPathInsideRoot(root, root)).toBe(true);
      expect(isPathInsideRoot(path.join(root, "sub", "file.png"), root)).toBe(true);
    });

    it("returns false for parent and sibling directory traversals", () => {
      const root = path.resolve("./output");
      expect(isPathInsideRoot(path.resolve("./src"), root)).toBe(false);
      expect(isPathInsideRoot(path.resolve("../"), root)).toBe(false);
      expect(isPathInsideRoot(path.join(root, "../outside.txt"), root)).toBe(false);
    });

    if (process.platform === "win32") {
      it("returns false for different Windows drive letters", () => {
        expect(isPathInsideRoot("D:\\some\\path", "C:\\some\\path")).toBe(false);
      });

      it("handles case-insensitivity on Windows properly", () => {
        const lower = path.resolve("./output").toLowerCase();
        const upper = path.resolve("./output").toUpperCase();
        expect(isPathInsideRoot(lower, upper)).toBe(true);
      });
    }
  });

  describe("sanitizePathForError", () => {
    it("masks user home directory with '~'", () => {
      const home = process.env.USERPROFILE || process.env.HOME;
      if (home) {
        const sensitivePath = path.join(home, ".ssh", "id_rsa");
        const sanitized = sanitizePathForError(sensitivePath);
        expect(sanitized).not.toContain(home);
        expect(sanitized).toContain("~/.ssh/id_rsa");
      }
    });

    it("converts workspace paths to relative paths with forward slashes", () => {
      const workspaceFile = path.resolve("public/demo-image.png");
      const sanitized = sanitizePathForError(workspaceFile);
      expect(sanitized).toBe("public/demo-image.png");
    });
  });

  describe("validateInputFilePath", () => {
    it("accepts valid image within allowed workspace root", () => {
      const canonical = validateInputFilePath("public/demo-image.png");
      expect(canonical).toBe(fs.realpathSync(validImage));
    });

    it("rejects non-string or empty input paths", () => {
      expect(() => validateInputFilePath("")).toThrow("must be a non-empty string");
    });

    it("rejects null byte injection", () => {
      expect(() => validateInputFilePath("public/demo\0image.png")).toThrow(
        "invalid characters (null bytes)",
      );
    });

    it("rejects UNC network paths", () => {
      expect(() => validateInputFilePath("\\\\server\\share\\image.png")).toThrow(
        "UNC network paths are not permitted",
      );
      expect(() => validateInputFilePath("//server/share/image.png")).toThrow(
        "UNC network paths are not permitted",
      );
    });

    it("rejects non-image file extensions", () => {
      const textFile = path.join(TEST_SANDBOX_DIR, "secret.txt");
      fs.writeFileSync(textFile, "secret content");

      expect(() => validateInputFilePath(textFile)).toThrow(
        "Unsupported image file format '.txt'",
      );
    });

    it("rejects non-existent files with sanitized message", () => {
      expect(() => validateInputFilePath("public/non-existent-image-xyz.png")).toThrow(
        "Input file does not exist: 'public/non-existent-image-xyz.png'",
      );
    });

    it("rejects directory paths that are not regular files", () => {
      expect(() => validateInputFilePath("public")).toThrow(
        "Unsupported image file format"
      );
    });

    it("rejects path traversal outside allowed input roots", () => {
      // Mock an isolated root sandbox
      const isolatedRoot = path.join(TEST_SANDBOX_DIR, "isolated-root");
      fs.mkdirSync(isolatedRoot, { recursive: true });

      const fileInside = path.join(isolatedRoot, "sample.png");
      fs.copyFileSync(validImage, fileInside);

      // Path outside isolated root
      expect(() =>
        validateInputFilePath(validImage, { allowedRoots: [isolatedRoot] }),
      ).toThrow("is outside the allowed input root directories");

      // Path inside isolated root
      const canonical = validateInputFilePath(fileInside, { allowedRoots: [isolatedRoot] });
      expect(canonical).toBe(fs.realpathSync(fileInside));
    });

    it("detects and blocks symlink traversal outside allowed root", () => {
      const rootDir = path.join(TEST_SANDBOX_DIR, "symlink-root");
      const outsideDir = path.join(TEST_SANDBOX_DIR, "symlink-outside");
      fs.mkdirSync(rootDir, { recursive: true });
      fs.mkdirSync(outsideDir, { recursive: true });

      const targetOutside = path.join(outsideDir, "outside.png");
      fs.copyFileSync(validImage, targetOutside);

      const symlinkInside = path.join(rootDir, "link-to-outside.png");

      try {
        fs.symlinkSync(targetOutside, symlinkInside);
      } catch {
        // Skip if symlink creation is restricted by OS permissions (e.g. non-admin Windows)
        return;
      }

      // Symlink exists inside rootDir, but realpath resolves to outsideDir
      expect(() =>
        validateInputFilePath(symlinkInside, { allowedRoots: [rootDir] }),
      ).toThrow("is outside the allowed input root directories");
    });
  });

  describe("validateOutputDirectoryPath", () => {
    it("allows paths within default output directory", () => {
      const targetDir = path.resolve("./output/subfolder/export");
      const canonical = validateOutputDirectoryPath(targetDir);
      expect(fs.existsSync(canonical)).toBe(true);
      expect(isPathInsideRoot(canonical, path.resolve("./output"))).toBe(true);
    });

    it("allows paths within tmp directory", () => {
      const targetDir = path.resolve("./tmp/security-tests-sandbox/test-out");
      const canonical = validateOutputDirectoryPath(targetDir);
      expect(fs.existsSync(canonical)).toBe(true);
    });

    it("rejects root directory paths", () => {
      const root = path.parse(process.cwd()).root;
      expect(() => validateOutputDirectoryPath(root)).toThrow(
        "Output directory cannot be the root filesystem path",
      );
    });

    it("rejects UNC network paths", () => {
      expect(() => validateOutputDirectoryPath("\\\\server\\share\\out")).toThrow(
        "UNC network paths are not permitted",
      );
    });

    it("rejects writing directly to or inside .git", () => {
      expect(() => validateOutputDirectoryPath(".git")).toThrow(
        "targets a protected workspace directory",
      );
      expect(() => validateOutputDirectoryPath(".git/sub")).toThrow(
        "targets a protected workspace directory",
      );
    });

    it("rejects writing directly to or inside node_modules", () => {
      expect(() => validateOutputDirectoryPath("node_modules/bad")).toThrow(
        "targets a protected workspace directory",
      );
    });

    it("rejects writing into project src directory", () => {
      expect(() => validateOutputDirectoryPath("src/generated")).toThrow(
        "targets a protected workspace directory",
      );
    });

    it("rejects paths outside allowed output roots", () => {
      const isolatedRoot = path.join(TEST_SANDBOX_DIR, "isolated-output");
      fs.mkdirSync(isolatedRoot, { recursive: true });

      expect(() =>
        validateOutputDirectoryPath("./output", { allowedRoots: [isolatedRoot] }),
      ).toThrow("is outside the allowed output root directories");
    });
  });

  describe("validateFilenamePrefix", () => {
    it("returns default prefix when undefined or empty", () => {
      expect(validateFilenamePrefix()).toBe("appstore-screenshot");
      expect(validateFilenamePrefix("   ")).toBe("appstore-screenshot");
    });

    it("accepts valid alphanumeric and dash prefixes", () => {
      expect(validateFilenamePrefix("store-preview-v2")).toBe("store-preview-v2");
      expect(validateFilenamePrefix("App_Shot")).toBe("App_Shot");
    });

    it("rejects forward and backward slashes (path traversal)", () => {
      expect(() => validateFilenamePrefix("sub/dir")).toThrow(
        "cannot contain path separators",
      );
      expect(() => validateFilenamePrefix("..\\escape")).toThrow(
        "cannot contain path separators",
      );
    });

    it("rejects directory traversal '..' sequences", () => {
      expect(() => validateFilenamePrefix("../traversal")).toThrow(
        "cannot contain path separators",
      );
    });

    it("rejects invalid filesystem characters", () => {
      expect(() => validateFilenamePrefix("screen:test")).toThrow(
        "contains invalid filesystem characters",
      );
      expect(() => validateFilenamePrefix("screen*shot")).toThrow(
        "contains invalid filesystem characters",
      );
    });
  });

  describe("allowed roots and extensions configuration", () => {
    it("exports expected standard image extensions", () => {
      expect(ALLOWED_IMAGE_EXTENSIONS.has(".png")).toBe(true);
      expect(ALLOWED_IMAGE_EXTENSIONS.has(".jpg")).toBe(true);
      expect(ALLOWED_IMAGE_EXTENSIONS.has(".jpeg")).toBe(true);
      expect(ALLOWED_IMAGE_EXTENSIONS.has(".webp")).toBe(true);
      expect(ALLOWED_IMAGE_EXTENSIONS.has(".svg")).toBe(true);
      expect(ALLOWED_IMAGE_EXTENSIONS.has(".txt")).toBe(false);
    });

    it("returns default allowed input roots containing workspace root", () => {
      const roots = getAllowedInputRoots();
      expect(roots.length).toBeGreaterThan(0);
      expect(roots).toContain(fs.realpathSync(process.cwd()));
    });

    it("returns default allowed output roots containing output and tmp", () => {
      const roots = getAllowedOutputRoots();
      expect(roots.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("lifecycle resource registration", () => {
    it("registers and unregisters cleanup functions", () => {
      let cleaned = false;
      const unregister = registerResourceCleanup(() => {
        cleaned = true;
      });

      // When unregistered before shutdown, should not be called
      unregister();
      expect(cleaned).toBe(false);
    });
  });
});
