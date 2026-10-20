import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  verifyPngBytes,
  dataUrlToUint8Array,
  sanitizeArchivePrefix,
  packageBrowserStudioZip,
  type RenderedVariantAsset,
} from "./browser-packager";
import { generateVariantsForScreen, variantsToProject } from "./variants";
import type { ObservedScreen } from "../../mcp/ai/schemas";

describe("Browser Studio ZIP Packager & PNG Verifier", () => {
  // Helper to create a valid in-memory PNG typed array
  function createValidPngBytes(width = 1284, height = 2778): Uint8Array {
    const bytes = new Uint8Array(33);
    // Magic PNG header
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // IHDR chunk length: 13
    const view = new DataView(bytes.buffer);
    view.setUint32(8, 13, false);
    // 'IHDR'
    bytes.set([0x49, 0x48, 0x44, 0x52], 12);
    // Width & Height
    view.setUint32(16, width, false);
    view.setUint32(20, height, false);
    // bit depth 8, color type 2, compression 0, filter 0, interlace 0
    bytes.set([8, 2, 0, 0, 0], 24);
    return bytes;
  }

  function bytesToDataUrl(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:image/png;base64,${btoa(binary)}`;
  }

  const sampleScreen: ObservedScreen = {
    id: "screen-analytics",
    route: "/analytics",
    filePath: "data:image/png;base64,fakeData",
    title: "Analytics Suite",
    keyElements: ["Revenue Graph", "Metrics"],
    status: "captured",
  };

  it("verifies valid PNG headers and correctly parses IHDR dimensions", () => {
    const bytes = createValidPngBytes(1284, 2778);
    const parsed = verifyPngBytes(bytes);
    expect(parsed.width).toBe(1284);
    expect(parsed.height).toBe(2778);
  });

  it("rejects non-PNG buffers, truncated data, or corrupt signatures", () => {
    // Truncated
    expect(() => verifyPngBytes(new Uint8Array(10))).toThrow(/minimum 24 bytes/i);

    // Corrupt magic header
    const badMagic = createValidPngBytes(1284, 2778);
    badMagic[0] = 0x00;
    expect(() => verifyPngBytes(badMagic)).toThrow(/Invalid PNG signature/i);

    // Missing IHDR chunk
    const badIhdr = createValidPngBytes(1284, 2778);
    badIhdr[12] = 0x58; // 'X'
    expect(() => verifyPngBytes(badIhdr)).toThrow(/Expected IHDR chunk marker/i);
  });

  it("converts data URLs to Uint8Array accurately", () => {
    const original = createValidPngBytes(1242, 2688);
    const dataUrl = bytesToDataUrl(original);
    const decoded = dataUrlToUint8Array(dataUrl);

    expect(decoded.length).toBe(original.length);
    const verified = verifyPngBytes(decoded);
    expect(verified.width).toBe(1242);
    expect(verified.height).toBe(2688);
  });

  it("sanitizes archive prefix and blocks path traversal characters", () => {
    expect(sanitizeArchivePrefix("../../malicious-export")).toBe("malicious-export");
    expect(sanitizeArchivePrefix("export/dir/name")).toBe("export-dir-name");
    expect(sanitizeArchivePrefix("clean_name-123")).toBe("clean_name-123");
  });

  it("packages verified PNGs, portable project, manifest, and README into a real ZIP archive", async () => {
    const variants = generateVariantsForScreen(sampleScreen, { variantCount: 3 });
    const project = variantsToProject(variants, { projectName: "Test Analytics Studio" });

    const renderedAssets: RenderedVariantAsset[] = variants.map((v) => ({
      variant: v,
      dataUrl: bytesToDataUrl(createValidPngBytes(1284, 2778)),
    }));

    const result = await packageBrowserStudioZip({
      project,
      renderedAssets,
      archiveName: "test-studio-pack",
      targetStore: "apple-app-store",
      exportSizeId: "6.7",
    });

    expect(result.archiveFilename).toBe("test-studio-pack.zip");
    expect(result.fileCount).toBe(6); // 3 PNGs + manifest + project.json + README
    expect(result.manifest.totalScreenshots).toBe(3);
    expect(result.manifest.exportSize.width).toBe(1284);
    expect(result.manifest.exportSize.height).toBe(2778);

    // Inspect the actual unzipped contents
    const zip = await JSZip.loadAsync(result.uint8array || (await result.blob.arrayBuffer()));
    const manifestContent = await zip.file("appshots-export/manifest.json")?.async("string");
    expect(manifestContent).toBeDefined();
    const parsedManifest = JSON.parse(manifestContent!);
    expect(parsedManifest.slides.length).toBe(3);

    // Verify ordering and filenames
    expect(parsedManifest.slides[0].filename).toBe("screen-01-minimal-clean.png");
    expect(parsedManifest.slides[1].filename).toBe("screen-02-bold-gradient.png");
    expect(parsedManifest.slides[2].filename).toBe("screen-03-dark-contrast-3d.png");

    // Verify actual PNGs inside the ZIP
    for (let i = 0; i < 3; i++) {
      const slide = parsedManifest.slides[i];
      const pngFile = await zip.file(`appshots-export/screenshots/${slide.filename}`)?.async("uint8array");
      expect(pngFile).toBeDefined();
      expect(pngFile!.length).toBeGreaterThan(0);

      // Must be real PNG bytes, NOT placeholder text
      const verified = verifyPngBytes(pngFile!);
      expect(verified.width).toBe(1284);
      expect(verified.height).toBe(2778);
      expect(slide.width).toBe(verified.width);
      expect(slide.height).toBe(verified.height);
      expect(slide.bytes).toBe(pngFile!.length);
    }

    // Verify project.json is portable and importable
    const projectJson = await zip.file("appshots-export/project/project.json")?.async("string");
    expect(projectJson).toBeDefined();
    const parsedProject = JSON.parse(projectJson!);
    expect(parsedProject.screenshots.length).toBe(3);
    expect(parsedProject.name).toBe(project.name);

    // Verify README
    const readme = await zip.file("appshots-export/README.txt")?.async("string");
    expect(readme).toContain("AppShots Screenshot Studio");
    expect(readme).toContain("screen-01-minimal-clean.png");
  });

  it("strictly rejects Google Play store export requests", async () => {
    const variants = generateVariantsForScreen(sampleScreen, { variantCount: 3 });
    const project = variantsToProject(variants);
    const renderedAssets: RenderedVariantAsset[] = variants.map((v) => ({
      variant: v,
      dataUrl: bytesToDataUrl(createValidPngBytes(1284, 2778)),
    }));

    await expect(
      packageBrowserStudioZip({
        project,
        renderedAssets,
        targetStore: "google-play",
      }),
    ).rejects.toThrow(/Google Play export is not currently supported/i);
  });

  it("fails safely and never produces an archive if a rendered image is corrupt or placeholder text", async () => {
    const variants = generateVariantsForScreen(sampleScreen, { variantCount: 3 });
    const project = variantsToProject(variants);

    // 1. Placeholder text is too small to be a PNG
    const placeholderAssets: RenderedVariantAsset[] = [
      {
        variant: variants[0],
        dataUrl: "data:image/png;base64,UE5HX1BMQUNFSE9MREVSCg==", // "PNG_PLACEHOLDER"
      },
    ];

    await expect(
      packageBrowserStudioZip({
        project,
        renderedAssets: placeholderAssets,
      }),
    ).rejects.toThrow(/minimum 24 bytes/i);

    // 2. Corrupt signature with sufficient byte length
    const corruptBytes = new Uint8Array(40);
    corruptBytes.fill(0x41); // 'AAAA...'
    const corruptDataUrl = bytesToDataUrl(corruptBytes);

    await expect(
      packageBrowserStudioZip({
        project,
        renderedAssets: [
          {
            variant: variants[0],
            dataUrl: corruptDataUrl,
          },
        ],
      }),
    ).rejects.toThrow(/Invalid PNG signature/i);
  });
});
