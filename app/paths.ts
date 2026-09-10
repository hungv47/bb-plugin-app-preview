export function hostSep(root: string): "/" | "\\" {
  return root.includes("\\") && !root.includes("/") ? "\\" : "/";
}

export function joinHost(root: string, ...parts: string[]): string {
  const sep = hostSep(root);
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const rest = parts
    .flatMap((part) => part.split(/[\\/]+/))
    .filter((part) => part !== "" && part !== ".");
  return [trimmedRoot, ...rest].join(sep);
}

/** Unquoted POSIX token body: letters, digits, and `_./:@%+=-`. */
export const SHELL_SAFE_TOKEN = /^[A-Za-z0-9_./:@%+=-]+$/;
const PLAIN_ARGV_TOKEN = /^(?:[A-Za-z_][A-Za-z0-9_]*=)?[A-Za-z0-9_./:@%+=-]+$/;
const RELATIVE_CWD_PART = /^[A-Za-z0-9._@%+=-]+$/;

/**
 * POSIX quoting for `sh -lc` (BB command terminals). Safe charset is unquoted;
 * everything else is single-quoted so `$()`, backticks, and `$VAR` stay literal.
 */
export function quoteShellArg(value: string): string {
  if (value.includes("\0")) {
    throw new Error("Argument cannot contain NUL.");
  }
  if (value === "") return "''";
  if (SHELL_SAFE_TOKEN.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** True for a detection/CLI argv token: optional `NAME=value`, then a shell-safe body. */
export function isPlainArgvToken(token: string): boolean {
  return PLAIN_ARGV_TOKEN.test(token);
}

export function relativeFromRoot(root: string, absolute: string): string {
  const sep = hostSep(root);
  const prefix = root.replace(/[\\/]+$/, "") + sep;
  if (absolute === root.replace(/[\\/]+$/, "")) return ".";
  if (absolute.startsWith(prefix)) {
    const relative = absolute.slice(prefix.length).replace(/[\\/]+/g, "/");
    return relative === "" ? "." : relative;
  }
  return ".";
}

/** True for `.` or a relative POSIX path with no `..`, drives, NULs, or shell metacharacters. */
export function isSafeRelativeCwd(cwd: string): boolean {
  if (cwd === "." || cwd === "") return true;
  if (cwd.includes("\0") || cwd.includes("\\") || cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd)) {
    return false;
  }
  const parts = cwd.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== ".." && RELATIVE_CWD_PART.test(part));
}

export const MARKER_FILES = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pyproject.toml",
  "requirements.txt",
  "Pipfile",
  "uv.lock",
  "manage.py",
  "go.mod",
  "Cargo.toml",
  "Cargo.lock",
  "Gemfile",
  "composer.json",
  "artisan",
  "mix.exs",
  "deno.json",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yaml",
  "Procfile",
  "index.html",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "astro.config.mjs",
  "astro.config.ts",
] as const;

export const SKIP_DIR_NAMES = new Set([
  ".bb",
  ".git",
  ".next",
  ".output",
  ".turbo",
  ".venv",
  "backups",
  "build",
  "coverage",
  "deprecated",
  "dist",
  "node_modules",
  "skills",
  "target",
  "vendor",
  "_hq",
]);

export const TEXT_MARKERS = new Set<string>(
  MARKER_FILES.filter((name) => name !== "bun.lockb"),
);
