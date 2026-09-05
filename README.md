# App Preview

BB plugin that finds the app in the current thread's worktree, starts it in a thread terminal, and opens it in BB's in-app browser. Stop closes that browser. No extra click.

Path: **Preview** in the thread side panel, the play control in the thread header, or **Preview app** in the command palette. Agents use `bb preview` or the `preview_app` tool.

In a monorepo it lists every startable app it finds. Pick one. Start/Stop/Restart stay on that process. Remote clients get a bb connect share URL instead of localhost.

## Install

```
bb plugin install git:github.com/hungv47/bb-plugin-app-preview@semver:^0.2.0
```

From a local checkout:

```
npm install
bb plugin install .
```

Reload after edits with `bb plugin reload app-preview`, or run `bb plugin dev` while you work.

## CLI

```
bb preview detect
bb preview start [--command <cmd>] [--cwd <dir>] [--port <n>]
bb preview stop
bb preview restart
bb preview status
```

Add `--json` when a later step needs the structured result. Pass `--thread <id>` outside a session.

## Settings

- **Install dependencies before start** (default on)
- **Automatically open and close the in-app browser** (default on). When off, start does not open a tab and stop does not close one. Use **Open in browser**.
- **Seconds to wait for a ready URL** (default 90)

`bb plugin config app-preview`

## Types

SDK types come from `@get-bb/plugin-sdk` `0.4.34`. `bb plugin types` repins them to the BB you are running.
