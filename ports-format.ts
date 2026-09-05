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
