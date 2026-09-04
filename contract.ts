import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

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
});

export const PREVIEW_CHANGED = "preview-changed";
