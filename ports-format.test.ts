import { describe, expect, it } from "vitest";
import { formatMemory, formatUptime, parseLstartMs } from "./ports-format.js";

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
