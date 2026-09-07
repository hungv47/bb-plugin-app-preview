import { describe, expect, it } from "vitest";
import { parseReadyHint, shareUrlForPort, stripAnsi } from "./ready.js";

describe("parseReadyHint", () => {
  it("reads a Vite local URL", () => {
    const hint = parseReadyHint(
      "  ➜  Local:   http://localhost:5173/\n  ➜  Network: http://192.168.1.8:5173/",
      5173,
    );
    expect(hint).toEqual({ localUrl: "http://localhost:5173/", port: 5173 });
  });

  it("rewrites python http.server IPv6 any-address", () => {
    const hint = parseReadyHint("Serving HTTP on :: port 18765 (http://[::]:18765/) ...", 18765);
    expect(hint).toEqual({ localUrl: "http://127.0.0.1:18765/", port: 18765 });
  });

  it("rewrites 0.0.0.0 to loopback", () => {
    const hint = parseReadyHint("Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)", 8000);
    expect(hint?.localUrl).toBe("http://127.0.0.1:8000");
    expect(hint?.port).toBe(8000);
  });

  it("strips ANSI before matching", () => {
    const text = stripAnsi("\u001b[32mLocal:\u001b[0m http://127.0.0.1:3000");
    expect(parseReadyHint(text, 3000)?.port).toBe(3000);
  });

  it("falls back to the expected port after a ready line", () => {
    const hint = parseReadyHint("webpack compiled successfully\nlistening on port 3000", 3000);
    expect(hint).toEqual({ localUrl: "http://127.0.0.1:3000", port: 3000 });
  });

  it("ignores documentation URLs that are not loopback", () => {
    const hint = parseReadyHint(
      "See https://nextjs.org:443/docs\nready - started server on 0.0.0.0:3000, url: http://localhost:3000",
      3000,
    );
    expect(hint?.localUrl).toBe("http://localhost:3000");
    expect(hint?.port).toBe(3000);
  });

  it("does not treat a LAN URL as ready", () => {
    const hint = parseReadyHint("Network: http://192.168.1.8:5173/", 5173);
    expect(hint).toBeNull();
  });

  it("does not treat a compiled-in-Nms line as ready", () => {
    expect(parseReadyHint("webpack compiled successfully in 3000ms", 3000)).toBeNull();
  });

  it("prefers Vite Local over an earlier API URL when fallback matches neither", () => {
    const hint = parseReadyHint(
      [
        "e-reader-preview: API → http://127.0.0.1:8650",
        "e-reader-preview: UI  → http://127.0.0.1:5173  (/api → :8650)",
        "  ➜  Local:   http://127.0.0.1:5173/",
      ].join("\n"),
      3000,
    );
    expect(hint?.port).toBe(5173);
    expect(hint?.localUrl).toBe("http://127.0.0.1:5173/");
  });

  it("prefers a URL whose port equals the fallback port", () => {
    const hint = parseReadyHint(
      [
        "API → http://127.0.0.1:8650",
        "  ➜  Local:   http://127.0.0.1:5173/",
      ].join("\n"),
      8650,
    );
    expect(hint?.port).toBe(8650);
    expect(hint?.localUrl).toBe("http://127.0.0.1:8650");
  });

  it("prefers a UI line over an API line when neither is Local", () => {
    const hint = parseReadyHint(
      ["API → http://127.0.0.1:8650", "UI → http://127.0.0.1:5173"].join("\n"),
      3000,
    );
    expect(hint?.port).toBe(5173);
    expect(hint?.localUrl).toBe("http://127.0.0.1:5173");
  });

  it("prefers the mixed UI/API banner over an earlier API URL without a Local line", () => {
    const hint = parseReadyHint(
      [
        "e-reader-preview: API → http://127.0.0.1:8650",
        "e-reader-preview: UI  → http://127.0.0.1:5173  (/api → :8650)",
      ].join("\n"),
      3000,
    );
    expect(hint?.port).toBe(5173);
    expect(hint?.localUrl).toBe("http://127.0.0.1:5173");
  });

  it("prefers a later bare loopback URL when ranks are otherwise equal", () => {
    const hint = parseReadyHint(
      ["http://127.0.0.1:8650", "http://127.0.0.1:5173"].join("\n"),
      3000,
    );
    expect(hint?.port).toBe(5173);
    expect(hint?.localUrl).toBe("http://127.0.0.1:5173");
  });

  it("prefers Local over a bare UI-looking URL on the same port", () => {
    const hint = parseReadyHint(
      [
        "UI → http://127.0.0.1:5173",
        "  ➜  Local:   http://127.0.0.1:5173/",
      ].join("\n"),
      3000,
    );
    expect(hint?.port).toBe(5173);
    expect(hint?.localUrl).toBe("http://127.0.0.1:5173/");
  });
});

describe("shareUrlForPort", () => {
  it("uses the connect tunnel shape", () => {
    expect(
      shareUrlForPort({ label: "hung-mac", baseDomain: "getbb.app" }, 5173),
    ).toBe("https://hung-mac--5173.getbb.app");
  });
});
