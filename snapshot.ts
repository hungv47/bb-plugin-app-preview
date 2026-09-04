import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { DirSnapshot } from "./detect.js";
import {
  joinHost,
  MARKER_FILES,
  SKIP_DIR_NAMES,
  relativeFromRoot,
  TEXT_MARKERS,
} from "./paths.js";

const MAX_DIRS = 32;

type DirListing = {
  name: string;
  kind: "file" | "directory";
  path: string;
};

async function listDir(
  bb: BbPluginApi,
  hostId: string,
  path: string,
): Promise<DirListing[]> {
  const listing = await bb.sdk.hosts.directory({ hostId, path });
  return listing.entries.map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    path: entry.path,
  }));
}

async function readIfPresent(
  bb: BbPluginApi,
  hostId: string,
  workspaceRoot: string,
  dirAbs: string,
  entries: DirListing[],
): Promise<{ contents: Record<string, string>; hasNodeModules: boolean }> {
  const names = new Set(entries.map((entry) => entry.name));
  const candidates = MARKER_FILES.filter((name) => names.has(name) && TEXT_MARKERS.has(name)).map(
    (name) => joinHost(dirAbs, name),
  );
  const nodeModulesPath = joinHost(dirAbs, "node_modules");
  const existence = await bb.sdk.hosts.pathsExist({
    hostId,
    paths: [...candidates, nodeModulesPath],
  });
  const contents: Record<string, string> = {};
  for (const abs of candidates) {
    if (existence.existence[abs] !== true) continue;
    try {
      const file = await bb.sdk.files.read({
        hostId,
        path: abs,
        rootPath: workspaceRoot,
      });
      if (file.contentEncoding === "utf8") {
        contents[relativeName(abs)] = file.content;
      }
    } catch {
      // Missing or unreadable marker; detection continues with the rest.
    }
  }
  return {
    contents,
    hasNodeModules: existence.existence[nodeModulesPath] === true,
  };
}

function relativeName(abs: string): string {
  const parts = abs.split(/[\\/]/);
  return parts[parts.length - 1] ?? abs;
}

async function snapshotDir(
  bb: BbPluginApi,
  hostId: string,
  workspaceRoot: string,
  dirAbs: string,
): Promise<DirSnapshot> {
  const entries = await listDir(bb, hostId, dirAbs);
  const { contents, hasNodeModules } = await readIfPresent(
    bb,
    hostId,
    workspaceRoot,
    dirAbs,
    entries,
  );
  return {
    relativeCwd: relativeFromRoot(workspaceRoot, dirAbs),
    entries: entries.map((entry) => ({ name: entry.name, kind: entry.kind })),
    contents,
    hasNodeModules,
  };
}

function looksLikeAppDir(entries: DirListing[]): boolean {
  const names = new Set(entries.map((entry) => entry.name));
  return (
    names.has("package.json") ||
    names.has("pyproject.toml") ||
    names.has("requirements.txt") ||
    names.has("manage.py") ||
    names.has("go.mod") ||
    names.has("Cargo.toml") ||
    names.has("Gemfile") ||
    names.has("composer.json") ||
    names.has("artisan") ||
    names.has("docker-compose.yml") ||
    names.has("docker-compose.yaml") ||
    names.has("compose.yaml") ||
    names.has("index.html")
  );
}

export async function collectSnapshots(
  bb: BbPluginApi,
  hostId: string,
  workspaceRoot: string,
): Promise<DirSnapshot[]> {
  const snapshots: DirSnapshot[] = [await snapshotDir(bb, hostId, workspaceRoot, workspaceRoot)];
  const rootEntries = await listDir(bb, hostId, workspaceRoot);

  async function consider(dirAbs: string): Promise<boolean> {
    if (snapshots.length >= MAX_DIRS) return false;
    const entries = await listDir(bb, hostId, dirAbs);
    if (!looksLikeAppDir(entries)) return false;
    snapshots.push(await snapshotDir(bb, hostId, workspaceRoot, dirAbs));
    return true;
  }

  for (const entry of rootEntries) {
    if (snapshots.length >= MAX_DIRS) break;
    if (entry.kind !== "directory") continue;
    if (SKIP_DIR_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;
    await consider(entry.path);
    const children = await listDir(bb, hostId, entry.path);
    for (const child of children) {
      if (snapshots.length >= MAX_DIRS) break;
      if (child.kind !== "directory") continue;
      if (SKIP_DIR_NAMES.has(child.name) || child.name.startsWith(".")) continue;
      const found = await consider(child.path);
      if (found) continue;
      const grandchildren = await listDir(bb, hostId, child.path);
      for (const grandchild of grandchildren) {
        if (snapshots.length >= MAX_DIRS) break;
        if (grandchild.kind !== "directory") continue;
        if (SKIP_DIR_NAMES.has(grandchild.name) || grandchild.name.startsWith(".")) continue;
        await consider(grandchild.path);
      }
    }
  }

  return snapshots;
}
