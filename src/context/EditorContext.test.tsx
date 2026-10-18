/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider, useEditor } from "./EditorContext";
import { Toolbar } from "../components/CanvasPreview/Toolbar";
import { ScreenshotImageSection } from "../components/RightSidebar/ScreenshotImageSection";
import { OverlayImagesSection } from "../components/RightSidebar/OverlayImagesSection";
import type { PersistedEditorState } from "../lib/useLocalStorage";
import * as imageOptimizer from "../lib/image-optimizer";

const STORAGE_KEY = "app-screenshot-editor-state";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const TestHarness = () => {
  const {
    projects,
    activeProjectId,
    activeProject,
    createProject,
    autosaveStatus,
  } = useEditor();

  return (
    <div>
      <span data-testid="autosave-status">{autosaveStatus}</span>
      <span data-testid="active-project-id">{activeProjectId}</span>
      <span data-testid="active-project-name">{activeProject.name}</span>
      <span data-testid="projects-count">{projects.length}</span>
      <button onClick={() => createProject("Brand New Project")}>
        Create Project
      </button>
    </div>
  );
};

describe("EditorContext - createProject", () => {
  it("creates a new project and immediately makes it the active project", () => {
    render(
      <EditorProvider>
        <TestHarness />
      </EditorProvider>,
    );

    expect(screen.getByTestId("active-project-name").textContent).toBe("My Project");
    expect(screen.getByTestId("projects-count").textContent).toBe("1");
    expect(screen.getByTestId("autosave-status").textContent).toBe("saved");

    fireEvent.click(screen.getByRole("button", { name: "Create Project" }));

    // The project should exist in the projects list
    expect(screen.getByTestId("projects-count").textContent).toBe("2");

    // Defect verification: Newly created project should become the active project
    expect(screen.getByTestId("active-project-name").textContent).toBe("Brand New Project");
  });

  it("exposes initial autosaveStatus as 'saved'", () => {
    render(
      <EditorProvider>
        <TestHarness />
      </EditorProvider>,
    );

    expect(screen.getByTestId("autosave-status").textContent).toBe("saved");
  });
});

const createTestProject = (id: string, name: string) => ({
  id,
  name,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  screenshots: [
    {
      id: "s-1",
      headline: "Showcase Your App",
      subheadline: "Create stunning App Store screenshots in minutes.",
      backgroundColor: "#8b5cf6",
      backgroundMode: "solid" as const,
      gradientPresetId: null,
      textColor: "#ffffff",
      headlineX: 0,
      headlineY: 0,
      headlineWidth: 100,
      subheadlineX: 0,
      subheadlineY: 0,
      subheadlineWidth: 100,
      fontFamily: "Inter",
      overlayImages: [],
      devices: [
        {
          id: "dev-1",
          deviceId: "iphone-15-pro-max",
          colorId: "black",
          screenshotSrc: null,
          x: 0,
          y: 0,
          scale: 0.85,
          rotation: 0,
          shadow: {
            enabled: true,
            color: "rgba(0,0,0,0.3)",
            blur: 20,
            offsetX: 0,
            offsetY: 10,
          },
          style: "flat" as const,
          rotateY: 0,
          rotateX: 0,
        },
      ],
      activeDeviceId: "dev-1",
    },
  ],
  selectedDeviceId: "iphone-15-pro-max",
  selectedColorId: "black",
  exportSizeId: "6.7",
  activeScreenshotId: "s-1",
  headlineFontSize: 72,
  subheadlineFontSize: 42,
});

describe("EditorContext - Initial hydration and persistence accuracy", () => {
  it("initializes empty storage with default project, 'saved' status (no edits pending), and leaves storage unverified", () => {
    render(
      <EditorProvider>
        <TestHarness />
      </EditorProvider>,
    );

    expect(screen.getByTestId("autosave-status").textContent).toBe("saved");
    expect(screen.getByTestId("active-project-name").textContent).toBe("My Project");
    // Initial mount skips redundant write; storage remains unwritten
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("hydrates from valid persisted storage: status is 'saved' and matches successfully persisted storage", () => {
    const project = createTestProject("persisted-proj-1", "Persisted App");
    const persistedFixture: PersistedEditorState = {
      version: 2,
      activeProjectId: "persisted-proj-1",
      lastSaved: 1700000000000,
      projects: [project],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistedFixture));

    render(
      <EditorProvider>
        <TestHarness />
      </EditorProvider>,
    );

    expect(screen.getByTestId("autosave-status").textContent).toBe("saved");
    expect(screen.getByTestId("active-project-name").textContent).toBe("Persisted App");
    expect(screen.getByTestId("active-project-id").textContent).toBe("persisted-proj-1");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(persistedFixture);
  });

  it("safely falls back to default state when storage is corrupted without overwriting raw storage", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEY, "{corrupt-json");

    render(
      <EditorProvider>
        <TestHarness />
      </EditorProvider>,
    );

    expect(screen.getByTestId("autosave-status").textContent).toBe("saved");
    expect(screen.getByTestId("active-project-name").textContent).toBe("My Project");
    // Raw storage remains untouched until an actual save happens
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{corrupt-json");
  });

  it("re-reads persisted storage on remount instead of using stale module-level cache", () => {
    const { unmount } = render(
      <EditorProvider>
        <TestHarness />
      </EditorProvider>,
    );
    expect(screen.getByTestId("active-project-name").textContent).toBe("My Project");
    unmount();

    // Simulate storage update during session
    const updatedProject = createTestProject("remount-proj", "Remounted Project");
    const updatedFixture: PersistedEditorState = {
      version: 2,
      activeProjectId: "remount-proj",
      lastSaved: 1700000000000,
      projects: [updatedProject],
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedFixture));

    render(
      <EditorProvider>
        <TestHarness />
      </EditorProvider>,
    );
    expect(screen.getByTestId("active-project-name").textContent).toBe("Remounted Project");
  });

  it("renders general 'Save failed' without claiming storage is full when autosave fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Generic storage error");
    });

    const ToolbarTestHarness = () => {
      const { createProject } = useEditor();
      return (
        <div>
          <Toolbar onAddScreenshot={() => {}} screenshotCount={1} />
          <button onClick={() => createProject("New Project")}>Add</button>
        </div>
      );
    };

    render(
      <EditorProvider>
        <ToolbarTestHarness />
      </EditorProvider>,
    );

    // Trigger an edit
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    // Advance debounce timer
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const statusEl = screen.getByTestId("autosave-status");
    expect(statusEl.textContent).toContain("Save failed");
    expect(statusEl.textContent).not.toContain("storage full");

    const errorSpan = statusEl.querySelector("span[title]");
    expect(errorSpan?.getAttribute("title")).toBe(
      "The latest changes could not be saved and may be lost on reload",
    );

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});

