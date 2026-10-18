/**
 * Security and Path Validation Helpers for AppShots MCP Server
 *
 * Implements strict filesystem boundaries, canonicalization, symlink
 * dereferencing, UNC rejection, protected directory blocking, and error sanitization.
 */

import fs from "node:fs";
import path from "node:path";

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
]);

/**
 * Returns the list of configured allowed input directories.
 * Defaults to the current workspace root (process.cwd()).
 * Can be overridden via customRoots or augmented via APPSHOTS_ALLOWED_INPUT_ROOTS.
 */
export function getAllowedInputRoots(customRoots?: string[]): string[] {
  if (customRoots && Array.isArray(customRoots) && customRoots.length > 0) {
    return customRoots.map((r) => {
      const resolved = path.resolve(r);
      if (fs.existsSync(resolved)) {
        try {
          return fs.realpathSync(resolved);
        } catch {
          return resolved;
        }
      }
      return resolved;
    });
  }

  const roots: string[] = [path.resolve(process.cwd())];

  if (process.env.APPSHOTS_ALLOWED_INPUT_ROOTS) {
    const envRoots = process.env.APPSHOTS_ALLOWED_INPUT_ROOTS.split(path.delimiter)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => path.resolve(r));
    roots.push(...envRoots);
  }

  // Canonicalize roots that exist on disk
  return roots.map((root) => {
    if (fs.existsSync(root)) {
      try {
        return fs.realpathSync(root);
      } catch {
        return root;
      }
    }
    return root;
  });
}

/**
 * Returns the list of configured allowed output directories.
 * Defaults to `<workspace>/output` and `<workspace>/tmp`.
 * Can be overridden via customRoots or augmented via APPSHOTS_ALLOWED_OUTPUT_ROOTS.
 */
export function getAllowedOutputRoots(customRoots?: string[]): string[] {
  if (customRoots && Array.isArray(customRoots) && customRoots.length > 0) {
    return customRoots.map((r) => {
      const resolved = path.resolve(r);
      if (fs.existsSync(resolved)) {
        try {
          return fs.realpathSync(resolved);
        } catch {
          return resolved;
        }
      }
      return resolved;
    });
  }

  const roots: string[] = [
    path.resolve(process.cwd(), "output"),
    path.resolve(process.cwd(), "tmp"),
  ];

  if (process.env.APPSHOTS_ALLOWED_OUTPUT_ROOTS) {
    const envRoots = process.env.APPSHOTS_ALLOWED_OUTPUT_ROOTS.split(path.delimiter)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => path.resolve(r));
    roots.push(...envRoots);
  }

  return roots.map((root) => {
    if (fs.existsSync(root)) {
      try {
        return fs.realpathSync(root);
      } catch {
        return root;
      }
    }
    return root;
  });
}

/**
 * Sanitizes an absolute filesystem path for display in error messages,
 * ensuring internal usernames, machine profile paths, and drive roots are not leaked.
 */
export function sanitizePathForError(targetPath: string): string {
  if (!targetPath || typeof targetPath !== "string") {
    return "";
  }

  const normalized = path.normalize(targetPath);
  const resolved = path.resolve(targetPath);

  // 1. Make relative to current working directory if inside workspace
  const cwd = path.normalize(process.cwd());
  if (
    resolved.toLowerCase() === cwd.toLowerCase() ||
    isPathInsideRoot(resolved, cwd)
  ) {
    const rel = path.relative(cwd, resolved);
    return (rel || ".").replace(/\\/g, "/");
  }

  // 2. Mask user profile / home directory if outside workspace
  const homeDir = process.env.USERPROFILE || process.env.HOME;
  if (homeDir) {
    const normalizedHome = path.normalize(homeDir);
    if (resolved.toLowerCase().startsWith(normalizedHome.toLowerCase())) {
      const relToHome = resolved.slice(normalizedHome.length);
      return `~${relToHome}`.replace(/\\/g, "/");
    }
  }

  // Standardize slashes to forward slashes for clean output
  return normalized.replace(/\\/g, "/");
}

/**
 * Checks whether targetPath is located inside rootPath (or is rootPath itself).
 * Handles Windows drive letters, case-insensitivity, and traversal escapes.
 */
export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normTarget = path.resolve(targetPath);
  const normRoot = path.resolve(rootPath);

  if (process.platform === "win32") {
    const targetParsed = path.parse(normTarget);
    const rootParsed = path.parse(normRoot);

    if (targetParsed.root.toLowerCase() !== rootParsed.root.toLowerCase()) {
      return false;
    }

    const relLower = path.relative(normRoot.toLowerCase(), normTarget.toLowerCase());
    if (relLower === "") return true;
    if (relLower.startsWith("..") || path.isAbsolute(relLower)) {
      return false;
    }
  }

  const rel = path.relative(normRoot, normTarget);
  if (rel === "") return true;
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return false;
  }

  return true;
}

/**
 * Validates and canonicalizes an input image file path.
 *
 * Enforces:
 * - Non-empty string
 * - Null byte rejection
 * - UNC path rejection
 * - Supported image file extensions (.png, .jpg, .jpeg, .webp, .svg)
 * - Existence and regular file check
 * - Symlink dereferencing via realpath
 * - Confinement to configured allowed input roots
 * - Sanitized error reporting without host username leaks
 */
