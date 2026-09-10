import { describe, expect, it } from "vitest";
import { formatMemory, formatUptime, parseLstartMs, visibleListeningPorts } from "./ports-format.js";

describe("formatUptime", () => {
  it("uses the largest useful unit", () => {
    expect(formatUptime(5_000)).toBe("5s");
    expect(formatUptime(90_000)).toBe("1m 30s");
    expect(formatUptime(3_600_000)).toBe("1h 0m");
    expect(formatUptime(90_000_000)).toBe("1d 1h");
  });
});

describe("formatMemory", () => {
  it("scales RSS kilobytes", () => {
    expect(formatMemory(512)).toBe("512 KB");
    expect(formatMemory(2048)).toBe("2.0 MB");
    expect(formatMemory(2_097_152)).toBe("2.0 GB");
  });
});

describe("parseLstartMs", () => {
  it("parses a ps lstart stamp", () => {
    const now = Date.parse("Sun Sep  6 00:20:00 2026");
    expect(parseLstartMs("Sep  6 00:10:00 2026", now)).toBe(Date.parse("Sep  6 00:10:00 2026"));
  });

  it("rejects a stamp in the future", () => {
    const now = Date.parse("Sun Sep  6 00:20:00 2026");
    expect(parseLstartMs("Sep  7 00:10:00 2026", now)).toBeNull();
  });
});

describe("visibleListeningPorts", () => {
  const row = (
    port: number,
    extra: Partial<{
      processName: string;
      projectName: string | null;
      framework: string | null;
      command: string;
      ownedByPreview: boolean;
      shareUrl: string | null;
    }> = {},
  ) => ({
    port,
    pid: port,
    processName: extra.processName ?? "node",
    projectName: extra.projectName ?? "app",
    framework: extra.framework ?? "Vite",
    command: extra.command ?? "npm run dev",
    status: "healthy",
    docker: false,
    ownedByPreview: extra.ownedByPreview ?? false,
    shareUrl: extra.shareUrl ?? null,
  });

  it("puts this preview, then shared ports, then the rest", () => {
    const visible = visibleListeningPorts(
      [
        row(5173),
        row(3000, { shareUrl: "https://hung--3000.getbb.app" }),
        row(4321, { ownedByPreview: true }),
      ],
      "",
    );
    expect(visible.map((item) => item.port)).toEqual([4321, 3000, 5173]);
  });

  it("filters by port, process, project, and preview", () => {
    const ports = [
      row(4321, { ownedByPreview: true, projectName: "hungv47-com", framework: "Astro" }),
      row(5173, { processName: "node", projectName: "vite-app" }),
    ];
    expect(visibleListeningPorts(ports, "4321").map((item) => item.port)).toEqual([4321]);
    expect(visibleListeningPorts(ports, "astro").map((item) => item.port)).toEqual([4321]);
    expect(visibleListeningPorts(ports, "preview").map((item) => item.port)).toEqual([4321]);
    expect(visibleListeningPorts(ports, "vite-app").map((item) => item.port)).toEqual([5173]);
    expect(visibleListeningPorts(ports, "nope")).toEqual([]);
  });
});
