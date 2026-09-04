import type { Database } from "better-sqlite3";
import type { Detection } from "./detect.js";
import type { PreviewStatus } from "./contract.js";

export type PreviewRow = {
  environmentId: string;
  threadId: string;
  hostId: string;
  workspacePath: string;
  branch: string | null;
  relativeCwd: string;
  framework: string | null;
  frameworkLabel: string | null;
  packageManager: string | null;
  command: string;
  port: number | null;
  terminalId: string | null;
  localUrl: string | null;
  shareUrl: string | null;
  status: PreviewStatus;
  error: string | null;
  logTail: string;
  detectedJson: string;
  startedAt: number | null;
  updatedAt: number;
};

const ACTIVE: PreviewStatus[] = ["starting", "running", "stopping"];

export function migratePreviews(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS previews (
      environment_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      host_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      branch TEXT,
      relative_cwd TEXT NOT NULL DEFAULT '.',
      framework TEXT,
      framework_label TEXT,
      package_manager TEXT,
      command TEXT NOT NULL,
      port INTEGER,
      terminal_id TEXT,
      local_url TEXT,
      share_url TEXT,
      status TEXT NOT NULL,
      error TEXT,
      log_tail TEXT NOT NULL DEFAULT '',
      detected_json TEXT NOT NULL DEFAULT '{}',
      started_at INTEGER,
      updated_at INTEGER NOT NULL
    )
  `);
}

function asInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const converted = Number(value);
    return Number.isSafeInteger(converted) ? converted : null;
  }
  return null;
}

function fromRow(row: Record<string, unknown>): PreviewRow {
  const startedAt = asInt(row.started_at);
  const updatedAt = asInt(row.updated_at) ?? 0;
  const port = asInt(row.port);
  return {
    environmentId: String(row.environment_id),
    threadId: String(row.thread_id),
    hostId: String(row.host_id),
    workspacePath: String(row.workspace_path),
    branch: row.branch === null || row.branch === undefined ? null : String(row.branch),
    relativeCwd: String(row.relative_cwd),
    framework: row.framework === null || row.framework === undefined ? null : String(row.framework),
    frameworkLabel:
      row.framework_label === null || row.framework_label === undefined
        ? null
        : String(row.framework_label),
    packageManager:
      row.package_manager === null || row.package_manager === undefined
        ? null
        : String(row.package_manager),
    command: String(row.command),
    port,
    terminalId:
      row.terminal_id === null || row.terminal_id === undefined ? null : String(row.terminal_id),
    localUrl: row.local_url === null || row.local_url === undefined ? null : String(row.local_url),
    shareUrl: row.share_url === null || row.share_url === undefined ? null : String(row.share_url),
    status: row.status as PreviewRow["status"],
    error: row.error === null || row.error === undefined ? null : String(row.error),
    logTail: typeof row.log_tail === "string" ? row.log_tail : "",
    detectedJson: typeof row.detected_json === "string" ? row.detected_json : "{}",
    startedAt,
    updatedAt,
  };
}

export function getPreview(db: Database, environmentId: string): PreviewRow | null {
  const row = db.prepare(`SELECT * FROM previews WHERE environment_id = ?`).get(environmentId) as
    | Record<string, unknown>
    | undefined;
  return row === undefined ? null : fromRow(row);
}

export function listActivePreviews(db: Database): PreviewRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM previews WHERE status IN (${ACTIVE.map(() => "?").join(",")})`,
    )
    .all(...ACTIVE) as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function listAllPreviews(db: Database): PreviewRow[] {
  const rows = db.prepare(`SELECT * FROM previews`).all() as Record<string, unknown>[];
  return rows.map(fromRow);
}

export function upsertPreview(db: Database, row: PreviewRow): void {
  db.prepare(
    `
    INSERT INTO previews (
      environment_id, thread_id, host_id, workspace_path, branch, relative_cwd,
      framework, framework_label, package_manager, command, port, terminal_id,
      local_url, share_url, status, error, log_tail, detected_json, started_at, updated_at
    ) VALUES (
      @environmentId, @threadId, @hostId, @workspacePath, @branch, @relativeCwd,
      @framework, @frameworkLabel, @packageManager, @command, @port, @terminalId,
      @localUrl, @shareUrl, @status, @error, @logTail, @detectedJson, @startedAt, @updatedAt
    )
    ON CONFLICT(environment_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      host_id = excluded.host_id,
      workspace_path = excluded.workspace_path,
      branch = excluded.branch,
      relative_cwd = excluded.relative_cwd,
      framework = excluded.framework,
      framework_label = excluded.framework_label,
      package_manager = excluded.package_manager,
      command = excluded.command,
      port = excluded.port,
      terminal_id = excluded.terminal_id,
      local_url = excluded.local_url,
      share_url = excluded.share_url,
      status = excluded.status,
      error = excluded.error,
      log_tail = excluded.log_tail,
      detected_json = excluded.detected_json,
      started_at = excluded.started_at,
      updated_at = excluded.updated_at
  `,
  ).run(row);
}

export function detectionFromRow(row: PreviewRow): Detection | null {
  try {
    const parsed = JSON.parse(row.detectedJson) as Detection;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return null;
  }
  return null;
}
