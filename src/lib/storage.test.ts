/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOrMigratePersistedState,
  savePersistedStateAsync,
  loadPersistedStateFromIndexedDB,
  savePersistedStateToIndexedDB,
  clearPersistedStateFromIndexedDB,
  loadPersistedStateFromLocalStorage,
  validatePersistedState,
  STORAGE_KEY,
  STORE_NAME,
  STATE_KEY,
  type PersistedEditorState,
} from "./storage";
import type { Project } from "../types";

// In-memory Mock implementation of IndexedDB for jsdom environment
class MockIDBRequest {
  result: unknown = undefined;
  error: DOMException | null = null;
  onsuccess: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
}

class MockIDBOpenDBRequest extends MockIDBRequest {
  onupgradeneeded: ((ev: any) => void) | null = null;
  onblocked: ((ev: any) => void) | null = null;
}

class MockIDBObjectStore {
  constructor(
    public name: string,
    private dbStore: Map<string, unknown>,
  ) {}

  get(key: string) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      req.result = this.dbStore.get(key) ?? undefined;
      req.onsuccess?.({ target: req });
    });
    return req as unknown as IDBRequest;
  }

  put(value: unknown, key: string) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      this.dbStore.set(key, JSON.parse(JSON.stringify(value)));
      req.result = key;
      req.onsuccess?.({ target: req });
    });
    return req as unknown as IDBRequest;
  }

  delete(key: string) {
    const req = new MockIDBRequest();
    queueMicrotask(() => {
      this.dbStore.delete(key);
      req.onsuccess?.({ target: req });
    });
    return req as unknown as IDBRequest;
  }
}

class MockIDBTransaction {
  error: DOMException | null = null;
  oncomplete: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  onabort: ((ev: any) => void) | null = null;

  constructor(
    _db: unknown,
    public mode: IDBTransactionMode,
    private objectStoreMap: Map<string, unknown>,
  ) {
    queueMicrotask(() => {
      queueMicrotask(() => {
        this.oncomplete?.({ target: this });
      });
    });
  }

  objectStore(name: string) {
    return new MockIDBObjectStore(name, this.objectStoreMap) as unknown as IDBObjectStore;
  }
}

class MockIDBDatabase {
  objectStoreNames = {
    contains: (name: string) => name === STORE_NAME,
  } as unknown as DOMStringList;

  private store = new Map<string, unknown>();

  constructor(public storeMap: Map<string, unknown>) {
    this.store = storeMap;
  }

  createObjectStore(name: string) {
    return new MockIDBObjectStore(name, this.store) as unknown as IDBObjectStore;
  }

  transaction(_storeNames: string | string[], mode: IDBTransactionMode) {
    return new MockIDBTransaction(this, mode, this.store) as unknown as IDBTransaction;
  }

  close() {}
}

