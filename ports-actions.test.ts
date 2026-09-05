import { describe, expect, it } from "vitest";
import { previewPortSet, previewShareUpdates, previewShareUrlMap } from "./ports-actions.js";
import type { PreviewRow } from "./store.js";

function row(partial: Partial<PreviewRow> & { port: number | null }): PreviewRow {
  return {
    environmentId: "env_1",
    threadId: "thr_1",
    hostId: "host_1",
    workspacePath: "/repo",
    branch: "main",
    relativeCwd: ".",
    framework: "astro",
    frameworkLabel: "Astro",
    packageManager: "pnpm",
    command: "pnpm dev",
    terminalId: "term_1",
    localUrl: "http://127.0.0.1:4321",
    shareUrl: null,
    status: "running",
    error: null,
    logTail: "",
    detectedJson: "{}",
    startedAt: 1,
    updatedAt: 1,
    browserTabId: null,
    ...partial,
  };
}

describe("previewPortSet", () => {
  it("collects ports from active preview rows", () => {
    expect(previewPortSet([row({ port: 4321 }), row({ environmentId: "env_2", port: null })])).toEqual(
      new Set([4321]),
    );
  });
});

describe("previewShareUrlMap", () => {
  it("keeps getbb.app share URLs and drops localhost", () => {
    const urls = previewShareUrlMap([
      row({ port: 4321, shareUrl: "https://hung--4321.getbb.app" }),
      row({ environmentId: "env_2", port: 5173, shareUrl: "https://127.0.0.1:5173" }),
    ]);
    expect(urls.get(4321)).toBe("https://hung--4321.getbb.app");
    expect(urls.has(5173)).toBe(false);
  });
});

describe("previewShareUpdates", () => {
  it("stamps the matching preview row and leaves others alone", () => {
    const rows = [
      row({ port: 4321, shareUrl: null }),
      row({ environmentId: "env_2", port: 5173, shareUrl: null }),
    ];
    expect(previewShareUpdates(rows, 4321, "https://hung--4321.getbb.app", 9)).toEqual([
      { ...rows[0], shareUrl: "https://hung--4321.getbb.app", updatedAt: 9 },
    ]);
  });

  it("clears a stamped share URL", () => {
    const rows = [row({ port: 4321, shareUrl: "https://hung--4321.getbb.app" })];
    expect(previewShareUpdates(rows, 4321, null, 9)).toEqual([
      { ...rows[0], shareUrl: null, updatedAt: 9 },
    ]);
  });
});
