import { z } from "zod";

export const CONFIRM_RENDERER_ID = "preview-confirm";

export const confirmActions = ["share", "unshare", "kill"] as const;
export type ConfirmAction = (typeof confirmActions)[number];

export const confirmPayloadSchema = z
  .object({
    action: z.enum(confirmActions),
    summary: z.string().min(1).max(500),
    confirmationToken: z.string().min(16).max(128),
  })
  .strict();
export type ConfirmPayload = z.infer<typeof confirmPayloadSchema>;

export const confirmSubmitSchema = z
  .object({
    confirmationToken: z.string().min(16).max(128),
  })
  .strict();

export function confirmSummary(
  action: ConfirmAction,
  details: { port?: number; targets?: readonly string[]; force?: boolean },
): string {
  if (action === "share") return `Share port ${details.port ?? "?"} over BB Connect (a public HTTPS URL).`;
  if (action === "unshare") return `Remove the BB Connect share for port ${details.port ?? "?"}.`;
  const signal = details.force === true ? "SIGKILL" : "SIGTERM";
  const targets = details.targets?.join(", ") ?? "(none)";
  return `Send ${signal} to ${targets}.`;
}
