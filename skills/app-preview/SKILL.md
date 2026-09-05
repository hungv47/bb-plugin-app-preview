---
name: app-preview
description: Detect, start, stop, and open the app in the current BB thread worktree. Use when the user wants to preview, run, launch, or test the app from a session, try a branch in the browser, or keep a dev server running in the Preview panel.
---

# App preview

This plugin runs the worktree (or branch checkout) attached to the current thread. It detects the framework and start command, launches the app in a BB terminal, and by default opens the ready URL in BB's in-app browser. Stop closes that browser. Users can turn auto-open off under plugin settings and use Open in browser themselves.

Prefer `bb preview` over guessing `package.json` scripts.

## Commands

| Command | Effect |
| --- | --- |
| `bb preview detect` | Identify framework, package manager, start command, and port |
| `bb preview start` | Launch in a thread terminal and open the in-app browser when ready (unless auto-open is off) |
| `bb preview stop` | Stop that worktree's preview process and close its in-app browser (unless auto-open is off) |
| `bb preview restart` | Stop, then start again |
| `bb preview status` | Detection plus running/stopped state and URLs |

Add `--json` when the output drives later steps. From outside a thread, pass `--thread <id>`.

Optional start flags: `--command "<cmd>"`, `--cwd <dir>` (a detected app directory), `--port <n>`.

The native tool `preview_app` is the same actions (`detect`, `start`, `stop`, `restart`, `status`) with optional `command`, `port`, and `relativeCwd`.

## Procedure

1. Run `bb preview detect` in this thread.
2. If several apps are listed, start the one the user wants with `--cwd`.
3. If detection found an app, `bb preview start`. If it did not, ask before inventing a command, or pass `--command`.
4. Give the user the `Open:` URL as a markdown link. That URL is a bb connect share when pairing is available, so it works from hung.getbb.app. Do not paste a localhost URL as the thing they should click while they are remote.
5. By default the in-app browser opens when the server is ready and stop closes it. If auto-open is off, give them the Open URL and let them use the Preview panel.
6. Stop the preview when they are done testing, unless they asked to leave it up.

## Rules

- Start and stop through this plugin so the panel, terminal, shared port, and in-app browser stay in sync.
- One preview per worktree. Starting again while it is already running returns the existing process and re-opens the browser if it is missing.
- After start, prefer the plugin's Open URL over guessing localhost.
- Pass `--cwd` / `relativeCwd` for the app directory. Do not bake `cd … &&` into `--command`.
