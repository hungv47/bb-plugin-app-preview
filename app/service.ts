import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  closeThreadBrowser,
  openThreadBrowser,
  previewUrls,
  type ThreadTabsApi,
} from "./browser-tabs.js";
import {
  detectAll,
  detectApp,
  launchCommand,
  splitCdPrefix,
  type Detection,
} from "./detect.js";
import { PREVIEW_CHANGED, type InspectResult } from "./contract.js";
import { isSafeRelativeCwd } from "./paths.js";
import { decodeTerminalChunks, parseReadyHint, tailText } from "./ready.js";
import {
  exposeConnectShare,
  forgetShareUrl,
  isConnectShareUrl,
  resolvePreviewShareUrl,
  shouldRefreshPreviewShare,
  unexposeConnectShare,
} from "./share-port.js";
import { collectSnapshots } from "./snapshot.js";
import {
  detectionFromRow,
  getPreview,
  listActivePreviews,
  listAllPreviews,
  migratePreviews,
  upsertPreview,
  type PreviewRow,
} from "./store.js";
import {
  asUserFacingError,
  environmentPreviewBlocker,
  type EnvironmentLifecycle,
} from "./workspace-error.js";

export type { InspectResult };

export type ServiceSettings = {
  autoInstall: boolean;
  readyTimeoutMs: number;
  autoOpenBrowser: boolean;
};

type WorkspaceInfo = {
  environmentId: string;
  hostId: string;
  path: string;
  branch: string | null;
  isWorktree: boolean;
  environmentStatus: EnvironmentLifecycle;
  prefer: string;
};

type StartOptions = { command?: string; port?: number; relativeCwd?: string };

function now(): number {
  return Date.now();
}

function asErrorMessage(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return asUserFacingError(message);
}

function openUrlFor(row: PreviewRow | null): string | null {
  if (row === null || row.status !== "running") return null;
  return row.shareUrl ?? row.localUrl;
}

function idlePreview(): InspectResult["preview"] {
  return {
    status: "idle",
    terminalId: null,
    localUrl: null,
    shareUrl: null,
    openUrl: null,
    command: null,
    port: null,
    error: null,
    logTail: "",
    startedAt: null,
    updatedAt: now(),
  };
}

function previewFromRow(row: PreviewRow): NonNullable<InspectResult["preview"]> {
  return {
    status: row.status,
    terminalId: row.terminalId,
    localUrl: row.localUrl,
    shareUrl: row.shareUrl,
    openUrl: openUrlFor(row),
    command: row.command,
    port: row.port,
    error: row.error,
    logTail: row.logTail,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
  };
}

function publicWorkspace(workspace: WorkspaceInfo): NonNullable<InspectResult["workspace"]> {
  return {
    environmentId: workspace.environmentId,
    hostId: workspace.hostId,
    path: workspace.path,
    branch: workspace.branch,
    isWorktree: workspace.isWorktree,
    environmentStatus: workspace.environmentStatus,
  };
}

function createQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    tails.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  };
}

