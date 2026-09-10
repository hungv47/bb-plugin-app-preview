import { describe, expect, it } from "vitest";
import { detectAll, detectApp, launchCommand, parsePortHint, splitCdPrefix, type DirSnapshot } from "./detect.js";

function dir(partial: Partial<DirSnapshot> & { contents: Record<string, string> }): DirSnapshot {
  const names = Object.keys(partial.contents);
  return {
    relativeCwd: partial.relativeCwd ?? ".",
    hasNodeModules: partial.hasNodeModules ?? true,
    contents: partial.contents,
    entries: [
      ...(partial.entries ?? []),
      ...names.map((name) => ({ name, kind: "file" as const })),
    ],
  };
}

describe("parsePortHint", () => {
  it("reads --port and localhost URLs", () => {
    expect(parsePortHint("vite --port 4173")).toBe(4173);
    expect(parsePortHint("next dev -p 3001")).toBe(3001);
    expect(parsePortHint("PORT=4000 node server.js")).toBe(4000);
    expect(parsePortHint("http://localhost:5173/")).toBe(5173);
  });
});

describe("detectApp", () => {
  it("detects Next.js with pnpm", () => {
    const result = detectApp([
      dir({
        contents: {
          "package.json": JSON.stringify({
            packageManager: "pnpm@9.0.0",
            scripts: { dev: "next dev" },
            dependencies: { next: "15.0.0", react: "19.0.0" },
          }),
          "pnpm-lock.yaml": "lockfileVersion: 9",
        },
      }),
    ]);
    expect(result.found).toBe(true);
    expect(result.framework).toBe("next");
    expect(result.packageManager).toBe("pnpm");
    expect(result.command).toBe("pnpm dev");
    expect(result.port).toBe(3000);
    expect(result.confidence).toBe("high");
  });

  it("detects Vite when Next is absent", () => {
    const result = detectApp([
      dir({
        contents: {
          "package.json": JSON.stringify({
            scripts: { dev: "vite --port 5174" },
            devDependencies: { vite: "6.0.0" },
          }),
          "package-lock.json": "{}",
        },
      }),
    ]);
    expect(result.framework).toBe("vite");
    expect(result.command).toBe("npm run dev");
    expect(result.port).toBe(5174);
  });

  it("prefers a nested web app over a root without start scripts", () => {
    const result = detectApp([
      dir({
        relativeCwd: ".",
        contents: {
          "package.json": JSON.stringify({
            private: true,
            workspaces: ["apps/*"],
            scripts: { lint: "eslint ." },
          }),
        },
      }),
      dir({
        relativeCwd: "apps/web",
        contents: {
          "package.json": JSON.stringify({
            scripts: { dev: "next dev" },
            dependencies: { next: "15.0.0" },
          }),
        },
      }),
    ]);
    expect(result.framework).toBe("next");
    expect(result.relativeCwd).toBe("apps/web");
  });

  it("detects Django", () => {
    const result = detectApp([
      dir({
        contents: {
          "pyproject.toml": "[project]\ndependencies = [\"django\"]\n",
        },
        entries: [{ name: "manage.py", kind: "file" }],
      }),
    ]);
    expect(result.framework).toBe("django");
    expect(result.command).toContain("manage.py runserver");
    expect(result.port).toBe(8000);
  });

  it("detects FastAPI with uv", () => {
    const result = detectApp([
      dir({
        contents: {
          "pyproject.toml": "[project]\ndependencies = [\"fastapi\"]\n",
          "uv.lock": "version = 1",
          "main.py": "app = FastAPI()\n",
        },
      }),
    ]);
    expect(result.framework).toBe("fastapi");
    expect(result.packageManager).toBe("uv");
    expect(result.command).toContain("uvicorn main:app");
  });

  it("returns not found for an empty tree", () => {
    const result = detectApp([
      dir({
        contents: {},
        entries: [{ name: "README.md", kind: "file" }],
      }),
    ]);
    expect(result.found).toBe(false);
    expect(result.command).toBeNull();
  });

  it("prefers a cwd that matches the thread title", () => {
    const web = dir({
      relativeCwd: "personal/site",
      contents: {
        "package.json": JSON.stringify({
          scripts: { dev: "astro dev" },
          dependencies: { astro: "5.0.0" },
        }),
      },
    });
    const anzoa = dir({
      relativeCwd: "forsvn/anzoa/app",
      contents: {
        "package.json": JSON.stringify({
          scripts: { dev: "next dev" },
          dependencies: { next: "15.0.0" },
        }),
      },
    });
    const ranked = detectAll([web, anzoa], "Preview Anzoa login");
    expect(ranked[0]?.relativeCwd).toBe("forsvn/anzoa/app");
  });
});

describe("splitCdPrefix", () => {
  it("peels a relative cd off the inner command", () => {
    expect(splitCdPrefix("cd forsvn/anzoa/app && bun run dev")).toEqual({
      relativeCwd: "forsvn/anzoa/app",
      command: "bun run dev",
    });
  });
});

