/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorProvider, useEditor } from "./EditorContext";
import { Toolbar } from "../components/CanvasPreview/Toolbar";
import type { PersistedEditorState } from "../lib/useLocalStorage";

const STORAGE_KEY = "app-screenshot-editor-state";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
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
      "Browser storage could not save the latest changes",
    );

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });
});
