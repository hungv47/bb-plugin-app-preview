import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { shareUrlForPort } from "./ready.js";

const execFileAsync = promisify(execFile);

const exposeResultSchema = z.object({
  url: z.string().startsWith("https://"),
});

export type SharedPortTunnel = { label: string; baseDomain: string };

export function parseConnectExposeJson(stdout: string): string {
  const parsed = exposeResultSchema.safeParse(JSON.parse(stdout));
  if (!parsed.success) {
    throw new Error("bb connect expose did not return a share URL.");
  }
  return parsed.data.url;
}

export function isConnectShareUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".getbb.app") && hostname.includes("--");
  } catch {
    return false;
  }
}

export async function resolvePreviewShareUrl(
  hostId: string,
  port: number,
  ensureTunnel: (id: string) => Promise<SharedPortTunnel>,
  expose: (id: string, sharePort: number) => Promise<string>,
): Promise<string | null> {
  try {
    return shareUrlForPort(await ensureTunnel(hostId), port);
  } catch {
    try {
      return await expose(hostId, port);
    } catch {
      return null;
    }
  }
}

function bbBin(): string {
  const fromEnv = process.env.BB_CLI;
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : "bb";
}

export async function exposeConnectShare(hostId: string, port: number): Promise<string> {
  const { stdout } = await execFileAsync(
    bbBin(),
    ["connect", "expose", String(port), "--host", hostId, "--json"],
    { timeout: 15_000 },
  );
  return parseConnectExposeJson(stdout);
}

export async function unexposeConnectShare(hostId: string, port: number): Promise<void> {
  await execFileAsync(bbBin(), ["connect", "unexpose", String(port), "--host", hostId], {
    timeout: 15_000,
  });
}
