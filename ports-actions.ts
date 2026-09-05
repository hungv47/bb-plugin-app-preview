import type { Database } from "better-sqlite3";
import {
  killListening,
  listListeningPorts,
  lookupShareTarget,
  type PortsKillResult,
  type PortsListResult,
  type PortsShareResult,
} from "./ports.js";
import {
  attachShareUrls,
  exposeConnectShare,
  forgetShareUrl,
  isConnectShareUrl,
  listedShareUrls,
  rememberShareUrl,
  unexposeConnectShare,
} from "./share-port.js";
import { listActivePreviews, upsertPreview, type PreviewRow } from "./store.js";

export type PortsActions = {
  listPorts: (showAll: boolean) => Promise<PortsListResult>;
  killPorts: (targets: readonly string[], force: boolean) => Promise<PortsKillResult>;
  sharePort: (port: number) => Promise<PortsShareResult>;
  unsharePort: (port: number) => Promise<PortsShareResult>;
};

export function previewPortSet(rows: readonly PreviewRow[]): Set<number> {
  const ports = new Set<number>();
  for (const row of rows) {
    if (row.port !== null) ports.add(row.port);
  }
  return ports;
}

export function previewShareUrlMap(rows: readonly PreviewRow[]): Map<number, string> {
  const urls = new Map<number, string>();
  for (const row of rows) {
    if (row.port !== null && row.shareUrl !== null && isConnectShareUrl(row.shareUrl)) {
      urls.set(row.port, row.shareUrl);
    }
  }
  return urls;
}

export function clearPreviewShare(db: Database, port: number, nowMs: number): void {
  for (const row of listActivePreviews(db)) {
    if (row.port !== port || row.shareUrl === null) continue;
    upsertPreview(db, { ...row, shareUrl: null, updatedAt: nowMs });
  }
}

export function createPortsActions(db: Database, publish: () => void): PortsActions {
  function activeRows(): PreviewRow[] {
    return listActivePreviews(db);
  }

  async function listPorts(showAll: boolean): Promise<PortsListResult> {
    const rows = activeRows();
    const listed = listListeningPorts(showAll, previewPortSet(rows));
    if (listed.error !== null) return listed;
    const urls = await listedShareUrls(previewShareUrlMap(rows));
    return { ports: attachShareUrls(listed.ports, urls), error: null };
  }

  async function sharePort(port: number): Promise<PortsShareResult> {
    const listed = await listPorts(true);
    if (listed.error !== null) return { url: null, error: listed.error };
    const found = lookupShareTarget(listed.ports, port);
    if (!found.ok) return { url: null, error: found.error };
    if (found.row.shareUrl !== null) return { url: found.row.shareUrl, error: null };
    try {
      const url = await exposeConnectShare(null, port);
      rememberShareUrl(port, url);
      publish();
      return { url, error: null };
    } catch (cause) {
      return { url: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function unsharePort(port: number): Promise<PortsShareResult> {
    try {
      await unexposeConnectShare(null, port);
      forgetShareUrl(port);
      clearPreviewShare(db, port, Date.now());
      publish();
      return { url: null, error: null };
    } catch (cause) {
      return { url: null, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function killPorts(targets: readonly string[], force: boolean): Promise<PortsKillResult> {
    const result = killListening(targets, force, previewPortSet(activeRows()));
    for (const outcome of result.outcomes) {
      if (!outcome.ok || outcome.signal === null || outcome.port === null) continue;
      forgetShareUrl(outcome.port);
      clearPreviewShare(db, outcome.port, Date.now());
      try {
        await unexposeConnectShare(null, outcome.port);
      } catch {
        // Connect may have no share for this port.
      }
    }
    publish();
    return result;
  }

  return { listPorts, killPorts, sharePort, unsharePort };
}