describe("EditorContext - Clone behavior regression tests", () => {
  let editor: ReturnType<typeof useEditor>;

  const ContextProbe = () => {
    editor = useEditor();
    return null;
  };

  it("addScreenshot adds a screenshot, activates it, preserves theme and device layout, resets text and overlays, and resets screenshotSrc to null", () => {
    const customProject = {
      ...createTestProject("project-clone-test", "Clone Test"),
      screenshots: [
        {
          id: "screenshot-orig",
          headline: "Custom Headline",
          subheadline: "Custom Subheadline",
          backgroundColor: "#123456",
          backgroundMode: "solid" as const,
          gradientPresetId: "sunset",
          textColor: "#abcdef",
          headlineX: 25,
          headlineY: 35,
          headlineWidth: 65,
          subheadlineX: 25,
          subheadlineY: 45,
          subheadlineWidth: 65,
          fontFamily: "Inter",
          overlayImages: [
            {
              id: "overlay-1",
              src: "data:image/png;base64,overlayIcon",
              x: 10,
              y: 20,
              width: 30,
              height: 30,
              layer: "front" as const,
              rotation: 0,
              shadow: {
                enabled: false,
                color: "#000000",
                blur: 20,
                offsetX: 0,
                offsetY: 10,
              },
            },
          ],
          devices: [
            {
              id: "device-orig",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: "data:image/png;base64,inheritedScreen123",
              x: 45,
              y: 25,
              scale: 90,
              rotation: 15,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.5)",
                blur: 30,
                offsetX: 5,
                offsetY: 15,
              },
              style: "3d" as const,
              rotateY: 20,
              rotateX: 10,
            },
          ],
          activeDeviceId: "device-orig",
        },
      ],
      activeScreenshotId: "screenshot-orig",
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProjectId: "project-clone-test",
        lastSaved: 1700000000000,
        projects: [customProject],
      }),
    );

    render(
      <EditorProvider>
        <ContextProbe />
      </EditorProvider>,
    );

    expect(editor.screenshots.length).toBe(1);
    expect(editor.activeScreenshotId).toBe("screenshot-orig");

    // Execute addScreenshot
    act(() => {
      editor.addScreenshot();
    });

    // 1. Adds exactly one screenshot and activates it
    expect(editor.screenshots.length).toBe(2);
    const originalScreenshot = editor.screenshots[0];
    const newScreenshot = editor.screenshots[1];
    expect(editor.activeScreenshotId).toBe(newScreenshot.id);

    // 2. Generates new unique screenshot and device IDs
    expect(newScreenshot.id).not.toBe(originalScreenshot.id);
    expect(newScreenshot.devices[0].id).not.toBe(originalScreenshot.devices[0].id);

    // 3. Preserves background and theme settings
    expect(newScreenshot.backgroundColor).toBe("#123456");
    expect(newScreenshot.backgroundMode).toBe("solid");
    expect(newScreenshot.gradientPresetId).toBe("sunset");
    expect(newScreenshot.textColor).toBe("#abcdef");
    expect(newScreenshot.fontFamily).toBe("Inter");

    // 4. Preserves device configuration
    expect(newScreenshot.devices.length).toBe(1);
    const newDevice = newScreenshot.devices[0];
    expect(newDevice.deviceId).toBe("iphone-15-pro-max");
    expect(newDevice.colorId).toBe("black");
    expect(newDevice.x).toBe(45);
    expect(newDevice.y).toBe(25);
    expect(newDevice.scale).toBe(90);
    expect(newDevice.rotation).toBe(15);
    expect(newDevice.shadow).toEqual({
      enabled: true,
      color: "rgba(0,0,0,0.5)",
      blur: 30,
      offsetX: 5,
      offsetY: 15,
    });
    expect(newDevice.style).toBe("3d");
    expect(newDevice.rotateY).toBe(20);
    expect(newDevice.rotateX).toBe(10);

    // 5. Resets text, text layout defaults, and overlays
    expect(newScreenshot.headline).toBe("New Screenshot");
    expect(newScreenshot.subheadline).toBe("Add your description here");
    expect(newScreenshot.headlineX).toBe(50);
    expect(newScreenshot.headlineY).toBe(10);
    expect(newScreenshot.headlineWidth).toBe(80);
    expect(newScreenshot.subheadlineX).toBe(50);
    expect(newScreenshot.subheadlineY).toBe(18);
    expect(newScreenshot.subheadlineWidth).toBe(80);
    expect(newScreenshot.overlayImages).toEqual([]);

    // 6. Screenshot image is NOT inherited: new screenshot has screenshotSrc: null
    expect(newDevice.screenshotSrc).toBeNull();

    // 7. Preserves original screenshot and device data unchanged
    expect(originalScreenshot.id).toBe("screenshot-orig");
    expect(originalScreenshot.headline).toBe("Custom Headline");
    expect(originalScreenshot.subheadline).toBe("Custom Subheadline");
    expect(originalScreenshot.overlayImages.length).toBe(1);
    expect(originalScreenshot.devices[0].id).toBe("device-orig");
    expect(originalScreenshot.devices[0].screenshotSrc).toBe("data:image/png;base64,inheritedScreen123");
  });

  it("addDevice adds a device, activates and selects it, applies position offsets, preserves styling, and resets screenshotSrc to null", () => {
    const customProject = {
      ...createTestProject("project-device-test", "Device Test"),
      screenshots: [
        {
          id: "screenshot-dev-test",
          headline: "Screenshot",
          subheadline: "Subheadline",
          backgroundColor: "#8b5cf6",
          backgroundMode: "solid" as const,
          gradientPresetId: null,
          textColor: "#ffffff",
          headlineX: 50,
          headlineY: 10,
          headlineWidth: 80,
          subheadlineX: 50,
          subheadlineY: 18,
          subheadlineWidth: 80,
          fontFamily: "Inter",
          overlayImages: [],
          devices: [
            {
              id: "device-primary",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: "data:image/png;base64,deviceImage456",
              x: 50,
              y: 30,
              scale: 85,
              rotation: -5,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.4)",
                blur: 25,
                offsetX: 2,
                offsetY: 8,
              },
              style: "3d" as const,
              rotateY: -10,
              rotateX: 8,
            },
          ],
          activeDeviceId: "device-primary",
        },
      ],
      activeScreenshotId: "screenshot-dev-test",
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProjectId: "project-device-test",
        lastSaved: 1700000000000,
        projects: [customProject],
      }),
    );

    render(
      <EditorProvider>
        <ContextProbe />
      </EditorProvider>,
    );

    expect(editor.activeScreenshot.devices.length).toBe(1);
    const originalDevice = editor.activeScreenshot.devices[0];

    // Execute addDevice
    act(() => {
      editor.addDevice();
    });

    // 1. Adds exactly one device to active screenshot
    expect(editor.activeScreenshot.devices.length).toBe(2);
    const newDevice = editor.activeScreenshot.devices[1];

    // 2. Activates new device and synchronizes activeDeviceId and selectedElement
    expect(editor.activeScreenshot.activeDeviceId).toBe(newDevice.id);
    expect(editor.selectedElement).toEqual({
      type: "device",
      id: newDevice.id,
      screenshotId: editor.activeScreenshot.id,
    });

    // 3. Applies expected position offset: x + 12 (capped at 88), y + 4 (capped at 70)
    expect(newDevice.x).toBe(50 + 12);
    expect(newDevice.y).toBe(30 + 4);

    // 4. Preserves model, color, scale, rotation, shadow, style, and 3D transforms
    expect(newDevice.id).not.toBe(originalDevice.id);
    expect(newDevice.deviceId).toBe("iphone-15-pro-max");
    expect(newDevice.colorId).toBe("black");
    expect(newDevice.scale).toBe(85);
    expect(newDevice.rotation).toBe(-5);
    expect(newDevice.shadow).toEqual({
      enabled: true,
      color: "rgba(0,0,0,0.4)",
      blur: 25,
      offsetX: 2,
      offsetY: 8,
    });
    expect(newDevice.style).toBe("3d");
    expect(newDevice.rotateY).toBe(-10);
    expect(newDevice.rotateX).toBe(8);

    // 5. Screenshot image is NOT inherited: new device has screenshotSrc: null
    expect(newDevice.screenshotSrc).toBeNull();

    // 6. Leaves original device unchanged
    expect(editor.activeScreenshot.devices[0].id).toBe("device-primary");
    expect(editor.activeScreenshot.devices[0].x).toBe(50);
    expect(editor.activeScreenshot.devices[0].y).toBe(30);
    expect(editor.activeScreenshot.devices[0].screenshotSrc).toBe("data:image/png;base64,deviceImage456");
  });

  it("addDevice respects position offset upper bounds when active device is near edge", () => {
    const edgeProject = {
      ...createTestProject("project-edge-test", "Edge Test"),
      screenshots: [
        {
          id: "screenshot-edge",
          headline: "Screenshot",
          subheadline: "Subheadline",
          backgroundColor: "#8b5cf6",
          backgroundMode: "solid" as const,
          gradientPresetId: null,
          textColor: "#ffffff",
          headlineX: 50,
          headlineY: 10,
          headlineWidth: 80,
          subheadlineX: 50,
          subheadlineY: 18,
          subheadlineWidth: 80,
          fontFamily: "Inter",
          overlayImages: [],
          devices: [
            {
              id: "device-edge",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: null,
              x: 85,
              y: 68,
              scale: 85,
              rotation: 0,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.3)",
                blur: 20,
                offsetX: 0,
                offsetY: 10,
              },
              style: "flat" as const,
              rotateY: 0,
              rotateX: 0,
            },
          ],
          activeDeviceId: "device-edge",
        },
      ],
      activeScreenshotId: "screenshot-edge",
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProjectId: "project-edge-test",
        lastSaved: 1700000000000,
        projects: [edgeProject],
      }),
    );

    render(
      <EditorProvider>
        <ContextProbe />
      </EditorProvider>,
    );

    act(() => {
      editor.addDevice();
    });

    const newDevice = editor.activeScreenshot.devices[1];
    // x: Math.min(85 + 12, 88) = 88
    expect(newDevice.x).toBe(88);
    // y: Math.min(68 + 4, 70) = 70
    expect(newDevice.y).toBe(70);
  });
});

