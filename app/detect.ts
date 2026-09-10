import { isPlainArgvToken, isSafeRelativeCwd, quoteShellArg } from "./paths.js";

export type PackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "uv"
  | "pip"
  | "cargo"
  | "go"
  | "bundle"
  | "none";

export type Confidence = "high" | "medium" | "low";

export type Detection = {
  found: boolean;
  framework: string | null;
  frameworkLabel: string | null;
  packageManager: PackageManager | null;
  command: string | null;
  installCommand: string | null;
  port: number | null;
  relativeCwd: string;
  dependencies: string[];
  notes: string[];
  confidence: Confidence | null;
};

export type DirSnapshot = {
  relativeCwd: string;
  entries: { name: string; kind: "file" | "directory" }[];
  contents: Record<string, string>;
  hasNodeModules: boolean;
};

const SCRIPT_PREF = ["dev", "start", "preview", "serve"] as const;

const NODE_FRAMEWORKS: {
  id: string;
  label: string;
  packages: string[];
  port: number;
}[] = [
  { id: "next", label: "Next.js", packages: ["next"], port: 3000 },
  { id: "nuxt", label: "Nuxt", packages: ["nuxt"], port: 3000 },
  { id: "remix", label: "Remix", packages: ["@remix-run/dev", "@remix-run/react"], port: 3000 },
  {
    id: "react-router",
    label: "React Router",
    packages: ["@react-router/dev", "@react-router/node"],
    port: 5173,
  },
  { id: "astro", label: "Astro", packages: ["astro"], port: 4321 },
  { id: "sveltekit", label: "SvelteKit", packages: ["@sveltejs/kit"], port: 5173 },
  { id: "angular", label: "Angular", packages: ["@angular/core", "@angular/cli"], port: 4200 },
  { id: "expo", label: "Expo", packages: ["expo"], port: 8081 },
  { id: "tanstack-start", label: "TanStack Start", packages: ["@tanstack/react-start"], port: 3000 },
  { id: "nest", label: "NestJS", packages: ["@nestjs/core"], port: 3000 },
  { id: "vite", label: "Vite", packages: ["vite"], port: 5173 },
  { id: "cra", label: "Create React App", packages: ["react-scripts"], port: 3000 },
  { id: "express", label: "Express", packages: ["express"], port: 3000 },
  { id: "fastify", label: "Fastify", packages: ["fastify"], port: 3000 },
  { id: "hono", label: "Hono", packages: ["hono"], port: 3000 },
];

type PackageJson = {
  name?: string;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
};

function parseJson(text: string | undefined): PackageJson | null {
  if (text === undefined) return null;
  try {
    return JSON.parse(text) as PackageJson;
  } catch {
    return null;
  }
}

function depNames(pkg: PackageJson): string[] {
  return [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ];
}

function hasPackage(names: string[], wanted: string[]): boolean {
  const set = new Set(names);
  return wanted.some((name) => set.has(name));
}

function packageManagerFromField(field: string | undefined): PackageManager | null {
  if (field === undefined || field === "") return null;
  const id = field.split("@")[0]?.trim();
  if (id === "npm" || id === "pnpm" || id === "yarn" || id === "bun") return id;
  return null;
}

export function packageManagerFromLockfiles(
  names: Set<string>,
  packageManagerField?: string,
): PackageManager | null {
  const fromField = packageManagerFromField(packageManagerField);
  if (fromField !== null) return fromField;
  if (names.has("pnpm-lock.yaml") || names.has("pnpm-workspace.yaml")) return "pnpm";
  if (names.has("yarn.lock")) return "yarn";
  if (names.has("bun.lock") || names.has("bun.lockb")) return "bun";
  if (names.has("package-lock.json") || names.has("npm-shrinkwrap.json")) return "npm";
  if (names.has("uv.lock")) return "uv";
  if (names.has("Pipfile") || names.has("requirements.txt") || names.has("pyproject.toml")) {
    return names.has("uv.lock") ? "uv" : "pip";
  }
  if (names.has("Cargo.lock") || names.has("Cargo.toml")) return "cargo";
  if (names.has("go.mod")) return "go";
  if (names.has("Gemfile")) return "bundle";
  return null;
}

