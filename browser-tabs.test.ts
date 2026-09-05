import { describe, expect, it } from "vitest";
import {
  closeThreadBrowser,
  openThreadBrowser,
  removeBrowserTab,
  upsertBrowserTab,
  type TabRecord,
  type ThreadTabsSnapshot,
} from "./browser-tabs.js";

const browser = (id: string, url: string): TabRecord => ({
  id,
  kind: "browser",
  url,
  title: "Preview · app",
  environmentId: "env_1",
});

describe("upsertBrowserTab", () => {
  it("appends a browser tab before the new-tab launcher", () => {
    const tabs: TabRecord[] = [
      { id: "info", kind: "thread-info" },
      { id: "new", kind: "new-tab" },
    ];
    const next = upsertBrowserTab(tabs, {
      id: "preview",
      kind: "browser",
      url: "http://127.0.0.1:5173",
      title: "Preview · Vite",
      environmentId: "env_1",
    });
    expect(next.map((tab) => tab.id)).toEqual(["info", "preview", "new"]);
    expect(next[1]).toMatchObject({ kind: "browser", url: "http://127.0.0.1:5173" });
  });

  it("updates an existing tab by id or url instead of duplicating", () => {
    const tabs = [browser("preview", "http://127.0.0.1:5173")];
    const byId = upsertBrowserTab(tabs, {
      id: "preview",
      kind: "browser",
      url: "https://hung--5173.getbb.app",
      title: "Preview · Vite",
      environmentId: "env_1",
    });
    expect(byId).toHaveLength(1);
    expect(byId[0]?.url).toBe("https://hung--5173.getbb.app");
    const byUrl = upsertBrowserTab(tabs, {
      id: "other",
      kind: "browser",
      url: "http://127.0.0.1:5173",
      title: "Preview · Vite",
      environmentId: "env_1",
    });
    expect(byUrl).toHaveLength(1);
    expect(byUrl[0]?.id).toBe("other");
  });
});

describe("removeBrowserTab", () => {
  it("removes the owned tab by id or matching url and leaves others", () => {
    const tabs = [
      { id: "info", kind: "thread-info" },
      browser("preview", "http://127.0.0.1:5173"),
      browser("other", "https://example.com"),
    ];
    expect(removeBrowserTab(tabs, { id: "preview", urls: [] }).map((tab) => tab.id)).toEqual([
      "info",
      "other",
    ]);
    expect(
      removeBrowserTab(tabs, { id: null, urls: ["http://127.0.0.1:5173"] }).map((tab) => tab.id),
    ).toEqual(["info", "other"]);
  });
});

describe("openThreadBrowser / closeThreadBrowser", () => {
  it("writes a browser tab and later removes it", async () => {
    let snapshot: ThreadTabsSnapshot = {
      revision: 1,
      tabs: [{ id: "new", kind: "new-tab" }],
    };
    const tabsApi = {
      get: async () => snapshot,
      update: async (args: { expectedRevision: number; tabs: TabRecord[] }) => {
        snapshot = { revision: args.expectedRevision + 1, tabs: args.tabs };
        return snapshot;
      },
    };
    const tabId = await openThreadBrowser(tabsApi, {
      threadId: "thr_1",
      tabId: null,
      url: "http://127.0.0.1:5173/",
      title: "Preview · Vite",
      environmentId: "env_1",
    });
    expect(tabId).toEqual(expect.any(String));
    expect(snapshot.tabs.some((tab) => tab.kind === "browser")).toBe(true);
    await closeThreadBrowser(tabsApi, {
      threadId: "thr_1",
      tabId,
      urls: ["http://127.0.0.1:5173/"],
    });
    expect(snapshot.tabs.some((tab) => tab.kind === "browser")).toBe(false);
  });
});
