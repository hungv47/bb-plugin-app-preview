import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isSafeRelativeCwd, quoteShellArg } from "./paths.js";

function literalArg(value: string): string {
  return execFileSync("sh", ["-c", `printf %s ${quoteShellArg(value)}`], {
    encoding: "utf8",
    env: { ...process.env, HOME: "/should-not-expand", INJECT: "injected" },
  });
}

describe("quoteShellArg", () => {
  it("leaves substitutions, variables, quotes, and newlines literal", () => {
    expect(literalArg("$(printf injected)")).toBe("$(printf injected)");
    expect(literalArg("`printf injected`")).toBe("`printf injected`");
    expect(literalArg("$HOME")).toBe("$HOME");
    expect(literalArg("$INJECT")).toBe("$INJECT");
    expect(literalArg(`foo"bar`)).toBe(`foo"bar`);
    expect(literalArg("foo'bar")).toBe("foo'bar");
    expect(literalArg("line1\nline2")).toBe("line1\nline2");
  });

  it("round-trips an empty argument", () => {
    expect(literalArg("")).toBe("");
  });
});

describe("isSafeRelativeCwd", () => {
  it("accepts ordinary relative directories", () => {
    expect(isSafeRelativeCwd(".")).toBe(true);
    expect(isSafeRelativeCwd("apps/web")).toBe(true);
    expect(isSafeRelativeCwd("forsvn/anzoa/app")).toBe(true);
    expect(isSafeRelativeCwd("packages/@acme/web")).toBe(true);
  });

  it("rejects substitutions, variables, quotes, and newlines", () => {
    expect(isSafeRelativeCwd("apps/$(whoami)")).toBe(false);
    expect(isSafeRelativeCwd("apps/`id`")).toBe(false);
    expect(isSafeRelativeCwd("apps/$HOME")).toBe(false);
    expect(isSafeRelativeCwd(`apps/foo"bar`)).toBe(false);
    expect(isSafeRelativeCwd("apps/foo'bar")).toBe(false);
    expect(isSafeRelativeCwd("apps/foo\nbar")).toBe(false);
    expect(isSafeRelativeCwd("../etc")).toBe(false);
    expect(isSafeRelativeCwd("/tmp")).toBe(false);
  });
});
