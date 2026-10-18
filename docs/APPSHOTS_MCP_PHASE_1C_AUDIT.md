# AppShots MCP — Phase 1C, Step 1: Pre-Integration Audit Report

**Date**: October 2026  
**Status**: Pre-Integration Audit Complete (Read-Only)  
**Target Environment**: Antigravity IDE, Cursor, Node.js / Bun MCP Runtime  

---

## 1. Executive Summary

This audit evaluates the security, protocol compliance, runtime reliability, and client configuration readiness of the local AppShots Model Context Protocol (MCP) server implemented in Phase 1B ([`src/mcp/`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/)).

While the server successfully passed real stdio integration tests (`src/mcp/server.test.ts`) and proven full-resolution PNG rendering, several critical security boundaries (input/output directory restrictions, symlink dereferencing, path sanitization) and runtime dependencies (`tsx` devDependency, Chromium installation docs) must be addressed before connecting the server to live IDE agents.

---

## 2. Audit Matrix

| Category | Item | Status | Evidence | Risk & Impact |
| :--- | :--- | :---: | :--- | :--- |
| **Filesystem Security** | Allowed Input Directory Restriction | **GAP** | [`src/mcp/security.ts:12-34`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/security.ts#L12), [`src/mcp/project-builder.ts:89`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/project-builder.ts#L89) | Any readable file on the host machine can be passed as `screenshotPath` and loaded into memory as a data URL. |
| **Filesystem Security** | Allowed Output Directory Restriction | **GAP** | [`src/mcp/security.ts:40-67`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/security.ts#L40), [`src/mcp/asset-exporter.ts:57`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/asset-exporter.ts#L57) | Only root paths (`C:\`, `/`) are blocked; outputs can be written to arbitrary system directories or overwrite host files. |
| **Filesystem Security** | Path Traversal, UNC & Symlink Escapes | **GAP** | [`src/mcp/security.ts:18, 45`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/security.ts#L18) | Null bytes are rejected, but symlinks are not dereferenced via `fs.realpathSync()`. UNC network paths (`\\server\share`) are unhandled. |
| **Filesystem Security** | Safe Existence & Directory Creation | **PASS** | [`src/mcp/security.ts:24-31, 58-64`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/security.ts#L24) | Verifies regular file status with `stat.isFile()`; creates directories safely with `fs.mkdirSync(..., { recursive: true })`. |
| **Filesystem Security** | Malformed Project Data Protection | **PASS** | [`src/mcp/project-builder.ts:33-47`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/project-builder.ts#L33), [`src/mcp/asset-exporter.ts:20-27`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/asset-exporter.ts#L20) | Strict Zod schemas reject invalid parameters before any file I/O or browser actions occur. |
| **Filesystem Security** | Error Message Sanitization | **GAP** | [`src/mcp/security.ts:25, 30, 61`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/security.ts#L25) | Error strings return full host absolute paths (e.g. `C:\Users\username\...`), exposing internal filesystem layouts to LLMs. |
| **MCP Protocol** | stdout Exclusivity for JSON-RPC | **PASS** | `src/mcp/server.ts`, `src/lib/headless-export.ts` | 0 `console.log()` statements exist; all RPC output goes exclusively through `StdioServerTransport`. |
| **MCP Protocol** | Diagnostic Logging to stderr | **PASS** | [`src/mcp/index.ts:19`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/index.ts#L19) | Fatal startup errors are directed to `console.error()`, preserving `stdout` protocol integrity. |
| **MCP Protocol** | Stdio Handshake & Tool Discovery | **PASS** | [`src/mcp/server.test.ts:52-64`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/server.test.ts#L52) | Verified via automated test: real subprocess client discovered both tools and validated descriptions. |
| **MCP Protocol** | Structured Error Handling | **PASS** | [`src/mcp/server.ts:42, 76`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/server.ts#L42), [`src/mcp/server.test.ts:143`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/server.test.ts#L143) | Failed operations return `{ isError: true, content: [...] }` without crashing the server process. |
| **MCP Protocol** | Resource Cleanup on Execution | **PASS** | [`src/lib/headless-export.ts:277-285`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/lib/headless-export.ts#L277) | Chromium and Vite servers are closed in a guaranteed `try...finally` block. |
| **MCP Protocol** | Resource Cleanup on Client Disconnect | **GAP** | [`src/mcp/index.ts:12-21`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/index.ts#L12) | No `SIGINT`, `SIGTERM`, or `stdin` close handlers exist to shut down active child processes if the client terminates abruptly. |
| **Runtime & Deps** | `tsx` Dependency Declaration | **GAP** | [`package.json:25-42`](file:///c:/Users/shank/OneDrive/Desktop/appshots/package.json#L25) | `tsx` is not in `devDependencies`; running `npx tsx` on a clean/offline machine will fail if `tsx` is not globally installed. |
| **Runtime & Deps** | Repository Dependency Resolution | **PASS** | `package.json`, `bun.lock` | All direct imports resolve within the project `node_modules`. `bun run build` succeeds with 0 errors. |
| **Runtime & Deps** | Chromium Installation Documentation | **GAP** | `README.md`, `docs/` | The required one-time command (`bunx playwright install chromium`) is not documented for end-users. |
| **IDE Integration** | Antigravity Configuration Format | **PASS** | `~/.gemini/antigravity/mcp/` | Standard stdio configuration schema (`command`, `args`, `env`) verified against active IDE servers. |
| **IDE Integration** | Cursor Configuration Format | **PASS** | `.cursor/mcp.json` specification | Standard `mcpServers` JSON structure verified. |
| **IDE Integration** | Active Connection Status | **PASS** | Neither IDE configured yet | Correctly marked as uncommitted and pending security fixes. |

---

## 3. Deep-Dive Findings & Recommended Fixes

### 3.1 Filesystem Security

#### GAP-1: Unrestricted Input File Paths
* **Current Implementation**:
  ```typescript
  // src/mcp/security.ts
  export function validateInputFilePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error(`Input file does not exist: '${resolved}'`);
    ...
  }
  ```
* **Risk**: High. Any file accessible to the user account (e.g. `~/.ssh/id_rsa`, `.env`, system files) can be read into memory if requested by a compromised or confused LLM client turn.
* **Smallest Recommended Fix**: Define an `ALLOWED_INPUT_ROOTS` array (defaulting to `[process.cwd()]` or configured directories). Enforce that `resolved.startsWith(allowedRoot)` for at least one allowed root directory.

#### GAP-2: Unrestricted Output Directory Paths
* **Current Implementation**:
  ```typescript
  // src/mcp/security.ts
  export function validateOutputDirectoryPath(dirPath: string): string {
    const resolved = path.resolve(dirPath);
    if (resolved === parsed.root) throw new Error("Output directory cannot be root");
    ...
  }
  ```
* **Risk**: High. Allows writes to arbitrary locations on disk (e.g. system directories, user desktop, existing source files).
* **Smallest Recommended Fix**: Define an `ALLOWED_OUTPUT_ROOTS` array (defaulting to `[path.resolve(process.cwd(), "output")]` or workspace-relative directories). Explicitly block writes into `.git/`, `node_modules/`, and parent-escaping paths.

#### GAP-3: Symlinks, UNC Paths & Information Disclosure in Errors
* **Current Implementation**: Symlinks are checked with `stat.isFile()` without dereferencing `fs.realpathSync()`. UNC network paths (`\\\\server\\share`) are not rejected. Error messages expose full absolute machine paths (e.g. `C:\Users\shank\...`).
* **Risk**: Symlinks can bypass boundary checks. Full paths leak local usernames and folder structures.
* **Smallest Recommended Fix**:
  1. Call `fs.realpathSync()` on existing input paths before checking boundaries.
  2. Reject paths starting with `\\\\` (UNC paths).
  3. Format error messages to display relative paths or generic error descriptions instead of raw absolute host paths.

---

### 3.2 Protocol & Process Lifecycle

#### GAP-4: Missing Process Termination Handlers
* **Current Implementation**: [`src/mcp/index.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/index.ts) connects the transport but does not listen for process termination signals.
* **Risk**: If the MCP client process closes or crashes during an active export, the child Playwright browser or ephemeral Vite server could remain running in the background.
* **Smallest Recommended Fix**:
  Add standard shutdown hooks in `src/mcp/index.ts`:
  ```typescript
  const cleanup = () => {
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.stdin.on("close", cleanup);
  ```

---

### 3.3 Runtime & Dependencies

#### GAP-5: `tsx` Missing From `devDependencies`
* **Current Implementation**: The documented launch command is `npx tsx src/mcp/index.ts`. However, `tsx` is not listed in `devDependencies` in [`package.json`](file:///c:/Users/shank/OneDrive/Desktop/appshots/package.json).
* **Risk**: On a clean clone or an offline workstation, `npx tsx` will attempt an on-demand npm network lookup or fail.
* **Smallest Recommended Fix**: Install `tsx` as a devDependency (`bun add -d tsx`) so `npx tsx` and local CLI execution are guaranteed to be self-contained and reproducible.

#### GAP-6: Undocumented Playwright Browser Installation Prerequisite
* **Current Implementation**: If Chromium has not been downloaded to the user's local cache (`~/.cache/ms-playwright` or `%LOCALAPPDATA%\ms-playwright`), the first export call fails with an internal Playwright launcher error.
* **Risk**: Degraded initial setup experience in Cursor or Antigravity.
* **Smallest Recommended Fix**: Document the one-time prerequisite command (`bunx playwright install chromium`) clearly in the project documentation and README.

---

## 4. IDE Integration Readiness

### Antigravity IDE
* **Target Configuration File**: `~/.gemini/antigravity/mcp/appshots.json` or project-level configuration.
* **Configuration Structure**:
  ```json
  {
    "mcpServers": {
      "appshots": {
        "command": "npx",
        "args": ["tsx", "C:/path/to/appshots/src/mcp/index.ts"]
      }
    }
  }
  ```
* **Status**: Ready pending resolution of GAP-1 through GAP-5.

### Cursor IDE
* **Target Configuration File**: `.cursor/mcp.json` or `~/.cursor/mcp.json`.
* **Configuration Structure**:
  ```json
  {
    "mcpServers": {
      "appshots": {
        "command": "npx",
        "args": ["tsx", "C:/path/to/appshots/src/mcp/index.ts"]
      }
    }
  }
  ```
* **Status**: Ready pending resolution of GAP-1 through GAP-5.

---

## 5. Recommended Next Implementation Task

**Recommended Next Task**: **Implement Phase 1C, Step 2: Hardening Filesystem Security & Runtime Packaging**.
Specifically:
1. Harden [`src/mcp/security.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/security.ts) by adding explicit workspace input/output boundary enforcement, UNC path rejection, `fs.realpathSync` symlink dereferencing, and path sanitization in errors (fixing GAP-1, GAP-2, GAP-3).
2. Add graceful signal termination hooks to [`src/mcp/index.ts`](file:///c:/Users/shank/OneDrive/Desktop/appshots/src/mcp/index.ts) (fixing GAP-4).
3. Add `tsx` to `devDependencies` in `package.json` (fixing GAP-5).
4. Document the Chromium installation prerequisite (fixing GAP-6).
