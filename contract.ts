import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { ENVIRONMENT_LIFECYCLES } from "./workspace-error.js";

export const previewStatusSchema = z.enum([
  "idle",
  "starting",
  "running",
  "stopping",
  "error",
  "exited",
]);
export type PreviewStatus = z.infer<typeof previewStatusSchema>;

export const detectionSchema = z.object({
  found: z.boolean(),
  framework: z.string().nullable(),
  frameworkLabel: z.string().nullable(),
  packageManager: z.string().nullable(),
  command: z.string().nullable(),
  installCommand: z.string().nullable(),
  port: z.number().int().nullable(),
  relativeCwd: z.string(),
  dependencies: z.array(z.string()),
  notes: z.array(z.string()),
  confidence: z.enum(["high", "medium", "low"]).nullable(),
});

export const workspaceSchema = z.object({
  environmentId: z.string(),
  hostId: z.string(),
  path: z.string(),
  branch: z.string().nullable(),
  isWorktree: z.boolean(),
  environmentStatus: z.enum(ENVIRONMENT_LIFECYCLES),
});

export const previewSchema = z.object({
  status: previewStatusSchema,
  terminalId: z.string().nullable(),
  localUrl: z.string().nullable(),
  shareUrl: z.string().nullable(),
  openUrl: z.string().nullable(),
  command: z.string().nullable(),
  port: z.number().int().nullable(),
  error: z.string().nullable(),
  logTail: z.string(),
  startedAt: z.number().nullable(),
  updatedAt: z.number(),
});

export const candidateSchema = z.object({
  framework: z.string().nullable(),
  frameworkLabel: z.string().nullable(),
  packageManager: z.string().nullable(),
  command: z.string().nullable(),
  installCommand: z.string().nullable(),
  port: z.number().int().nullable(),
  relativeCwd: z.string(),
});

export const inspectResultSchema = z.object({
  workspace: workspaceSchema.nullable(),
  detection: detectionSchema.nullable(),
  candidates: z.array(candidateSchema),
  preview: previewSchema.nullable(),
  error: z.string().nullable(),
});
export type InspectResult = z.infer<typeof inspectResultSchema>;

const threadInput = z.object({ threadId: z.string().min(1) }).strict();

const startInput = z
  .object({
    threadId: z.string().min(1),
    command: z.string().trim().min(1).max(500).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    relativeCwd: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

export const portStatusSchema = z.enum(["healthy", "orphaned", "zombie"]);

export const listeningPortSchema = z.object({
  port: z.number().int(),
  pid: z.number().int(),
  processName: z.string(),
  command: z.string(),
  cwd: z.string().nullable(),
  projectName: z.string().nullable(),
  framework: z.string().nullable(),
  uptime: z.string().nullable(),
  memory: z.string().nullable(),
  status: portStatusSchema,
  docker: z.boolean(),
  ownedByPreview: z.boolean(),
  shareUrl: z.string().nullable(),
  listensOnIpv4: z.boolean(),
});
export type ListeningPortDto = z.infer<typeof listeningPortSchema>;

export const listPortsInput = z
  .object({
    all: z.boolean().optional(),
  })
  .strict();

export const listPortsResultSchema = z.object({
  ports: z.array(listeningPortSchema),
  error: z.string().nullable(),
});
export type ListPortsResult = z.infer<typeof listPortsResultSchema>;

export const killPortsInput = z
  .object({
    targets: z.array(z.string().min(1).max(32)).min(1).max(1000),
    force: z.boolean().optional(),
  })
  .strict();

export const killOutcomeSchema = z.object({
  target: z.string(),
  via: z.enum(["port", "pid", "empty", "invalid", "protected", "blocked"]),
  port: z.number().int().nullable(),
  pid: z.number().int().nullable(),
  processName: z.string().nullable(),
  signal: z.enum(["SIGTERM", "SIGKILL"]).nullable(),
  ok: z.boolean(),
  message: z.string(),
});

export const killPortsResultSchema = z.object({
  outcomes: z.array(killOutcomeSchema),
  error: z.string().nullable(),
});
export type KillPortsResult = z.infer<typeof killPortsResultSchema>;

export const sharePortInput = z
  .object({
    port: z.number().int().min(1).max(65535),
  })
  .strict();

export const sharePortResultSchema = z.object({
  url: z.string().nullable(),
  error: z.string().nullable(),
});
export type SharePortResult = z.infer<typeof sharePortResultSchema>;

export const rpcContract = defineRpcContract({
  inspect: {
    input: threadInput,
    output: inspectResultSchema,
  },
  start: {
    input: startInput,
    output: inspectResultSchema,
  },
  stop: {
    input: threadInput,
    output: inspectResultSchema,
  },
  restart: {
    input: startInput,
    output: inspectResultSchema,
  },
  listPorts: {
    input: listPortsInput,
    output: listPortsResultSchema,
  },
  killPorts: {
    input: killPortsInput,
    output: killPortsResultSchema,
  },
  sharePort: {
    input: sharePortInput,
    output: sharePortResultSchema,
  },
  unsharePort: {
    input: sharePortInput,
    output: sharePortResultSchema,
  },
});

export const PREVIEW_CHANGED = "preview-changed";
export const PORTS_CHANGED = "ports-changed";
