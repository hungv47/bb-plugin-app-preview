# App Preview

BB plugin that finds the app in the current thread's worktree, starts it in a thread terminal, and opens it in BB's in-app browser. Stop closes that browser. No extra click.

**Ports** in the sidebar lists listening TCP ports on this machine and can kill a listener. Dev servers show by default; Show all includes system apps. Share gives a bb connect URL for phone/remote preview. Unshare removes it. Share and kill refuse Docker-published ports and system apps.

Path: **Preview** in the thread side panel, the play control in the thread header, or **Preview app** in the command palette. Agents use `bb preview` or the `preview_app` / `preview_ports` tools.

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
bb preview ports [--all]
bb preview share <port>
bb preview unshare <port>
bb preview kill [--force] <port|pid|range>
```

Add `--json` when a later step needs the structured result. Pass `--thread <id>` outside a session for detect/start/stop/restart/status.

## Settings

- **Install dependencies before start** (default on)
- **Automatically open and close the in-app browser** (default on). When off, start does not open a tab and stop does not close one. Use **Open in browser**.
- **Seconds to wait for a ready URL** (default 90)

`bb plugin config app-preview`

## Attribution

Port scan/kill behavior is adapted from [port-whisperer](https://github.com/LarsenCundric/port-whisperer) (MIT). See `THIRD_PARTY.md`.

## Types

SDK types come from `@get-bb/plugin-sdk` `0.4.34`. `bb plugin types` repins them to the BB you are running.
