import { describe, expect, it } from "vitest";
import { lookupShareTarget } from "./ports.js";
import type { ListeningPort } from "./ports-types.js";

function port(partial: Partial<ListeningPort> & { port: number }): ListeningPort {
  return {
    pid: 1,
    processName: "node",
    command: "astro",
    cwd: null,
    projectName: "site",
    framework: "Astro",
    uptime: null,
    memory: null,
    status: "healthy",
    docker: false,
    ownedByPreview: false,
    shareUrl: null,
    listensOnIpv4: true,
    ...partial,
  };
}

describe("lookupShareTarget", () => {
  it("refuses a port that is not listening", () => {
    expect(lookupShareTarget([], 4321)).toEqual({
      ok: false,
      error: "Nothing is listening on :4321.",
    });
  });

  it("refuses IPv6-only listeners because Connect talks to 127.0.0.1", () => {
    const found = lookupShareTarget([port({ port: 4321, listensOnIpv4: false })], 4321);
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error).toMatch(/IPv6 only/);
  });

  it("returns the row when the process listens on IPv4", () => {
    const row = port({ port: 4321 });
    expect(lookupShareTarget([row], 4321)).toEqual({ ok: true, row });
  });

  it("refuses Docker-published ports", () => {
    const found = lookupShareTarget(
      [port({ port: 5432, processName: "docker", docker: true })],
      5432,
    );
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error).toMatch(/Docker/);
  });

  it("refuses system apps that are not preview-owned", () => {
    const found = lookupShareTarget(
      [port({ port: 22, processName: "sshd", command: "/usr/sbin/sshd" })],
      22,
    );
    expect(found.ok).toBe(false);
    if (found.ok) return;
    expect(found.error).toMatch(/system app/);
  });
});
