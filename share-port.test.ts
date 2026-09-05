import { describe, expect, it } from "vitest";
import {
  isConnectShareUrl,
  parseConnectExposeJson,
  resolvePreviewShareUrl,
} from "./share-port.js";

describe("parseConnectExposeJson", () => {
  it("reads the share URL from bb connect expose --json", () => {
    expect(
      parseConnectExposeJson(
        JSON.stringify({
          hostId: "host_te8ta4cgrn",
          port: 18768,
          url: "https://hung--18768.getbb.app",
        }),
      ),
    ).toBe("https://hung--18768.getbb.app");
  });

  it("rejects a payload without an https URL", () => {
    expect(() => parseConnectExposeJson(JSON.stringify({ url: "http://127.0.0.1:5173" }))).toThrow(
      /share URL/,
    );
  });
});

describe("isConnectShareUrl", () => {
  it("accepts a getbb.app share", () => {
    expect(isConnectShareUrl("https://hung--18768.getbb.app")).toBe(true);
  });

  it("rejects localhost", () => {
    expect(isConnectShareUrl("http://127.0.0.1:18768/")).toBe(false);
  });
});

describe("resolvePreviewShareUrl", () => {
  it("uses the enrolled-machine tunnel when it exists", async () => {
    const url = await resolvePreviewShareUrl(
      "host_1",
      5173,
      async () => ({ label: "hung-mac", baseDomain: "getbb.app" }),
      async () => {
        throw new Error("expose should not run");
      },
    );
    expect(url).toBe("https://hung-mac--5173.getbb.app");
  });

  it("falls back to bb connect expose when the host has no machine credential", async () => {
    const url = await resolvePreviewShareUrl(
      "host_te8ta4cgrn",
      18768,
      async () => {
        throw new Error(
          'cannot share ports from host "Hung’s MacBook Air" (host_te8ta4cgrn) because it has no bb connect machine credential; enroll it via Connect in Settings > Machines',
        );
      },
      async () => "https://hung--18768.getbb.app",
    );
    expect(url).toBe("https://hung--18768.getbb.app");
  });

  it("returns null when both the tunnel and expose fail", async () => {
    const url = await resolvePreviewShareUrl(
      "host_1",
      5173,
      async () => {
        throw new Error("unenrolled");
      },
      async () => {
        throw new Error("not paired");
      },
    );
    expect(url).toBeNull();
  });
});
