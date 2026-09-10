import { describe, expect, it } from "vitest";
import { asUserFacingError, environmentPreviewBlocker } from "./workspace-error.js";

describe("environmentPreviewBlocker", () => {
  it("lets a ready worktree through", () => {
    expect(environmentPreviewBlocker("ready")).toBeNull();
  });

  it("explains a retiring worktree", () => {
    expect(environmentPreviewBlocker("retiring")).toMatch(/retiring/);
  });

  it("explains provisioning, gone, and error worktrees", () => {
    expect(environmentPreviewBlocker("provisioning")).toMatch(/still being created/);
    expect(environmentPreviewBlocker("destroying")).toMatch(/gone/);
    expect(environmentPreviewBlocker("destroyed")).toMatch(/gone/);
    expect(environmentPreviewBlocker("error")).toMatch(/error state/);
  });
});

describe("asUserFacingError", () => {
  it("rewrites BB's environment-unavailable 409", () => {
    expect(asUserFacingError("HTTP 409: Environment unavailable")).toMatch(
      /retiring or already gone/,
    );
  });

  it("keeps unrelated errors", () => {
    expect(asUserFacingError("No startable app in apps/web.")).toBe(
      "No startable app in apps/web.",
    );
  });
});
