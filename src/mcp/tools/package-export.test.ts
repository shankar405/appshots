import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { packageStoreExport } from "./package-export";
import { generateVariantsForScreen, variantsToProject } from "../../lib/studio/variants";

describe("package_store_export Tool", () => {
  const testOutputDir = path.resolve("./output/test-package-export");
  const fixtureDir = path.resolve("./output/test-package-export-fixtures");
  const sampleImagePath = path.join(fixtureDir, "sample-screen.png");

  // Minimal valid 10x10 PNG
  function createTestPng(width = 1284, height = 2778): Buffer {
    const buffer = Buffer.alloc(33);
    buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    buffer.writeUInt32BE(13, 8);
    buffer.write("IHDR", 12, "ascii");
    buffer.writeUInt32BE(width, 16);
    buffer.writeUInt32BE(height, 20);
    buffer.set([8, 6, 0, 0, 0], 24);
    buffer.writeUInt32BE(0x12345678, 29);
    return buffer;
  }

  beforeAll(() => {
    fs.mkdirSync(testOutputDir, { recursive: true });
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(sampleImagePath, createTestPng(1284, 2778));
  });

  afterAll(() => {
    try {
      if (fs.existsSync(testOutputDir)) {
        fs.rmSync(testOutputDir, { recursive: true, force: true });
      }
      if (fs.existsSync(fixtureDir)) {
        fs.rmSync(fixtureDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup
    }
  });

  it("packages store export from an array of approved design variants", async () => {
    const variants = generateVariantsForScreen(
      {
        id: "screen-1",
        route: "/dashboard",
        filePath: sampleImagePath,
        title: "Analytics Dashboard",
      },
      { variantCount: 3 },
    );

    const result = await packageStoreExport(
      {
        projectName: "Analytics Pro Export",
        variants: variants as any,
        outputDir: testOutputDir,
        archiveName: "analytics-bundle",
        preset: "6.7",
      },
      { allowedRoots: [testOutputDir, fixtureDir], allowedOutputRoots: [testOutputDir] },
    );

    expect(result.success).toBe(true);
    expect(result.projectName).toBe("Analytics Pro Export");
    expect(result.archiveFilename).toBe("analytics-bundle.zip");
    expect(fs.existsSync(result.archivePath)).toBe(true);
    expect(result.fileCount).toBe(3);

    // Verify ZIP structure
    const zipData = fs.readFileSync(result.archivePath);
    const zip = await JSZip.loadAsync(zipData);

    expect(zip.file("appshots-export/manifest.json")).not.toBeNull();
    expect(zip.file("appshots-export/README.txt")).not.toBeNull();
    expect(zip.file("appshots-export/project/project.json")).not.toBeNull();

    // Verify manifest contents
    const manifest = JSON.parse(await zip.file("appshots-export/manifest.json")!.async("text"));
    expect(manifest.projectName).toBe("Analytics Pro Export");
    expect(manifest.totalScreenshots).toBe(3);
    expect(manifest.exportSize.width).toBe(1284);
    expect(manifest.exportSize.height).toBe(2778);

    // Verify temporary staging directory was cleaned up
    const remainingDirs = fs
      .readdirSync(testOutputDir)
      .filter((name) => name.startsWith("__staging_"));
    expect(remainingDirs).toHaveLength(0);
  }, 45000);

  it("packages store export from a stringified project JSON", async () => {
    const variants = generateVariantsForScreen(
      {
        id: "screen-home",
        route: "/",
        filePath: sampleImagePath,
        title: "Home",
      },
      { variantCount: 3 },
    );

    const project = variantsToProject(variants, {
      projectName: "Direct Project Export",
      exportSizeId: "6.7",
    });

    const result = await packageStoreExport(
      {
        project: JSON.stringify(project),
        outputDir: testOutputDir,
        archiveName: "direct-project-bundle",
        preset: "6.7",
      },
      { allowedRoots: [testOutputDir, fixtureDir], allowedOutputRoots: [testOutputDir] },
    );

    expect(result.success).toBe(true);
    expect(result.archiveFilename).toBe("direct-project-bundle.zip");
    expect(fs.existsSync(result.archivePath)).toBe(true);
  }, 45000);

  it("rejects Google Play targetStore with explicit unsupported-format error", async () => {
    const variants = generateVariantsForScreen({
      id: "screen-1",
      route: "/",
      filePath: sampleImagePath,
      title: "Home",
    });

    await expect(
      packageStoreExport(
        {
          variants: variants as any,
          targetStore: "google-play",
          outputDir: testOutputDir,
        },
        { allowedRoots: [testOutputDir, fixtureDir], allowedOutputRoots: [testOutputDir] },
      ),
    ).rejects.toThrow(/Google Play export is not currently supported/);
  });

  it("rejects output directories outside allowed output roots", async () => {
    const variants = generateVariantsForScreen({
      id: "screen-1",
      route: "/",
      filePath: sampleImagePath,
      title: "Home",
    });

    await expect(
      packageStoreExport(
        {
          variants: variants as any,
          outputDir: "C:/unauthorized-path/output",
        },
        { allowedRoots: [testOutputDir], allowedOutputRoots: [testOutputDir] },
      ),
    ).rejects.toThrow();
  });

  it("throws clear error when neither project nor variants are provided", async () => {
    await expect(
      packageStoreExport(
        {
          outputDir: testOutputDir,
        } as any,
        { allowedRoots: [testOutputDir], allowedOutputRoots: [testOutputDir] },
      ),
    ).rejects.toThrow("Either 'project' or 'variants' must be provided to package a store export.");
  });
});
