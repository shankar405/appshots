/**
 * useLocalStorage Hook / Persistence Layer
 *
 * Persists editor state to IndexedDB (for large projects with base64 screenshots)
 * and localStorage (for synchronous fast startup and fallback).
 * Handles serialization, auto-save debounce, and stale-write prevention.
 */

import { useEffect, useCallback, useRef, useState } from "react";
import type { Project } from "../types";
import * as storage from "./storage";

export type { PersistedEditorState, AutosaveStatus } from "./storage";
export const getOrMigratePersistedState = storage.getOrMigratePersistedState;
export const savePersistedStateAsync = storage.savePersistedStateAsync;
export const CURRENT_VERSION = storage.CURRENT_VERSION;

/** Debounce delay for auto-save (ms) */
const AUTO_SAVE_DELAY = 1000;

/**
 * Loads persisted state synchronously from localStorage.
 *
 * @returns Persisted state or null if not found/invalid
 */
export const loadPersistedState = (): storage.PersistedEditorState | null => {
  return storage.loadPersistedStateFromLocalStorage();
};

/**
 * Saves state synchronously to localStorage, and if IndexedDB is available,
 * initiates an asynchronous write to IndexedDB.
 *
 * @param state - State to persist
 * @returns boolean indicating localStorage success (or false if storage throws)
 */
export const savePersistedState = (state: storage.PersistedEditorState): boolean => {
  if (storage.isIndexedDBAvailable()) {
    storage.savePersistedStateToIndexedDB(state).catch((err) => {
      console.error("Failed to asynchronously save editor state to IndexedDB:", err);
    });
  }
  return storage.savePersistedStateToLocalStorage(state);
};

/**
 * Clears persisted state from localStorage.
 */
export const clearPersistedState = (): void => {
  storage.clearPersistedStateFromLocalStorage();
};

interface UseEditorPersistenceOptions {
  /** All projects */
  projects: Project[];
  /** Active project ID */
  activeProjectId: string;
}

export interface UseEditorPersistenceReturn {
  /** Current autosave status */
  status: storage.AutosaveStatus;
}

/**
 * useEditorPersistence - Auto-saves editor state to IndexedDB and localStorage
 *
 * Debounces saves to avoid excessive writes during rapid changes.
 * Tracks monotonic sequence IDs to prevent stale writes from overwriting newer state.
 *
 * @param options - Current editor state values
 * @returns Object containing current autosave status
 */
export const useEditorPersistence = ({
  projects,
  activeProjectId,
}: UseEditorPersistenceOptions): UseEditorPersistenceReturn => {
  const [status, setStatus] = useState<storage.AutosaveStatus>("saved");
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);
  const latestSaveSeq = useRef(0);

  const saveState = useCallback(() => {
    const state: storage.PersistedEditorState = {
      version: storage.CURRENT_VERSION,
      projects,
      activeProjectId,
      lastSaved: Date.now(),
    };
    const seq = ++latestSaveSeq.current;

    // 1. Synchronous attempt to localStorage
    const lsSuccess = storage.savePersistedStateToLocalStorage(state);

    if (storage.isIndexedDBAvailable()) {
      // 2. Asynchronous attempt to IndexedDB
      storage.savePersistedStateToIndexedDB(state)
        .then((idbSuccess) => {
          if (seq === latestSaveSeq.current) {
            setStatus(idbSuccess || lsSuccess ? "saved" : "error");
          }
        })
        .catch(() => {
          if (seq === latestSaveSeq.current) {
            setStatus(lsSuccess ? "saved" : "error");
          }
        });

      // If localStorage succeeded right away, we can immediately reflect "saved"
      if (lsSuccess) {
        setStatus("saved");
      }
    } else {
      // IndexedDB not available in this environment
      setStatus(lsSuccess ? "saved" : "error");
    }

    return lsSuccess;
  }, [projects, activeProjectId]);

  // Debounced auto-save on state changes
  useEffect(() => {
    // Skip initial mount to avoid overwriting loaded state
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    setStatus("saving");

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Schedule new save
    saveTimeoutRef.current = setTimeout(saveState, AUTO_SAVE_DELAY);

    // Cleanup on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [saveState]);

  // Save immediately on page unload and request confirmation if save fails
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      const state: storage.PersistedEditorState = {
        version: storage.CURRENT_VERSION,
        projects,
        activeProjectId,
        lastSaved: Date.now(),
      };
      const saved = savePersistedState(state);
      if (!saved) {
        event.preventDefault();
        event.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [projects, activeProjectId]);

  return { status };
};
