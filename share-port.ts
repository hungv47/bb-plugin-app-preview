import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { shareUrlForPort } from "./ready.js";
import type { ListeningPort } from "./ports-types.js";

const execFileAsync = promisify(execFile);

const exposeResultSchema = z.object({
  url: z.string().startsWith("https://"),
});

const shareRowSchema = z.object({
  hostId: z.string().optional(),
  port: z.number().int(),
  url: z.string().startsWith("https://"),
});

const sharesListSchema = z.object({
  host: z.object({ id: z.string() }).optional(),
  shares: z.array(shareRowSchema),
});

export type SharedPortTunnel = { label: string; baseDomain: string };

export type ConnectShareList = {
  hostId: string | null;
  urlsByPort: Map<number, string>;
};

export function parseConnectExposeJson(stdout: string): string {
  const parsed = exposeResultSchema.safeParse(JSON.parse(stdout));
  if (!parsed.success || !isConnectShareUrl(parsed.data.url)) {
    throw new Error("bb connect expose did not return a share URL.");
  }
  return parsed.data.url;
}

export function shouldRefreshPreviewShare(status: string, shareUrl: string | null): boolean {
  return status === "starting" || (shareUrl !== null && isConnectShareUrl(shareUrl));
}

export function isConnectShareUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return hostname.endsWith(".getbb.app") && hostname.includes("--");
  } catch {
    return false;
  }
}

export function parseConnectSharesJson(stdout: string): ConnectShareList {
  const parsed = sharesListSchema.safeParse(JSON.parse(stdout));
  if (!parsed.success) {
    throw new Error("bb connect shares did not return a host and share list.");
  }
  const urlsByPort = new Map<number, string>();
  for (const share of parsed.data.shares) {
    if (!isConnectShareUrl(share.url)) continue;
    if (!urlsByPort.has(share.port)) urlsByPort.set(share.port, share.url);
  }
  return {
    hostId: parsed.data.host?.id ?? parsed.data.shares[0]?.hostId ?? null,
    urlsByPort,
  };
}

export function attachShareUrls(
  ports: readonly ListeningPort[],
  urlsByPort: ReadonlyMap<number, string>,
): ListeningPort[] {
  return ports.map((port) => {
    const shareUrl = urlsByPort.get(port.port) ?? null;
    if (shareUrl === port.shareUrl) return port;
    return { ...port, shareUrl };
  });
}

export function mergeShareUrlMaps(
  preview: ReadonlyMap<number, string>,
  connect: ReadonlyMap<number, string>,
): Map<number, string> {
  const urls = new Map(preview);
  for (const [port, url] of connect) {
    if (isConnectShareUrl(url)) urls.set(port, url);
  }
  return urls;
}

const SHARE_URL_TTL_MS = 20_000;

type ShareUrlCache = { at: number; urls: Map<number, string> };

let shareUrlCache: ShareUrlCache | null = null;

export function rememberShareUrl(port: number, url: string): void {
  if (!isConnectShareUrl(url)) return;
  if (shareUrlCache === null) shareUrlCache = { at: Date.now(), urls: new Map() };
  shareUrlCache.urls.set(port, url);
  shareUrlCache.at = Date.now();
}

export function forgetShareUrl(port: number): void {
  shareUrlCache?.urls.delete(port);
}

export function resetShareUrlCache(): void {
  shareUrlCache = null;
}

export async function listedShareUrls(
  preview: ReadonlyMap<number, string>,
  list: () => Promise<ConnectShareList> = listConnectShares,
  nowMs: number = Date.now(),
): Promise<Map<number, string>> {
  if (shareUrlCache !== null && nowMs - shareUrlCache.at < SHARE_URL_TTL_MS) {
    return mergeShareUrlMaps(preview, shareUrlCache.urls);
  }
  try {
    const listed = await list();
    shareUrlCache = { at: nowMs, urls: listed.urlsByPort };
    return mergeShareUrlMaps(preview, listed.urlsByPort);
  } catch {
    const stale = shareUrlCache?.urls ?? new Map<number, string>();
    return mergeShareUrlMaps(preview, stale);
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

function skipLiveConnect(): boolean {
  return process.env.VITEST === "true";
}

export async function listConnectShares(): Promise<ConnectShareList> {
  if (skipLiveConnect()) return { hostId: null, urlsByPort: new Map() };
  const { stdout } = await execFileAsync(bbBin(), ["connect", "shares", "--json"], {
    timeout: 10_000,
  });
  return parseConnectSharesJson(stdout);
}

export async function exposeConnectShare(hostId: string | null, port: number): Promise<string> {
  if (skipLiveConnect()) {
    throw new Error("bb connect expose is skipped in tests.");
  }
  const args = ["connect", "expose", String(port)];
  if (hostId !== null && hostId !== "") args.push("--host", hostId);
  args.push("--json");
  const { stdout } = await execFileAsync(bbBin(), args, { timeout: 15_000 });
  return parseConnectExposeJson(stdout);
}

export async function unexposeConnectShare(hostId: string | null, port: number): Promise<void> {
  if (skipLiveConnect()) return;
  const args = ["connect", "unexpose", String(port)];
  if (hostId !== null && hostId !== "") args.push("--host", hostId);
  await execFileAsync(bbBin(), args, { timeout: 15_000 });
}
