export const ENVIRONMENT_LIFECYCLES = [
  "destroyed",
  "destroying",
  "error",
  "provisioning",
  "ready",
  "retiring",
] as const;

export type EnvironmentLifecycle = (typeof ENVIRONMENT_LIFECYCLES)[number];

export function environmentPreviewBlocker(status: EnvironmentLifecycle): string | null {
  switch (status) {
    case "ready":
      return null;
    case "provisioning":
      return "This worktree is still being created. Wait until it is ready, then Start.";
    case "retiring":
      return "This worktree is retiring. BB will not start a preview here. Use a live thread or spawn a new worktree.";
    case "destroying":
    case "destroyed":
      return "This worktree is gone. Preview cannot start here. Spawn a new worktree.";
    case "error":
      return "This worktree is in an error state. Preview cannot start. Spawn a new worktree.";
  }
}

export function asUserFacingError(message: string): string {
  if (/HTTP 409:\s*Environment unavailable/i.test(message)) {
    return "BB refused this worktree. It is retiring or already gone. Use a live thread or spawn a new worktree.";
  }
  return message;
}
