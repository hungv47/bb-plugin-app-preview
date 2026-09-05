import type { DockerInfo, ListenEntry, ProcessInfo } from "./ports-types.js";

function portFromListenAddress(address: string): number | null {
  const match = address.match(/:(\d+)$/);
  if (match === null || match[1] === undefined) return null;
  const port = Number.parseInt(match[1], 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/** True when Connect's 127.0.0.1 probe can hit this listen address. */
export function isIpv6LoopbackAddress(address: string): boolean {
  return /\[::1\]:/.test(address) || address.startsWith("::1:");
}

export function listensOnIpv4Address(address: string, typeField?: string): boolean {
  if (isIpv6LoopbackAddress(address)) return false;
  if (typeField === "IPv4") return true;
  if (typeField === "IPv6") return false;
  if (address.startsWith("[") || address.includes("::")) return false;
  return true;
}

function rememberListen(
  byPort: Map<number, ListenEntry>,
  entry: ListenEntry,
): void {
  const existing = byPort.get(entry.port);
  if (existing === undefined) {
    byPort.set(entry.port, entry);
    return;
  }
  if (entry.listensOnIpv4) existing.listensOnIpv4 = true;
}

/** Parse `lsof -iTCP -sTCP:LISTEN -P -n` (macOS / Linux fallback). */
export function parseLsofListen(raw: string): ListenEntry[] {
  const byPort = new Map<number, ListenEntry>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("COMMAND")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 9) continue;
    const processName = parts[0];
    const pidText = parts[1];
    const typeField = parts[4];
    const nameField = parts[8];
    if (processName === undefined || pidText === undefined || nameField === undefined) continue;
    const pid = Number.parseInt(pidText, 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const port = portFromListenAddress(nameField);
    if (port === null) continue;
    rememberListen(byPort, {
      port,
      pid,
      processName,
      listensOnIpv4: listensOnIpv4Address(nameField, typeField),
    });
  }
  return [...byPort.values()];
}

/**
 * Parse `ss -tlnp`. Local address is column 4; pid lives in the users field.
 */
export function parseSsListen(raw: string): ListenEntry[] {
  const byPort = new Map<number, ListenEntry>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("State") || trimmed.startsWith("Netid")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    const localAddr = parts[3];
    if (localAddr === undefined) continue;
    const port = portFromListenAddress(localAddr);
    if (port === null) continue;
    const usersField = parts.slice(5).join(" ");
    const pidMatch = usersField.match(/pid=(\d+)/);
    if (pidMatch === null || pidMatch[1] === undefined) continue;
    const pid = Number.parseInt(pidMatch[1], 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const nameMatch = usersField.match(/\("([^"]+)"/);
    const processName = nameMatch?.[1] ?? "unknown";
    rememberListen(byPort, {
      port,
      pid,
      processName,
      listensOnIpv4: listensOnIpv4Address(localAddr),
    });
  }
  return [...byPort.values()];
}

const PS_LINE =
  /^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+\w+\s+(\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/;

/** Parse `ps -p … -o pid=,ppid=,stat=,rss=,lstart=,command=`. */
export function parsePs(raw: string): Map<number, ProcessInfo> {
  const map = new Map<number, ProcessInfo>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const match = trimmed.match(PS_LINE);
    if (match === null) continue;
    const pidText = match[1];
    const ppidText = match[2];
    const stat = match[3];
    const rssText = match[4];
    const lstart = match[5];
    const command = match[6];
    if (
      pidText === undefined ||
      ppidText === undefined ||
      stat === undefined ||
      rssText === undefined ||
      lstart === undefined ||
      command === undefined
    ) {
      continue;
    }
    const pid = Number.parseInt(pidText, 10);
    const ppid = Number.parseInt(ppidText, 10);
    const rss = Number.parseInt(rssText, 10);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    map.set(pid, {
      ppid: Number.isInteger(ppid) ? ppid : 0,
      stat,
      rss: Number.isInteger(rss) ? rss : 0,
      lstart,
      command,
    });
  }
  return map;
}

/** Parse `lsof -a -d cwd -p …` NAME column. */
export function parseLsofCwd(raw: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("COMMAND")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 9) continue;
    const pidText = parts[1];
    if (pidText === undefined) continue;
    const pid = Number.parseInt(pidText, 10);
    if (!Number.isInteger(pid) || pid <= 0 || map.has(pid)) continue;
    const path = parts.slice(8).join(" ");
    if (!path.startsWith("/")) continue;
    map.set(pid, path);
  }
  return map;
}

/** Parse `docker ps --format '{{.Ports}}\\t{{.Names}}\\t{{.Image}}'`. */
export function parseDockerPs(raw: string): Map<number, DockerInfo> {
  const map = new Map<number, DockerInfo>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const [portsStr, name, image] = trimmed.split("\t");
    if (portsStr === undefined || name === undefined) continue;
    const info: DockerInfo = { name, image: image ?? "Docker" };
    for (const match of portsStr.matchAll(/:(\d+)->/g)) {
      const portText = match[1];
      if (portText === undefined) continue;
      const port = Number.parseInt(portText, 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
      if (!map.has(port)) map.set(port, info);
    }
  }
  return map;
}