describe("launchCommand", () => {
  it("prefixes install and cd for a nested app", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "next",
        frameworkLabel: "Next.js",
        packageManager: "pnpm",
        command: "pnpm dev",
        installCommand: "pnpm install",
        port: 3000,
        relativeCwd: "apps/web",
        dependencies: ["next"],
        notes: ["Dependencies are not installed yet."],
        confidence: "high",
      },
      { autoInstall: true },
    );
    expect(command).toBe("cd apps/web && pnpm install && pnpm dev -- --hostname 127.0.0.1");
  });

  it("uses an override as the inner command and still installs", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "vite",
        frameworkLabel: "Vite",
        packageManager: "npm",
        command: "npm run dev",
        installCommand: "npm install",
        port: 5173,
        relativeCwd: ".",
        dependencies: ["vite"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: true, commandOverride: "npm run preview -- --port 4173" },
    );
    expect(command).toBe("npm install && npm run preview -- --port 4173 --host 127.0.0.1");
  });

  it("does not wrap a command that already starts with cd", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "next",
        frameworkLabel: "Next.js",
        packageManager: "pnpm",
        command: "pnpm dev",
        installCommand: "pnpm install",
        port: 3000,
        relativeCwd: "apps/web",
        dependencies: ["next"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: true, commandOverride: "cd personal/site && bun run dev" },
    );
    expect(command).toBe("cd personal/site && pnpm install && bun run dev -- --hostname 127.0.0.1");
  });

  it("cds into the worktree with an absolute path when given one", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "next",
        frameworkLabel: "Next.js",
        packageManager: "bun",
        command: "bun run dev",
        installCommand: null,
        port: 3000,
        relativeCwd: "forsvn/anzoa/app",
        dependencies: ["next"],
        notes: [],
        confidence: "high",
      },
      {
        autoInstall: true,
        commandOverride: "cd forsvn/anzoa/app && bun run dev",
        workspacePath: "/Users/hungv47/.bb/worktrees/env_x/forsvn",
      },
    );
    expect(command).toBe(
      "cd /Users/hungv47/.bb/worktrees/env_x/forsvn/forsvn/anzoa/app && bun run dev -- --hostname 127.0.0.1",
    );
  });

  it("binds Astro to 127.0.0.1 so Connect share can reach it", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "astro",
        frameworkLabel: "Astro",
        packageManager: "pnpm",
        command: "pnpm dev",
        installCommand: null,
        port: 4321,
        relativeCwd: ".",
        dependencies: ["astro"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: false },
    );
    expect(command).toBe("pnpm dev -- --host 127.0.0.1");
  });

  it("leaves an explicit --host flag alone", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "astro",
        frameworkLabel: "Astro",
        packageManager: "pnpm",
        command: "pnpm dev",
        installCommand: null,
        port: 4321,
        relativeCwd: ".",
        dependencies: ["astro"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: false, commandOverride: "pnpm dev -- --host 0.0.0.0" },
    );
    expect(command).toBe("pnpm dev -- --host 0.0.0.0");
  });

  it("does not append a host flag to a non-JS override", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "astro",
        frameworkLabel: "Astro",
        packageManager: "pnpm",
        command: "pnpm dev",
        installCommand: null,
        port: 4321,
        relativeCwd: ".",
        dependencies: ["astro"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: false, commandOverride: "python -m http.server 4321" },
    );
    expect(command).toBe("python -m http.server 4321");
  });

  it("binds Expo to 127.0.0.1", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "expo",
        frameworkLabel: "Expo",
        packageManager: "npm",
        command: "npx expo start",
        installCommand: null,
        port: 8081,
        relativeCwd: ".",
        dependencies: ["expo"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: false },
    );
    expect(command).toBe("npx expo start --localhost");
  });

  it("leaves Expo --localhost alone", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "expo",
        frameworkLabel: "Expo",
        packageManager: "npm",
        command: "npx expo start",
        installCommand: null,
        port: 8081,
        relativeCwd: ".",
        dependencies: ["expo"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: false, commandOverride: "npx expo start --localhost" },
    );
    expect(command).toBe("npx expo start --localhost");
  });

  it("does not append --host to Remix", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "remix",
        frameworkLabel: "Remix",
        packageManager: "npm",
        command: "npm run dev",
        installCommand: null,
        port: 3000,
        relativeCwd: ".",
        dependencies: ["@remix-run/react"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: false },
    );
    expect(command).toBe("npm run dev");
  });

  it("prefixes Create React App with HOST=127.0.0.1", () => {
    const command = launchCommand(
      {
        found: true,
        framework: "cra",
        frameworkLabel: "Create React App",
        packageManager: "npm",
        command: "npm start",
        installCommand: null,
        port: 3000,
        relativeCwd: ".",
        dependencies: ["react-scripts"],
        notes: [],
        confidence: "high",
      },
      { autoInstall: false },
    );
    expect(command).toBe("HOST=127.0.0.1 npm start");
  });
});
