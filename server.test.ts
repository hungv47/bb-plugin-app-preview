import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

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
    expect(created.command).toBe("cd /repo/apps/web && npm install && npm run dev");
    expect(result.detection.relativeCwd).toBe("apps/web");
    expect(result.preview.status).toBe("starting");
    await harness.lifecycle.dispose();
  });

  it("opens an in-app browser when the preview is ready and closes it on stop", async () => {
    const tabs: Array<{ id: string; kind: string; url?: string }> = [{ id: "new", kind: "new-tab" }];
    let revision = 1;
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
});
