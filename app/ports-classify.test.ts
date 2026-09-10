import { describe, expect, it } from "vitest";
import {
  detectFrameworkFromCommand,
  detectFrameworkFromImage,
  findProjectRoot,
  isDevProcess,
  projectNameFromCwd,
} from "./ports-classify.js";

describe("isDevProcess", () => {
  it("keeps node and docker, drops Spotify and Control Center", () => {
    expect(isDevProcess("node", "node ./node_modules/.bin/astro dev")).toBe(true);
    expect(isDevProcess("docker", "")).toBe(true);
    expect(isDevProcess("Spotify", "/Applications/Spotify.app/Contents/MacOS/Spotify")).toBe(
      false,
    );
    expect(isDevProcess("ControlCe", "/System/Library/CoreServices/ControlCenter.app")).toBe(
      false,
    );
    expect(isDevProcess("bb", "/Applications/bb.app/Contents/MacOS/bb serve")).toBe(false);
  });

  it("treats a python process running uvicorn as a dev server", () => {
    expect(isDevProcess("python3", "python3 -m uvicorn app:app")).toBe(true);
  });
});

describe("framework detection", () => {
  it("reads Astro and Next from the command line", () => {
    expect(detectFrameworkFromCommand("node ./node_modules/.bin/astro dev --port 4321", "node")).toBe(
      "Astro",
    );
    expect(detectFrameworkFromCommand("next dev", "node")).toBe("Next.js");
    expect(detectFrameworkFromCommand("node server.js", "node")).toBe("Node.js");
  });

  it("reads database images", () => {
    expect(detectFrameworkFromImage("postgres:16")).toBe("PostgreSQL");
    expect(detectFrameworkFromImage("redis:7")).toBe("Redis");
    expect(detectFrameworkFromImage("nginx:alpine")).toBe("nginx");
  });
});

describe("findProjectRoot", () => {
  it("walks up to the directory that has package.json", () => {
    const exists = (path: string) => path === "/repo/app/package.json";
    expect(findProjectRoot("/repo/app/src", exists)).toBe("/repo/app");
  });

  it("returns the original directory when nothing matches", () => {
    expect(findProjectRoot("/tmp/scratch", () => false)).toBe("/tmp/scratch");
  });
});

describe("projectNameFromCwd", () => {
  it("uses the last path segment", () => {
    expect(projectNameFromCwd("/Users/hung/ipse/forsvn/app-preview/app")).toBe("app");
  });

  it("returns null for the filesystem root", () => {
    expect(projectNameFromCwd("/")).toBeNull();
  });
});