export function validateInputFilePath(
  filePath: string,
  options?: { allowedRoots?: string[] },
): string {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Input file path must be a non-empty string.");
  }

  if (filePath.includes("\0")) {
    throw new Error("Input file path contains invalid characters (null bytes).");
  }

  // Reject UNC paths (e.g. \\server\share or //server/share)
  if (filePath.startsWith("\\\\") || filePath.startsWith("//")) {
    throw new Error("UNC network paths are not permitted.");
  }

  const resolved = path.resolve(filePath);

  // Validate extension
  const ext = path.extname(resolved).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported image file format '${ext}'. Allowed formats: ${Array.from(ALLOWED_IMAGE_EXTENSIONS).join(", ")}.`,
    );
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Input file does not exist: '${sanitizePathForError(filePath)}'`);
  }

  // Dereference symlinks to canonical destination on disk
  let canonicalPath: string;
  try {
    canonicalPath = fs.realpathSync(resolved);
  } catch (err) {
    throw new Error(
      `Failed to resolve real path for '${sanitizePathForError(filePath)}': ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const stat = fs.statSync(canonicalPath);
  if (!stat.isFile()) {
    throw new Error(`Input path is not a regular file: '${sanitizePathForError(filePath)}'`);
  }

  // Confinement check against allowed input roots
  const allowedRoots = getAllowedInputRoots(options?.allowedRoots);
  const isAllowed = allowedRoots.some((root) => isPathInsideRoot(canonicalPath, root));

  if (!isAllowed) {
    throw new Error(
      `Input file path '${sanitizePathForError(filePath)}' is outside the allowed input root directories.`,
    );
  }

  return canonicalPath;
}

/**
 * Validates and canonicalizes an output directory path.
 *
 * Enforces:
 * - Non-empty string
 * - Null byte rejection
 * - UNC path rejection
 * - Filesystem root rejection (e.g. C:\ or /)
 * - Protected system / repository directory rejection (.git, node_modules, src)
 * - Confinement to configured allowed output roots
 * - Safe directory creation
 * - Sanitized error reporting
 */
export function validateOutputDirectoryPath(
  dirPath: string,
  options?: { allowedRoots?: string[] },
): string {
  if (!dirPath || typeof dirPath !== "string") {
    throw new Error("Output directory path must be a non-empty string.");
  }

  if (dirPath.includes("\0")) {
    throw new Error("Output directory path contains invalid characters (null bytes).");
  }

  if (dirPath.startsWith("\\\\") || dirPath.startsWith("//")) {
    throw new Error("UNC network paths are not permitted.");
  }

  const resolved = path.resolve(dirPath);
  const parsed = path.parse(resolved);

  // Prevent writes directly to root directory (e.g. C:\ or /)
  if (resolved === parsed.root) {
    throw new Error("Output directory cannot be the root filesystem path.");
  }

  // Check against protected directories: .git, node_modules, src
  const workspaceRoot = path.resolve(process.cwd());
  const protectedDirs = [
    path.resolve(workspaceRoot, ".git"),
    path.resolve(workspaceRoot, "node_modules"),
    path.resolve(workspaceRoot, "src"),
  ];

  for (const protectedDir of protectedDirs) {
    if (isPathInsideRoot(resolved, protectedDir)) {
      throw new Error(
        `Output directory '${sanitizePathForError(dirPath)}' targets a protected workspace directory and is not permitted.`,
      );
    }
  }

  // Also check individual path segments for protected names
  const segments = resolved.split(path.sep).map((s) => s.toLowerCase());
  if (segments.includes(".git") || segments.includes("node_modules")) {
    throw new Error("Output directory path cannot contain protected directory names (.git, node_modules).");
  }

  // Confinement check against allowed output roots
  const allowedRoots = getAllowedOutputRoots(options?.allowedRoots);
  const isAllowed = allowedRoots.some((root) => isPathInsideRoot(resolved, root));

  if (!isAllowed) {
    throw new Error(
      `Output directory '${sanitizePathForError(dirPath)}' is outside the allowed output root directories.`,
    );
  }

  try {
    fs.mkdirSync(resolved, { recursive: true });
  } catch (err) {
    throw new Error(
      `Cannot access or create output directory '${sanitizePathForError(dirPath)}': ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return fs.realpathSync(resolved);
}

/**
 * Validates a filename prefix to prevent path traversal and invalid characters.
 */
export function validateFilenamePrefix(prefix?: string): string {
  if (!prefix || typeof prefix !== "string") {
    return "appstore-screenshot";
  }

  const trimmed = prefix.trim();
  if (!trimmed) {
    return "appstore-screenshot";
  }

  if (
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("..") ||
    trimmed.includes("\0")
  ) {
    throw new Error(
      "Filename prefix cannot contain path separators ('/', '\\'), null bytes, or directory traversal sequences ('..').",
    );
  }

  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
  if (invalidChars.test(trimmed)) {
    throw new Error("Filename prefix contains invalid filesystem characters.");
  }

  return trimmed;
}
