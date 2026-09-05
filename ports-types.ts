export type PortStatus = "healthy" | "orphaned" | "zombie";

export type ListenEntry = {
  port: number;
  pid: number;
  processName: string;
  listensOnIpv4: boolean;
};

export type ProcessInfo = {
  ppid: number;
  stat: string;
  rss: number;
  lstart: string;
  command: string;
};

export type DockerInfo = {
  name: string;
  image: string;
};

export type ListenSnapshot = {
  entries: ListenEntry[];
  processes: Map<number, ProcessInfo>;
  cwds: Map<number, string>;
  docker: Map<number, DockerInfo>;
};

export type ListeningPort = {
  port: number;
  pid: number;
  processName: string;
  command: string;
  cwd: string | null;
  projectName: string | null;
  framework: string | null;
  uptime: string | null;
  memory: string | null;
  status: PortStatus;
  docker: boolean;
  ownedByPreview: boolean;
  shareUrl: string | null;
  listensOnIpv4: boolean;
};

export type KillVia = "port" | "pid" | "empty" | "invalid" | "protected" | "blocked";

export type KillOutcome = {
  target: string;
  via: KillVia;
  port: number | null;
  pid: number | null;
  processName: string | null;
  signal: "SIGTERM" | "SIGKILL" | null;
  ok: boolean;
  message: string;
};