describe("EditorContext - Image Upload & Optimization", () => {
  let editor: ReturnType<typeof useEditor>;

  const ContextProbe = () => {
    editor = useEditor();
    return null;
  };

  const setupEditorWithDevice = (initialScreenshotSrc: string | null = null) => {
    const project = {
      ...createTestProject("project-upload-test", "Upload Test"),
      screenshots: [
        {
          id: "screenshot-upload",
          headline: "Headline",
          subheadline: "Subheadline",
          backgroundColor: "#ffffff",
          backgroundMode: "solid" as const,
          gradientPresetId: null,
          textColor: "#000000",
          headlineX: 50,
          headlineY: 10,
          headlineWidth: 80,
          subheadlineX: 50,
          subheadlineY: 18,
          subheadlineWidth: 80,
          fontFamily: "Inter",
          overlayImages: [],
          devices: [
            {
              id: "device-upload",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: initialScreenshotSrc,
              x: 50,
              y: 50,
              scale: 80,
              rotation: 0,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.3)",
                blur: 20,
                offsetX: 0,
                offsetY: 10,
              },
              style: "flat" as const,
              rotateY: 0,
              rotateX: 0,
            },
          ],
          activeDeviceId: "device-upload",
        },
      ],
      activeScreenshotId: "screenshot-upload",
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProjectId: "project-upload-test",
        lastSaved: 1700000000000,
        projects: [project],
      }),
    );

    render(
      <EditorProvider>
        <ContextProbe />
      </EditorProvider>,
    );
  };

  it("handleFileUpload successfully optimizes image and updates active device screenshotSrc", async () => {
    setupEditorWithDevice(null);

    const optimizeSpy = vi
      .spyOn(imageOptimizer, "optimizeImageFile")
      .mockResolvedValueOnce({
        dataUrl: "data:image/webp;base64,optimizedScreen123",
        width: 2560,
        height: 1440,
        format: "image/webp",
        byteLength: 45000,
      });

    const file = new File(["test data"], "screen.png", { type: "image/png" });
    const targetObj = { files: [file], value: "C:\\fakepath\\screen.png" };
    const mockEvent = {
      target: targetObj,
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await editor.handleFileUpload(mockEvent);
    });

    expect(optimizeSpy).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        maxDimension: 2560,
        quality: 0.85,
        maxInputBytes: 15 * 1024 * 1024,
      }),
    );
    expect(editor.activeScreenshot.devices[0].screenshotSrc).toBe(
      "data:image/webp;base64,optimizedScreen123",
    );
    expect(targetObj.value).toBe("");
  });

  it("handleFileUpload preserves existing screenshotSrc and resets input when optimization fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    setupEditorWithDevice("data:image/png;base64,existingImageOriginal");

    vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
      new Error("File size (20MB) exceeds the maximum allowed size of 15MB."),
    );

    const file = new File(["oversized"], "huge.png", { type: "image/png" });
    const targetObj = { files: [file], value: "C:\\fakepath\\huge.png" };
    const mockEvent = {
      target: targetObj,
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await editor.handleFileUpload(mockEvent);
    });

    // Existing screenshotSrc must remain intact
    expect(editor.activeScreenshot.devices[0].screenshotSrc).toBe(
      "data:image/png;base64,existingImageOriginal",
    );
    // Input must be reset in finally block so the user can retry
    expect(targetObj.value).toBe("");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Screenshot upload failed:",
      expect.any(Error),
    );
  });

  it("addOverlayImage optimizes and adds overlay image with correct properties", async () => {
    setupEditorWithDevice();

    const originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      width = 400;
      height = 200;
      naturalWidth = 400;
      naturalHeight = 200;
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    } as unknown as typeof Image;

    try {
      const optimizeSpy = vi
        .spyOn(imageOptimizer, "optimizeImageFile")
        .mockResolvedValueOnce({
          dataUrl: "data:image/webp;base64,optimizedOverlay123",
          width: 800,
          height: 400,
          format: "image/webp",
          byteLength: 20000,
        });

      const file = new File(["overlay data"], "logo.png", {
        type: "image/png",
      });

      await act(async () => {
        await editor.addOverlayImage(file);
        // Allow setTimeout in MockImage to execute
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(optimizeSpy).toHaveBeenCalledWith(
        file,
        expect.objectContaining({
          maxDimension: 1280,
          quality: 0.85,
          maxInputBytes: 10 * 1024 * 1024,
        }),
      );

      expect(editor.activeScreenshot.overlayImages.length).toBe(1);
      const addedOverlay = editor.activeScreenshot.overlayImages[0];
      expect(addedOverlay.src).toBe("data:image/webp;base64,optimizedOverlay123");
      expect(addedOverlay.name).toBe("logo.png");
      expect(addedOverlay.width).toBe(30);
      // Aspect ratio: width 400 / height 200 = 2 -> height = 30 / 2 = 15
      expect(addedOverlay.height).toBe(15);
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it("addOverlayImage preserves existing overlays when optimization fails", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    setupEditorWithDevice();

    vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
      new Error("Invalid image format"),
    );

    const file = new File(["bad data"], "corrupt.png", { type: "image/png" });

    await act(async () => {
      await editor.addOverlayImage(file);
    });

    expect(editor.activeScreenshot.overlayImages.length).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Overlay image upload failed:",
      expect.any(Error),
    );
  });

  it("addIcon bypasses optimizeImageFile and directly adds built-in icon", async () => {
    setupEditorWithDevice();

    const originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      width = 50;
      height = 50;
      naturalWidth = 50;
      naturalHeight = 50;
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    } as unknown as typeof Image;

    try {
      const optimizeSpy = vi.spyOn(imageOptimizer, "optimizeImageFile");

      await act(async () => {
        editor.addIcon("/icons/star.png", "Star Icon");
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(optimizeSpy).not.toHaveBeenCalled();
      expect(editor.activeScreenshot.overlayImages.length).toBe(1);
      expect(editor.activeScreenshot.overlayImages[0].src).toBe("/icons/star.png");
      expect(editor.activeScreenshot.overlayImages[0].name).toBe("Star Icon");
    } finally {
      globalThis.Image = originalImage;
    }
  });
});

