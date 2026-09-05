import { useCallback, useEffect, useRef, useState } from "react";
import { UrlLink, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  killPortsResultSchema,
  listPortsResultSchema,
  rpcContract,
  sharePortResultSchema,
  type ListeningPortDto,
} from "./contract";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function metaLine(row: ListeningPortDto): string {
  return [row.projectName, row.framework, row.uptime, row.memory]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" · ");
}

export function PortsPanel() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [showAll, setShowAll] = useState(false);
  const [ports, setPorts] = useState<ListeningPortDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const sawConnected = useRef(false);

  const load = useCallback(async () => {
    try {
      const result = await rpc.call("listPorts", { all: showAll });
      const listed = listPortsResultSchema.safeParse(result);
      if (!listed.success) {
        setError("Could not read the ports list.");
        return;
      }
      setPorts(listed.data.ports);
      setError(listed.data.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [rpc, showAll]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtime("ports-changed", () => {
    void load();
  });

  useEffect(() => {
    if (connection !== "connected") return;
    if (sawConnected.current) void load();
    sawConnected.current = true;
  }, [connection, load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load();
    }, 4000);
    return () => clearInterval(timer);
  }, [load]);

  const kill = async (port: number, confirmed: boolean) => {
    if (!confirmed) {
      setPending(port);
      return;
    }
    setBusy(true);
    try {
      const result = await rpc.call("killPorts", { targets: [String(port)] });
      const killed = killPortsResultSchema.safeParse(result);
      if (!killed.success) {
        toast.error("Could not read the kill result.");
      } else {
        const first = killed.data.outcomes[0];
        if (killed.data.error !== null) toast.error(killed.data.error);
        else if (first !== undefined && !first.ok) toast.error(first.message);
        else toast.success(first?.message ?? "Sent SIGTERM");
      }
      setPending(null);
      await load();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const share = async (port: number) => {
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
  };

  const unshare = async (port: number) => {
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
  };

  const copyShare = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Copied share URL");
    } catch {
      toast.error("Could not copy the URL");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <p className="text-sm font-medium">Listening ports</p>
        <span className="text-xs text-muted-foreground">{ports.length}</span>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(event) => setShowAll(event.target.checked)}
            className="size-3.5 accent-foreground"
            aria-label="Show all ports"
          />
          Show all
        </label>
        <Button variant="ghost" size="icon" className="size-7" onClick={() => void load()} aria-label="Refresh">
          <Icon name="RotateCcw" className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {error === null && ports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {showAll
              ? "Nothing is listening on this machine."
              : "No dev servers listening. Show all to include system apps."}
          </p>
        ) : null}
        <ul className="space-y-2">
          {ports.map((row) => {
            const confirm = pending === row.port;
            const meta = metaLine(row);
            return (
              <li key={`${row.port}-${row.pid}`} className="rounded-md border border-border px-2 py-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm">
                      :{row.port}
                      <span className="ml-2 text-muted-foreground">{row.processName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">PID {row.pid}</span>
                    </p>
                    {meta !== "" ? <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p> : null}
                    {row.status !== "healthy" ? (
                      <p
                        className={cn(
                          "mt-0.5 text-xs font-medium",
                          row.status === "zombie" ? "text-destructive" : "text-muted-foreground",
                        )}
                      >
                        {row.status}
                      </p>
                    ) : null}
                    {row.ownedByPreview ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">preview</p>
                    ) : null}
                    {!row.listensOnIpv4 ? (
                      <p className="mt-0.5 text-xs text-destructive">
                        IPv6 only. Connect share needs 127.0.0.1. Restart the preview.
                      </p>
                    ) : null}
                    {row.shareUrl !== null ? (
                      <div className="mt-2 flex items-start gap-2">
                        <UrlLink
                          href={row.shareUrl}
                          className="min-w-0 flex-1 break-all font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                        >
                          {row.shareUrl}
                        </UrlLink>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 shrink-0"
                          onClick={() => void copyShare(row.shareUrl ?? "")}
                          aria-label="Copy share URL"
                        >
                          <Icon name="Copy" className="size-4" />
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-1">
                    {row.shareUrl === null ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || row.docker || !row.listensOnIpv4}
                        onClick={() => void share(row.port)}
                      >
                        Share
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void unshare(row.port)}
                      >
                        Unshare
                      </Button>
                    )}
                    <Button
                      variant={confirm ? "destructive" : "outline"}
                      size="sm"
                      disabled={busy || row.docker}
                      onClick={() => void kill(row.port, confirm)}
                    >
                      {confirm ? "Confirm" : "Kill"}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
