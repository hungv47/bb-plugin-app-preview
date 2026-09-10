import { z } from "zod";

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