export function parsePortHint(text: string): number | null {
  const patterns = [
    /(?:--port|-p)(?:=|\s+)(\d{2,5})\b/i,
    /\bPORT=(\d{2,5})\b/,
    /\blocalhost:(\d{2,5})\b/i,
    /\b127\.0\.0\.1:(\d{2,5})\b/,
    /\b0\.0\.0\.0:(\d{2,5})\b/,
    /\bport\s*[:=]\s*(\d{2,5})\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1] === undefined) continue;
    const port = Number(match[1]);
    if (Number.isInteger(port) && port >= 1 && port <= 65535) return port;
  }
  return null;
}

function pickScript(
  scripts: Record<string, string> | undefined,
): { name: string; body: string } | null {
  if (scripts === undefined) return null;
  for (const name of SCRIPT_PREF) {
    const body = scripts[name];
    if (typeof body === "string" && body.trim() !== "") return { name, body };
  }
  return null;
}

function runScript(pm: PackageManager | null, scriptName: string): string {
  switch (pm) {
    case "pnpm":
      return scriptName === "dev" || scriptName === "start"
        ? `pnpm ${scriptName}`
        : `pnpm run ${scriptName}`;
    case "yarn":
      return `yarn ${scriptName}`;
    case "bun":
      return `bun run ${scriptName}`;
    default:
      return `npm run ${scriptName}`;
  }
}

function installCommand(pm: PackageManager | null): string | null {
  switch (pm) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    case "npm":
      return "npm install";
    case "uv":
      return "uv sync";
    default:
      return null;
  }
}

function pythonInstall(dir: DirSnapshot, pm: PackageManager): string | null {
  if (pm === "uv") return "uv sync";
  const names = new Set(dir.entries.map((entry) => entry.name));
  if (names.has("requirements.txt")) return "pip install -r requirements.txt";
  return null;
}

function emptyDetection(relativeCwd: string): Detection {
  return {
    found: false,
    framework: null,
    frameworkLabel: null,
    packageManager: null,
    command: null,
    installCommand: null,
    port: null,
    relativeCwd,
    dependencies: [],
    notes: [],
    confidence: null,
  };
}

function detectNode(dir: DirSnapshot): Detection | null {
  const pkg = parseJson(dir.contents["package.json"]);
  if (pkg === null) return null;
  const names = new Set(dir.entries.map((entry) => entry.name));
  const deps = depNames(pkg);
  const notable = NODE_FRAMEWORKS.filter((item) => hasPackage(deps, item.packages)).map(
    (item) => item.id,
  );
  const framework = NODE_FRAMEWORKS.find((item) => hasPackage(deps, item.packages));
  const pm = packageManagerFromLockfiles(names, pkg.packageManager) ?? "npm";
  const script = pickScript(pkg.scripts);
  const configText = [
    dir.contents["vite.config.ts"],
    dir.contents["vite.config.js"],
    dir.contents["vite.config.mjs"],
    dir.contents["next.config.js"],
    dir.contents["next.config.mjs"],
    dir.contents["next.config.ts"],
    dir.contents["astro.config.mjs"],
    dir.contents["astro.config.ts"],
  ]
    .filter((text): text is string => text !== undefined)
    .join("\n");
  const port =
    (script !== null ? parsePortHint(script.body) : null) ??
    parsePortHint(configText) ??
    framework?.port ??
    (script !== null ? 3000 : null);
  const notes: string[] = [];
  if (!dir.hasNodeModules) notes.push("Dependencies are not installed yet.");
  if (script === null) notes.push("No dev/start/preview script in package.json.");
  const command = script !== null ? runScript(pm, script.name) : null;
  if (command === null) return null;
  return {
    found: true,
    framework: framework?.id ?? "node",
    frameworkLabel: framework?.label ?? (pkg.name || "Node"),
    packageManager: pm,
    command,
    installCommand: dir.hasNodeModules ? null : installCommand(pm),
    port,
    relativeCwd: dir.relativeCwd,
    dependencies: notable.length > 0 ? notable : deps.slice(0, 8),
    notes,
    confidence: framework !== undefined ? "high" : "medium",
  };
}

