/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  savePersistedState,
  loadPersistedState,
  useEditorPersistence,
  type PersistedEditorState,
} from "./useLocalStorage";

const mockValidState: PersistedEditorState = {
  version: 2,
  activeProjectId: "test-project-1",
  lastSaved: 1700000000000,
  projects: [
    {
      id: "test-project-1",
      name: "Test Project",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
      screenshots: [],
      selectedDeviceId: "iphone-15-pro-max",
      selectedColorId: "black",
      exportSizeId: "6.7",
      activeScreenshotId: "screenshot-1",
      headlineFontSize: 72,
      subheadlineFontSize: 42,
    },
  ],
};

describe("savePersistedState return contract", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns true when localStorage.setItem succeeds", () => {
    const result = savePersistedState(mockValidState) as unknown;
    expect(result).toBe(true);

    const loaded = loadPersistedState();
    expect(loaded).toEqual(mockValidState);
  });

  it("returns false and logs when localStorage.setItem throws QuotaExceededError", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const quotaError = new DOMException(
      "The quota has been exceeded.",
      "QuotaExceededError",
    );
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError;
    });

    const result = savePersistedState(mockValidState) as unknown;
    expect(result).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to save editor state to localStorage:",
      quotaError,
    );
  });
});

describe("useEditorPersistence autosave status lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("initializes with 'saved' status and does not trigger save on initial mount", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(() =>
      useEditorPersistence({
        projects: mockValidState.projects,
        activeProjectId: mockValidState.activeProjectId,
      }),
    );

    expect(result.current.status).toBe("saved");
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("transitions to 'saving' on change and 'saved' after debounce completes", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result, rerender } = renderHook(
      (props) => useEditorPersistence(props),
      {
        initialProps: {
          projects: mockValidState.projects,
          activeProjectId: mockValidState.activeProjectId,
        },
      },
    );

    expect(result.current.status).toBe("saved");

    const updatedProjects = [
      {
        ...mockValidState.projects[0],
        name: "Updated Name",
      },
    ];

    rerender({
      projects: updatedProjects,
      activeProjectId: mockValidState.activeProjectId,
    });

    expect(result.current.status).toBe("saving");
    expect(setItemSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe("saved");
    expect(setItemSpy).toHaveBeenCalledTimes(1);
  });

  it("transitions to 'error' when localStorage throws QuotaExceededError during autosave", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const quotaError = new DOMException("Quota exceeded", "QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw quotaError;
    });

    const { result, rerender } = renderHook(
      (props) => useEditorPersistence(props),
      {
        initialProps: {
          projects: mockValidState.projects,
          activeProjectId: mockValidState.activeProjectId,
        },
      },
    );

    rerender({
      projects: [{ ...mockValidState.projects[0], name: "Changed" }],
      activeProjectId: mockValidState.activeProjectId,
    });

    expect(result.current.status).toBe("saving");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe("error");
  });

  it("recovers from 'error' to 'saved' when subsequent save succeeds", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const quotaError = new DOMException("Quota exceeded", "QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
      throw quotaError;
    });

    const { result, rerender } = renderHook(
      (props) => useEditorPersistence(props),
      {
        initialProps: {
          projects: mockValidState.projects,
          activeProjectId: mockValidState.activeProjectId,
        },
      },
    );

    // First edit fails
    rerender({
      projects: [{ ...mockValidState.projects[0], name: "Change 1" }],
      activeProjectId: mockValidState.activeProjectId,
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe("error");

    // Second edit succeeds
    rerender({
      projects: [{ ...mockValidState.projects[0], name: "Change 2" }],
      activeProjectId: mockValidState.activeProjectId,
    });

    expect(result.current.status).toBe("saving");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.status).toBe("saved");
  });

  it("clears pending debounce timer on unmount without saving", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    const { result, rerender, unmount } = renderHook(
      (props) => useEditorPersistence(props),
      {
        initialProps: {
          projects: mockValidState.projects,
          activeProjectId: mockValidState.activeProjectId,
        },
      },
    );

    rerender({
      projects: [{ ...mockValidState.projects[0], name: "Unsaved Change" }],
      activeProjectId: mockValidState.activeProjectId,
    });

    expect(result.current.status).toBe("saving");

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Because the component unmounted, the pending timer was cancelled
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});

describe("useEditorPersistence beforeunload confirmation", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("attempts immediate save on beforeunload and requests browser confirmation if save fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    renderHook(() =>
      useEditorPersistence({
        projects: mockValidState.projects,
        activeProjectId: mockValidState.activeProjectId,
      }),
    );

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    // In JSDOM and standard DOM, Event.prototype.returnValue getter returns !defaultPrevented (false)
    expect((event as unknown as { returnValue: unknown }).returnValue).toBe(false);
  });

  it("does not prevent default on beforeunload if immediate save succeeds", () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

    renderHook(() =>
      useEditorPersistence({
        projects: mockValidState.projects,
        activeProjectId: mockValidState.activeProjectId,
      }),
    );

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);

    expect(setItemSpy).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});

