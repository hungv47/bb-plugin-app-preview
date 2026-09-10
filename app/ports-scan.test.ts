import { describe, expect, it } from "vitest";
import { assembleListeningPorts } from "./ports-scan.js";
import type { ListenSnapshot } from "./ports-types.js";

const NOW = Date.parse("Sun Sep  6 00:20:00 2026");

function snapshot(): ListenSnapshot {
  return {
    entries: [
      { port: 7000, pid: 635, processName: "ControlCe", listensOnIpv4: true },
      { port: 4321, pid: 3900, processName: "node", listensOnIpv4: false },
      { port: 5432, pid: 58351, processName: "com.docker", listensOnIpv4: true },
      { port: 3000, pid: 99, processName: "node", listensOnIpv4: true },
    ],
    processes: new Map([
      [
        635,
        {
          ppid: 1,
          stat: "S",
          rss: 38672,
          lstart: "Sep  4 11:15:08 2026",
          command: "/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter",
        },
      ],
      [
        3900,
        {
          ppid: 8619,
          stat: "S",
          rss: 12000,
          lstart: "Sep  6 00:10:00 2026",
          command: "node ./node_modules/.bin/astro dev --port 4321",
        },
      ],
      [
        99,
        {
          ppid: 1,
          stat: "S",
          rss: 8000,
          lstart: "Sep  6 00:00:00 2026",
          command: "node server.js",
        },
      ],
      [
        58351,
        {
          ppid: 1,
          stat: "S",
          rss: 1000,
          lstart: "Sep  1 00:00:00 2026",
          command: "com.docker.backend",
        },
      ],
    ]),
    cwds: new Map([[3900, "/repo/app/src"]]),
    docker: new Map([[5432, { name: "backend-postgres-1", image: "postgres:16" }]]),
  };
}

describe("assembleListeningPorts", () => {
  it("hides system apps unless showAll is set", () => {
    const exists = (path: string) => path === "/repo/app/package.json";
    const previewPorts = new Set([4321]);
    const filtered = assembleListeningPorts(snapshot(), false, previewPorts, NOW, exists);
    const ports = filtered.map((row) => row.port);
    expect(ports).toContain(4321);
    expect(ports).toContain(5432);
    expect(ports).toContain(3000);
    expect(ports).not.toContain(7000);

    const astro = filtered.find((row) => row.port === 4321);
    expect(astro?.framework).toBe("Astro");
    expect(astro?.projectName).toBe("app");
    expect(astro?.ownedByPreview).toBe(true);
    expect(astro?.status).toBe("healthy");
    expect(astro?.listensOnIpv4).toBe(false);

    const orphan = filtered.find((row) => row.port === 3000);
    expect(orphan?.status).toBe("orphaned");

    const docker = filtered.find((row) => row.port === 5432);
    expect(docker?.processName).toBe("docker");
    expect(docker?.framework).toBe("PostgreSQL");
    expect(docker?.projectName).toBe("backend-postgres-1");

    const all = assembleListeningPorts(snapshot(), true, previewPorts, NOW, exists);
    expect(all.map((row) => row.port)).toContain(7000);
  });
});
