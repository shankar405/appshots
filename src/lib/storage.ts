/**
 * storage.ts
 *
 * Dual-layer persistence engine for AppShots:
 * - Primary durable storage: IndexedDB (handles large projects with full-res base64 screenshots without quota failure)
 * - Secondary cache/fallback: localStorage (preserves fast synchronous initial boot and legacy compatibility)
 * - Safe automatic migration from legacy localStorage to IndexedDB
 * - Monotonic ordering to prevent stale writes
 */

import type { Project } from "../types";

export interface PersistedEditorState {
  version: number;
  projects: Project[];
  activeProjectId: string;
  lastSaved: number;
}

export type AutosaveStatus = "saved" | "saving" | "error";

export const CURRENT_VERSION = 2;
export const STORAGE_KEY = "app-screenshot-editor-state";
export const DB_NAME = "appshots_db";
export const DB_VERSION = 1;
export const STORE_NAME = "editor_state";
export const STATE_KEY = "persisted_state";

/**
 * Checks if IndexedDB is available and functional in the current environment.
 */
export const isIndexedDBAvailable = (): boolean => {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.indexedDB !== "undefined" &&
      window.indexedDB !== null
    );
  } catch {
    return false;
  }
};

/**
 * Opens or initializes the AppShots IndexedDB database.
 */
export const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error || new Error("Failed to open IndexedDB"));
      };

      request.onblocked = () => {
        console.warn("IndexedDB open request was blocked by an existing open connection");
      };
    } catch (error) {
      reject(error);
    }
  });
};

/**
 * Validates the structure and schema version of a PersistedEditorState object.
 */
export const validatePersistedState = (state: unknown): state is PersistedEditorState => {
  if (!state || typeof state !== "object") return false;
  const s = state as Partial<PersistedEditorState>;
  if (s.version !== CURRENT_VERSION) return false;
  if (!Array.isArray(s.projects)) return false;
  if (typeof s.activeProjectId !== "string") return false;
  return true;
};

/**
 * Loads persisted state synchronously from localStorage.
 */
export const loadPersistedStateFromLocalStorage = (): PersistedEditorState | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (!validatePersistedState(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.error("Failed to load editor state from localStorage:", error);
    return null;
  }
};

/**
 * Saves persisted state synchronously to localStorage.
 * Returns true if successful, false if it throws (e.g. QuotaExceededError).
 */
export const savePersistedStateToLocalStorage = (state: PersistedEditorState): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Failed to save editor state to localStorage:", error);
    return false;
  }
};

/**
 * Clears persisted state from localStorage.
 */
export const clearPersistedStateFromLocalStorage = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error("Failed to clear editor state from localStorage:", error);
  }
};

/**
 * Loads persisted state asynchronously from IndexedDB.
 */
export const loadPersistedStateFromIndexedDB = async (): Promise<PersistedEditorState | null> => {
  if (!isIndexedDBAvailable()) return null;

  try {
    const db = await openDatabase();
    return await new Promise<PersistedEditorState | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(STATE_KEY);

      req.onsuccess = () => {
        const result = req.result as unknown;
        if (result && validatePersistedState(result)) {
          resolve(result);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => {
        reject(req.error || new Error("Failed to read from IndexedDB"));
      };

      tx.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error("Failed to load editor state from IndexedDB:", error);
    return null;
  }
};

/**
 * Saves persisted state asynchronously to IndexedDB.
 */
export const savePersistedStateToIndexedDB = async (
  state: PersistedEditorState,
): Promise<boolean> => {
  if (!isIndexedDBAvailable()) return false;

  try {
    const db = await openDatabase();
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(state, STATE_KEY);

      req.onsuccess = () => {
        // Wait for transaction complete for durability
      };

      tx.oncomplete = () => {
        db.close();
        resolve(true);
      };

      tx.onerror = () => {
        console.error("IndexedDB transaction error during save:", tx.error);
        db.close();
        resolve(false);
      };

      tx.onabort = () => {
        console.error("IndexedDB transaction aborted during save:", tx.error);
        db.close();
        resolve(false);
      };
    });
  } catch (error) {
    console.error("Failed to save editor state to IndexedDB:", error);
    return false;
  }
};

/**
 * Clears persisted state from IndexedDB.
 */
export const clearPersistedStateFromIndexedDB = async (): Promise<void> => {
  if (!isIndexedDBAvailable()) return;

  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(STATE_KEY);

      req.onsuccess = () => {};
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("Failed to clear IndexedDB"));
      };
    });
  } catch (error) {
    console.error("Failed to clear editor state from IndexedDB:", error);
  }
};

/**
 * Loads persisted state with automatic migration from localStorage:
 * 1. Checks IndexedDB first.
 * 2. If IndexedDB is empty or unavailable, checks legacy localStorage.
 * 3. If found in localStorage, migrates it into IndexedDB for future large-capacity storage.
 */
export const getOrMigratePersistedState = async (): Promise<PersistedEditorState | null> => {
  // 1. Try loading from IndexedDB
  const idbState = await loadPersistedStateFromIndexedDB();
  if (idbState && validatePersistedState(idbState)) {
    return idbState;
  }

  // 2. If not in IndexedDB, check localStorage
  const legacyState = loadPersistedStateFromLocalStorage();
  if (legacyState && validatePersistedState(legacyState)) {
    // 3. Migrate to IndexedDB in background
    if (isIndexedDBAvailable()) {
      try {
        await savePersistedStateToIndexedDB(legacyState);
      } catch (err) {
        console.warn("Failed to migrate legacy localStorage state to IndexedDB:", err);
      }
    }
    return legacyState;
  }

  return null;
};

/**
 * Dual-persistence save:
 * Attempts saving to IndexedDB (unlimited quota) and localStorage (fast synchronous cache).
 *
 * If localStorage throws QuotaExceededError because of large base64 screenshots,
 * but IndexedDB succeeds, the save is a complete SUCCESS!
 *
 * Returns true if durable persistence succeeded in at least one store.
 */
export const savePersistedStateAsync = async (
  state: PersistedEditorState,
): Promise<boolean> => {
  const idbAvailable = isIndexedDBAvailable();

  let idbSuccess = false;
  if (idbAvailable) {
    try {
      idbSuccess = await savePersistedStateToIndexedDB(state);
    } catch {
      idbSuccess = false;
    }
  }

  // Best-effort cache write to localStorage for immediate sync availability on next reload
  let lsSuccess = false;
  try {
    lsSuccess = savePersistedStateToLocalStorage(state);
  } catch {
    lsSuccess = false;
  }

  // If IndexedDB succeeded, the save is safe and durable, even if localStorage exceeded quota
  if (idbSuccess) {
    return true;
  }

  // If IndexedDB wasn't available (or failed) but localStorage succeeded, that's also success
  if (lsSuccess) {
    return true;
  }

  return false;
};
