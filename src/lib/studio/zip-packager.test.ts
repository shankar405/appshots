import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createStudioZipArchive,
  sanitizeArchivePath,
  type PackageStudioArchiveOptions,
} from "./zip-packager";
import { variantsToProject, generateVariantsForScreen } from "./variants";
import { verifyPngBuffer } from "../headless-export";

describe("Studio ZIP Archive Packager", () => {
  const testOutputDir = path.resolve("./output/test-packager-output");
  const testFixtureDir = path.resolve("./output/test-packager-fixtures");
  const testPngPath = path.join(testFixtureDir, "test-fixture-screen.png");

  // Create a minimal 10x10 valid PNG buffer with valid PNG signature and IHDR
  function createTestPngBuffer(width = 1284, height = 2778): Buffer {
    // 8-byte PNG header + IHDR chunk (13 bytes) + CRC (4 bytes) + dummy IEND
    const buffer = Buffer.alloc(33);
    // Header: 89 50 4E 47 0D 0A 1A 0A
    buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // IHDR length: 13 bytes
    buffer.writeUInt32BE(13, 8);
    // IHDR type
    buffer.write("IHDR", 12, "ascii");
    // Dimensions
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    // Bit depth (8), color type (6), compression (0), filter (0), interlace (0)
    buffer.set([8, 6, 0, 0, 0], 24);
    // CRC placeholder
    buffer.writeUInt32BE(0x12345678, 29);
    return buffer;
  }

  beforeAll(() => {
    fs.mkdirSync(testOutputDir, { recursive: true });
    fs.mkdirSync(testFixtureDir, { recursive: true });
    fs.writeFileSync(testPngPath, createTestPngBuffer(1284, 2778));
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true, force: true });
      }
      if (fs.existsSync(testFixtureDir)) {
        fs.rmSync(testFixtureDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe("Archive Path Sanitization & Security", () => {
    it("accepts valid relative archive entry paths", () => {
      expect(sanitizeArchivePath("screenshots/screen-1.png")).toBe("screenshots/screen-1.png");
      expect(sanitizeArchivePath("project/project.json")).toBe("project/project.json");
      expect(sanitizeArchivePath("manifest.json")).toBe("manifest.json");
    });

    it("rejects path traversal attempts containing '..'", () => {
      expect(() => sanitizeArchivePath("../secrets.txt")).toThrow(/Insecure archive entry path/);
      expect(() => sanitizeArchivePath("screenshots/../../etc/passwd")).toThrow(/Insecure archive entry path/);
    });

    it("rejects sensitive files matching forbidden patterns", () => {
      expect(() => sanitizeArchivePath(".env")).toThrow(/Forbidden archive entry path pattern/);
      expect(() => sanitizeArchivePath(".env.local")).toThrow(/Forbidden archive entry path pattern/);
      expect(() => sanitizeArchivePath(".git/config")).toThrow(/Forbidden archive entry path pattern/);
      expect(() => sanitizeArchivePath("node_modules/package.json")).toThrow(/Forbidden archive entry path pattern/);
      expect(() => sanitizeArchivePath("id_rsa")).toThrow(/Forbidden archive entry path pattern/);
    });
  });

  describe("ZIP Archive Creation & Structure", () => {
    it("packages valid screenshots, manifest, README, and portable project into ZIP", async () => {
      const variants = generateVariantsForScreen({
        id: "screen-home",
        route: "/",
        filePath: testPngPath,
        title: "Home Screen",
      }, { variantCount: 3 });

      const project = variantsToProject(variants, {
        projectName: "Packager Test App",
        exportSizeId: "6.7",
      });

      const options: PackageStudioArchiveOptions = {
        project,
        renderedFiles: [
          {
            filepath: testPngPath,
            variantId: "var-1-minimal",
            sourceRoute: "/",
            headline: "Headline 1",
            subheadline: "Subheadline 1",
          },
          {
            filepath: testPngPath,
            variantId: "var-2-bold",
            sourceRoute: "/",
            headline: "Headline 2",
            subheadline: "Subheadline 2",
          },
        ],
        outputDir: testOutputDir,
        archiveName: "test-studio-bundle",
        targetStore: "apple-app-store",
        allowedRoots: [testOutputDir, testFixtureDir],
      };

      const result = await createStudioZipArchive(options);

      expect(result.success).toBe(true);
      expect(result.archiveFilename).toBe("test-studio-bundle.zip");
      expect(fs.existsSync(result.archivePath)).toBe(true);
      expect(result.bytes).toBeGreaterThan(100);
      expect(result.fileCount).toBe(2);

      // Verify ZIP contents using JSZip
      const zipBuffer = fs.readFileSync(result.archivePath);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Check root files
      expect(zip.file("appshots-export/manifest.json")).not.toBeNull();
      expect(zip.file("appshots-export/README.txt")).not.toBeNull();
      expect(zip.file("appshots-export/project/project.json")).not.toBeNull();

      // Check screenshots
      expect(zip.file("appshots-export/screenshots/screen-01-var-1-minimal.png")).not.toBeNull();
      expect(zip.file("appshots-export/screenshots/screen-02-var-2-bold.png")).not.toBeNull();

      // Check manifest accuracy
      const manifestText = await zip.file("appshots-export/manifest.json")!.async("text");
      const manifest = JSON.parse(manifestText);

      expect(manifest.projectName).toBe("Packager Test App");
      expect(manifest.targetStore).toBe("apple-app-store");
      expect(manifest.totalScreenshots).toBe(2);
      expect(manifest.slides).toHaveLength(2);
      expect(manifest.slides[0].width).toBe(1284);
      expect(manifest.slides[0].height).toBe(2778);
      expect(manifest.slides[0].bytes).toBe(fs.statSync(testPngPath).size);

      // Verify PNG headers of packed screenshot
      const screen1Buffer = await zip.file("appshots-export/screenshots/screen-01-var-1-minimal.png")!.async("nodebuffer");
      const verifiedDims = verifyPngBuffer(screen1Buffer);
      expect(verifiedDims.width).toBe(1284);
      expect(verifiedDims.height).toBe(2778);

      // Verify README instructions
      const readmeText = await zip.file("appshots-export/README.txt")!.async("text");
      expect(readmeText).toContain("AppShots Screenshot Studio");
      expect(readmeText).toContain("How to Reopen and Edit in AppShots:");
    });

    it("throws descriptive error when a rendered screenshot file is missing from disk", async () => {
      const variants = generateVariantsForScreen({
        id: "screen-home",
        route: "/",
        filePath: testPngPath,
        title: "Home",
      });
      const project = variantsToProject(variants);

      const options: PackageStudioArchiveOptions = {
        project,
        renderedFiles: [
          {
            filepath: path.join(testFixtureDir, "non-existent-image.png"),
            variantId: "missing-variant",
          },
        ],
        outputDir: testOutputDir,
        allowedRoots: [testOutputDir, testFixtureDir],
      };

      await expect(createStudioZipArchive(options)).rejects.toThrow(
        /Rendered screenshot file not found on disk/,
      );
    });

    it("throws clear error when project has no screenshots or files", async () => {
      const emptyProject = variantsToProject(generateVariantsForScreen({
        id: "s1", route: "/", filePath: testPngPath, title: "S1",
      }));
      emptyProject.screenshots = [];

      await expect(
        createStudioZipArchive({
          project: emptyProject,
          renderedFiles: [{ filepath: testPngPath }],
          outputDir: testOutputDir,
          allowedRoots: [testOutputDir, testFixtureDir],
        }),
      ).rejects.toThrow("Cannot package archive: project has no screenshots.");
    });
  });
});