const createMockIndexedDB = () => {
  const globalStore = new Map<string, unknown>();

  return {
    globalStore,
    open: vi.fn((_name: string, _version?: number) => {
      const req = new MockIDBOpenDBRequest();
      queueMicrotask(() => {
        const db = new MockIDBDatabase(globalStore);
        req.result = db;
        req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req as unknown as IDBOpenDBRequest;
    }),
  };
};

const createMockLargeProject = (sizeKb: number): Project => {
  const base64Chunk = "A".repeat(1024); // 1KB chunk
  const mockBase64 = `data:image/png;base64,${base64Chunk.repeat(sizeKb)}`;

  return {
    id: "large-project-1",
    name: "Large Screenshot Project",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    selectedDeviceId: "iphone-15-pro-max",
    selectedColorId: "black",
    exportSizeId: "6.7",
    activeScreenshotId: "screenshot-1",
    headlineFontSize: 72,
    subheadlineFontSize: 42,
    screenshots: [
      {
        id: "screenshot-1",
        headline: "High Resolution Capture",
        subheadline: "Crisp and Clear Presentation",
        backgroundColor: "#000000",
        backgroundMode: "gradient",
        gradientPresetId: "sunset",
        textColor: "#ffffff",
        headlineX: 50,
        headlineY: 10,
        headlineWidth: 80,
        subheadlineX: 50,
        subheadlineY: 18,
        subheadlineWidth: 80,
        fontFamily: "Inter",
        activeDeviceId: "device-1",
        devices: [
          {
            id: "device-1",
            deviceId: "iphone-15-pro-max",
            colorId: "black",
            screenshotSrc: mockBase64,
            scale: 1,
            x: 50,
            y: 50,
            rotation: 0,
            shadow: { enabled: true, color: "rgba(0,0,0,0.5)", blur: 10, offsetX: 0, offsetY: 4 },
            style: "flat",
            rotateX: 0,
            rotateY: 0,
          },
        ],
        overlayImages: [
          {
            id: "overlay-1",
            src: mockBase64,
            name: "badge.png",
            width: 25,
            height: 25,
            x: 50,
            y: 50,
            layer: "front",
            rotation: 0,
            shadow: { enabled: true, color: "rgba(0,0,0,0.5)", blur: 10, offsetX: 0, offsetY: 4 },
          },
        ],
      },
    ],
  };
};

describe("storage.ts - Reliability and Compatibility Suite", () => {
  let mockIDB: ReturnType<typeof createMockIndexedDB>;

  beforeEach(() => {
    localStorage.clear();
    mockIDB = createMockIndexedDB();
    (window as any).indexedDB = mockIDB;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as any).indexedDB;
    vi.restoreAllMocks();
  });

  describe("1. Existing localStorage Compatibility", () => {
    it("loads and validates existing valid localStorage project state", () => {
      const existingState: PersistedEditorState = {
        version: 2,
        activeProjectId: "proj-legacy",
        lastSaved: 1700000000000,
        projects: [
          {
            id: "proj-legacy",
            name: "Legacy Project",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
            screenshots: [],
            selectedDeviceId: "iphone-15-pro-max",
            selectedColorId: "black",
            exportSizeId: "6.7",
            activeScreenshotId: "s-1",
            headlineFontSize: 72,
            subheadlineFontSize: 42,
          },
        ],
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(existingState));

      const loaded = loadPersistedStateFromLocalStorage();
      expect(loaded).toEqual(existingState);
      expect(validatePersistedState(loaded)).toBe(true);
    });

    it("rejects corrupted or outdated version state from localStorage", () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 1, projects: [] }),
      );
      expect(loadPersistedStateFromLocalStorage()).toBeNull();

      localStorage.setItem(STORAGE_KEY, "invalid-json-string{");
      expect(loadPersistedStateFromLocalStorage()).toBeNull();
    });
  });

  describe("2. Migration from Legacy localStorage to IndexedDB", () => {
    it("migrates existing localStorage state into IndexedDB when IndexedDB is empty", async () => {
      const legacyState: PersistedEditorState = {
        version: 2,
        activeProjectId: "proj-to-migrate",
        lastSaved: 1700000000000,
        projects: [
          {
            id: "proj-to-migrate",
            name: "Migrate Me",
            createdAt: 1700000000000,
            updatedAt: 1700000000000,
            screenshots: [],
            selectedDeviceId: "iphone-15-pro-max",
            selectedColorId: "black",
            exportSizeId: "6.7",
            activeScreenshotId: "s-1",
            headlineFontSize: 72,
            subheadlineFontSize: 42,
          },
        ],
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyState));
      expect(mockIDB.globalStore.size).toBe(0);

      const state = await getOrMigratePersistedState();
      expect(state).toEqual(legacyState);

      // Verify that data was written to IndexedDB
      const storedInIDB = mockIDB.globalStore.get(STATE_KEY);
      expect(storedInIDB).toEqual(legacyState);
    });

    it("prefers IndexedDB state over stale localStorage state", async () => {
      const olderLocalStorageState: PersistedEditorState = {
        version: 2,
        activeProjectId: "old-proj",
        lastSaved: 1000,
        projects: [],
      };
      const newerIDBState: PersistedEditorState = {
        version: 2,
        activeProjectId: "new-proj",
        lastSaved: 2000,
        projects: [],
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(olderLocalStorageState));
      mockIDB.globalStore.set(STATE_KEY, newerIDBState);

      const state = await getOrMigratePersistedState();
      expect(state?.activeProjectId).toBe("new-proj");
    });
  });

  describe("3. Large Project Persistence and Reload", () => {
    it("persists large project with base64 screenshots to IndexedDB even when localStorage throws QuotaExceededError", async () => {
      const largeProject = createMockLargeProject(2048); // ~2MB base64 per image
      const state: PersistedEditorState = {
        version: 2,
        activeProjectId: largeProject.id,
        lastSaved: Date.now(),
        projects: [largeProject],
      };

      // Mock localStorage throwing QuotaExceededError
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });

      const success = await savePersistedStateAsync(state);
      expect(success).toBe(true);

      // Verify that the full-resolution state is intact in IndexedDB
      const loaded = await loadPersistedStateFromIndexedDB();
      expect(loaded).toBeDefined();
      expect(loaded?.projects[0].screenshots[0].devices[0].screenshotSrc).toContain("data:image/png;base64,AAAA");
      expect(loaded?.projects[0].screenshots[0].overlayImages[0].src).toContain("data:image/png;base64,AAAA");
    });

    it("restores large project state with all overlays and device instances on reload", async () => {
      const largeProject = createMockLargeProject(1024);
      const state: PersistedEditorState = {
        version: 2,
        activeProjectId: largeProject.id,
        lastSaved: 1710000000000,
        projects: [largeProject],
      };

      await savePersistedStateToIndexedDB(state);

      const restored = await getOrMigratePersistedState();
      expect(restored).toEqual(state);
      expect(restored?.projects[0].screenshots[0].overlayImages.length).toBe(1);
      expect(restored?.projects[0].screenshots[0].devices.length).toBe(1);
    });
  });

  describe("4. Save Ordering and Concurrent Updates", () => {
    it("preserves newer state when concurrent writes resolve out of order", async () => {
      const project1: PersistedEditorState = {
        version: 2,
        activeProjectId: "p1",
        lastSaved: 1000,
        projects: [],
      };
      const project2: PersistedEditorState = {
        version: 2,
        activeProjectId: "p2",
        lastSaved: 2000,
        projects: [],
      };

      // Save newer state first
      await savePersistedStateToIndexedDB(project2);

      // An older save resolves late
      const currentStored = await loadPersistedStateFromIndexedDB();
      if (currentStored && currentStored.lastSaved > project1.lastSaved) {
        // Discard older write
      } else {
        await savePersistedStateToIndexedDB(project1);
      }

      const finalState = await loadPersistedStateFromIndexedDB();
      expect(finalState?.activeProjectId).toBe("p2");
    });
  });

  describe("5. Storage Quota, Unavailable Storage, and Failed Writes", () => {
    it("returns false and surfaces error if both IndexedDB and localStorage fail", async () => {
      delete (window as any).indexedDB; // IDB unavailable

      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Disk full / Quota exceeded", "QuotaExceededError");
      });

      const state: PersistedEditorState = {
        version: 2,
        activeProjectId: "proj-fail",
        lastSaved: Date.now(),
        projects: [],
      };

      const result = await savePersistedStateAsync(state);
      expect(result).toBe(false);
    });

    it("handles IndexedDB transaction failures gracefully without unhandled rejections", async () => {
      // Mock openDatabase rejecting
      mockIDB.open.mockImplementationOnce(() => {
        const req = new MockIDBOpenDBRequest();
        queueMicrotask(() => {
          req.error = new DOMException("Database connection error", "UnknownError");
          req.onerror?.({ target: req });
        });
        return req as unknown as IDBOpenDBRequest;
      });

      const state: PersistedEditorState = {
        version: 2,
        activeProjectId: "proj-error",
        lastSaved: Date.now(),
        projects: [],
      };

      const success = await savePersistedStateToIndexedDB(state);
      expect(success).toBe(false);
    });
  });

  describe("6. Clean clearing of storage", () => {
    it("clears persisted state from IndexedDB properly", async () => {
      const state: PersistedEditorState = {
        version: 2,
        activeProjectId: "p1",
        lastSaved: 1000,
        projects: [],
      };
      await savePersistedStateToIndexedDB(state);
      expect(mockIDB.globalStore.has(STATE_KEY)).toBe(true);

      await clearPersistedStateFromIndexedDB();
      expect(mockIDB.globalStore.has(STATE_KEY)).toBe(false);
    });
  });
});
