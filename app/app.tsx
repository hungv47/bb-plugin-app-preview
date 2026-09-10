import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  UrlLink,
  definePluginApp,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { InspectResult } from "./contract";
import { rpcContract } from "./contract";
import { splitCdPrefix } from "./detect";
import { sharePortResultSchema } from "./ports-schema";
import { omitUndefined } from "./rpc-input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { formatHomePathForDisplay, cn } from "@/lib/utils";
import { environmentPreviewBlocker } from "./workspace-error";
import { PortsPanel } from "./ports-panel";

function isInspect(value: unknown): value is InspectResult {
  return typeof value === "object" && value !== null && "workspace" in value;
}

function usePreview(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [data, setData] = useState<InspectResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sawConnected = useRef(false);

  const load = useCallback(async () => {
    if (threadId === "") return;
    try {
      const result = await rpc.call("inspect", { threadId });
      if (isInspect(result)) {
        setData(result);
        setError(result.error);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("preview-changed", () => {
    void load();
  });

  useEffect(() => {
    if (connection !== "connected") return;
    if (sawConnected.current) void load();
    sawConnected.current = true;
  }, [connection, load]);

  const run = useCallback(
    async (
      method: "start" | "stop" | "restart",
      extra?: { command?: string; port?: number; relativeCwd?: string },
    ) => {
      setBusy(true);
      try {
        const result =
          method === "stop"
            ? await rpc.call("stop", { threadId })
            : await rpc.call(
                method,
                omitUndefined({ threadId, ...extra }) as {
                  threadId: string;
                  command?: string;
                  port?: number;
                  relativeCwd?: string;
                },
              );
        if (isInspect(result)) {
          setData(result);
          setError(result.error);
          if (result.error !== null) toast.error(result.error);
        }
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        toast.error(message);
      } finally {
        setBusy(false);
      }
    },
    [rpc, threadId],
  );

  const share = useCallback(
    async (port: number) => {
      setBusy(true);
      try {
        const result = await rpc.call("sharePort", { port });
        const shared = sharePortResultSchema.safeParse(result);
        if (!shared.success) toast.error("Could not read the share result.");
        else if (shared.data.error !== null) toast.error(shared.data.error);
        else if (shared.data.url !== null) toast.success("Shared port");
        await load();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [load, rpc],
  );

  const unshare = useCallback(
    async (port: number) => {
      setBusy(true);
      try {
        const result = await rpc.call("unsharePort", { port });
        const shared = sharePortResultSchema.safeParse(result);
        if (!shared.success) toast.error("Could not read the unshare result.");
        else if (shared.data.error !== null) toast.error(shared.data.error);
        else toast.success("Unshared port");
        await load();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [load, rpc],
  );

  return { data, error, busy, load, run, share, unshare };
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "running"
      ? "text-foreground"
      : status === "error" || status === "exited"
        ? "text-destructive"
        : "text-muted-foreground";
  return (
    <span className={cn("text-xs font-medium uppercase tracking-wide", tone)}>
      {status}
    </span>
  );
}

function PreviewPanel({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const { data, error, busy, run, share, unshare } = usePreview(threadId);
  const [command, setCommand] = useState("");
  const [port, setPort] = useState("");
  const [selectedCwd, setSelectedCwd] = useState(".");
  const workspaceKey = data?.workspace?.path ?? "";
  const filledFor = useRef("");

  const detection = data?.detection ?? null;
  const preview = data?.preview ?? null;
  const workspace = data?.workspace ?? null;
  const candidates = data?.candidates ?? [];
  const running = preview?.status === "running" || preview?.status === "starting";

  useEffect(() => {
    if (workspaceKey === "" || filledFor.current === workspaceKey) return;
    filledFor.current = workspaceKey;
    setSelectedCwd(detection?.relativeCwd ?? ".");
    const nextCommand = detection?.command ?? "";
    setCommand(splitCdPrefix(nextCommand).command || nextCommand);
    setPort(detection?.port !== null && detection?.port !== undefined ? String(detection.port) : "");
  }, [workspaceKey, detection]);

  const selected =
    candidates.find((candidate) => candidate.relativeCwd === selectedCwd) ?? detection;

  const extras = useMemo(() => {
    const parsedPort = port.trim() === "" ? undefined : Number(port);
    const split = splitCdPrefix(command);
    const inner = split.command;
    const cwd = split.relativeCwd ?? (selectedCwd === "" ? undefined : selectedCwd);
    return omitUndefined({
      command: inner === "" ? undefined : inner,
      port:
        parsedPort !== undefined && Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
          ? parsedPort
          : undefined,
      relativeCwd: cwd,
    });
  }, [command, port, selectedCwd]);

  const displayError = error ?? preview?.error ?? null;
  const ready =
    preview?.status === "running" && preview.openUrl !== null && preview.openUrl !== undefined;
  const workspaceBlocked =
    workspace !== null && environmentPreviewBlocker(workspace.environmentStatus) !== null;
  const canStart =
    workspace !== null &&
    !workspaceBlocked &&
    (command.trim() !== "" || (detection?.command ?? "") !== "");

  const openPreview = () => {
    if (preview?.status !== "running" || preview.openUrl === null || preview.openUrl === undefined) {
      toast.error("The app has not published a URL yet.");
      return;
    }
    if (!navigate.openUrl(preview.openUrl)) {
      toast.error("BB could not open that URL in the in-app browser.");
    }
  };

  const copyUrl = async () => {
    const url = preview?.openUrl;
    if (url === undefined || url === null) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied preview URL");
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  const onStart = (event?: FormEvent) => {
    event?.preventDefault();
    void run("start", extras);
  };

  const pickCandidate = (relativeCwd: string, nextCommand: string | null, nextPort: number | null) => {
    setSelectedCwd(relativeCwd);
    if (nextCommand !== null) setCommand(splitCdPrefix(nextCommand).command || nextCommand);
    if (nextPort !== null) setPort(String(nextPort));
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {workspace !== null ? (
          <div className="space-y-1">
            <p
              className="truncate font-mono text-xs text-muted-foreground"
              title={workspace.path}
            >
              {formatHomePathForDisplay(workspace.path)}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {workspace.branch !== null ? <span>{workspace.branch}</span> : null}
              {workspace.isWorktree ? <span>worktree</span> : null}
              {workspaceBlocked ? (
                <span>{workspace.environmentStatus}</span>
              ) : null}
              {preview !== null ? <StatusBadge status={preview.status} /> : null}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Open Preview from a thread that has a workspace.
          </p>
        )}

        {detection?.found ? (
          <div className="mt-3 space-y-1">
            <p className="text-sm font-medium">
              {selected?.frameworkLabel ??
                selected?.framework ??
                detection.frameworkLabel ??
                detection.framework}
            </p>
            <p className="text-xs text-muted-foreground">
              {[
                selected?.packageManager ?? detection.packageManager,
                selectedCwd !== "." ? selectedCwd : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {detection.dependencies.length > 0 && selectedCwd === detection.relativeCwd ? (
              <p className="text-xs text-muted-foreground">
                {detection.dependencies.join(", ")}
              </p>
            ) : null}
            {detection.notes.map((note) => (
              <p key={note} className="text-xs text-muted-foreground">
                {note}
              </p>
            ))}
          </div>
        ) : detection !== null ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No startable app found. Set a command below or add a package.json script.
          </p>
        ) : null}

        {candidates.length > 1 ? (
          <div className="mt-3 space-y-1">
            <p className="text-xs text-muted-foreground">Apps in this worktree</p>
            <div className="flex flex-col gap-1">
              {candidates.map((candidate) => {
                const selectedRow = candidate.relativeCwd === selectedCwd;
                return (
                  <button
                    key={candidate.relativeCwd}
                    type="button"
                    aria-pressed={selectedRow}
                    className={cn(
                      "rounded-md border px-2 py-1.5 text-left text-xs hover:bg-state-hover",
                      selectedRow ? "border-foreground" : "border-border",
                    )}
                    onClick={() =>
                      pickCandidate(candidate.relativeCwd, candidate.command, candidate.port)
                    }
                  >
                    <span className="font-medium">
                      {candidate.frameworkLabel ?? candidate.framework ?? "app"}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {candidate.relativeCwd}
                      {candidate.port !== null ? ` · :${candidate.port}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <form className="mt-4 space-y-2" onSubmit={onStart}>
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Start command</span>
            <Input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              placeholder="pnpm dev"
              aria-label="Start command"
            />
          </label>
          {selectedCwd !== "." ? (
            <p className="text-xs text-muted-foreground">Runs in {selectedCwd}</p>
          ) : null}
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Port</span>
            <Input
              value={port}
              onChange={(event) => setPort(event.target.value)}
              placeholder="3000"
              inputMode="numeric"
              aria-label="Port"
            />
          </label>
        </form>

        {displayError !== null ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {displayError}
          </p>
        ) : null}

        {preview?.status === "running" && preview.openUrl !== null && preview.openUrl !== undefined ? (
          <div className="mt-3 flex items-start gap-2">
            <UrlLink
              href={preview.openUrl}
              className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {preview.openUrl}
            </UrlLink>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => void copyUrl()}
              aria-label="Copy URL"
            >
              <Icon name="Copy" className="size-4" />
            </Button>
          </div>
        ) : null}

        {preview?.status === "running" &&
        preview.shareUrl === null &&
        preview.localUrl !== null ? (
          <p className="mt-2 text-xs text-muted-foreground">
            This URL is only reachable on this machine. Share over bb connect for a phone or
            a getbb.app client.
          </p>
        ) : null}

        {preview?.logTail ? (
          <details className="mt-3" open={preview.status === "exited" || preview.status === "error"}>
            <summary className="cursor-pointer text-xs text-muted-foreground">Logs</summary>
            <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-[11px] leading-4 text-muted-foreground">
              {preview.logTail}
            </pre>
          </details>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
        {running ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void run("stop")}
          >
            <Icon name="Square" className="size-4" />
            Stop
          </Button>
        ) : (
          <Button size="sm" disabled={busy || !canStart} onClick={() => onStart()}>
            <Icon name="Play" className="size-4" />
            Start
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          disabled={busy || workspace === null || workspaceBlocked}
          onClick={() => void run("restart", extras)}
        >
          <Icon name="RotateCcw" className="size-4" />
          Restart
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!ready}
          onClick={openPreview}
        >
          <Icon name="Globe" className="size-4" />
          Open in browser
        </Button>
        {preview?.status === "running" &&
        preview.shareUrl === null &&
        preview.port !== null ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (preview.port !== null) void share(preview.port);
            }}
          >
            Share
          </Button>
        ) : null}
        {preview?.status === "running" &&
        preview.shareUrl !== null &&
        preview.port !== null ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              if (preview.port !== null) void unshare(preview.port);
            }}
          >
            Unshare
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate.toPluginPanel("ports")}
        >
          Ports
        </Button>
      </div>
    </div>
  );
}

function PreviewHeaderButton(_props: { threadId: string }) {
  const navigate = useBbNavigate();
  return (
    <button
      type="button"
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
      aria-label="Preview app"
      title="Preview app"
      onClick={() => {
        navigate.openThreadPanel({ actionId: "preview", title: "Preview" });
      }}
    >
      <Icon name="Play" className="size-4" />
    </button>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "preview",
    title: "Preview",
    icon: "Play",
    layout: "flush",
    component: PreviewPanel,
  });
  app.slots.experimental_threadHeaderAction({
    id: "preview-header",
    title: "Preview",
    component: PreviewHeaderButton,
  });
  app.slots.commandPaletteAction({
    id: "open-preview",
    title: "Preview app",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: "preview", title: "Preview" });
    },
  });
  app.slots.navPanel({
    id: "ports",
    title: "Ports",
    icon: "Radio",
    path: "ports",
    component: PortsPanel,
  });
});