describe("EditorContext - Async Upload Race Conditions & Staleness", () => {
  let editor: ReturnType<typeof useEditor>;

  const ContextProbe = () => {
    editor = useEditor();
    return null;
  };

  function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: any) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const setupEditorWithTwoDevices = () => {
    const project = {
      ...createTestProject("project-multi-dev", "Multi Device"),
      screenshots: [
        {
          id: "screenshot-multi-dev",
          headline: "Headline",
          subheadline: "Subheadline",
          backgroundColor: "#ffffff",
          backgroundMode: "solid" as const,
          gradientPresetId: null,
          textColor: "#000000",
          headlineX: 50,
          headlineY: 10,
          headlineWidth: 80,
          subheadlineX: 50,
          subheadlineY: 18,
          subheadlineWidth: 80,
          fontFamily: "Inter",
          overlayImages: [],
          devices: [
            {
              id: "device-1",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: "data:image/png;base64,origScreen1",
              x: 40,
              y: 50,
              scale: 80,
              rotation: 0,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.3)",
                blur: 20,
                offsetX: 0,
                offsetY: 10,
              },
              style: "flat" as const,
              rotateY: 0,
              rotateX: 0,
            },
            {
              id: "device-2",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: "data:image/png;base64,origScreen2",
              x: 60,
              y: 50,
              scale: 80,
              rotation: 0,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.3)",
                blur: 20,
                offsetX: 0,
                offsetY: 10,
              },
              style: "flat" as const,
              rotateY: 0,
              rotateX: 0,
            },
          ],
          activeDeviceId: "device-1",
        },
      ],
      activeScreenshotId: "screenshot-multi-dev",
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProjectId: "project-multi-dev",
        lastSaved: 1700000000000,
        projects: [project],
      }),
    );

    render(
      <EditorProvider>
        <ContextProbe />
      </EditorProvider>,
    );
  };

  const setupEditorWithTwoScreenshots = () => {
    const project = {
      ...createTestProject("project-multi-screen", "Multi Screen"),
      screenshots: [
        {
          id: "screen-1",
          headline: "Headline 1",
          subheadline: "Subheadline 1",
          backgroundColor: "#ffffff",
          backgroundMode: "solid" as const,
          gradientPresetId: null,
          textColor: "#000000",
          headlineX: 50,
          headlineY: 10,
          headlineWidth: 80,
          subheadlineX: 50,
          subheadlineY: 18,
          subheadlineWidth: 80,
          fontFamily: "Inter",
          overlayImages: [],
          devices: [
            {
              id: "dev-s1",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: "data:image/png;base64,screen1Image",
              x: 50,
              y: 50,
              scale: 80,
              rotation: 0,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.3)",
                blur: 20,
                offsetX: 0,
                offsetY: 10,
              },
              style: "flat" as const,
              rotateY: 0,
              rotateX: 0,
            },
          ],
          activeDeviceId: "dev-s1",
        },
        {
          id: "screen-2",
          headline: "Headline 2",
          subheadline: "Subheadline 2",
          backgroundColor: "#000000",
          backgroundMode: "solid" as const,
          gradientPresetId: null,
          textColor: "#ffffff",
          headlineX: 50,
          headlineY: 10,
          headlineWidth: 80,
          subheadlineX: 50,
          subheadlineY: 18,
          subheadlineWidth: 80,
          fontFamily: "Inter",
          overlayImages: [],
          devices: [
            {
              id: "dev-s2",
              deviceId: "iphone-15-pro-max",
              colorId: "black",
              screenshotSrc: null,
              x: 50,
              y: 50,
              scale: 80,
              rotation: 0,
              shadow: {
                enabled: true,
                color: "rgba(0,0,0,0.3)",
                blur: 20,
                offsetX: 0,
                offsetY: 10,
              },
              style: "flat" as const,
              rotateY: 0,
              rotateX: 0,
            },
          ],
          activeDeviceId: "dev-s2",
        },
      ],
      activeScreenshotId: "screen-1",
    };

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 2,
        activeProjectId: "project-multi-screen",
        lastSaved: 1700000000000,
        projects: [project],
      }),
    );

    render(
      <EditorProvider>
        <ContextProbe />
      </EditorProvider>,
    );
  };

  it("an earlier screenshot upload finishing last cannot overwrite a newer upload to the same target", async () => {
    setupEditorWithTwoDevices();

    const d1 = createDeferred<imageOptimizer.OptimizationResult>();
    const d2 = createDeferred<imageOptimizer.OptimizationResult>();

    let callCount = 0;
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? d1.promise : d2.promise;
    });

    const file1 = new File(["data1"], "upload1.png", { type: "image/png" });
    const target1 = { files: [file1], value: "file1.png" };
    const event1 = { target: target1 } as unknown as React.ChangeEvent<HTMLInputElement>;

    const file2 = new File(["data2"], "upload2.png", { type: "image/png" });
    const target2 = { files: [file2], value: "file2.png" };
    const event2 = { target: target2 } as unknown as React.ChangeEvent<HTMLInputElement>;

    // Start upload 1
    const p1 = editor.handleFileUpload(event1);
    // Start upload 2 for the same device
    const p2 = editor.handleFileUpload(event2);

    // Resolve upload 2 FIRST (newer upload completes first)
    d2.resolve({
      dataUrl: "data:image/webp;base64,newerImageResult",
      width: 2560,
      height: 1440,
      format: "image/webp",
      byteLength: 50000,
    });

    await act(async () => {
      await p2;
    });

    const activeDevAfterUpload2 = editor.activeScreenshot.devices.find(
      (d) => d.id === "device-1",
    );
    expect(activeDevAfterUpload2?.screenshotSrc).toBe(
      "data:image/webp;base64,newerImageResult",
    );

    // Now resolve upload 1 LAST (older upload finishes out-of-order)
    d1.resolve({
      dataUrl: "data:image/webp;base64,staleOlderImageResult",
      width: 2560,
      height: 1440,
      format: "image/webp",
      byteLength: 50000,
    });

    await act(async () => {
      await p1;
    });

    // Verification: Stale upload was discarded and did NOT overwrite newer upload
    const activeDevAfterUpload1 = editor.activeScreenshot.devices.find(
      (d) => d.id === "device-1",
    );
    expect(activeDevAfterUpload1?.screenshotSrc).toBe(
      "data:image/webp;base64,newerImageResult",
    );
  });

  it("switching the active device while an upload is pending cannot update the wrong device", async () => {
    setupEditorWithTwoDevices();

    const d1 = createDeferred<imageOptimizer.OptimizationResult>();
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockReturnValue(d1.promise);

    const file = new File(["device1 data"], "dev1.png", { type: "image/png" });
    const target = { files: [file], value: "dev1.png" };
    const event = { target } as unknown as React.ChangeEvent<HTMLInputElement>;

    // Upload begins for active device ("device-1")
    const pUpload = editor.handleFileUpload(event);

    // User switches active device to "device-2" while upload is still processing
    act(() => {
      editor.selectDevice("device-2");
    });
    expect(editor.activeDevice.id).toBe("device-2");

    // Upload completes
    d1.resolve({
      dataUrl: "data:image/webp;base64,optimizedForDev1",
      width: 2560,
      height: 1440,
      format: "image/webp",
      byteLength: 50000,
    });

    await act(async () => {
      await pUpload;
    });

    // Device 1 (target when upload started) received the image
    const dev1 = editor.activeScreenshot.devices.find((d) => d.id === "device-1");
    expect(dev1?.screenshotSrc).toBe("data:image/webp;base64,optimizedForDev1");

    // Device 2 (newly active device) was NOT mutated or overwritten
    const dev2 = editor.activeScreenshot.devices.find((d) => d.id === "device-2");
    expect(dev2?.screenshotSrc).toBe("data:image/png;base64,origScreen2");
  });

  it("switching screenshots during overlay processing cannot add the overlay to the wrong screenshot", async () => {
    setupEditorWithTwoScreenshots();

    const originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      width = 400;
      height = 200;
      naturalWidth = 400;
      naturalHeight = 200;
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    } as unknown as typeof Image;

    try {
      const d1 = createDeferred<imageOptimizer.OptimizationResult>();
      vi.spyOn(imageOptimizer, "optimizeImageFile").mockReturnValue(d1.promise);

      const file = new File(["overlay data"], "badge.png", { type: "image/png" });

      // User starts overlay upload on screen-1
      expect(editor.activeScreenshotId).toBe("screen-1");
      const pOverlay = editor.addOverlayImage(file);

      // User switches active screenshot to screen-2 while upload is pending
      act(() => {
        editor.setActiveScreenshotId("screen-2");
      });
      expect(editor.activeScreenshotId).toBe("screen-2");

      // Optimization resolves
      d1.resolve({
        dataUrl: "data:image/webp;base64,badgeForScreen1",
        width: 400,
        height: 200,
        format: "image/webp",
        byteLength: 12000,
      });

      await act(async () => {
        await pOverlay;
        await new Promise((r) => setTimeout(r, 10));
      });

      // Verification: Overlay was NOT added to screen-2 (the wrong screenshot)
      const screen2 = editor.screenshots.find((s) => s.id === "screen-2");
      expect(screen2?.overlayImages.length).toBe(0);

      // Verification: Overlay was correctly added to screen-1 (the target screenshot)
      const screen1 = editor.screenshots.find((s) => s.id === "screen-1");
      expect(screen1?.overlayImages.length).toBe(1);
      expect(screen1?.overlayImages[0].src).toBe("data:image/webp;base64,badgeForScreen1");
    } finally {
      globalThis.Image = originalImage;
    }
  });

  it("a stale or failed upload preserves existing images and overlays", async () => {
    setupEditorWithTwoDevices();

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Add an initial overlay to the screenshot
    const originalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      width = 50;
      height = 50;
      naturalWidth = 50;
      naturalHeight = 50;
      src = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      }
    } as unknown as typeof Image;

    try {
      await act(async () => {
        editor.addIcon("/icons/star.png", "Star Icon");
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(editor.activeScreenshot.overlayImages.length).toBe(1);

      // 1. Failed screenshot upload preserves existing device screenshotSrc
      vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
        new Error("Screenshot optimization failed"),
      );
      const file = new File(["bad"], "bad.png", { type: "image/png" });
      const target = { files: [file], value: "bad.png" };
      await act(async () => {
        await editor.handleFileUpload({ target } as unknown as React.ChangeEvent<HTMLInputElement>);
      });

      const dev1 = editor.activeScreenshot.devices.find((d) => d.id === "device-1");
      expect(dev1?.screenshotSrc).toBe("data:image/png;base64,origScreen1");

      // 2. Failed overlay upload preserves existing overlay images
      vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
        new Error("Overlay optimization failed"),
      );
      await act(async () => {
        await editor.addOverlayImage(file);
      });
      expect(editor.activeScreenshot.overlayImages.length).toBe(1);
      expect(editor.activeScreenshot.overlayImages[0].src).toBe("/icons/star.png");

      // 3. Stale upload where target device is removed while upload is pending
      const dStale = createDeferred<imageOptimizer.OptimizationResult>();
      vi.spyOn(imageOptimizer, "optimizeImageFile").mockReturnValue(dStale.promise);

      // Initiate upload on device-2
      act(() => {
        editor.selectDevice("device-2");
      });
      const pStaleUpload = editor.handleFileUpload({ target } as unknown as React.ChangeEvent<HTMLInputElement>);

      // Remove device-2 while upload is pending
      act(() => {
        editor.removeDevice("device-2");
      });
      expect(editor.activeScreenshot.devices.some((d) => d.id === "device-2")).toBe(false);

      // Now let the stale upload resolve
      dStale.resolve({
        dataUrl: "data:image/webp;base64,shouldBeIgnored",
        width: 2560,
        height: 1440,
        format: "image/webp",
        byteLength: 50000,
      });

      await act(async () => {
        await pStaleUpload;
      });

      // The removed device was not resurrected, and device-1 remains untouched
      expect(editor.activeScreenshot.devices.length).toBe(1);
      expect(editor.activeScreenshot.devices[0].id).toBe("device-1");
      expect(editor.activeScreenshot.devices[0].screenshotSrc).toBe("data:image/png;base64,origScreen1");
    } finally {
      globalThis.Image = originalImage;
      consoleErrorSpy.mockRestore();
    }
  });
});

