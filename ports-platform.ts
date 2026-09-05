import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ListenSnapshot } from "./ports-types.js";
import { parseDockerPs, parseLsofCwd, parseLsofListen, parsePs, parseSsListen } from "./ports-parse.js";

export type RunCommand = (file: string, args: readonly string[]) => string;

function execFileStdout(cause: unknown): string {
  if (!(cause instanceof Error)) return "";
  if (!("stdout" in cause)) return "";
  const stdout = cause.stdout;
  if (stdout === undefined || stdout === null) return "";
  if (Buffer.isBuffer(stdout)) return stdout.toString("utf8");
  return String(stdout);
}

export function defaultRunCommand(file: string, args: readonly string[]): string {
  try {
    return execFileSync(file, [...args], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 8_000_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (cause) {
    return execFileStdout(cause);
  }
}

function uniquePids(entries: ListenSnapshot["entries"]): number[] {
  return [...new Set(entries.map((entry) => entry.pid))];
}

function collectDocker(entries: ListenSnapshot["entries"], run: RunCommand): ListenSnapshot["docker"] {
  const wantsDocker = entries.some(
    (entry) => entry.processName.startsWith("com.docke") || entry.processName === "docker",
  );
  if (!wantsDocker) return new Map();
  return parseDockerPs(run("docker", ["ps", "--format", "{{.Ports}}\t{{.Names}}\t{{.Image}}"]));
}

function collectDarwin(run: RunCommand): ListenSnapshot {
  const entries = parseLsofListen(run("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"]));
  const pids = uniquePids(entries);
  const processes =
    pids.length === 0
      ? new Map()
      : parsePs(
          run("ps", [
            "-p",
            pids.join(","),
            "-o",
            "pid=,ppid=,stat=,rss=,lstart=,command=",
          ]),
        );
  const cwds =
    pids.length === 0 ? new Map() : parseLsofCwd(run("lsof", ["-a", "-d", "cwd", "-p", pids.join(",")]));
  return { entries, processes, cwds, docker: collectDocker(entries, run) };
}

function collectLinux(run: RunCommand): ListenSnapshot {
  let entries = parseSsListen(run("ss", ["-tlnp"]));
  if (entries.length === 0) {
    entries = parseLsofListen(run("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n"]));
  }
  const pids = uniquePids(entries);
  const processes =
    pids.length === 0
      ? new Map()
      : parsePs(
          run("ps", [
            "-p",
            pids.join(","),
            "-o",
            "pid=,ppid=,stat=,rss=,lstart=,command=",
          ]),
        );
  const cwds = new Map<number, string>();
  for (const pid of pids) {
    try {
      const cwd = run("readlink", ["-f", `/proc/${pid}/cwd`]).trim();
      if (cwd.startsWith("/")) cwds.set(pid, cwd);
    } catch {
      // process exited between ss and readlink
    }
  }
  return { entries, processes, cwds, docker: collectDocker(entries, run) };
}

export function collectListenSnapshot(
  platform: NodeJS.Platform,
  run: RunCommand,
): ListenSnapshot | { error: string } {
  if (platform === "win32") {
    return { error: "Ports listing is not supported on Windows yet." };
  }
  if (platform === "darwin") return collectDarwin(run);
  if (platform === "linux") return collectLinux(run);
  return { error: `Ports listing is not supported on ${platform}.` };
}

export function defaultPathExists(path: string): boolean {
  return existsSync(path);
}
