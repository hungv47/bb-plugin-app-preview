import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PORTS_CHANGED, rpcContract } from "./contract.js";
import { formatKillOutcomes, formatPortsTable } from "./ports.js";
import { createPortsActions } from "./ports-actions.js";
import {
  OPEN_PREVIEW_MANUAL,
  OPEN_PREVIEW_OPTIONS,
  isAgentOpenPreview,
  openPreviewAgentInstructions,
} from "./open-mode.js";
import { createPreviewService, sleep, type InspectResult } from "./service.js";
import { environmentPreviewBlocker } from "./workspace-error.js";

function parseTimeoutMs(raw: string): number {
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds)) return 90_000;
  return Math.min(600, Math.max(15, seconds)) * 1000;
}

function wantsJson(argv: string[]): boolean {
  return argv.includes("--json");
}

function takeFlag(argv: string[], name: string): { value?: string; rest: string[] } {
  const rest: string[] = [];
  let value: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === name) {
      value = argv[i + 1];
      i += 1;
      continue;
    }
    if (token?.startsWith(`${name}=`)) {
      value = token.slice(name.length + 1);
      continue;
    }
    rest.push(token ?? "");
  }
  return { value, rest };
}

function takeNumberFlag(argv: string[], name: string): { value?: number; rest: string[] } {
  const taken = takeFlag(argv, name);
  if (taken.value === undefined || taken.value === "") return { rest: taken.rest };
  const parsed = Number(taken.value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer port between 1 and 65535.`);
  }
  return { value: parsed, rest: taken.rest };
}

function formatInspect(result: InspectResult): string {
  if (result.error !== null && result.workspace === null) return result.error;
  const lines: string[] = [];
  if (result.workspace !== null) {
    lines.push(`Workspace: ${result.workspace.path}`);
    if (result.workspace.branch !== null) lines.push(`Branch: ${result.workspace.branch}`);
    if (result.workspace.isWorktree) lines.push("Kind: worktree");
    if (environmentPreviewBlocker(result.workspace.environmentStatus) !== null) {
      lines.push(`Workspace status: ${result.workspace.environmentStatus}`);
    }
  }
  if (result.detection !== null) {
    if (!result.detection.found) {
      lines.push("No startable app detected in this worktree.");
    } else {
      lines.push(
        `App: ${result.detection.frameworkLabel ?? result.detection.framework ?? "unknown"}`,
      );
      if (result.detection.packageManager !== null) {
        lines.push(`Package manager: ${result.detection.packageManager}`);
      }
      if (result.detection.command !== null) lines.push(`Command: ${result.detection.command}`);
      if (result.detection.port !== null) lines.push(`Port: ${result.detection.port}`);
      if (result.detection.relativeCwd !== ".") {
        lines.push(`Directory: ${result.detection.relativeCwd}`);
      }
      if (result.detection.dependencies.length > 0) {
        lines.push(`Dependencies: ${result.detection.dependencies.join(", ")}`);
      }
      for (const note of result.detection.notes) lines.push(`Note: ${note}`);
    }
  }
  if (result.candidates.length > 1) {
    lines.push("Apps in this worktree:");
    for (const candidate of result.candidates) {
      const mark = candidate.relativeCwd === result.detection?.relativeCwd ? "*" : "-";
      lines.push(
        `${mark} ${candidate.relativeCwd}: ${candidate.frameworkLabel ?? candidate.framework ?? "app"} (${candidate.command ?? "no command"})`,
      );
    }
  }
  if (result.preview !== null) {
    lines.push(`Status: ${result.preview.status}`);
    if (result.preview.openUrl !== null && result.preview.status === "running") {
      lines.push(`Open: ${result.preview.openUrl}`);
    }
    if (result.preview.error !== null) lines.push(`Preview: ${result.preview.error}`);
  }
  if (result.error !== null) lines.push(result.error);
  return lines.join("\n");
}

const USAGE = [
  "Usage:",
  "  bb preview detect [--thread <id>] [--json]",
  "  bb preview start [--thread <id>] [--command <cmd>] [--cwd <dir>] [--port <n>] [--json]",
  "  bb preview stop [--thread <id>] [--json]",
  "  bb preview restart [--thread <id>] [--command <cmd>] [--cwd <dir>] [--port <n>] [--json]",
  "  bb preview status [--thread <id>] [--json]",
  "  bb preview ports [--all] [--json]",
  "  bb preview share <port> [--json]",
  "  bb preview unshare <port> [--json]",
  "  bb preview kill [--force] <port|pid|range> [port|pid|range...]",
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    autoInstall: {
      type: "boolean",
      label: "Install dependencies before start",
      default: true,
    },
    openPreview: {
      type: "select",
      label: "Open the in-app browser",
      options: [...OPEN_PREVIEW_OPTIONS],
      description:
        "manual: start leaves the tab alone. Use Open in browser. agent: after start, the in-app browser opens once the app is ready, and stop closes it. Agents follow this setting.",
      default: OPEN_PREVIEW_MANUAL,
    },
    readyTimeoutSeconds: {
      type: "string",
      label: "Seconds to wait for a ready URL",
      default: "90",
    },
  });
  const values = await settings.get();
  let openPreview = values.openPreview;
  const serviceSettings = {
    autoInstall: values.autoInstall,
    readyTimeoutMs: parseTimeoutMs(values.readyTimeoutSeconds),
    autoOpenBrowser: isAgentOpenPreview(openPreview),
  };
  const service = createPreviewService(bb, serviceSettings);
  settings.onChange((next) => {
    openPreview = next.openPreview;
    serviceSettings.autoInstall = next.autoInstall;
    serviceSettings.readyTimeoutMs = parseTimeoutMs(next.readyTimeoutSeconds);
    serviceSettings.autoOpenBrowser = isAgentOpenPreview(next.openPreview);
  });

  const ports = createPortsActions(service.db, () => {
    bb.realtime.publish(PORTS_CHANGED, { at: Date.now() });
  });

  bb.rpc.register(rpcContract, {
    inspect: ({ threadId }) => service.inspect(threadId),
    start: ({ threadId, command, port, relativeCwd }) =>
      service.start(threadId, { command, port, relativeCwd }),
    stop: ({ threadId }) => service.stop(threadId),
    restart: ({ threadId, command, port, relativeCwd }) =>
      service.restart(threadId, { command, port, relativeCwd }),
    listPorts: ({ all }) => ports.listPorts(all === true),
    killPorts: ({ targets, force }) => ports.killPorts(targets, force === true),
    sharePort: ({ port }) => ports.sharePort(port),
    unsharePort: ({ port }) => ports.unsharePort(port),
  });

  bb.cli.register({
    name: "preview",
    summary: "Detect, start, and stop the app in a thread worktree, or list, share, and kill listening ports",
    commands: [
      {
        name: "detect",
        summary: "Identify the framework, package manager, and start command",
        usage: "bb preview detect [--thread <id>] [--json]",
      },
      {
        name: "start",
        summary: "Launch the detected app in a thread terminal",
        usage: "bb preview start [--thread <id>] [--command <cmd>] [--cwd <dir>] [--port <n>] [--json]",
      },
      {
        name: "stop",
        summary: "Stop the running preview for this worktree",
        usage: "bb preview stop [--thread <id>] [--json]",
      },
      {
        name: "restart",
        summary: "Stop then start the preview",
        usage: "bb preview restart [--thread <id>] [--command <cmd>] [--cwd <dir>] [--port <n>] [--json]",
      },
      {
        name: "status",
        summary: "Show detection and whether the app is running",
        usage: "bb preview status [--thread <id>] [--json]",
      },
      {
        name: "ports",
        summary: "List listening TCP ports on this machine (dev servers by default)",
        usage: "bb preview ports [--all] [--json]",
      },
      {
        name: "share",
        summary: "Expose a listening port over bb connect for phone/remote preview",
        usage: "bb preview share <port> [--json]",
      },
      {
        name: "unshare",
        summary: "Remove a bb connect share for a port",
        usage: "bb preview unshare <port> [--json]",
      },
      {
        name: "kill",
        summary: "Kill a listener by port or PID (range 3000-3010; --force for SIGKILL)",
        usage: "bb preview kill [--force] <port|pid|range> [port|pid|range...]",
      },
    ],
    async run(argv, ctx) {
      const json = wantsJson(argv);
      const withoutJson = argv.filter((arg) => arg !== "--json");
      try {
        const [head, ...raw] = withoutJson;
        if (head === "ports") {
          const showAll = raw.includes("--all") || raw.includes("-a");
          const leftover = raw.filter((arg) => arg !== "--all" && arg !== "-a");
          if (leftover.length > 0) return { exitCode: 1, stderr: USAGE };
          const listed = await ports.listPorts(showAll);
          if (listed.error !== null) return { exitCode: 1, stderr: listed.error };
          return {
            exitCode: 0,
            stdout: json ? JSON.stringify(listed) : formatPortsTable(listed.ports),
          };
        }
        if (head === "share" || head === "unshare") {
          const port = Number.parseInt(raw[0] ?? "", 10);
          if (raw.length !== 1 || !Number.isInteger(port) || port < 1 || port > 65535) {
            return { exitCode: 1, stderr: `Usage: bb preview ${head} <port>` };
          }
          const shared = head === "share" ? await ports.sharePort(port) : await ports.unsharePort(port);
          if (shared.error !== null) return { exitCode: 1, stderr: shared.error };
          if (json) return { exitCode: 0, stdout: JSON.stringify(shared) };
          return {
            exitCode: 0,
            stdout: head === "share" ? (shared.url ?? "Shared.") : `Unshared :${port}`,
          };
        }
        if (head === "kill") {
          const force = raw.includes("--force") || raw.includes("-f");
          const targets = raw.filter((arg) => arg !== "--force" && arg !== "-f");
          if (targets.length === 0) {
            return { exitCode: 1, stderr: "Usage: bb preview kill [--force] <port|pid|range> [...]" };
          }
          const killed = await ports.killPorts(targets, force);
          if (killed.error !== null) return { exitCode: 1, stderr: killed.error };
          const failed = killed.outcomes.some((outcome) => !outcome.ok);
          return {
            exitCode: failed ? 1 : 0,
            stdout: json ? JSON.stringify(killed) : formatKillOutcomes(killed.outcomes),
          };
        }
        const threadTaken = takeFlag(withoutJson, "--thread");
        const commandTaken = takeFlag(threadTaken.rest, "--command");
        const cwdTaken = takeFlag(commandTaken.rest, "--cwd");
        const portTaken = takeNumberFlag(cwdTaken.rest, "--port");
        const [command, ...rest] = portTaken.rest;
        if (rest.length > 0) {
          return { exitCode: 1, stderr: USAGE };
        }
        const threadId = threadTaken.value ?? ctx.threadId;
        if (threadId === undefined || threadId === "") {
          return {
            exitCode: 1,
            stderr: "Pass --thread <id> or run this from a BB session.",
          };
        }
        const reply = (result: InspectResult) => ({
          exitCode: result.error !== null ? 1 : 0,
          stdout: json ? JSON.stringify(result) : formatInspect(result),
        });
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: USAGE };
          case "detect":
          case "status":
            return reply(await service.inspect(threadId));
          case "start":
            return reply(
              await service.start(threadId, {
                command: commandTaken.value,
                port: portTaken.value,
                relativeCwd: cwdTaken.value,
              }),
            );
          case "stop":
            return reply(await service.stop(threadId));
          case "restart":
            return reply(
              await service.restart(threadId, {
                command: commandTaken.value,
                port: portTaken.value,
                relativeCwd: cwdTaken.value,
              }),
            );
          default:
            return { exitCode: 1, stderr: USAGE };
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        return { exitCode: 1, stderr: message };
      }
    },
  });

  bb.agents.registerTool({
    name: "preview_app",
    description:
      "Detect, start, stop, or inspect the web app in this thread's worktree so the user can try it from the session.",
    instructions:
      "Use preview_app to run this thread's worktree app. Prefer it over guessing package.json scripts or running bb preview. Start detects. Give the user the Open URL. Follow the live App Preview open-mode line for whether to start.",
    presentation: {
      label: {
        pending: "Checking worktree preview",
        completed: "Checked worktree preview",
      },
    },
    parameters: z.object({
      action: z.enum(["detect", "start", "stop", "restart", "status"]),
      command: z.string().min(1).max(500).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      relativeCwd: z.string().min(1).max(240).optional(),
    }),
    async execute({ action, command, port, relativeCwd }, { threadId }) {
      if (threadId === undefined || threadId === "") {
        return { content: [{ type: "text", text: "No thread is attached to this tool call." }], isError: true };
      }
      const result =
        action === "start"
          ? await service.start(threadId, { command, port, relativeCwd })
          : action === "stop"
            ? await service.stop(threadId)
            : action === "restart"
              ? await service.restart(threadId, { command, port, relativeCwd })
              : await service.inspect(threadId);
      return {
        content: [{ type: "text", text: formatInspect(result) }],
        isError: result.error !== null,
      };
    },
  });

  bb.agents.registerTool({
    name: "preview_ports",
    description:
      "List listening TCP ports on this machine, share one over bb connect, or kill a listener by port or PID. Dev servers are listed by default; pass all to include system apps. Share and kill refuse Docker-published ports and system apps.",
    instructions:
      "Use preview_ports when the user wants to see, share, or free a port. Prefer this over guessing lsof. Share returns a bb connect URL for phone/remote preview. Do not share or kill Docker-published ports or system apps. Kill is destructive: only kill what they asked for. Give them the port, process, PID, and share URL if one exists.",
    presentation: {
      label: {
        pending: "Checking listening ports",
        completed: "Checked listening ports",
      },
    },
    parameters: z.object({
      action: z.enum(["list", "kill", "share", "unshare"]),
      all: z.boolean().optional(),
      targets: z.array(z.string().min(1).max(32)).max(1000).optional(),
      port: z.number().int().min(1).max(65535).optional(),
      force: z.boolean().optional(),
    }),
    async execute({ action, all, targets, port, force }) {
      if (action === "list") {
        const listed = await ports.listPorts(all === true);
        return {
          content: [{ type: "text", text: listed.error ?? formatPortsTable(listed.ports) }],
          isError: listed.error !== null,
        };
      }
      if (action === "share" || action === "unshare") {
        if (port === undefined) {
          return {
            content: [{ type: "text", text: `${action} needs a port.` }],
            isError: true,
          };
        }
        const shared = action === "share" ? await ports.sharePort(port) : await ports.unsharePort(port);
        return {
          content: [
            {
              type: "text",
              text:
                shared.error ??
                (action === "share" ? (shared.url ?? "Shared.") : `Unshared :${port}`),
            },
          ],
          isError: shared.error !== null,
        };
      }
      if (targets === undefined || targets.length === 0) {
        return {
          content: [{ type: "text", text: "kill needs targets: a port, PID, or range such as 3000-3010." }],
          isError: true,
        };
      }
      const killed = await ports.killPorts(targets, force === true);
      return {
        content: [{ type: "text", text: killed.error ?? formatKillOutcomes(killed.outcomes) }],
        isError: killed.error !== null || killed.outcomes.some((outcome) => !outcome.ok),
      };
    },
  });

  bb.agents.contributeInstructions(({ threadId }) =>
    openPreviewAgentInstructions(
      openPreview,
      threadId === undefined || threadId === "" ? null : service.runningNote(threadId),
    ),
  );

  bb.background.service("preview-ready", {
    async start(signal) {
      while (!signal.aborted) {
        try {
          await service.tick();
        } catch (cause) {
          bb.log.warn(`preview tick failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
        await sleep(1500, signal);
      }
    },
  });

  bb.onDispose(() => {
    bb.log.info("disposed");
  });
}

export { rpcContract };
