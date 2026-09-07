const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function decodeTerminalChunks(
  chunks: ReadonlyArray<{ dataBase64: string }>,
): string {
  const text = chunks
    .map((chunk) => Buffer.from(chunk.dataBase64, "base64").toString("utf8"))
    .join("");
  return stripAnsi(text);
}

const URL_RE =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|[a-zA-Z0-9.-]+)(?::(\d{2,5}))?(?:\/[^\s"'<>]*)?/gi;

export type ReadyHint = {
  localUrl: string;
  port: number;
};

function rewriteLoopback(raw: string): string {
  return raw
    .replace(/^https?:\/\/0\.0\.0\.0/i, (match) =>
      match.toLowerCase().startsWith("https") ? "https://127.0.0.1" : "http://127.0.0.1",
    )
    .replace(/^https?:\/\/\[::1?\]/i, (match) =>
      match.toLowerCase().startsWith("https") ? "https://127.0.0.1" : "http://127.0.0.1",
    );
}

function isLoopbackUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "[::1]" ||
      host === "::1" ||
      host === "[::]" ||
      host === "::"
    );
  } catch {
    return false;
  }
}

function hostRank(url: string): number {
  if (/localhost|127\.0\.0\.1/i.test(url)) return 3;
  if (/0\.0\.0\.0|\[::1?\]/i.test(url)) return 2;
  return 0;
}

function lineAround(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index - 1) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

/** Higher is better: Local > UI > bare > API-ish. */
function lineKindScore(line: string): number {
  if (/\bLocal:/i.test(line)) return 300_000;
  if (/\bUI\s*(?:→|:)/i.test(line)) return 200_000;
  if (/\bAPI\s*(?:→|:)/i.test(line) || /Serving HTTP/i.test(line) || /\bUvicorn\b/i.test(line)) {
    return 0;
  }
  return 100_000;
}

function candidateScore(
  raw: string,
  port: number,
  fallbackPort: number | null,
  line: string,
): number {
  const fallbackBonus = fallbackPort !== null && port === fallbackPort ? 1_000_000 : 0;
  return fallbackBonus + lineKindScore(line) + hostRank(raw);
}

export function parseReadyHint(logText: string, fallbackPort: number | null): ReadyHint | null {
  const text = stripAnsi(logText);
  const matches = [...text.matchAll(URL_RE)];
  const ranked = matches
    .map((match, index) => {
      const raw = match[0]?.replace(/[),.;]+$/, "") ?? "";
      const portText = match[1];
      const port = portText !== undefined ? Number(portText) : fallbackPort;
      if (raw === "" || port === null || !Number.isInteger(port) || port < 1 || port > 65535) {
        return null;
      }
      if (!isLoopbackUrl(raw)) return null;
      const localUrl = rewriteLoopback(raw.replace(/0\.0\.0\.0/gi, "127.0.0.1"));
      const line = lineAround(text, match.index ?? 0);
      return {
        localUrl,
        port,
        score: candidateScore(raw, port, fallbackPort, line),
        index,
      };
    })
    .filter(
      (item): item is { localUrl: string; port: number; score: number; index: number } =>
        item !== null,
    )
    .sort((a, b) => b.score - a.score || b.index - a.index);
  if (ranked[0] !== undefined) {
    return { localUrl: ranked[0].localUrl, port: ranked[0].port };
  }
  if (fallbackPort !== null) {
    const readyish =
      /\b(ready|listening|local:|running at|serving http)\b/i.test(text) &&
      new RegExp(
        `(?:localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\[::1?\\]|port)\\D{0,12}${fallbackPort}\\b`,
        "i",
      ).test(text);
    if (readyish) {
      return { localUrl: `http://127.0.0.1:${fallbackPort}`, port: fallbackPort };
    }
  }
  return null;
}

export function shareUrlForPort(
  tunnel: { label: string; baseDomain: string },
  port: number,
): string {
  return `https://${tunnel.label}--${port}.${tunnel.baseDomain}`;
}

export function tailText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}
