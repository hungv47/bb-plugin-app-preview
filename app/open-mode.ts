export const OPEN_PREVIEW_MANUAL = "manual";
export const OPEN_PREVIEW_AGENT = "agent";
export const OPEN_PREVIEW_OPTIONS = [OPEN_PREVIEW_MANUAL, OPEN_PREVIEW_AGENT] as const;
export type OpenPreviewMode = (typeof OPEN_PREVIEW_OPTIONS)[number];

export function isAgentOpenPreview(mode: string | undefined): boolean {
  return mode === OPEN_PREVIEW_AGENT;
}

export function openPreviewAgentInstructions(
  mode: string | undefined,
  runningNote: string | null,
): string {
  const modeLine = isAgentOpenPreview(mode)
    ? "App Preview open mode is agent. After you finish UI-visible work on this worktree's app, call preview_app start once so the in-app browser opens when the app is ready. If a preview is already running, leave it. Start after that work is done, not at the beginning of a task."
    : "App Preview open mode is manual. Start the preview only when the user asked to preview or open the app. If it is already running, give them the Open URL.";
  if (runningNote === null || runningNote === "") return modeLine;
  return `${modeLine}\n${runningNote}`;
}
