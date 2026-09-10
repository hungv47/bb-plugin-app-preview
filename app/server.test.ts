import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { OPEN_PREVIEW_AGENT } from "./open-mode.js";

function environment() {
  return {
    baseBranch: "main",
    branchName: "feat/preview",
    createdAt: 1,
    defaultBranch: "main",
    hostId: "host_1",
    id: "env_1",
    isGitRepo: true,
    isWorktree: true,
    managed: true,
    mergeBaseBranch: "main",
    name: "feat/preview",
    path: "/repo",
    projectId: "proj_1",
    status: "ready" as const,
    updatedAt: 1,
    workspaceProvisionType: "managed-worktree" as const,
  };
}

async function waitForInteraction(harness: {
  inspection: {
    pendingInteractions: readonly { id: string; rendererId: string; payload: unknown }[];
  };
}): Promise<{ id: string; rendererId: string; payload: unknown }> {
  for (let i = 0; i < 50; i += 1) {
    const pending = harness.inspection.pendingInteractions[0];
    if (pending !== undefined) return pending;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("no pending interaction");
}

describe("plugin inspect", () => {
  it("detects a Vite app in the thread worktree", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => environment(),
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { dev: "vite" },
              devDependencies: { vite: "6.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
      },
    });
    await plugin(bb);
    const result = await harness.behavior.callRpc("inspect", { threadId: "thr_1" });
    expect(result.detection.found).toBe(true);
    expect(result.detection.framework).toBe("vite");
    expect(result.detection.command).toBe("npm run dev");
    expect(result.workspace?.branch).toBe("feat/preview");
    expect(result.preview.status).toBe("idle");
    await harness.lifecycle.dispose();
  });

  it("starts a nested app without double-wrapping cd", async () => {
    const created: { command?: string } = {};
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
              title: "Anzoa",
            }),
        },
        environments: {
          get: async () => environment(),
        },
        hosts: {
          directory: async ({ path }: { path: string }) => {
            if (path === "/repo") {
              return {
                directory: "/repo",
                parent: null,
                entries: [
                  { name: "apps", kind: "directory" as const, path: "/repo/apps" },
                ],
              };
            }
            if (path === "/repo/apps") {
              return {
                directory: "/repo/apps",
                parent: "/repo",
                entries: [
                  { name: "web", kind: "directory" as const, path: "/repo/apps/web" },
                ],
              };
            }
            return {
              directory: path,
              parent: "/repo/apps",
              entries: [
                { name: "package.json", kind: "file" as const, path: `${path}/package.json` },
              ],
            };
          },
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((item) => [item, item.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async ({ path }: { path: string }) => ({
            content: JSON.stringify({
              scripts: { dev: "next dev" },
              dependencies: { next: "15.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path,
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async (args: { start?: { command?: string } }) => {
            created.command = args.start?.command;
            return {
              closeReason: null,
              cols: 120,
              createdAt: 1,
              environmentId: "env_1",
              exitCode: null,
              hostId: "host_1",
              id: "term_1",
              initialCwd: "/repo",
              lastUserInputAt: null,
              rows: 32,
              status: "running" as const,
              threadId: "thr_1",
              title: "Preview",
              updatedAt: 1,
            };
          },
        },
      },
    });
    await plugin(bb);
    const result = await harness.behavior.callRpc("start", {
      threadId: "thr_1",
      relativeCwd: "apps/web",
    });
    expect(created.command).toBe(
      "cd -- ./apps/web && npm install && npm run dev -- --hostname 127.0.0.1",
    );
    expect(created.command).not.toContain("/repo");
    expect(result.detection.relativeCwd).toBe("apps/web");
    expect(result.preview.status).toBe("starting");
    await harness.lifecycle.dispose();
  });

  it("does not put the workspace path into the start command", async () => {
    const created: { command?: string } = {};
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => ({
            ...environment(),
            path: "/tmp/$(whoami)/$HOME",
          }),
        },
        hosts: {
          directory: async () => ({
            directory: "/tmp/$(whoami)/$HOME",
            parent: null,
            entries: [
              {
                name: "package.json",
                kind: "file" as const,
                path: "/tmp/$(whoami)/$HOME/package.json",
              },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { dev: "vite" },
              devDependencies: { vite: "6.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/tmp/$(whoami)/$HOME/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async (args: { start?: { command?: string } }) => {
            created.command = args.start?.command;
            return {
              closeReason: null,
              cols: 120,
              createdAt: 1,
              environmentId: "env_1",
              exitCode: null,
              hostId: "host_1",
              id: "term_1",
              initialCwd: "/tmp/$(whoami)/$HOME",
              lastUserInputAt: null,
              rows: 32,
              status: "running" as const,
              threadId: "thr_1",
              title: "Preview",
              updatedAt: 1,
            };
          },
        },
      },
    });
    await plugin(bb);
    await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(created.command).toBe("npm install && npm run dev -- --host 127.0.0.1");
    expect(created.command).not.toContain("$(whoami)");
    expect(created.command).not.toContain("$HOME");
    await harness.lifecycle.dispose();
  });

  it("opens an in-app browser when the preview is ready and closes it on stop", async () => {
    const tabs: Array<{ id: string; kind: string; url?: string }> = [{ id: "new", kind: "new-tab" }];
    let revision = 1;
    let closed: string | null = null;
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      settings: { openPreview: OPEN_PREVIEW_AGENT },
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
          tabs: {
            get: async () => ({ revision, tabs: [...tabs] }),
            update: async (args: {
              expectedRevision: number;
              tabs: Array<{ id: string; kind: string; url?: string }>;
            }) => {
              revision = args.expectedRevision + 1;
              tabs.splice(0, tabs.length, ...args.tabs);
              return { revision, tabs: [...tabs] };
            },
          },
        },
        environments: {
          get: async () => environment(),
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { dev: "vite" },
              devDependencies: { vite: "6.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          get: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          output: async () => ({
            chunks: [
              {
                dataBase64: Buffer.from("  ➜  Local:   http://localhost:5173/\n").toString(
                  "base64",
                ),
              },
            ],
            nextSeq: 1,
            truncated: false,
          }),
          close: async () => {
            closed = "term_1";
          },
        },
      },
    });
    await plugin(bb);
    const started = await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(started.preview.status).toBe("running");
    expect(started.preview.openUrl).toBe("http://localhost:5173/");
    expect(tabs.some((tab) => tab.kind === "browser" && tab.url === "http://localhost:5173/")).toBe(
      true,
    );
    const stopped = await harness.behavior.callRpc("stop", { threadId: "thr_1" });
    expect(stopped.preview.status).toBe("idle");
    expect(closed).toBe("term_1");
    expect(tabs.some((tab) => tab.kind === "browser")).toBe(false);
    await harness.lifecycle.dispose();
  });

  it("picks the Vite Local port for openUrl when logs also show an API URL", async () => {
    const dualLog = [
      "e-reader-preview: API → http://127.0.0.1:8650",
      "e-reader-preview: UI  → http://127.0.0.1:5173  (/api → :8650)",
      "  ➜  Local:   http://127.0.0.1:5173/",
    ].join("\n");
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => environment(),
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { start: "node server.js" },
              dependencies: { express: "4.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          get: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          output: async () => ({
            chunks: [
              {
                dataBase64: Buffer.from(dualLog).toString("base64"),
              },
            ],
            nextSeq: 1,
            truncated: false,
          }),
          close: async () => {},
        },
      },
    });
    await plugin(bb);
    const started = await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(started.preview.status).toBe("running");
    expect(started.preview.port).toBe(5173);
    expect(started.preview.openUrl).toBe("http://127.0.0.1:5173/");
    await harness.lifecycle.dispose();
  });

  it("settles from an early API URL to Vite Local and swaps the connect share", async () => {
    const apiOnlyLog = "e-reader-preview: API → http://127.0.0.1:8650";
    const dualLog = [
      "e-reader-preview: API → http://127.0.0.1:8650",
      "e-reader-preview: UI  → http://127.0.0.1:5173  (/api → :8650)",
      "  ➜  Local:   http://127.0.0.1:5173/",
    ].join("\n");
    let outputCalls = 0;
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sharedPortTunnelIdentities: {
        host_1: { label: "hung", baseDomain: "getbb.app" },
      },
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => environment(),
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { start: "node server.js" },
              dependencies: { express: "4.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          get: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          output: async () => {
            outputCalls += 1;
            const text = outputCalls === 1 ? apiOnlyLog : dualLog;
            return {
              chunks: [
                {
                  dataBase64: Buffer.from(text).toString("base64"),
                },
              ],
              nextSeq: outputCalls,
              truncated: false,
            };
          },
          close: async () => {},
        },
      },
    });
    await plugin(bb);
    const started = await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(started.preview.status).toBe("running");
    expect(started.preview.port).toBe(5173);
    expect(started.preview.openUrl).toBe("https://hung--5173.getbb.app");
    expect(outputCalls).toBeGreaterThan(1);
    await harness.lifecycle.dispose();
  });

  it("does not open the in-app browser by default, then opens after switching to agent mode", async () => {
    const tabs: Array<{ id: string; kind: string; url?: string }> = [{ id: "new", kind: "new-tab" }];
    let revision = 1;
    let tabUpdates = 0;
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
          tabs: {
            get: async () => ({ revision, tabs: [...tabs] }),
            update: async (args: {
              expectedRevision: number;
              tabs: Array<{ id: string; kind: string; url?: string }>;
            }) => {
              tabUpdates += 1;
              revision = args.expectedRevision + 1;
              tabs.splice(0, tabs.length, ...args.tabs);
              return { revision, tabs: [...tabs] };
            },
          },
        },
        environments: {
          get: async () => environment(),
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { dev: "vite" },
              devDependencies: { vite: "6.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          get: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          output: async () => ({
            chunks: [
              {
                dataBase64: Buffer.from("  ➜  Local:   http://localhost:5173/\n").toString(
                  "base64",
                ),
              },
            ],
            nextSeq: 1,
            truncated: false,
          }),
          close: async () => {},
        },
      },
    });
    await plugin(bb);
    const started = await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(started.preview.status).toBe("running");
    expect(started.preview.openUrl).toBe("http://localhost:5173/");
    expect(tabUpdates).toBe(0);
    expect(tabs.some((tab) => tab.kind === "browser")).toBe(false);
    await harness.behavior.setSettings({ openPreview: OPEN_PREVIEW_AGENT });
    await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(tabs.some((tab) => tab.kind === "browser")).toBe(true);
    const stopped = await harness.behavior.callRpc("stop", { threadId: "thr_1" });
    expect(stopped.preview.status).toBe("idle");
    expect(tabs.some((tab) => tab.kind === "browser")).toBe(false);
    await harness.lifecycle.dispose();
  });

  it("explains a retiring worktree instead of starting it", async () => {
    let created = false;
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => ({ ...environment(), status: "retiring" as const }),
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { dev: "vite" },
              devDependencies: { vite: "6.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async () => {
            created = true;
            throw new Error("HTTP 409: Environment unavailable");
          },
        },
      },
    });
    await plugin(bb);
    const inspected = await harness.behavior.callRpc("inspect", { threadId: "thr_1" });
    expect(inspected.workspace?.environmentStatus).toBe("retiring");
    expect(inspected.error).toMatch(/retiring/);
    const started = await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(created).toBe(false);
    expect(started.error).toMatch(/retiring/);
    await harness.lifecycle.dispose();
  });

  it("keeps a retiring worktree in the panel when detect fails", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => ({ ...environment(), status: "retiring" as const }),
        },
        hosts: {
          directory: async () => {
            throw new Error("HTTP 409: Environment unavailable");
          },
        },
      },
    });
    await plugin(bb);
    const inspected = await harness.behavior.callRpc("inspect", { threadId: "thr_1" });
    expect(inspected.workspace?.environmentStatus).toBe("retiring");
    expect(inspected.workspace?.path).toBe("/repo");
    expect(inspected.detection).toBeNull();
    expect(inspected.error).toMatch(/retiring/);
    expect(inspected.error).not.toMatch(/HTTP 409/);
    await harness.lifecycle.dispose();
  });

  it("explains a provisioning worktree with no path yet", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => ({
            ...environment(),
            status: "provisioning" as const,
            path: "",
          }),
        },
      },
    });
    await plugin(bb);
    const inspected = await harness.behavior.callRpc("inspect", { threadId: "thr_1" });
    expect(inspected.workspace?.environmentStatus).toBe("provisioning");
    expect(inspected.workspace?.path).toBe("");
    expect(inspected.error).toMatch(/still being created/);
    await harness.lifecycle.dispose();
  });

  it("does not stop a running preview when restart hits a retiring worktree", async () => {
    let status: "ready" | "retiring" = "ready";
    let created = 0;
    let closed: string | null = null;
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
        },
        environments: {
          get: async () => ({ ...environment(), status }),
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { dev: "vite" },
              devDependencies: { vite: "6.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async () => {
            created += 1;
            return {
              closeReason: null,
              cols: 120,
              createdAt: 1,
              environmentId: "env_1",
              exitCode: null,
              hostId: "host_1",
              id: "term_1",
              initialCwd: "/repo",
              lastUserInputAt: null,
              rows: 32,
              status: "running" as const,
              threadId: "thr_1",
              title: "Preview",
              updatedAt: 1,
            };
          },
          get: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          output: async () => ({
            chunks: [
              {
                dataBase64: Buffer.from("  ➜  Local:   http://localhost:5173/\n").toString(
                  "base64",
                ),
              },
            ],
            nextSeq: 1,
            truncated: false,
          }),
          close: async () => {
            closed = "term_1";
          },
        },
      },
    });
    await plugin(bb);
    const started = await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(started.preview.status).toBe("running");
    expect(created).toBe(1);
    status = "retiring";
    const restarted = await harness.behavior.callRpc("restart", { threadId: "thr_1" });
    expect(closed).toBeNull();
    expect(created).toBe(1);
    expect(restarted.error).toMatch(/retiring/);
    expect(restarted.preview?.status).toBe("running");
    await harness.lifecycle.dispose();
  });

  it("still closes the preview when stop cannot read the worktree", async () => {
    let envReady = true;
    let closed: string | null = null;
    const tabs: Array<{ id: string; kind: string; url?: string }> = [{ id: "new", kind: "new-tab" }];
    let revision = 1;
    const { bb, harness } = createFakePluginHost({
      pluginId: "app-preview",
      settings: { openPreview: OPEN_PREVIEW_AGENT },
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({
              id: "thr_1",
              environmentId: "env_1",
              projectId: "proj_1",
            }),
          tabs: {
            get: async () => ({ revision, tabs: [...tabs] }),
            update: async (args: {
              expectedRevision: number;
              tabs: Array<{ id: string; kind: string; url?: string }>;
            }) => {
              revision = args.expectedRevision + 1;
              tabs.splice(0, tabs.length, ...args.tabs);
              return { revision, tabs: [...tabs] };
            },
          },
        },
        environments: {
          get: async () => {
            if (!envReady) throw new Error("HTTP 409: Environment unavailable");
            return environment();
          },
        },
        hosts: {
          directory: async () => ({
            directory: "/repo",
            parent: null,
            entries: [
              { name: "package.json", kind: "file" as const, path: "/repo/package.json" },
            ],
          }),
          pathsExist: async ({ paths }: { paths: string[] }) => ({
            existence: Object.fromEntries(
              paths.map((path) => [path, path.endsWith("package.json")]),
            ),
          }),
        },
        files: {
          read: async () => ({
            content: JSON.stringify({
              scripts: { dev: "vite" },
              devDependencies: { vite: "6.0.0" },
            }),
            contentEncoding: "utf8" as const,
            path: "/repo/package.json",
            sha256: "abc",
            sizeBytes: 42,
          }),
        },
        terminals: {
          create: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          get: async () => ({
            closeReason: null,
            cols: 120,
            createdAt: 1,
            environmentId: "env_1",
            exitCode: null,
            hostId: "host_1",
            id: "term_1",
            initialCwd: "/repo",
            lastUserInputAt: null,
            rows: 32,
            status: "running" as const,
            threadId: "thr_1",
            title: "Preview",
            updatedAt: 1,
          }),
          output: async () => ({
            chunks: [
              {
                dataBase64: Buffer.from("  ➜  Local:   http://localhost:5173/\n").toString(
                  "base64",
                ),
              },
            ],
            nextSeq: 1,
            truncated: false,
          }),
          close: async () => {
            closed = "term_1";
          },
        },
      },
    });
    await plugin(bb);
    const started = await harness.behavior.callRpc("start", { threadId: "thr_1" });
    expect(started.preview.status).toBe("running");
    expect(tabs.some((tab) => tab.kind === "browser")).toBe(true);
    envReady = false;
    const stopped = await harness.behavior.callRpc("stop", { threadId: "thr_1" });
    expect(closed).toBe("term_1");
    expect(tabs.some((tab) => tab.kind === "browser")).toBe(false);
    expect(stopped.error).toMatch(/retiring or already gone/);
    await harness.lifecycle.dispose();
  });

  it("refuses CLI detect without a thread", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    const result = await harness.behavior.runCli(["detect"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--thread/);
    await harness.lifecycle.dispose();
  });

  it("lists listening ports from the CLI without a thread", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    const result = await harness.behavior.runCli(["ports", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(String(result.stdout)).toContain('"ports"');
    await harness.lifecycle.dispose();
  });

  it("refuses CLI share of a port that is not listening", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    const result = await harness.behavior.runCli(["share", "1"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/Nothing is listening on :1/);
    await harness.lifecycle.dispose();
  });

  it("refuses CLI kill without a target", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    const result = await harness.behavior.runCli(["kill"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/bb preview kill/);
    await harness.lifecycle.dispose();
  });

  it("kills a throwaway listener by port", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "require('http').createServer().listen(18792,'127.0.0.1',()=>process.stdout.write('ready'))",
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("listener did not start")), 5000);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", reject);
    });
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    try {
      const listed = await harness.behavior.runCli(["ports", "--all", "--json"]);
      expect(listed.exitCode).toBe(0);
      expect(String(listed.stdout)).toContain('"port":18792');
      const killed = await harness.behavior.runCli(["kill", "18792"]);
      expect(killed.exitCode).toBe(0);
      expect(String(killed.stdout)).toMatch(/SIGTERM/);
      const after = await harness.behavior.runCli(["ports", "--all", "--json"]);
      expect(String(after.stdout)).not.toContain('"port":18792');
    } finally {
      child.kill("SIGKILL");
      await harness.lifecycle.dispose();
    }
  });

  it("injects live open-mode instructions and prefers preview_app", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    const previewApp = harness.inspection.registrations.agentTools.find(
      (tool) => tool.name === "preview_app",
    );
    expect(previewApp?.instructions).toMatch(/preview_app/);
    expect(previewApp?.instructions).toMatch(/open-mode/);
    expect(previewApp?.instructions).not.toMatch(/after finishing UI work/);
    expect(previewApp?.instructions).not.toMatch(/Call start once/);
    const provider = harness.inspection.registrations.instructionProvider;
    expect(provider).not.toBeNull();
    expect(provider!({ threadId: "thr_1", projectId: "proj_1" })).toMatch(/open mode is manual/);
    await harness.behavior.setSettings({ openPreview: OPEN_PREVIEW_AGENT });
    expect(provider!({ threadId: "thr_1", projectId: "proj_1" })).toMatch(/open mode is agent/);
    expect(harness.inspection.registrations.settingsDescriptors).toHaveProperty("openPreview");
    expect(harness.inspection.registrations.settingsDescriptors).not.toHaveProperty(
      "autoOpenBrowser",
    );
    await harness.lifecycle.dispose();
  });

  it("refuses an arbitrary launch command on preview_app", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    await expect(
      harness.behavior.callAgentTool("preview_app", {
        action: "start",
        command: "touch /tmp/pwned",
      }),
    ).rejects.toThrow(/invalid/i);
    await harness.lifecycle.dispose();
  });

  it("asks the user to confirm before an agent share or kill", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);

    const sharePromise = harness.behavior.callAgentTool(
      "preview_ports",
      { action: "share", port: 1 },
      { threadId: "thr_1" },
    );
    const sharePending = await waitForInteraction(harness);
    expect(sharePending.rendererId).toBe("preview-confirm");
    expect(sharePending.payload).toMatchObject({ action: "share" });
    const shareToken =
      typeof sharePending.payload === "object" &&
      sharePending.payload !== null &&
      "confirmationToken" in sharePending.payload
        ? String(sharePending.payload.confirmationToken)
        : "";
    harness.behavior.submitInteraction(sharePending.id, { confirmationToken: shareToken });
    const shared = await sharePromise;
    expect(shared).toMatchObject({ isError: true });
    expect(JSON.stringify(shared)).toMatch(/Nothing is listening on :1/);

    const wrongToken = harness.behavior.callAgentTool(
      "preview_ports",
      { action: "share", port: 1 },
      { threadId: "thr_1" },
    );
    const wrongPending = await waitForInteraction(harness);
    harness.behavior.submitInteraction(wrongPending.id, { confirmed: true });
    const rejected = await wrongToken;
    expect(rejected).toMatchObject({ isError: true });
    expect(JSON.stringify(rejected)).toMatch(/token did not match/);

    const killPromise = harness.behavior.callAgentTool(
      "preview_ports",
      { action: "kill", targets: ["1"] },
      { threadId: "thr_1" },
    );
    const killPending = await waitForInteraction(harness);
    harness.behavior.cancelInteraction(killPending.id);
    const killed = await killPromise;
    expect(killed).toMatchObject({ isError: true });
    await harness.lifecycle.dispose();
  });

  it("does not kill a listener when the agent confirm is cancelled", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "require('http').createServer().listen(18793,'127.0.0.1',()=>process.stdout.write('ready'))",
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("listener did not start")), 5000);
      child.stdout?.on("data", (chunk: Buffer) => {
        if (chunk.toString().includes("ready")) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", reject);
    });
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    try {
      const listed = await harness.behavior.runCli(["ports", "--all", "--json"]);
      expect(String(listed.stdout)).toContain('"port":18793');
      const killPromise = harness.behavior.callAgentTool(
        "preview_ports",
        { action: "kill", targets: ["18793"] },
        { threadId: "thr_1" },
      );
      const pending = await waitForInteraction(harness);
      harness.behavior.cancelInteraction(pending.id);
      const killed = await killPromise;
      expect(killed).toMatchObject({ isError: true });
      expect(JSON.stringify(killed)).toMatch(/Cancelled/);
      const after = await harness.behavior.runCli(["ports", "--all", "--json"]);
      expect(String(after.stdout)).toContain('"port":18793');
    } finally {
      child.kill("SIGKILL");
      await harness.lifecycle.dispose();
    }
  });
});
