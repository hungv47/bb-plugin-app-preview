import { randomBytes, timingSafeEqual } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  CONFIRM_RENDERER_ID,
  confirmSubmitSchema,
  confirmSummary,
  type ConfirmAction,
} from "./confirm-schema.js";

export function createConfirmationToken(): string {
  return randomBytes(24).toString("base64url");
}

export function confirmationTokensMatch(issued: string, submitted: string): boolean {
  const left = Buffer.from(issued);
  const right = Buffer.from(submitted);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function submittedConfirmationMatches(issued: string, submitted: unknown): boolean {
  const parsed = confirmSubmitSchema.safeParse(submitted);
  return parsed.success && confirmationTokensMatch(issued, parsed.data.confirmationToken);
}

export async function requireUserConfirmation(
  bb: BbPluginApi,
  threadId: string | undefined,
  action: ConfirmAction,
  details: { port?: number; targets?: readonly string[]; force?: boolean },
  signal?: AbortSignal,
): Promise<string | null> {
  if (threadId === undefined || threadId === "") {
    return "Share and kill from an agent need a thread so you can confirm.";
  }
  const confirmationToken = createConfirmationToken();
  const summary = confirmSummary(action, details);
  const title =
    action === "kill"
      ? "Confirm killing a process"
      : action === "share"
        ? "Confirm sharing a port"
        : "Confirm unsharing a port";
  const result = await bb.ui.requestInput(
    {
      threadId,
      rendererId: CONFIRM_RENDERER_ID,
      title,
      payload: { action, summary, confirmationToken },
    },
    { signal },
  );
  if (result.outcome !== "submitted") {
    return "Cancelled.";
  }
  if (!submittedConfirmationMatches(confirmationToken, result.value)) {
    return "Confirmation token did not match.";
  }
  return null;
}
