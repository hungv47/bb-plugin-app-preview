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

  it("refuses CLI detect without a thread", async () => {
    const { bb, harness } = createFakePluginHost({ pluginId: "app-preview" });
    await plugin(bb);
    const result = await harness.behavior.runCli(["detect"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/--thread/);
    await harness.lifecycle.dispose();
  });
});