export function createPreviewService(bb: BbPluginApi, settings: ServiceSettings) {
  const db = bb.storage.database();
  migratePreviews(db);
  const knownHosts = new Set<string>();
  const threadEnvironments = new Map<string, string>();
  const openedUrls = new Map<string, string>();
  const enqueue = createQueue();
  const tabsApi = bb.sdk.threads.tabs as ThreadTabsApi;

  function browserTitle(row: PreviewRow): string {
    return `Preview · ${row.frameworkLabel ?? "app"}`;
  }

  async function openPreviewBrowser(row: PreviewRow): Promise<void> {
    if (!settings.autoOpenBrowser) return;
    const url = openUrlFor(row);
    if (url === null) return;
    try {
      const tabId = await openThreadBrowser(tabsApi, {
        threadId: row.threadId,
        tabId: row.browserTabId,
        url,
        title: browserTitle(row),
        environmentId: row.environmentId,
      });
      if (tabId !== null) {
        row.browserTabId = tabId;
        openedUrls.set(row.environmentId, url);
      }
    } catch (cause) {
      bb.log.warn(`could not open in-app browser: ${asErrorMessage(cause)}`);
    }
  }

  async function closePreviewBrowser(row: PreviewRow): Promise<void> {
    if (!settings.autoOpenBrowser) return;
    if (row.browserTabId === null && row.localUrl === null && row.shareUrl === null) {
      openedUrls.delete(row.environmentId);
      return;
    }
    try {
      await closeThreadBrowser(tabsApi, {
        threadId: row.threadId,
        tabId: row.browserTabId,
        urls: previewUrls({
          localUrl: row.localUrl,
          shareUrl: row.shareUrl,
          openUrl: openUrlFor(row),
        }),
      });
    } catch (cause) {
      bb.log.warn(`could not close in-app browser: ${asErrorMessage(cause)}`);
      return;
    }
    row.browserTabId = null;
    openedUrls.delete(row.environmentId);
  }

  async function syncPreviewBrowser(row: PreviewRow): Promise<void> {
    const url = openUrlFor(row);
    if (url === null) {
      await closePreviewBrowser(row);
      return;
    }
    if (openedUrls.get(row.environmentId) === url && row.browserTabId !== null) return;
    await openPreviewBrowser(row);
  }

  function publish(environmentId: string): void {
    bb.realtime.publish(PREVIEW_CHANGED, { environmentId });
  }

  function save(row: PreviewRow): void {
    row.updatedAt = now();
    upsertPreview(db, row);
    knownHosts.add(row.hostId);
    publish(row.environmentId);
  }

  async function resolveWorkspace(threadId: string): Promise<WorkspaceInfo> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) {
      throw new Error("This thread has no workspace to preview.");
    }
    const env = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    const path = env.path ?? "";
    if (env.status === "ready" && path === "") {
      throw new Error("The workspace path is not ready yet.");
    }
    let branch = env.branchName;
    if (env.status === "ready" && path !== "") {
      try {
        const status = await bb.sdk.environments.status({ environmentId: env.id });
        if (status.outcome === "available") {
          branch = status.workspace.branch.currentBranch ?? branch;
        }
      } catch {
        // Branch from the environment record is enough.
      }
    }
    const workspace = {
      environmentId: env.id,
      hostId: env.hostId,
      path,
      branch,
      isWorktree: env.isWorktree,
      environmentStatus: env.status,
      prefer: [thread.title, thread.titleFallback]
        .filter((value): value is string => value !== null && value !== "")
        .join(" "),
    };
    threadEnvironments.set(threadId, workspace.environmentId);
    return workspace;
  }

  function requireReadyWorkspace(workspace: WorkspaceInfo): void {
    const blocker = environmentPreviewBlocker(workspace.environmentStatus);
    if (blocker !== null) throw new Error(blocker);
  }

  async function detectWorkspace(workspace: WorkspaceInfo): Promise<{
    all: Detection[];
    detection: Detection;
    candidates: InspectResult["candidates"];
  }> {
    const snapshots = await collectSnapshots(bb, workspace.hostId, workspace.path);
    const all = detectAll(snapshots, workspace.prefer);
    return {
      all,
      detection: all[0] ?? detectApp([]),
      candidates: all.map((item) => ({
        framework: item.framework,
        frameworkLabel: item.frameworkLabel,
        packageManager: item.packageManager,
        command: item.command,
        installCommand: item.installCommand,
        port: item.port,
        relativeCwd: item.relativeCwd,
      })),
    };
  }

  async function detectIfPossible(workspace: WorkspaceInfo): Promise<{
    detection: InspectResult["detection"];
    candidates: InspectResult["candidates"];
  }> {
    if (workspace.path === "") {
      return { detection: null, candidates: [] };
    }
    try {
      const detected = await detectWorkspace(workspace);
      return { detection: detected.detection, candidates: detected.candidates };
    } catch (cause) {
      bb.log.warn(`could not detect apps: ${asErrorMessage(cause)}`);
      return { detection: null, candidates: [] };
    }
  }

  function findPreviewRow(threadId: string): PreviewRow | null {
    const environmentId = threadEnvironments.get(threadId);
    if (environmentId !== undefined) {
      const row = getPreview(db, environmentId);
      if (row !== null) return row;
    }
    return (
      listActivePreviews(db).find((candidate) => candidate.threadId === threadId) ??
      listAllPreviews(db).find((candidate) => candidate.threadId === threadId) ??
      null
    );
  }

  async function teardownPreview(row: PreviewRow): Promise<void> {
    if (row.terminalId !== null) {
      try {
        await bb.sdk.terminals.close({ terminalId: row.terminalId, mode: "force" });
      } catch (cause) {
        bb.log.warn(`could not close preview terminal: ${asErrorMessage(cause)}`);
      }
    }
    await closePreviewBrowser(row);
    await releaseShare(row);
    row.status = "idle";
    row.terminalId = null;
    row.localUrl = null;
    row.shareUrl = null;
    row.error = null;
    row.logTail = "";
    save(row);
    reconcileDeclaredPorts();
  }

  function pickDetection(
    all: Detection[],
    relativeCwd: string | undefined,
  ): Detection {
    if (relativeCwd === undefined || relativeCwd === "") {
      return { ...(all[0] ?? detectApp([])) };
    }
    if (!isSafeRelativeCwd(relativeCwd)) {
      throw new Error("App directory must be a relative path without .. or shell characters.");
    }
    const match = all.find((item) => item.relativeCwd === relativeCwd);
    if (match === undefined) {
      throw new Error(`No startable app in ${relativeCwd}.`);
    }
    return { ...match };
  }

  async function tryShareUrl(hostId: string, port: number): Promise<string | null> {
    const url = await resolvePreviewShareUrl(
      hostId,
      port,
      (id) => bb.hosts.ensureSharedPortTunnel(id),
      async (id, sharePort) => exposeConnectShare(id, sharePort),
    );
    if (url === null) {
      bb.log.warn(`shared port unavailable for ${hostId}:${port}`);
    }
    return url;
  }

  async function releaseShare(row: PreviewRow): Promise<void> {
    if (row.port === null) return;
    forgetShareUrl(row.port);
    if (row.shareUrl === null || !isConnectShareUrl(row.shareUrl)) return;
    try {
      await unexposeConnectShare(row.hostId, row.port);
    } catch (cause) {
      bb.log.warn(`could not unexpose preview port ${row.port}: ${asErrorMessage(cause)}`);
    }
  }

  function reconcileDeclaredPorts(): void {
    const portsByHost = new Map<string, Set<number>>();
    for (const hostId of knownHosts) portsByHost.set(hostId, new Set());
    for (const row of listActivePreviews(db)) {
      knownHosts.add(row.hostId);
      if (row.port === null) continue;
      const set = portsByHost.get(row.hostId) ?? new Set<number>();
      set.add(row.port);
      portsByHost.set(row.hostId, set);
    }
    for (const [hostId, ports] of portsByHost) {
      try {
        bb.hosts.declareSharedPorts(hostId, [...ports].sort((a, b) => a - b));
      } catch (cause) {
        bb.log.warn(`declareSharedPorts(${hostId}) failed: ${asErrorMessage(cause)}`);
      }
    }
  }

  async function refreshLogs(row: PreviewRow): Promise<PreviewRow> {
    if (row.terminalId === null) return row;
    try {
      const session = await bb.sdk.terminals.get({ terminalId: row.terminalId });
      try {
        const output = await bb.sdk.terminals.output({
          terminalId: row.terminalId,
          tailBytes: 16_000,
        });
        row.logTail = tailText(decodeTerminalChunks(output.chunks), 4000);
      } catch {
        // Keep the last tail if the buffer is already gone.
      }
      if (session.status === "exited" || session.status === "disconnected") {
        row.status = "exited";
        await closePreviewBrowser(row);
        await releaseShare(row);
        row.localUrl = null;
        row.shareUrl = null;
        const reason =
          session.exitCode === null
            ? `Preview terminal ${session.status}.`
            : `Preview process exited with code ${session.exitCode}.`;
        row.error = `${reason} Command: ${row.command}`;
        return row;
      }
      const detectedPort = detectionFromRow(row)?.port ?? row.port;
      const previousPort = row.port;
      const hadConnectShare = row.shareUrl !== null && isConnectShareUrl(row.shareUrl);
      const hint = parseReadyHint(row.logTail, detectedPort);
      if (hint !== null) {
        const portChanged = previousPort !== null && previousPort !== hint.port;
        row.port = hint.port;
        row.localUrl = hint.localUrl;
        try {
          const ports = new Set<number>([hint.port]);
          for (const active of listActivePreviews(db)) {
            if (active.hostId === row.hostId && active.port !== null) ports.add(active.port);
          }
          bb.hosts.declareSharedPorts(row.hostId, [...ports].sort((a, b) => a - b));
        } catch (cause) {
          bb.log.warn(`declareSharedPorts(${row.hostId}) failed: ${asErrorMessage(cause)}`);
        }
        if (portChanged && hadConnectShare) {
          // Share the new port first; only drop the old expose after success so
          // a failed swap keeps the previous shareUrl (both may be live briefly).
          const share = await tryShareUrl(row.hostId, hint.port);
          if (share !== null) {
            forgetShareUrl(previousPort);
            try {
              await unexposeConnectShare(row.hostId, previousPort);
            } catch (cause) {
              bb.log.warn(
                `could not unexpose previous preview port ${previousPort}: ${asErrorMessage(cause)}`,
              );
            }
            row.shareUrl = share;
          }
        } else if (shouldRefreshPreviewShare(row.status, row.shareUrl)) {
          const share = await tryShareUrl(row.hostId, hint.port);
          if (share !== null) row.shareUrl = share;
        }
        if (row.status === "starting") {
          row.status = "running";
          row.error = null;
        }
      } else if (
        row.status === "starting" &&
        row.startedAt !== null &&
        now() - row.startedAt > settings.readyTimeoutMs
      ) {
        row.error = "Still starting — no ready URL in the logs yet. You can wait or stop it.";
      }
    } catch (cause) {
      row.error = `Could not read preview logs: ${asErrorMessage(cause)}`;
    }
    return row;
  }

  async function waitForPreview(row: PreviewRow): Promise<PreviewRow> {
    let current = await refreshLogs(row);
    save(current);
    if (current.status === "exited" || current.status === "error") {
      return current;
    }
    if (current.error !== null && current.error.startsWith("Could not read preview logs:")) {
      current.error = null;
      save(current);
      return current;
    }
    const signal = new AbortController().signal;
    // Poll while still starting (up to ~2s), then briefly settle after the first
    // ready hint so a later Vite Local line can win over an earlier API URL.
    const maxStartingAttempts = 8;
    const settleAttempts = 4;
    let startingAttempts = 0;
    let settleRemaining = current.status === "running" ? settleAttempts : 0;
    while (
      (current.status === "starting" && startingAttempts < maxStartingAttempts) ||
      (current.status === "running" && settleRemaining > 0)
    ) {
      await sleep(250, signal);
      const latest = getPreview(db, current.environmentId);
      if (latest === null || latest.terminalId === null) return current;
      const wasStarting = current.status === "starting";
      current = await refreshLogs(latest);
      save(current);
      if (current.status === "exited" || current.status === "error") {
        return current;
      }
      if (wasStarting) startingAttempts += 1;
      if (current.status === "running") {
        // First transition to running arms the settle window; later ticks count it down.
        if (settleRemaining === 0 && wasStarting) settleRemaining = settleAttempts;
        else if (settleRemaining > 0) settleRemaining -= 1;
      }
    }
    return current;
  }

  async function inspect(threadId: string): Promise<InspectResult> {
    try {
      const workspace = await resolveWorkspace(threadId);
      return await enqueue(workspace.environmentId, async () => {
        knownHosts.add(workspace.hostId);
        const blocker = environmentPreviewBlocker(workspace.environmentStatus);
        const { detection, candidates } = await detectIfPossible(workspace);
        let row = getPreview(db, workspace.environmentId);
        if (blocker === null && row !== null && row.terminalId !== null) {
          row = await refreshLogs(row);
          await syncPreviewBrowser(row);
          save(row);
          reconcileDeclaredPorts();
        }
        return {
          workspace: publicWorkspace(workspace),
          detection,
          candidates,
          preview: row === null ? idlePreview() : previewFromRow(row),
          error: blocker,
        };
      });
    } catch (cause) {
      return {
        workspace: null,
        detection: null,
        candidates: [],
        preview: null,
        error: asErrorMessage(cause),
      };
    }
  }

  async function start(threadId: string, options: StartOptions = {}): Promise<InspectResult> {
    try {
      const workspace = await resolveWorkspace(threadId);
      return await enqueue(workspace.environmentId, async () => {
        requireReadyWorkspace(workspace);
        knownHosts.add(workspace.hostId);
        const existing = getPreview(db, workspace.environmentId);
        if (
          existing !== null &&
          (existing.status === "starting" || existing.status === "running") &&
          existing.terminalId !== null
        ) {
          const refreshed = await refreshLogs(existing);
          await syncPreviewBrowser(refreshed);
          save(refreshed);
          const detected = await detectWorkspace(workspace);
          const detection = detectionFromRow(refreshed) ?? detected.detection;
          return {
            workspace: publicWorkspace(workspace),
            detection,
            candidates: detected.candidates,
            preview: previewFromRow(refreshed),
            error: null,
          };
        }

        const split = splitCdPrefix(options.command ?? "");
        const relativeCwd = options.relativeCwd ?? split.relativeCwd ?? undefined;
        const commandOverride = split.relativeCwd !== null ? split.command : options.command;
        const detected = await detectWorkspace(workspace);
        const detection = pickDetection(detected.all, relativeCwd);
        if (options.port !== undefined) detection.port = options.port;
        const command = launchCommand(detection, {
          autoInstall: settings.autoInstall,
          commandOverride,
        });
        const startedAt = now();
        const terminal = await bb.sdk.terminals.create({
          cols: 120,
          rows: 32,
          scope: { kind: "thread", threadId },
          title: `Preview · ${detection.frameworkLabel ?? "app"}`,
          start: { mode: "command", command },
        });
        const row: PreviewRow = {
          environmentId: workspace.environmentId,
          threadId,
          hostId: workspace.hostId,
          workspacePath: workspace.path,
          branch: workspace.branch,
          relativeCwd: detection.relativeCwd,
          framework: detection.framework,
          frameworkLabel: detection.frameworkLabel,
          packageManager: detection.packageManager,
          command,
          port: detection.port,
          terminalId: terminal.id,
          localUrl: null,
          shareUrl: null,
          status: "starting",
          error: null,
          logTail: "",
          detectedJson: JSON.stringify(detection),
          startedAt,
          updatedAt: startedAt,
          browserTabId: null,
        };
        save(row);
        reconcileDeclaredPorts();
        const settled = await waitForPreview(row);
        await syncPreviewBrowser(settled);
        save(settled);
        return {
          workspace: publicWorkspace(workspace),
          detection,
          candidates: detected.candidates,
          preview: previewFromRow(settled),
          error:
            settled.status === "exited" || settled.status === "error" ? settled.error : null,
        };
      });
    } catch (cause) {
      const failed = await inspect(threadId);
      return { ...failed, error: asErrorMessage(cause) };
    }
  }

  async function stop(threadId: string): Promise<InspectResult> {
    try {
      const workspace = await resolveWorkspace(threadId);
      return await enqueue(workspace.environmentId, async () => {
        const row = getPreview(db, workspace.environmentId);
        if (row === null || row.terminalId === null) {
          const { detection, candidates } = await detectIfPossible(workspace);
          return {
            workspace: publicWorkspace(workspace),
            detection,
            candidates,
            preview: row === null ? idlePreview() : previewFromRow(row),
            error: environmentPreviewBlocker(workspace.environmentStatus),
          };
        }
        row.status = "stopping";
        save(row);
        try {
          await bb.sdk.terminals.close({ terminalId: row.terminalId, mode: "force" });
        } catch (cause) {
          row.status = "error";
          row.error = `Could not stop the preview process: ${asErrorMessage(cause)}`;
          save(row);
          const { detection, candidates } = await detectIfPossible(workspace);
          return {
            workspace: publicWorkspace(workspace),
            detection,
            candidates,
            preview: previewFromRow(row),
            error: row.error,
          };
        }
        await closePreviewBrowser(row);
        await releaseShare(row);
        row.status = "idle";
        row.terminalId = null;
        row.localUrl = null;
        row.shareUrl = null;
        row.error = null;
        row.logTail = "";
        save(row);
        reconcileDeclaredPorts();
        const { detection, candidates } = await detectIfPossible(workspace);
        return {
          workspace: publicWorkspace(workspace),
          detection,
          candidates,
          preview: previewFromRow(row),
          error: environmentPreviewBlocker(workspace.environmentStatus),
        };
      });
    } catch (cause) {
      const row = findPreviewRow(threadId);
      if (row !== null) {
        await enqueue(row.environmentId, async () => {
          await teardownPreview(row);
        });
      }
      const failed = await inspect(threadId);
      return { ...failed, error: asErrorMessage(cause) };
    }
  }

  async function restart(threadId: string, options: StartOptions = {}): Promise<InspectResult> {
    try {
      const workspace = await resolveWorkspace(threadId);
      requireReadyWorkspace(workspace);
    } catch (cause) {
      const failed = await inspect(threadId);
      return { ...failed, error: asErrorMessage(cause) };
    }
    const stopped = await stop(threadId);
    if (stopped.preview?.terminalId !== null && stopped.preview?.terminalId !== undefined) {
      return stopped;
    }
    return start(threadId, options);
  }

  async function tick(): Promise<void> {
    const rows = listActivePreviews(db);
    for (const row of rows) {
      await enqueue(row.environmentId, async () => {
        const current = getPreview(db, row.environmentId);
        if (
          current === null ||
          current.terminalId === null ||
          (current.status !== "starting" && current.status !== "running")
        ) {
          return;
        }
        knownHosts.add(current.hostId);
        const next = await refreshLogs(current);
        await syncPreviewBrowser(next);
        save(next);
      });
    }
    for (const row of listAllPreviews(db)) knownHosts.add(row.hostId);
    reconcileDeclaredPorts();
  }

  function runningNote(threadId: string): string | null {
    try {
      const environmentId = threadEnvironments.get(threadId);
      const row =
        environmentId !== undefined
          ? getPreview(db, environmentId)
          : (listActivePreviews(db).find((candidate) => candidate.threadId === threadId) ??
            null);
      if (row === null) return null;
      if (row.status !== "running" && row.status !== "starting") return null;
      const url = openUrlFor(row);
      if (url === null) {
        return "This worktree has an App Preview process starting. Check the Preview panel or run `bb preview status`.";
      }
      return `This worktree's app is being previewed at ${url}. Prefer that URL over guessing localhost.`;
    } catch {
      return null;
    }
  }

  return { inspect, start, stop, restart, tick, runningNote, db };
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
