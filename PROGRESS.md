# App Preview progress

Updated: 2026-09-10
Owner: Hung
State: 0.2.9 addresses get-bb/marketplace#194 (shell injection, agent recipes, confirm, disclosure)

## Resume here

Read `VISION.md`, then this file. Path-install from `forsvn/app-preview/app` and
`bb plugin reload app-preview` to pick up 0.2.9.

## Current state

Product root is `forsvn/app-preview/`. Public host is `hungv47/bb-plugin-app-preview` at `v0.2.8`
until this 0.2.9 is published. Git install of `git:github.com/hungv47/bb-plugin-app-preview@semver:^0.2.0`
still resolves `v0.2.8` until the new tag exists.

0.2.9 starts from a launch plan (cwd + argv). The thread terminal command is the detected
recipe only; environment paths are not interpolated. Agent start cannot pass `command`.
Share/kill from the agent tool wait for `bb.ui.requestInput` with a confirmation token.
Marketplace listing get-bb/marketplace#194 needs the new tag plus an overview.

0.2.8 ranks multi-URL ready hints so Open/share prefer Vite/Next `Local:` (and UI lines) over an
earlier API listen URL. On a port change with an existing connect share, refreshLogs shares the new
port first and only then forgets/unexposes the old one (keep the old shareUrl if the new share
fails). `waitForPreview` settles briefly after the first ready hint so a Vite Local line that
prints a moment later can win; server tests cover settle + share swap.

0.2.7 replaces the old auto-open boolean with **Open the in-app browser**: `manual`
(default) or `agent`. Start/stop/share/ports are unchanged. The
plugin no longer opens a tab unless that setting is agent. An upgrade drops the
old toggle and defaults to `manual` even if auto-open was on. Agents get a live
open-mode line each turn. Static tool copy does not tell them to start.

0.2.6 is Preview Share/Unshare, Ports filter (preview-owned and shared first), and cancelable kill confirm. Share stamps the preview row. Stop forgets the share cache.

0.2.4 added the **Ports** sidebar plus `bb preview ports` / `share` / `unshare` / `kill`.
Git install of `v0.2.4` failed. 0.2.5 keeps port wire schemas out of the SDK module so
the git frontend build can run. Leave `v0.2.4` and `v0.2.5` in place. Do not retag them.

Scanner/kill behavior is adapted from MIT-licensed port-whisperer; see
`app/THIRD_PARTY.md`.

## Commands

From `forsvn/app-preview/app`:

```bash
npm install
npm test
bb plugin install .
bb plugin reload app-preview
```

## Next action

Publish 0.2.9, point get-bb/marketplace#194 at the new tag, add overview, ping Sawyer.