describe("EditorContext - Step 22 Upload Failure Feedback & UI", () => {
  let editor: ReturnType<typeof useEditor>;

  const ContextProbe = () => {
    editor = useEditor();
    return null;
  };

  beforeEach(() => {
    render(
      <EditorProvider>
        <ContextProbe />
      </EditorProvider>,
    );
  });

  it("sets screenshotUploadError when optimization fails, allows manual clearing, and clears on subsequent success", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
      new Error("Failed to load image in browser"),
    );

    const file = new File(["bad data"], "photo.png", { type: "image/png" });
    const target = {
      files: [file],
      value: "photo.png",
    };

    expect(editor.screenshotUploadError).toBeNull();

    // Trigger failed upload
    await act(async () => {
      await editor.handleFileUpload({ target } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    expect(editor.screenshotUploadError).toBe(
      "Unable to decode image. Please check that the file is not corrupted.",
    );

    // Manual clear
    act(() => {
      editor.clearScreenshotUploadError();
    });
    expect(editor.screenshotUploadError).toBeNull();

    // Trigger another failure
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
      new Error("File exceeds the maximum allowed size of 15MB"),
    );
    await act(async () => {
      await editor.handleFileUpload({ target } as unknown as React.ChangeEvent<HTMLInputElement>);
    });
    expect(editor.screenshotUploadError).toBe(
      "File exceeds the maximum allowed size of 15MB",
    );

    // Subsequent success clears error
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockResolvedValueOnce({
      dataUrl: "data:image/webp;base64,goodData",
      width: 1000,
      height: 2000,
      format: "image/webp",
      byteLength: 20000,
    });
    await act(async () => {
      await editor.handleFileUpload({ target } as unknown as React.ChangeEvent<HTMLInputElement>);
    });
    expect(editor.screenshotUploadError).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  it("sets overlayUploadError when optimization fails, allows manual clearing, and clears on subsequent success", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
      new Error("Unsupported file type: application/pdf"),
    );

    const file = new File(["bad"], "document.pdf", { type: "application/pdf" });

    expect(editor.overlayUploadError).toBeNull();

    // Trigger failed upload
    await act(async () => {
      await editor.addOverlayImage(file);
    });

    expect(editor.overlayUploadError).toBe(
      "Unsupported file format. Please upload a PNG, JPEG, WebP, or SVG.",
    );

    // Manual clear
    act(() => {
      editor.clearOverlayUploadError();
    });
    expect(editor.overlayUploadError).toBeNull();

    // Trigger another failure with empty file
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockRejectedValueOnce(
      new Error("Image file is empty"),
    );
    await act(async () => {
      await editor.addOverlayImage(file);
    });
    expect(editor.overlayUploadError).toBe("The selected file is empty.");

    // Subsequent success clears error
    vi.spyOn(imageOptimizer, "optimizeImageFile").mockResolvedValueOnce({
      dataUrl: "data:image/webp;base64,overlayData",
      width: 400,
      height: 400,
      format: "image/webp",
      byteLength: 5000,
    });
    await act(async () => {
      await editor.addOverlayImage(file);
    });
    expect(editor.overlayUploadError).toBeNull();

    consoleErrorSpy.mockRestore();
  });

  it("renders accessible alert and handles dismiss in ScreenshotImageSection", () => {
    const handleClear = vi.fn();
    const { rerender } = render(
      <ScreenshotImageSection
        device={editor.activeDevice!}
        fileInputRef={{ current: null }}
        onFileUpload={() => {}}
        error="Unable to decode image. Please check that the file is not corrupted."
        onClearError={handleClear}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("Unable to decode image.");

    const dismissBtn = screen.getByRole("button", { name: "Dismiss error" });
    fireEvent.click(dismissBtn);
    expect(handleClear).toHaveBeenCalledTimes(1);

    // When error is cleared/null, alert is not in document
    rerender(
      <ScreenshotImageSection
        device={editor.activeDevice!}
        fileInputRef={{ current: null }}
        onFileUpload={() => {}}
        error={null}
        onClearError={handleClear}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders accessible alert and handles dismiss in OverlayImagesSection", () => {
    const handleClear = vi.fn();
    const { rerender } = render(
      <OverlayImagesSection
        screenshot={editor.activeScreenshot}
        selectedElement={null}
        overlayImageInputRef={{ current: null }}
        onSelectElement={() => {}}
        onAddImage={() => {}}
        onRemoveImage={() => {}}
        onBringForward={() => {}}
        onSendBackward={() => {}}
        onUpdateSize={() => {}}
        onUpdateRotation={() => {}}
        onUpdateLayer={() => {}}
        onUpdateShadow={() => {}}
        error="Unsupported file format. Please upload a PNG, JPEG, WebP, or SVG."
        onClearError={handleClear}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toBeTruthy();
    expect(alert.getAttribute("aria-live")).toBe("assertive");
    expect(alert.textContent).toContain("Unsupported file format");

    const dismissBtn = screen.getByRole("button", { name: "Dismiss error" });
    fireEvent.click(dismissBtn);
    expect(handleClear).toHaveBeenCalledTimes(1);

    // When error is cleared/null, alert is not in document
    rerender(
      <OverlayImagesSection
        screenshot={editor.activeScreenshot}
        selectedElement={null}
        overlayImageInputRef={{ current: null }}
        onSelectElement={() => {}}
        onAddImage={() => {}}
        onRemoveImage={() => {}}
        onBringForward={() => {}}
        onSendBackward={() => {}}
        onUpdateSize={() => {}}
        onUpdateRotation={() => {}}
        onUpdateLayer={() => {}}
        onUpdateShadow={() => {}}
        error={null}
        onClearError={handleClear}
      />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

