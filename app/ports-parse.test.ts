import { describe, expect, it } from "vitest";
import { parseDockerPs, parseLsofCwd, parseLsofListen, parsePs, parseSsListen } from "./ports-parse.js";

const LSOF = `COMMAND     PID    USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
ControlCe   635 hungv47    9u  IPv4 0x8e374fbf50fbabf5      0t0  TCP *:7000 (LISTEN)
ControlCe   635 hungv47   10u  IPv6  0xd9267b68de62e22      0t0  TCP *:7000 (LISTEN)
Spotify     892 hungv47   52u  IPv4 0x44d3b9bf2d7cc8e9      0t0  TCP *:63466 (LISTEN)
Spotify     892 hungv47  116u  IPv4 0xfbdb2820b663da4a      0t0  TCP 127.0.0.1:7768 (LISTEN)
node        942 hungv47  143u  IPv4 0xf31ea78adde09ddf      0t0  TCP 127.0.0.1:7265 (LISTEN)
node       3900 hungv47   35u  IPv6 0x85ac90493aac3ce7      0t0  TCP [::1]:4321 (LISTEN)
bb         8619 hungv47   29u  IPv4 0xeae3957cd51f3152      0t0  TCP 127.0.0.1:38886 (LISTEN)
`;

const PS = `  635     1 S     38672 Fri Sep  4 11:15:08 2026     /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter
  892     1 S     81840 Fri Sep  4 11:15:20 2026     /Applications/Spotify.app/Contents/MacOS/Spotify --autostart
  942   873 S    203872 Fri Sep  4 11:15:21 2026     Raycast Backend
 3900  8619 S     12000 Sun Sep  6 00:10:00 2026     node ./node_modules/.bin/astro dev --port 4321
 8619     1 Ss    75376 Sun Sep  6 00:11:12 2026     /Applications/bb.app/Contents/MacOS/bb serve
`;

describe("parseLsofListen", () => {
  it("reads unique TCP listen ports from macOS lsof", () => {
    const entries = parseLsofListen(LSOF);
    expect(entries).toEqual([
      { port: 7000, pid: 635, processName: "ControlCe", listensOnIpv4: true },
      { port: 63466, pid: 892, processName: "Spotify", listensOnIpv4: true },
      { port: 7768, pid: 892, processName: "Spotify", listensOnIpv4: true },
      { port: 7265, pid: 942, processName: "node", listensOnIpv4: true },
      { port: 4321, pid: 3900, processName: "node", listensOnIpv4: false },
      { port: 38886, pid: 8619, processName: "bb", listensOnIpv4: true },
    ]);
  });

  it("returns nothing for empty output", () => {
    expect(parseLsofListen("")).toEqual([]);
  });
});

describe("parsePs", () => {
  it("reads pid, parent, rss, start, and command", () => {
    const map = parsePs(PS);
    expect(map.get(3900)).toMatchObject({
      ppid: 8619,
      stat: "S",
      rss: 12000,
      command: "node ./node_modules/.bin/astro dev --port 4321",
    });
    expect(map.get(635)?.ppid).toBe(1);
  });
});

describe("parseLsofCwd", () => {
  it("maps pid to an absolute cwd", () => {
    const raw = `COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
node    3900 hung   cwd    DIR    1,4      640    1 /Users/hung/ipse/forsvn/app-preview/app
`;
    expect(parseLsofCwd(raw).get(3900)).toBe("/Users/hung/ipse/forsvn/app-preview/app");
  });
});

describe("parseSsListen", () => {
  it("reads pid from the users field", () => {
    const raw = `State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
LISTEN 0      511          0.0.0.0:3000       0.0.0.0:*    users:(("node",pid=42872,fd=23))
LISTEN 0      128               *:5432          *:*    users:(("docker-proxy",pid=58351,fd=8))
`;
    expect(parseSsListen(raw)).toEqual([
      { port: 3000, pid: 42872, processName: "node", listensOnIpv4: true },
      { port: 5432, pid: 58351, processName: "docker-proxy", listensOnIpv4: true },
    ]);
  });
});

describe("parseDockerPs", () => {
  it("maps published host ports to container name and image", () => {
    const raw =
      "0.0.0.0:5432->5432/tcp, [::]:5432->5432/tcp\tbackend-postgres-1\tpostgres:16\n127.0.0.1:6379->6379/tcp\tbackend-redis-1\tredis:7\n";
    const map = parseDockerPs(raw);
    expect(map.get(5432)).toEqual({ name: "backend-postgres-1", image: "postgres:16" });
    expect(map.get(6379)).toEqual({ name: "backend-redis-1", image: "redis:7" });
  });
});
