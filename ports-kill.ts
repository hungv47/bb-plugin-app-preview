import { isDevProcess } from "./ports-classify.js";
import type { KillOutcome, ListeningPort } from "./ports-types.js";

export type KillToken =
  | { kind: "value"; n: number; fromRange: boolean; label: string }
  | { kind: "error"; message: string };

const RANGE = /^(\d+)-(\d+)$/;

export function parseKillTokens(tokens: readonly string[]): KillToken[] {
  const out: KillToken[] = [];
  for (const token of tokens) {
    const range = token.match(RANGE);
    if (range !== null && range[1] !== undefined && range[2] !== undefined) {
      const start = Number.parseInt(range[1], 10);
      const end = Number.parseInt(range[2], 10);
      if (start > end) {
        out.push({ kind: "error", message: `Invalid range: ${token} (start must be less than end)` });
        continue;
      }
      if (end - start + 1 > 1000) {
        out.push({ kind: "error", message: `Range too large: ${token} (max 1000 ports)` });
        continue;
      }
      if (start < 1 || end > 65535) {
        out.push({ kind: "error", message: `Invalid range: ${token} (ports must be 1-65535)` });
        continue;
      }
      for (let p = start; p <= end; p += 1) {
        out.push({ kind: "value", n: p, fromRange: true, label: String(p) });
      }
      continue;
    }
    const n = Number.parseInt(token, 10);
    if (!Number.isInteger(n) || String(n) !== token.trim()) {
      out.push({ kind: "error", message: `"${token}" is not a valid port/PID` });
      continue;
    }
    out.push({ kind: "value", n, fromRange: false, label: token });
  }
  return out;
}

export type PidExists = (pid: number) => boolean;
export type SendSignal = (pid: number, signal: "SIGTERM" | "SIGKILL") => boolean;

export type ResolvedKillTarget = {
  pid: number;
  via: "port" | "pid";
  port: number | null;
  processName: string | null;
  row: ListeningPort;
};

export function resolveKillTarget(
  n: number,
  ports: readonly ListeningPort[],
  _pidExists: PidExists,
): ResolvedKillTarget | null {
  if (!Number.isInteger(n) || n < 1) return null;
  if (n <= 65535) {
    const info = ports.find((port) => port.port === n);
    if (info !== undefined) {
      return { pid: info.pid, via: "port", port: n, processName: info.processName, row: info };
    }
  }
  const byPid = ports.find((port) => port.pid === n);
  if (byPid !== undefined) {
    return {
      pid: byPid.pid,
      via: "pid",
      port: byPid.port,
      processName: byPid.processName,
      row: byPid,
    };
  }
  return null;
}

export function isProtectedPid(pid: number, selfPid: number, parentPid: number): boolean {
  return pid <= 1 || pid === selfPid || pid === parentPid;
}

export function killBlockedReason(port: ListeningPort): string | null {
  if (port.docker) return `Won't kill Docker on :${port.port}. Stop the container instead.`;
  if (!isDevProcess(port.processName, port.command) && !port.ownedByPreview) {
    return `Won't kill ${port.processName} on :${port.port} (system app).`;
  }
  return null;
}

export function applyKill(
  tokens: readonly KillToken[],
  ports: readonly ListeningPort[],
  force: boolean,
  pidExists: PidExists,
  sendSignal: SendSignal,
  selfPid: number,
  parentPid: number,
): KillOutcome[] {
  const signal = force ? "SIGKILL" : "SIGTERM";
  const outcomes: KillOutcome[] = [];
  for (const token of tokens) {
    if (token.kind === "error") {
      outcomes.push({
        target: token.message,
        via: "invalid",
        port: null,
        pid: null,
        processName: null,
        signal: null,
        ok: false,
        message: token.message,
      });
      continue;
    }
    const resolved = resolveKillTarget(token.n, ports, pidExists);
    if (resolved === null) {
      if (token.fromRange) {
        outcomes.push({
          target: token.label,
          via: "empty",
          port: token.n <= 65535 ? token.n : null,
          pid: null,
          processName: null,
          signal: null,
          ok: true,
          message: `No listener on :${token.n}`,
        });
        continue;
      }
      const msg =
        token.n <= 65535
          ? `No listener on :${token.n} and no process with PID ${token.n}`
          : `No process with PID ${token.n}`;
      outcomes.push({
        target: token.label,
        via: "empty",
        port: token.n <= 65535 ? token.n : null,
        pid: null,
        processName: null,
        signal: null,
        ok: false,
        message: msg,
      });
      continue;
    }
    if (isProtectedPid(resolved.pid, selfPid, parentPid)) {
      outcomes.push({
        target: token.label,
        via: "protected",
        port: resolved.port,
        pid: resolved.pid,
        processName: resolved.processName,
        signal: null,
        ok: false,
        message: `Refusing to signal PID ${resolved.pid} (this process or init)`,
      });
      continue;
    }
    const blocked = killBlockedReason(resolved.row);
    if (blocked !== null) {
      outcomes.push({
        target: token.label,
        via: "blocked",
        port: resolved.port,
        pid: resolved.pid,
        processName: resolved.processName,
        signal: null,
        ok: false,
        message: blocked,
      });
      continue;
    }
    const label =
      resolved.via === "port"
        ? `:${resolved.port} ${resolved.processName ?? "unknown"} (PID ${resolved.pid})`
        : `PID ${resolved.pid}`;
    const ok = sendSignal(resolved.pid, signal);
    outcomes.push({
      target: token.label,
      via: resolved.via,
      port: resolved.port,
      pid: resolved.pid,
      processName: resolved.processName,
      signal,
      ok,
      message: ok ? `Sent ${signal} to ${label}` : `Failed to signal ${label}`,
    });
  }
  return outcomes;
}
