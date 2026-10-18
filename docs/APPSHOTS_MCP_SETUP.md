# AppShots MCP Server — Setup & Integration Guide

The AppShots Model Context Protocol (MCP) server allows AI coding assistants (such as **Antigravity** and **Cursor**) to programmatically generate store-ready App Store screenshots directly from local image assets and marketing specifications using AppShots' production canvas rendering engine.

---

## 1. Prerequisites

1. **Runtime**: Node.js 18+ or [Bun](https://bun.sh/) 1.1+.
2. **Dependencies**: Installed locally via `bun install` or `npm install`.
3. **Playwright Chromium Browser**: Headless rendering requires Playwright Chromium. If not already installed on your system, install it with:
   ```bash
   bunx playwright install chromium
   # or
   npx playwright install chromium
   ```

---

## 2. Tools Exposed by the Server

The server provides two tools via standard JSON-RPC over `stdio`:

### `build_appshots_project`
Constructs a validated AppShots project specification from local image files, marketing headlines, and mockup styles without manual UI interaction.
- **Parameters**:
  - `projectName` (*string*): Project name.
  - `deviceId` (*string*): Device model (`iphone-15-pro-max`, `iphone-15-pro`, `iphone-14`, `ipad-pro-12-9`, `samsung-galaxy-s24-ultra`, `samsung-galaxy-tab-s9`).
  - `exportSizeId` (*string*): Target dimension preset (`6.7`, `6.5`, `5.5`, `ipad`).
  - `slides` (*array*): Array of slide configurations with local `screenshotPath`, `headline`, `subheadline`, `backgroundMode`, `gradientPresetId`, etc.

### `export_store_assets`
Renders an AppShots project specification to disk as pixel-perfect, store-ready PNG screenshots using the production canvas rendering pipeline.
- **Parameters**:
  - `project` (*object | string*): Project data from `build_appshots_project`.
  - `outputDir` (*string*): Target filesystem directory (must be inside allowed output roots, e.g. `<workspace>/output` or `<workspace>/tmp`).
  - `filenamePrefix` (*string*, default: `appstore-screenshot`): Prefix for output files.

---

## 3. Security Boundaries & Filesystem Hardening

To protect host machines and environments:
- **Input Confinement**: Screenshot files must reside inside the current workspace root or paths explicitly specified in `APPSHOTS_ALLOWED_INPUT_ROOTS`.
- **Symlink Dereferencing**: Symlinks are dereferenced using `fs.realpathSync()`; symlinks pointing outside allowed boundaries are rejected.
- **Output Confinement**: Output files can only be written to `<workspace>/output`, `<workspace>/tmp`, or paths explicitly listed in `APPSHOTS_ALLOWED_OUTPUT_ROOTS`.
- **Protected Paths**: Writes directly to root directories (`C:\`, `/`) or repository source directories (`.git`, `node_modules`, `src`) are strictly forbidden.
- **Network Path Rejection**: UNC paths (`\\server\share`) and null byte injections (`\0`) are immediately rejected.
- **Information Masking**: Error messages mask user home directories (`~`) and avoid leaking internal host absolute paths.

---

## 4. IDE Integration

### Antigravity IDE Configuration

Add the server to your Antigravity configuration file (e.g. in `~/.gemini/antigravity/mcp/appshots.json` or project MCP config):

```json
{
  "mcpServers": {
    "appshots": {
      "command": "npx",
      "args": ["tsx", "<ABSOLUTE_PATH_TO_APPSHOTS>/src/mcp/index.ts"]
    }
  }
}
```

*Note for Windows*: `npx` resolves automatically through `cmd` or PowerShell.

### Cursor IDE Configuration

Add the server to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "appshots": {
      "command": "npx",
      "args": ["tsx", "<ABSOLUTE_PATH_TO_APPSHOTS>/src/mcp/index.ts"]
    }
  }
}
```

---

## 5. Manual Verification & Testing

Verify that the MCP server starts and runs cleanly over stdio:

```bash
# Run automated tests
npx vitest run src/mcp/security.test.ts
npx vitest run src/mcp/server.test.ts

# Run interactive inspection or MCP inspector
npx @modelcontextprotocol/inspector npx tsx src/mcp/index.ts
```
