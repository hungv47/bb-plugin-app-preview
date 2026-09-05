import {
  detectFrameworkFromCommand,
  detectFrameworkFromImage,
  findProjectRoot,
  isDevProcess,
  projectNameFromCwd,
} from "./ports-classify.js";
import { formatMemory, uptimeFromLstart } from "./ports-format.js";
import type { ListenSnapshot, ListeningPort } from "./ports-types.js";

export type PathExists = (path: string) => boolean;

export function assembleListeningPorts(
  snapshot: ListenSnapshot,
  showAll: boolean,
  previewPorts: ReadonlySet<number>,
  nowMs: number,
  pathExists: PathExists,
): ListeningPort[] {
  const assembled: ListeningPort[] = [];
  for (const entry of snapshot.entries) {
    const ps = snapshot.processes.get(entry.pid);
    const command = ps?.command ?? "";
    const docker = snapshot.docker.get(entry.port);
    const cwdRaw = snapshot.cwds.get(entry.pid) ?? null;
    let processName = entry.processName;
    let projectName: string | null = null;
    let cwd: string | null = cwdRaw;
    let framework = detectFrameworkFromCommand(command, processName);
    let status: ListeningPort["status"] = "healthy";

    if (ps !== undefined) {
      if (ps.stat.includes("Z")) status = "zombie";
      else if (ps.ppid === 1 && isDevProcess(processName, command)) status = "orphaned";
    }

    if (docker !== undefined) {
      processName = "docker";
      projectName = docker.name;
      framework = detectFrameworkFromImage(docker.image);
      cwd = null;
    } else if (cwdRaw !== null) {
      const root = findProjectRoot(cwdRaw, pathExists);
      cwd = root;
      projectName = projectNameFromCwd(root);
    }

    const uptime = ps !== undefined ? uptimeFromLstart(ps.lstart, nowMs) : null;
    const memory = ps !== undefined && ps.rss > 0 ? formatMemory(ps.rss) : null;

    assembled.push({
      port: entry.port,
      pid: entry.pid,
      processName,
      command,
      cwd,
      projectName,
      framework,
      uptime,
      memory,
      status,
      docker: docker !== undefined,
      ownedByPreview: previewPorts.has(entry.port),
      shareUrl: null,
      listensOnIpv4: entry.listensOnIpv4,
    });
  }

  assembled.sort((a, b) => a.port - b.port);
  if (showAll) return assembled;
  return assembled.filter((port) => isDevProcess(port.processName, port.command) || port.docker);
}
