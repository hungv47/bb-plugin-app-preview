import { describe, expect, it } from "vitest";
import type { PluginInteractionRequest, PluginInteractionResult } from "@get-bb/plugin-sdk";
import {
  createConfirmationToken,
  requireUserConfirmation,
  submittedConfirmationMatches,
  type ConfirmationHost,
} from "./confirm.js";
import {
  confirmPayloadSchema,
  confirmSummary,
  type ConfirmPayload,
} from "./confirm-schema.js";

function stubBb(
  reply: (payload: ConfirmPayload) => PluginInteractionResult | Promise<PluginInteractionResult>,
): ConfirmationHost {
  return {
    ui: {
      requestInput: async (request: PluginInteractionRequest): Promise<PluginInteractionResult> => {
        const parsed = confirmPayloadSchema.safeParse(request.payload);
        if (!parsed.success) {
          return { outcome: "cancelled", reason: "user" };
        }
        return reply(parsed.data);
      },
    },
  };
}

describe("confirmation tokens", () => {
  it("only matches the issued token", () => {
    const issued = createConfirmationToken();
    expect(submittedConfirmationMatches(issued, { confirmationToken: issued })).toBe(true);
    expect(submittedConfirmationMatches(issued, { confirmationToken: createConfirmationToken() })).toBe(
      false,
    );
    expect(submittedConfirmationMatches(issued, { confirmationToken: "yes" })).toBe(false);
    expect(submittedConfirmationMatches(issued, { confirmed: true })).toBe(false);
    expect(submittedConfirmationMatches(issued, issued)).toBe(false);
  });

  it("describes share and kill for the confirm UI", () => {
    expect(confirmSummary("share", { port: 5173 })).toMatch(/Share port 5173/);
    expect(confirmSummary("kill", { targets: ["3000"], force: true })).toMatch(/SIGKILL/);
    expect(
      confirmPayloadSchema.parse({
        action: "share",
        summary: "Share port 5173 over BB Connect (a public HTTPS URL).",
        confirmationToken: createConfirmationToken(),
      }).action,
    ).toBe("share");
  });

  it("requireUserConfirmation accepts only the issued token", async () => {
    expect(
      await requireUserConfirmation(
        stubBb((payload) => ({
          outcome: "submitted",
          value: { confirmationToken: payload.confirmationToken },
        })),
        "thr_1",
        "share",
        { port: 5173 },
      ),
    ).toBeNull();
    expect(
      await requireUserConfirmation(
        stubBb(() => ({ outcome: "submitted", value: { confirmed: true } })),
        "thr_1",
        "share",
        { port: 5173 },
      ),
    ).toBe("Confirmation token did not match.");
    expect(
      await requireUserConfirmation(
        stubBb(() => ({ outcome: "cancelled", reason: "user" })),
        "thr_1",
        "kill",
        { targets: ["3000"] },
      ),
    ).toBe("Cancelled.");
    expect(
      await requireUserConfirmation(
        stubBb(() => ({ outcome: "cancelled", reason: "user" })),
        "",
        "kill",
        {
          targets: ["1"],
        },
      ),
    ).toBe("Share and kill from an agent need a thread so you can confirm.");
  });
});
