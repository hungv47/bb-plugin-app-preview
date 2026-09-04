import { describe, expect, it } from "vitest";
import { omitUndefined } from "./rpc-input.js";

describe("omitUndefined", () => {
  it("drops undefined keys so the payload is JSON", () => {
    expect(
      omitUndefined({
        threadId: "thr_1",
        command: undefined,
        port: 3000,
        relativeCwd: "forsvn/anzoa/app",
      }),
    ).toEqual({
      threadId: "thr_1",
      port: 3000,
      relativeCwd: "forsvn/anzoa/app",
    });
    expect(JSON.parse(JSON.stringify(omitUndefined({ command: undefined, threadId: "x" })))).toEqual({
      threadId: "x",
    });
  });
});
