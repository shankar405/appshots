# AppShots Phase 3 — Step 5: Large Project Persistence Reliability Report

## 1. Executive Summary

In AppShots Phase 3 Step 5, we audited, diagnosed, and resolved persistence reliability failures that occurred when projects contained multi-slide, full-resolution base64-embedded screenshots and overlays.

Previously, AppShots persisted all project states exclusively via `localStorage.setItem`. Because standard web browsers enforce a strict origin storage quota of approximately 5MB, a multi-slide project with 2–4 high-resolution mobile screenshots (often 1.5MB–3.5MB each in base64 data URL format) rapidly exceeded the quota, throwing `DOMException: QuotaExceededError`. While the active editor session continued in memory, all subsequent saves failed, and state could not be restored upon browser refresh or tab reopen.

To resolve this root cause while preserving 100% backward compatibility and synchronous startup speed:
1. We architected a dual-layer storage engine in [`src/lib/storage.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/storage.ts) with **IndexedDB** as the primary durable storage (gigabyte quota) and **localStorage** as an immediate synchronous cache and fallback.
2. We implemented safe, transparent migration of existing `localStorage` version 2 projects to IndexedDB.
3. We implemented monotonic save sequence tracking to prevent asynchronous stale writes from overwriting newer user state.
4. We integrated asynchronous mount reconciliation into [`src/context/EditorContext.tsx`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/context/EditorContext.tsx), while protecting active in-flight user interactions.
5. All 6 MCP tools remain operational with zero contract changes.
6. Existing working-tree changes were preserved, and no git commits were created.

---

## 2. Root Cause & Investigation Evidence

### 2.1. Project Lifecycle & Error Handling Trace

1. **Project Creation & Editing**:
   - Creating a project or editing canvas properties updates React state (`projects`, `activeProjectId`, etc.).
   - `updateProjectState()` updates the active project object inside the `projects` array.
2. **Persistence Trigger**:
   - [`useEditorPersistence`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/useLocalStorage.ts) debounces changes by 1000ms (`AUTO_SAVE_DELAY = 1000`).
   - On debounce expiry, it compiles a [`PersistedEditorState`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/storage.ts) object (`version: 2`, `projects: Project[]`, `activeProjectId: string`, `lastSaved: number`).
3. **Legacy Failure Mode**:
   - `savePersistedState` performed `localStorage.setItem(STORAGE_KEY, JSON.stringify(state))`.
   - When a project contained 2 or more base64 screenshots (e.g. 1179x2556 or 1284x2778 images captured from web apps or imported via Studio variants), the JSON string exceeded 5MB.
   - `localStorage.setItem` threw `DOMException: QuotaExceededError`.
   - `savePersistedState` caught the exception, logged `Failed to save editor state to localStorage:`, and returned `false`.
   - The hook set `autosaveStatus` to `"error"`.
   - The toolbar displayed a red error indicator: `Save failed (unsaved changes)`.
   - On page reload, the browser re-read the stale state from `localStorage` (or defaulted to an empty project if initial save failed), losing the user's recent edits and imported screenshots.

---

## 3. Architecture & Migration Decisions

| Decision Area | Chosen Approach | Rationale |
|:---|:---|:---|
| **Primary Storage** | **IndexedDB** (`appshots_db`, store: `editor_state`) | IndexedDB provides gigabytes of storage (up to 50–80% of available disk space), easily accommodating dozens of full-resolution base64 screenshots without quota errors. Direct object storage avoids main-thread UI thread locking during serialization. |
| **Startup / Hydration** | **Dual-Layer Hydration** | Synchronous initial render continues reading from `localStorage` (or default state) to ensure zero layout flash. Immediately on mount, [`getOrMigratePersistedState`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/storage.ts) asynchronously reads IndexedDB. If IndexedDB contains newer state or large projects not present in `localStorage`, the editor reconciles smoothly. |
| **Legacy Migration** | **Automatic On-First-Load** | If IndexedDB is empty on first boot, [`getOrMigratePersistedState`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/storage.ts) inspects `localStorage`. If existing version 2 state is found, it automatically writes it to IndexedDB in the background, ensuring no user projects are lost. |
| **Dual-Write on Save** | **IndexedDB Primary + Best-Effort LocalStorage** | On save, state is persisted to IndexedDB. Best-effort write to `localStorage` keeps the fast synchronous cache warm. If `localStorage` throws `QuotaExceededError` due to image size, the error is safely ignored because the durable save succeeded in IndexedDB. |
| **Concurrency & Ordering** | **Monotonic Sequence Counter** | Each save operation increments `latestSaveSeq`. If an asynchronous write resolves after a newer save has already started or completed, the older write's status transition is discarded, preventing stale writes from clobbering newer project data. |
| **User Interaction Guard** | **`hasUserEdited` Reference** | If the user immediately clicks "Create Project", "Import Project", or begins editing before the async IndexedDB mount read finishes, the reconciliation bails out, guaranteeing in-flight user edits are never overwritten. |
| **Failure Transparency** | **Honest Status Reporting** | `autosaveStatus` reports `"saved"` only if persistence succeeded in durable storage. If both IndexedDB and localStorage fail (e.g., storage disabled, disk full), status transitions to `"error"` with active editor usability preserved. |
| **ZIP Export Independence**| **Self-Contained Portable JSON** | Both browser Studio ZIP export and MCP `package_store_export` generate self-contained `project.json` files with embedded base64 data, independent of local browser storage. |

---

## 4. Files Changed & Implementation Details

### 4.1. [`src/lib/storage.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/storage.ts) (New File)
- Implements core IndexedDB database operations: `openDatabase`, `loadPersistedStateFromIndexedDB`, `savePersistedStateToIndexedDB`, `clearPersistedStateFromIndexedDB`.
- Implements synchronous localStorage helpers: `loadPersistedStateFromLocalStorage`, `savePersistedStateToLocalStorage`, `clearPersistedStateFromLocalStorage`.
- Implements `getOrMigratePersistedState()`: checks IndexedDB, migrates from localStorage if empty, returns validated state.
- Implements `savePersistedStateAsync()`: dual persistence with quota tolerance.

