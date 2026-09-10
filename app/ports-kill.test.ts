import { describe, expect, it } from "vitest";
import { applyKill, parseKillTokens, resolveKillTarget } from "./ports-kill.js";
import type { ListeningPort } from "./ports-types.js";

function port(partial: Partial<ListeningPort> & { port: number; pid: number }): ListeningPort {
  return {
    processName: "node",
    command: "node server.js",
    cwd: null,
    projectName: "app",
    framework: "Node.js",
    uptime: "1m",
    memory: "10 MB",
    status: "healthy",
    docker: false,
    ownedByPreview: false,
    shareUrl: null,
    listensOnIpv4: true,
    ...partial,
  };
}

describe("parseKillTokens", () => {
  it("expands a port range and keeps singles", () => {
    const tokens = parseKillTokens(["3000", "3002-3004"]);
    expect(tokens).toEqual([
      { kind: "value", n: 3000, fromRange: false, label: "3000" },
      { kind: "value", n: 3002, fromRange: true, label: "3002" },
      { kind: "value", n: 3003, fromRange: true, label: "3003" },
      { kind: "value", n: 3004, fromRange: true, label: "3004" },
    ]);
  });

  it("rejects inverted, oversized, and non-numeric tokens", () => {
    expect(parseKillTokens(["3005-3000"])[0]).toMatchObject({ kind: "error" });
    expect(parseKillTokens(["1-2000"])[0]).toMatchObject({ kind: "error" });
    expect(parseKillTokens(["1-1001"])[0]).toMatchObject({ kind: "error" });
    expect(parseKillTokens(["1-1000"])).toHaveLength(1000);
    expect(parseKillTokens(["nope"])[0]).toMatchObject({ kind: "error" });
  });

  it("caps the total expanded ports, not only one range", () => {
    const tokens = parseKillTokens(["1-500", "501-1001"]);
    expect(tokens.filter((token) => token.kind === "value")).toHaveLength(500);
    expect(tokens.some((token) => token.kind === "error")).toBe(true);
    expect(parseKillTokens(["1-1000", "1001"]).some((token) => token.kind === "error")).toBe(true);
  });
});

describe("resolveKillTarget", () => {
  const ports = [port({ port: 3000, pid: 42872, processName: "node" })];

  it("prefers a listener when the number is a port", () => {
    expect(resolveKillTarget(3000, ports)).toEqual({
      pid: 42872,
      via: "port",
      port: 3000,
      processName: "node",
      row: ports[0],
    });
  });

  it("does not kill a PID that is not listening", () => {
    expect(resolveKillTarget(99999, ports)).toBeNull();
  });
});

describe("applyKill", () => {
  it("signals the listener and skips empty range slots", () => {
    const sent: Array<{ pid: number; signal: string }> = [];
    const outcomes = applyKill(
      parseKillTokens(["3000-3002"]),
      [port({ port: 3000, pid: 42872 })],
      false,
      (pid, signal) => {
        sent.push({ pid, signal });
        return true;
      },
      1,
      0,
    );
    expect(sent).toEqual([{ pid: 42872, signal: "SIGTERM" }]);
    expect(outcomes.filter((row) => row.via === "empty")).toHaveLength(2);
    expect(outcomes.find((row) => row.port === 3000)?.ok).toBe(true);
  });

  it("refuses to signal this process", () => {
    const outcomes = applyKill(
      parseKillTokens(["3000"]),
      [port({ port: 3000, pid: 42 })],
      true,
      () => true,
      42,
      1,
    );
    expect(outcomes[0]?.via).toBe("protected");
    expect(outcomes[0]?.ok).toBe(false);
  });

  it("refuses Docker-published ports", () => {
    const sent: number[] = [];
    const outcomes = applyKill(
      parseKillTokens(["5432"]),
      [port({ port: 5432, pid: 58351, processName: "docker", docker: true })],
      false,
      (pid) => {
        sent.push(pid);
        return true;
      },
      1,
      0,
    );
    expect(sent).toEqual([]);
    expect(outcomes[0]?.via).toBe("blocked");
    expect(outcomes[0]?.message).toMatch(/Docker/);
  });

  it("refuses system apps that are not preview-owned", () => {
    const sent: number[] = [];
    const outcomes = applyKill(
      parseKillTokens(["22"]),
      [port({ port: 22, pid: 10, processName: "sshd", command: "/usr/sbin/sshd" })],
      false,
      (pid) => {
        sent.push(pid);
        return true;
      },
      1,
      0,
    );
    expect(sent).toEqual([]);
    expect(outcomes[0]?.via).toBe("blocked");
    expect(outcomes[0]?.message).toMatch(/system app/);
  });

  it("does not signal a PID that is not a listener", () => {
    const sent: number[] = [];
    const outcomes = applyKill(
      parseKillTokens(["99999"]),
      [port({ port: 3000, pid: 42872 })],
      false,
      (pid) => {
        sent.push(pid);
        return true;
      },
      1,
      0,
    );
    expect(sent).toEqual([]);
    expect(outcomes[0]?.ok).toBe(false);
    expect(outcomes[0]?.message).toMatch(/PID 99999/);
  });
});
