export function formatUptime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function formatMemory(rssKb: number): string {
  if (rssKb > 1_048_576) return `${(rssKb / 1_048_576).toFixed(1)} GB`;
  if (rssKb > 1024) return `${(rssKb / 1024).toFixed(1)} MB`;
  return `${rssKb} KB`;
}

export function parseLstartMs(lstart: string, nowMs: number): number | null {
  const parsed = Date.parse(lstart);
  if (Number.isNaN(parsed) || parsed > nowMs + 60_000) return null;
  return parsed;
}

export function uptimeFromLstart(lstart: string, nowMs: number): string | null {
  if (lstart === "") return null;
  const start = parseLstartMs(lstart, nowMs);
  return start === null ? null : formatUptime(nowMs - start);
}

export type PortListMatch = {
  port: number;
  pid: number;
  processName: string;
  projectName: string | null;
  framework: string | null;
  command: string;
  status: string;
  docker: boolean;
  ownedByPreview: boolean;
  shareUrl: string | null;
};

function portRowHaystack(row: PortListMatch): string {
  return [
    `:${row.port}`,
    String(row.port),
    String(row.pid),
    row.processName,
    row.projectName ?? "",
    row.framework ?? "",
    row.command,
    row.status,
    row.docker ? "docker" : "",
    row.ownedByPreview ? "preview" : "",
    row.shareUrl ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function portRowRank(row: PortListMatch): number {
  if (row.ownedByPreview) return 0;
  if (row.shareUrl !== null) return 1;
  return 2;
}

export function visibleListeningPorts<T extends PortListMatch>(ports: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  const matched = needle === "" ? [...ports] : ports.filter((row) => portRowHaystack(row).includes(needle));
  return matched.sort((a, b) => {
    const rank = portRowRank(a) - portRowRank(b);
    if (rank !== 0) return rank;
    if (a.port !== b.port) return a.port - b.port;
    return a.pid - b.pid;
  });
}