### 4.2. [`src/lib/useLocalStorage.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/useLocalStorage.ts)
- Integrates with `storage.ts` while preserving all existing exports and function signatures (`loadPersistedState`, `savePersistedState`, `clearPersistedState`, `useEditorPersistence`, `PersistedEditorState`, `AutosaveStatus`).
- Updates `useEditorPersistence` to save through dual-persistence with monotonic sequence tracking (`latestSaveSeq`).
- Synchronous `savePersistedState` preserved for `beforeunload` browser lifecycle events.

### 4.3. [`src/context/EditorContext.tsx`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/context/EditorContext.tsx)
- Added `storage.getOrMigratePersistedState()` reconciliation on initial mount.
- Added `hasUserEdited` guard across mutation actions (`createProject`, `deleteProject`, `switchProject`, `importProject`, `handleFileUpload`, `addOverlayImage`, `updateActiveScreenshot`).
- Updated `getInitialState()` to track `lastSaved` and `isFallback` to prevent redundant re-renders when localStorage already matches IndexedDB.

### 4.4. [`src/lib/storage.test.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/storage.test.ts) (New File)
- 10 comprehensive unit and integration tests covering:
  1. Existing localStorage project compatibility and schema validation.
  2. Legacy localStorage to IndexedDB migration.
  3. Large project persistence (>5MB base64 mockup data) succeeding in IndexedDB when localStorage throws `QuotaExceededError`.
  4. Reload and restoration of large multi-slide projects with overlays and device configurations.
  5. Save ordering and stale-write prevention under out-of-order asynchronous completions.
  6. Failure handling and error surfacing when all storage mechanisms are unavailable.
  7. Storage clearing.

### 4.5. [`src/lib/useLocalStorage.test.ts`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/lib/useLocalStorage.test.ts)
- Added verification that autosave status transitions to `"saved"` when `localStorage` throws `QuotaExceededError` but IndexedDB is active and succeeds.

### 4.6. [`src/context/EditorContext.test.tsx`](file:///c:/Users/fpii/Desktop/shankar/appshots/src/context/EditorContext.test.tsx)
- Added verification of asynchronous IndexedDB reconciliation on mount (`EditorContext - IndexedDB Reconciliation on Mount`).

---

## 5. Verification & Test Results

### 5.1. Vitest Suite Execution
Command executed:
```powershell
$env:NODE_OPTIONS="--no-webstorage"; npx vitest run --fileParallelism=false
```

**Results**:
- **Test Files**: **20 passed (20 total)**
- **Tests**: **186 passed (186 total)**
- **Failures**: **0**

| Test Suite | Tests | Result |
|:---|:---:|:---:|
| `src/lib/storage.test.ts` | 10 | **Passed** |
| `src/lib/useLocalStorage.test.ts` | 10 | **Passed** |
| `src/context/EditorContext.test.tsx` | 26 | **Passed** |
| `src/mcp/server.test.ts` | 9 | **Passed** |
| `src/mcp/tools/package-export.test.ts` | 5 | **Passed** |
| `src/mcp/tools/build-and-export.test.ts` | 9 | **Passed** |
| `src/lib/headless-export.test.ts` | 5 | **Passed** |
| `src/mcp/capture/page-crawler.test.ts` | 15 | **Passed** |
| `src/lib/studio/browser-packager.test.ts` | 7 | **Passed** |
| `src/lib/studio/variants.test.ts` | 7 | **Passed** |
| `src/lib/studio/zip-packager.test.ts` | 6 | **Passed** |
| `src/mcp/security.test.ts` | 32 | **Passed** |
| `src/mcp/ai/provider.test.ts` | 18 | **Passed** |
| `src/lib/image-optimizer.test.ts` | 13 | **Passed** |
| Remaining existing suites | 14 | **Passed** |

### 5.2. TypeScript & Production Build Verification
Command executed:
```powershell
npx vite build; npx tsc
```

**Results**:
- **Vite Production Client Bundle**: Transformed 1856 modules in 20.50s without warnings or errors.
- **TypeScript Compiler (`tsc`)**: Exited with code 0 (**0 errors**).

---

## 6. Remaining Limitations & Non-Blockers

1. **Private Browsing IDB Restrictions in Legacy Safari**:
   - In rare legacy browser private modes where IndexedDB is completely blocked, the storage engine falls back to `localStorage`. If projects in those specific environments exceed 5MB, the UI surfaces `"Save failed (unsaved changes)"` truthfully, while active-session editing and ZIP export remain functional.
2. **Google Play Presets**:
   - Intentionally unsupported per specification; explicit descriptive errors remain in place.

---

## 7. Working Tree & Commit Safety Confirmation

- **Git Status**: Inspected via `git status --short`.
- **Pre-existing Changes**: All working tree changes from previous steps (Studio components, MCP package-export tools, reports, canvas toolbar) are intact and untouched.
- **Git Commits**: Zero git commits were created.
