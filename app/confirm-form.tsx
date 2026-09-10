import { useMemo, useState } from "react";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { confirmPayloadSchema } from "./confirm-schema.js";

export function ConfirmInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = useMemo(
    () => confirmPayloadSchema.safeParse(interaction.payload),
    [interaction.payload],
  );
  const [busy, setBusy] = useState(false);

  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">This confirmation request is invalid.</p>
        <Button variant="outline" onClick={() => void cancel().catch(() => undefined)}>
          Cancel
        </Button>
      </div>
    );
  }

  const payload = parsed.data;
  const confirm = async () => {
    setBusy(true);
    try {
      await submit({ confirmationToken: payload.confirmationToken });
    } catch {
      // Host surfaces cancel/submit failures; keep the form usable.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-pretty text-sm leading-relaxed text-foreground">{payload.summary}</p>
      <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => void cancel().catch(() => undefined)}
        >
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => void confirm()}
        >
          Confirm
        </Button>
      </div>
    </div>
  );
}