function textHas(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function detectPython(dir: DirSnapshot): Detection | null {
  const names = new Set(dir.entries.map((entry) => entry.name));
  const pyproject = dir.contents["pyproject.toml"] ?? "";
  const requirements = dir.contents["requirements.txt"] ?? "";
  const pipfile = dir.contents["Pipfile"] ?? "";
  const blob = `${pyproject}\n${requirements}\n${pipfile}`;
  const hasPython =
    names.has("pyproject.toml") ||
    names.has("requirements.txt") ||
    names.has("Pipfile") ||
    names.has("manage.py") ||
    names.has("uv.lock");
  if (!hasPython) return null;
  const pm: PackageManager = names.has("uv.lock") || textHas(pyproject, "[tool.uv") ? "uv" : "pip";
  const run = (command: string) => (pm === "uv" ? `uv run ${command}` : command);
  const notes: string[] = [];
  if (names.has("manage.py") || textHas(blob, "django")) {
    return {
      found: true,
      framework: "django",
      frameworkLabel: "Django",
      packageManager: pm,
      command: run("python manage.py runserver 0.0.0.0:8000"),
      installCommand: pythonInstall(dir, pm),
      port: 8000,
      relativeCwd: dir.relativeCwd,
      dependencies: ["django"],
      notes,
      confidence: "high",
    };
  }
  if (textHas(blob, "fastapi")) {
    const module = names.has("main.py") ? "main:app" : names.has("app.py") ? "app:app" : "main:app";
    notes.push("FastAPI module is guessed from main.py/app.py.");
    return {
      found: true,
      framework: "fastapi",
      frameworkLabel: "FastAPI",
      packageManager: pm,
      command: run(`uvicorn ${module} --reload --host 0.0.0.0 --port 8000`),
      installCommand: pythonInstall(dir, pm),
      port: 8000,
      relativeCwd: dir.relativeCwd,
      dependencies: ["fastapi"],
      notes,
      confidence: "high",
    };
  }
  if (textHas(blob, "streamlit")) {
    const file = names.has("streamlit_app.py")
      ? "streamlit_app.py"
      : names.has("Home.py")
        ? "Home.py"
        : names.has("app.py")
          ? "app.py"
          : "app.py";
    return {
      found: true,
      framework: "streamlit",
      frameworkLabel: "Streamlit",
      packageManager: pm,
      command: run(`streamlit run ${file} --server.port 8501 --server.address 0.0.0.0`),
      installCommand: pythonInstall(dir, pm),
      port: 8501,
      relativeCwd: dir.relativeCwd,
      dependencies: ["streamlit"],
      notes,
      confidence: "high",
    };
  }
  if (textHas(blob, "flask") || textHas(blob, "quart")) {
    return {
      found: true,
      framework: "flask",
      frameworkLabel: "Flask",
      packageManager: pm,
      command: run("flask run --host 0.0.0.0 --port 5000"),
      installCommand: pythonInstall(dir, pm),
      port: 5000,
      relativeCwd: dir.relativeCwd,
      dependencies: ["flask"],
      notes: [...notes, "FLASK_APP may still need to be set."],
      confidence: "medium",
    };
  }
  return null;
}

function detectOther(dir: DirSnapshot): Detection | null {
  const names = new Set(dir.entries.map((entry) => entry.name));
  const gemfile = dir.contents["Gemfile"] ?? "";
  if (names.has("Gemfile") && (textHas(gemfile, "rails") || names.has("bin"))) {
    return {
      found: true,
      framework: "rails",
      frameworkLabel: "Ruby on Rails",
      packageManager: "bundle",
      command: "bin/rails server -b 0.0.0.0 -p 3000",
      installCommand: "bundle install",
      port: 3000,
      relativeCwd: dir.relativeCwd,
      dependencies: ["rails"],
      notes: [],
      confidence: "high",
    };
  }
  const cargo = dir.contents["Cargo.toml"] ?? "";
  if (names.has("Cargo.toml") && /axum|actix-web|rocket|warp|tide/.test(cargo)) {
    return {
      found: true,
      framework: "rust-web",
      frameworkLabel: "Rust web",
      packageManager: "cargo",
      command: "cargo run",
      installCommand: null,
      port: parsePortHint(cargo) ?? 8080,
      relativeCwd: dir.relativeCwd,
      dependencies: [],
      notes: ["Port is a guess unless the crate prints it."],
      confidence: "medium",
    };
  }
  if (names.has("go.mod")) {
    return {
      found: true,
      framework: "go",
      frameworkLabel: "Go",
      packageManager: "go",
      command: "go run .",
      installCommand: null,
      port: 8080,
      relativeCwd: dir.relativeCwd,
      dependencies: [],
      notes: ["Go apps do not declare a standard preview port."],
      confidence: "low",
    };
  }
  const composer = dir.contents["composer.json"] ?? "";
  if (names.has("artisan") || (names.has("composer.json") && textHas(composer, "laravel/framework"))) {
    return {
      found: true,
      framework: "laravel",
      frameworkLabel: "Laravel",
      packageManager: null,
      command: "php artisan serve --host 0.0.0.0 --port 8000",
      installCommand: "composer install",
      port: 8000,
      relativeCwd: dir.relativeCwd,
      dependencies: ["laravel"],
      notes: [],
      confidence: "high",
    };
  }
  if (
    names.has("docker-compose.yml") ||
    names.has("docker-compose.yaml") ||
    names.has("compose.yaml")
  ) {
    return {
      found: true,
      framework: "compose",
      frameworkLabel: "Docker Compose",
      packageManager: "none",
      command: "docker compose up",
      installCommand: null,
      port: 8080,
      relativeCwd: dir.relativeCwd,
      dependencies: [],
      notes: ["Compose port mapping is not parsed; set the port if Open in browser misses."],
      confidence: "low",
    };
  }
  if (names.has("index.html") && !names.has("package.json")) {
    return {
      found: true,
      framework: "static",
      frameworkLabel: "Static files",
      packageManager: "none",
      command: "python3 -m http.server 8080",
      installCommand: null,
      port: 8080,
      relativeCwd: dir.relativeCwd,
      dependencies: [],
      notes: [],
      confidence: "medium",
    };
  }
  return null;
}

function detectDirectory(dir: DirSnapshot): Detection | null {
  return detectNode(dir) ?? detectPython(dir) ?? detectOther(dir);
}

const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const PREFER_STOP = new Set([
  "preview",
  "app",
  "the",
  "and",
  "for",
  "with",
  "from",
  "login",
  "test",
  "open",
  "start",
  "thread",
]);

function preferTokens(prefer: string | null | undefined): string[] {
  return (prefer ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !PREFER_STOP.has(token));
}

function preferScore(detection: Detection, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack =
    `${detection.relativeCwd} ${detection.frameworkLabel ?? ""} ${detection.framework ?? ""}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length;
  }
  return score;
}

function pathDepth(relativeCwd: string): number {
  if (relativeCwd === "." || relativeCwd === "") return 0;
  return relativeCwd.split("/").length;
}

export function detectAll(
  directories: DirSnapshot[],
  prefer?: string | null,
): Detection[] {
  const found: Detection[] = [];
  for (const dir of directories) {
    const next = detectDirectory(dir);
    if (next !== null) found.push(next);
  }
  const tokens = preferTokens(prefer);
  return found.sort((a, b) => {
    const aRank = a.confidence === null ? 0 : CONFIDENCE_RANK[a.confidence];
    const bRank = b.confidence === null ? 0 : CONFIDENCE_RANK[b.confidence];
    if (aRank !== bRank) return bRank - aRank;
    const preferDelta = preferScore(b, tokens) - preferScore(a, tokens);
    if (preferDelta !== 0) return preferDelta;
    if (a.relativeCwd === "." && b.relativeCwd !== ".") return -1;
    if (b.relativeCwd === "." && a.relativeCwd !== ".") return 1;
    const depth = pathDepth(a.relativeCwd) - pathDepth(b.relativeCwd);
    if (depth !== 0) return depth;
    return a.relativeCwd.localeCompare(b.relativeCwd);
  });
}

export function detectApp(
  directories: DirSnapshot[],
  prefer?: string | null,
): Detection {
  return detectAll(directories, prefer)[0] ?? emptyDetection(directories[0]?.relativeCwd ?? ".");
}

const CD_PREFIX = /^\s*cd\s+(?:--\s+)?("[^"]+"|'[^']+'|\S+)\s*&&\s*([\s\S]+)$/;

export type LaunchPlan = {
  relativeCwd: string;
  installArgv: string[] | null;
  startArgv: string[];
};

export function parseLaunchArgv(command: string): string[] {
  const trimmed = command.trim();
  if (trimmed === "") throw new Error("No start command to run.");
  if (/[\n\r\0]/.test(command)) {
    throw new Error("Start command cannot contain newlines.");
  }
  const tokens = trimmed.split(/\s+/);
  for (const token of tokens) {
    if (isPlainArgvToken(token)) continue;
    throw new Error(
      "Start command may only use plain arguments (no substitutions, quotes, or shell operators).",
    );
  }
  return tokens;
}

export function formatLaunchCommand(plan: LaunchPlan): string {
  const recipe = plan.startArgv.map(quoteShellArg).join(" ");
  const withInstall =
    plan.installArgv === null || plan.installArgv.length === 0
      ? recipe
      : `${plan.installArgv.map(quoteShellArg).join(" ")} && ${recipe}`;
  if (plan.relativeCwd === "" || plan.relativeCwd === ".") return withInstall;
  if (!isSafeRelativeCwd(plan.relativeCwd)) {
    throw new Error("App directory must be a relative path without .. or shell characters.");
  }
  return `cd -- ${quoteShellArg(`./${plan.relativeCwd}`)} && ${withInstall}`;
}

/** Peel `cd dir && rest` so callers can pass cwd and the inner command separately. */
export function splitCdPrefix(command: string): { relativeCwd: string | null; command: string } {
  const match = CD_PREFIX.exec(command.trim());
  if (match === null || match[1] === undefined || match[2] === undefined) {
    return { relativeCwd: null, command: command.trim() };
  }
  let relativeCwd = match[1].replace(/^["']|["']$/g, "").replace(/\\/g, "/");
  if (relativeCwd.startsWith("./")) relativeCwd = relativeCwd.slice(2) || ".";
  if (relativeCwd.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativeCwd)) {
    return { relativeCwd: null, command: command.trim() };
  }
  return { relativeCwd, command: match[2].trim() };
}

function commandHasListenHost(command: string): boolean {
  return (
    /(?:^|[\s;|&])HOST=/.test(command) ||
    /(?:^|\s)(?:--host|--hostname|-H)(?:\s|=)/.test(command) ||
    /(?:^|\s)--(?:localhost|lan|tunnel)(?:\s|$)/.test(command)
  );
}

function ipv4HostFlag(framework: string | null): string | null {
  switch (framework) {
    case "next":
      return "--hostname 127.0.0.1";
    case "astro":
    case "vite":
    case "nuxt":
    case "sveltekit":
    case "angular":
    case "tanstack-start":
      return "--host 127.0.0.1";
    case "expo":
      return "--localhost";
    default:
      return null;
  }
}

function looksLikeJsDevScript(command: string): boolean {
  return (
    /^(?:npm|pnpm|yarn|bun|npx|bunx)(?:\s+run)?\s+\S+/.test(command) ||
    /\b(?:astro|vite|next|nuxt|remix|expo|react-scripts)\b/.test(command) ||
    /\bng serve\b/.test(command)
  );
}

/**
 * Connect share forwards to 127.0.0.1. `localhost` on macOS often binds [::1] only,
 * which then fails with ECONNREFUSED on the share URL.
 */
export function withIpv4ListenHost(command: string, framework: string | null): string {
  if (framework === "cra" && !commandHasListenHost(command) && looksLikeJsDevScript(command)) {
    return `HOST=127.0.0.1 ${command}`;
  }
  const flag = ipv4HostFlag(framework);
  if (flag === null || commandHasListenHost(command) || !looksLikeJsDevScript(command)) {
    return command;
  }
  if (/(?:^|\s)--(?:\s|$)/.test(command)) return `${command} ${flag}`;
  if (/^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+\S+/.test(command)) return `${command} -- ${flag}`;
  return `${command} ${flag}`;
}

export function launchPlan(
  detection: Detection,
  options: {
    autoInstall: boolean;
    commandOverride?: string;
  },
): LaunchPlan {
  const split = splitCdPrefix(options.commandOverride ?? "");
  let inner = detection.command;
  if (options.commandOverride !== undefined && options.commandOverride.trim() !== "") {
    inner = split.command !== "" ? split.command : options.commandOverride.trim();
  }
  if (inner === undefined || inner === null || inner === "") {
    throw new Error("No start command to run.");
  }
  const relativeCwd = split.relativeCwd ?? detection.relativeCwd;
  if (!isSafeRelativeCwd(relativeCwd)) {
    throw new Error("App directory must be a relative path without .. or shell characters.");
  }
  const startArgv = parseLaunchArgv(withIpv4ListenHost(inner, detection.framework));
  const installArgv =
    options.autoInstall && detection.installCommand !== null
      ? parseLaunchArgv(detection.installCommand)
      : null;
  return { relativeCwd, installArgv, startArgv };
}

export function launchCommand(
  detection: Detection,
  options: {
    autoInstall: boolean;
    commandOverride?: string;
  },
): string {
  return formatLaunchCommand(launchPlan(detection, options));
}
