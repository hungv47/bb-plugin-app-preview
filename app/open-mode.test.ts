import { describe, expect, it } from "vitest";
import {
  OPEN_PREVIEW_AGENT,
  OPEN_PREVIEW_MANUAL,
  isAgentOpenPreview,
  openPreviewAgentInstructions,
} from "./open-mode.js";

describe("open preview mode", () => {
  it("treats only the agent option as auto-open", () => {
    expect(isAgentOpenPreview(OPEN_PREVIEW_AGENT)).toBe(true);
    expect(isAgentOpenPreview(OPEN_PREVIEW_MANUAL)).toBe(false);
    expect(isAgentOpenPreview(undefined)).toBe(false);
    expect(isAgentOpenPreview("true")).toBe(false);
    expect(isAgentOpenPreview("when the agent is ready")).toBe(false);
  });

  it("tells agents to start after UI work when mode is agent", () => {
    const text = openPreviewAgentInstructions(OPEN_PREVIEW_AGENT, null);
    expect(text).toMatch(/open mode is agent/);
    expect(text).toMatch(/preview_app start/);
    expect(text).toMatch(/this worktree's app/);
  });

  it("tells agents to wait for an explicit preview request when mode is manual", () => {
    const text = openPreviewAgentInstructions(OPEN_PREVIEW_MANUAL, null);
    expect(text).toMatch(/open mode is manual/);
    expect(text).toMatch(/Start the preview only when the user asked/);
    expect(text).not.toMatch(/Start or open/);
  });

  it("appends a running preview note when one exists", () => {
    const text = openPreviewAgentInstructions(
      OPEN_PREVIEW_MANUAL,
      "Preview is up at http://127.0.0.1:5173/",
    );
    expect(text).toMatch(/open mode is manual/);
    expect(text).toMatch(/Preview is up at http:\/\/127\.0\.0\.1:5173\//);
  });
});
