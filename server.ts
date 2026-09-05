import { z } from "zod";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contract.js";
import { createPreviewService, sleep, type InspectResult } from "./service.js";

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
].join("\n");

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("loaded");

  const settings = bb.settings.define({
    autoInstall: {
      type: "boolean",
      label: "Install dependencies before start",
      default: true,
    },
    readyTimeoutSeconds: {
      type: "string",
      label: "Seconds to wait for a ready URL",
      default: "90",
    },
  });
  const values = await settings.get();
  const serviceSettings = {
    autoInstall: values.autoInstall,
    readyTimeoutMs: parseTimeoutMs(values.readyTimeoutSeconds),
  };
  const service = createPreviewService(bb, serviceSettings);
  settings.onChange((next) => {
    serviceSettings.autoInstall = next.autoInstall;
    serviceSettings.readyTimeoutMs = parseTimeoutMs(next.readyTimeoutSeconds);
  });

  bb.rpc.register(rpcContract, {
    inspect: ({ threadId }) => service.inspect(threadId),
    start: ({ threadId, command, port, relativeCwd }) =>
      service.start(threadId, { command, port, relativeCwd }),
    stop: ({ threadId }) => service.stop(threadId),
    restart: ({ threadId, command, port, relativeCwd }) =>
      service.restart(threadId, { command, port, relativeCwd }),
  });

  bb.cli.register({
    name: "preview",
    summary: "Detect, start, and stop the app in a thread worktree",
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
    ],
    async run(argv, ctx) {
      const json = wantsJson(argv);
      const withoutJson = argv.filter((arg) => arg !== "--json");
      try {
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
      "Use preview_app to run the worktree app from this session. Prefer it over guessing package.json scripts. After start, the in-app browser opens on its own. Give the user the Open URL. Stop closes that browser.",
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

  bb.agents.contributeInstructions(({ threadId }) => service.runningNote(threadId));

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
