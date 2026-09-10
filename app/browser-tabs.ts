export type TabRecord = {
  id: string;
  kind: string;
  url?: string;
  title?: string | null;
  environmentId?: string | null;
  [key: string]: unknown;
};

export type BrowserTab = {
  id: string;
  kind: "browser";
  url: string;
  title: string | null;
  environmentId: string | null;
};

export type ThreadTabsSnapshot = {
  revision: number;
  tabs: TabRecord[];
};

export type ThreadTabsApi = {
  get: (args: { threadId: string }) => Promise<ThreadTabsSnapshot>;
  update: (args: {
    threadId: string;
    expectedRevision: number;
    tabs: TabRecord[];
  }) => Promise<ThreadTabsSnapshot>;
};

export function upsertBrowserTab(tabs: TabRecord[], browser: BrowserTab): TabRecord[] {
  const existingIndex = tabs.findIndex(
    (tab) => tab.kind === "browser" && (tab.id === browser.id || tab.url === browser.url),
  );
  if (existingIndex >= 0) {
    const current = tabs[existingIndex];
    if (current === undefined) return tabs;
    if (
      current.id === browser.id &&
      current.url === browser.url &&
      current.title === browser.title &&
      current.environmentId === browser.environmentId
    ) {
      return tabs;
    }
    const next = [...tabs];
    next[existingIndex] = { ...current, ...browser };
    return next;
  }
  const rest = tabs.filter((tab) => tab.kind !== "new-tab");
  const launcher = tabs.filter((tab) => tab.kind === "new-tab");
  return [...rest, browser, ...launcher];
}

export function removeBrowserTab(
  tabs: TabRecord[],
  match: { id?: string | null; urls: string[] },
): TabRecord[] {
  const urls = new Set(match.urls.filter((url) => url !== ""));
  return tabs.filter((tab) => {
    if (tab.kind !== "browser") return true;
    if (match.id !== undefined && match.id !== null && tab.id === match.id) return false;
    if (typeof tab.url === "string" && urls.has(tab.url)) return false;
    return true;
  });
}

export function previewUrls(row: {
  localUrl: string | null;
  shareUrl: string | null;
  openUrl?: string | null;
}): string[] {
  return [row.shareUrl, row.localUrl, row.openUrl ?? null].filter(
    (url): url is string => url !== null && url !== "",
  );
}

export async function openThreadBrowser(
  tabsApi: ThreadTabsApi,
  input: {
    threadId: string;
    tabId: string | null;
    url: string;
    title: string;
    environmentId: string;
  },
): Promise<string | null> {
  const tabId = input.tabId ?? crypto.randomUUID();
  return mutateTabs(tabsApi, input.threadId, (tabs) => {
    const next = upsertBrowserTab(tabs, {
      id: tabId,
      kind: "browser",
      url: input.url,
      title: input.title,
      environmentId: input.environmentId,
    });
    return { tabs: next, resultId: tabId };
  });
}

export async function closeThreadBrowser(
  tabsApi: ThreadTabsApi,
  input: { threadId: string; tabId: string | null; urls: string[] },
): Promise<string | null> {
  return mutateTabs(tabsApi, input.threadId, (tabs) => {
    const next = removeBrowserTab(tabs, { id: input.tabId, urls: input.urls });
    if (next.length === tabs.length) return { tabs, resultId: null };
    return { tabs: next, resultId: null };
  });
}

async function mutateTabs(
  tabsApi: ThreadTabsApi,
  threadId: string,
  mutate: (tabs: TabRecord[]) => { tabs: TabRecord[]; resultId: string | null },
): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const current = await tabsApi.get({ threadId });
      const planned = mutate(current.tabs);
      if (planned.tabs === current.tabs) return planned.resultId;
      await tabsApi.update({
        threadId,
        expectedRevision: current.revision,
        tabs: planned.tabs,
      });
      return planned.resultId;
    } catch (cause) {
      lastError = cause;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
