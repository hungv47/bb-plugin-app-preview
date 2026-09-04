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

export function quoteShellArg(value: string): string {
  if (value === "") return '""';
  if (/^[A-Za-z0-9_./:@%+=-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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

/** True for `.` or a relative POSIX path with no `..`, drives, or NULs. */
export function isSafeRelativeCwd(cwd: string): boolean {
  if (cwd === "." || cwd === "") return true;
  if (cwd.includes("\0") || cwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(cwd)) {
    return false;
  }
  const parts = cwd.replace(/\\/g, "/").split("/");
  return parts.every(
    (part) => part !== "" && part !== "." && part !== ".." && !part.includes(":"),
  );
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
