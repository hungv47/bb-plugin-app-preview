/**
 * Dev vs system classification and framework hints, adapted from
 * port-whisperer (https://github.com/LarsenCundric/port-whisperer),
 * Copyright (c) 2026 Larsen Cundric, MIT License. See THIRD_PARTY.md.
 */

import { basename, dirname } from "node:path";

const SYSTEM_APPS = [
  "spotify",
  "raycast",
  "tableplus",
  "postman",
  "linear",
  "cursor",
  "controlce",
  "rapportd",
  "superhuma",
  "setappage",
  "slack",
  "discord",
  "firefox",
  "chrome",
  "google",
  "safari",
  "figma",
  "notion",
  "zoom",
  "teams",
  "code",
  "iterm2",
  "warp",
  "arc",
  "loginwindow",
  "windowserver",
  "systemuise",
  "kernel_task",
  "launchd",
  "mdworker",
  "mds_stores",
  "cfprefsd",
  "coreaudio",
  "corebrightne",
  "airportd",
  "bluetoothd",
  "sharingd",
  "usernoted",
  "notificationc",
  "cloudd",
  "systemd",
  "snapd",
  "networkmanager",
  "gdm",
  "sshd",
  "cron",
  "dbus-daemon",
  "polkitd",
  "rsyslogd",
  "thermald",
  "accounts-daemon",
  "svchost",
  "csrss",
  "lsass",
  "services",
  "explorer",
  "dwm",
  "searchindexer",
  "taskhostw",
  "runtimebroker",
  "shellexperiencehost",
] as const;

const DEV_NAMES = new Set([
  "node",
  "python",
  "python3",
  "ruby",
  "java",
  "go",
  "cargo",
  "deno",
  "bun",
  "php",
  "uvicorn",
  "gunicorn",
  "flask",
  "rails",
  "npm",
  "npx",
  "yarn",
  "pnpm",
  "tsc",
  "tsx",
  "esbuild",
  "rollup",
  "turbo",
  "nx",
  "jest",
  "vitest",
  "mocha",
  "pytest",
  "cypress",
  "playwright",
  "rustc",
  "dotnet",
  "gradle",
  "mvn",
  "mix",
  "elixir",
]);

const CMD_INDICATORS = [
  /\bnode\b/,
  /\bnext[\s-]/,
  /\bvite\b/,
  /\bnuxt\b/,
  /\bwebpack\b/,
  /\bremix\b/,
  /\bastro\b/,
  /\bgulp\b/,
  /\bng serve\b/,
  /\bgatsb/,
  /\bflask\b/,
  /\bdjango\b|manage\.py/,
  /\buvicorn\b/,
  /\brails\b/,
  /\bcargo\b/,
];

const PROJECT_MARKERS = [
  "package.json",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
  "Gemfile",
  "pom.xml",
  "build.gradle",
] as const;

export function isDevProcess(processName: string, command: string): boolean {
  const name = processName.toLowerCase();
  const cmd = command.toLowerCase();
  for (const app of SYSTEM_APPS) {
    if (name.startsWith(app)) return false;
  }
  if (DEV_NAMES.has(name)) return true;
  if (name.startsWith("com.docke") || name === "docker" || name === "docker-sandbox") {
    return true;
  }
  for (const re of CMD_INDICATORS) {
    if (re.test(cmd)) return true;
  }
  return false;
}

export function detectFrameworkFromImage(image: string): string {
  const img = image.toLowerCase();
  if (img.includes("postgres")) return "PostgreSQL";
  if (img.includes("redis")) return "Redis";
  if (img.includes("mysql") || img.includes("mariadb")) return "MySQL";
  if (img.includes("mongo")) return "MongoDB";
  if (img.includes("nginx")) return "nginx";
  if (img.includes("localstack")) return "LocalStack";
  if (img.includes("rabbitmq")) return "RabbitMQ";
  if (img.includes("kafka")) return "Kafka";
  if (img.includes("elasticsearch") || img.includes("opensearch")) return "Elasticsearch";
  if (img.includes("minio")) return "MinIO";
  return "Docker";
}

export function detectFrameworkFromCommand(command: string, processName: string): string | null {
  const cmd = command.toLowerCase();
  if (cmd.includes("next")) return "Next.js";
  if (cmd.includes("vite")) return "Vite";
  if (cmd.includes("nuxt")) return "Nuxt";
  if (cmd.includes("angular") || cmd.includes("ng serve")) return "Angular";
  if (cmd.includes("webpack")) return "Webpack";
  if (cmd.includes("remix")) return "Remix";
  if (cmd.includes("astro")) return "Astro";
  if (cmd.includes("gatsby")) return "Gatsby";
  if (cmd.includes("flask")) return "Flask";
  if (cmd.includes("django") || cmd.includes("manage.py")) return "Django";
  if (cmd.includes("uvicorn")) return "FastAPI";
  if (cmd.includes("rails")) return "Rails";
  if (cmd.includes("cargo") || cmd.includes("rustc")) return "Rust";
  return detectFrameworkFromName(processName);
}

function detectFrameworkFromName(processName: string): string | null {
  const name = processName.toLowerCase();
  if (name === "node") return "Node.js";
  if (name === "python" || name === "python3") return "Python";
  if (name === "ruby") return "Ruby";
  if (name === "java") return "Java";
  if (name === "go") return "Go";
  return null;
}

export function findProjectRoot(dir: string, pathExists: (path: string) => boolean): string {
  let current = dir;
  let depth = 0;
  while (current !== "/" && depth < 15) {
    for (const marker of PROJECT_MARKERS) {
      if (pathExists(`${current}/${marker}`)) return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
    depth += 1;
  }
  return dir;
}

export function projectNameFromCwd(cwd: string): string | null {
  if (cwd === "/" || cwd === "") return null;
  const name = basename(cwd);
  if (name === "" || name === "/") return null;
  return name;
}
