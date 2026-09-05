import { isDevProcess } from "./ports-classify.js";
import { assembleListeningPorts } from "./ports-scan.js";
import { applyKill, parseKillTokens, type SendSignal } from "./ports-kill.js";
import { collectListenSnapshot, defaultPathExists, defaultRunCommand } from "./ports-platform.js";
import type { KillOutcome, ListeningPort } from "./ports-types.js";

export type PortsListResult = {
  ports: ListeningPort[];
  error: string | null;
};

export type PortsKillResult = {
  outcomes: KillOutcome[];
  error: string | null;
};

export type PortsShareResult = {
  url: string | null;
  error: string | null;
};

export type ShareLookup =
  | { ok: true; row: ListeningPort }
  | { ok: false; error: string };

export function shareBlockedReason(port: ListeningPort): string | null {
  if (port.docker) return `Won't share Docker on :${port.port}.`;
  if (!isDevProcess(port.processName, port.command) && !port.ownedByPreview) {
    return `Won't share ${port.processName} on :${port.port} (system app).`;
  }
  if (port.listensOnIpv4) return null;
  return `:${port.port} listens on IPv6 only. Connect share talks to 127.0.0.1. Restart the preview so it binds 127.0.0.1.`;
}

export function lookupShareTarget(ports: readonly ListeningPort[], port: number): ShareLookup {
  const row = ports.find((item) => item.port === port);
  if (row === undefined) return { ok: false, error: `Nothing is listening on :${port}.` };
  const blocked = shareBlockedReason(row);
  if (blocked !== null) return { ok: false, error: blocked };
  return { ok: true, row };
}

export function sendSignal(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function listListeningPorts(showAll: boolean, previewPorts: ReadonlySet<number>): PortsListResult {
  const snapshot = collectListenSnapshot(process.platform, defaultRunCommand);
  if ("error" in snapshot) return { ports: [], error: snapshot.error };
  return {
    ports: assembleListeningPorts(snapshot, showAll, previewPorts, Date.now(), defaultPathExists),
    error: null,
  };
}

export function killListening(
  rawTargets: readonly string[],
  force: boolean,
  previewPorts: ReadonlySet<number>,
  signal: SendSignal = sendSignal,
): PortsKillResult {
  const listed = listListeningPorts(true, previewPorts);
  if (listed.error !== null) return { outcomes: [], error: listed.error };
  const tokens = parseKillTokens(rawTargets);
  const parentPid = process.ppid;
  const outcomes = applyKill(tokens, listed.ports, force, signal, process.pid, parentPid);
  return { outcomes, error: null };
}

export function formatPortsTable(ports: readonly ListeningPort[]): string {
  if (ports.length === 0) return "No listening ports.";
  const header = pad(["PORT", "PID", "PROCESS", "PROJECT", "FRAMEWORK", "STATUS", "UPTIME"]);
  const lines = [header];
  for (const port of ports) {
    lines.push(
      pad([
        `:${port.port}`,
        String(port.pid),
        port.processName,
        port.projectName ?? "—",
        port.framework ?? "—",
        port.status === "healthy" ? "—" : port.status,
        port.uptime ?? "—",
      ]),
    );
    if (port.shareUrl !== null) lines.push(`        ${port.shareUrl}`);
    const blocked = shareBlockedReason(port);
    if (blocked !== null) lines.push(`        ${blocked}`);
  }
  lines.push("");
  lines.push(`${ports.length} port${ports.length === 1 ? "" : "s"}`);
  return lines.join("\n");
}

export function formatKillOutcomes(outcomes: readonly KillOutcome[]): string {
  if (outcomes.length === 0) return "Nothing to kill.";
  return outcomes.map((outcome) => (outcome.ok ? outcome.message : `✕ ${outcome.message}`)).join("\n");
}

function pad(cols: readonly string[]): string {
  const widths = [7, 8, 12, 16, 12, 10, 10];
  return cols
    .map((col, i) => {
      const width = widths[i] ?? 10;
      const cell = col.length > width ? `${col.slice(0, width - 1)}…` : col;
      return cell.padEnd(width);
    })
    .join("  ")
    .trimEnd();
}
