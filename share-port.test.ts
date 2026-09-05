import { afterEach, describe, expect, it } from "vitest";
import {
  attachShareUrls,
  isConnectShareUrl,
  listedShareUrls,
  mergeShareUrlMaps,
  parseConnectExposeJson,
  parseConnectSharesJson,
  rememberShareUrl,
  resetShareUrlCache,
  resolvePreviewShareUrl,
} from "./share-port.js";

afterEach(() => {
  resetShareUrlCache();
});

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

  it("rejects an https URL that is not a getbb.app share", () => {
    expect(() => parseConnectExposeJson(JSON.stringify({ url: "https://127.0.0.1:5173" }))).toThrow(
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
    expect(isConnectShareUrl("https://127.0.0.1:5173")).toBe(false);
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

describe("parseConnectSharesJson", () => {
  it("maps ports to share URLs", () => {
    const listed = parseConnectSharesJson(
      JSON.stringify({
        host: { id: "host_te8ta4cgrn" },
        shares: [
          { port: 4321, url: "https://hung--4321.getbb.app" },
          { hostId: "host_te8ta4cgrn", port: 5173, url: "https://hung--5173.getbb.app" },
        ],
      }),
    );
    expect(listed.hostId).toBe("host_te8ta4cgrn");
    expect(listed.urlsByPort.get(4321)).toBe("https://hung--4321.getbb.app");
    expect(listed.urlsByPort.get(5173)).toBe("https://hung--5173.getbb.app");
  });

  it("skips URLs that are not getbb.app shares", () => {
    const listed = parseConnectSharesJson(
      JSON.stringify({
        host: { id: "host_te8ta4cgrn" },
        shares: [
          { port: 5173, url: "https://127.0.0.1:5173" },
          { port: 4321, url: "https://hung--4321.getbb.app" },
        ],
      }),
    );
    expect(listed.urlsByPort.has(5173)).toBe(false);
    expect(listed.urlsByPort.get(4321)).toBe("https://hung--4321.getbb.app");
  });
});

describe("attachShareUrls", () => {
  it("copies known share URLs onto matching rows", () => {
    const ports = attachShareUrls(
      [
        {
          port: 4321,
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
          ownedByPreview: true,
          shareUrl: null,
          listensOnIpv4: true,
        },
      ],
      new Map([[4321, "https://hung--4321.getbb.app"]]),
    );
    expect(ports[0]?.shareUrl).toBe("https://hung--4321.getbb.app");
  });
});

describe("mergeShareUrlMaps", () => {
  it("lets Connect URLs overwrite preview SQLite URLs", () => {
    const merged = mergeShareUrlMaps(
      new Map([[4321, "https://old--4321.getbb.app"]]),
      new Map([[4321, "https://hung--4321.getbb.app"], [5173, "https://hung--5173.getbb.app"]]),
    );
    expect(merged.get(4321)).toBe("https://hung--4321.getbb.app");
    expect(merged.get(5173)).toBe("https://hung--5173.getbb.app");
  });
});

describe("listedShareUrls", () => {
  it("merges Connect shares over preview URLs and caches them", async () => {
    let calls = 0;
    const list = async () => {
      calls += 1;
      return {
        hostId: "host_1",
        urlsByPort: new Map([[4321, "https://hung--4321.getbb.app"]]),
      };
    };
    const preview = new Map([[5173, "https://hung--5173.getbb.app"]]);
    const first = await listedShareUrls(preview, list, 1_000);
    const second = await listedShareUrls(preview, list, 10_000);
    expect(calls).toBe(1);
    expect(first.get(4321)).toBe("https://hung--4321.getbb.app");
    expect(first.get(5173)).toBe("https://hung--5173.getbb.app");
    expect(second.get(4321)).toBe("https://hung--4321.getbb.app");
  });

  it("uses a URL stamped by rememberShareUrl without listing again", async () => {
    rememberShareUrl(4321, "https://hung--4321.getbb.app");
    let calls = 0;
    const urls = await listedShareUrls(new Map(), async () => {
      calls += 1;
      return { hostId: null, urlsByPort: new Map() };
    }, Date.now());
    expect(calls).toBe(0);
    expect(urls.get(4321)).toBe("https://hung--4321.getbb.app");
  });
});
