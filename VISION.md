# App Preview vision

App Preview is Hung's FORSVN BB plugin. It finds a startable app in a thread worktree and starts it
in a thread terminal. You open the in-app browser yourself, or agents open it when the app is ready.
Stop closes that browser in agent mode. Remote clients need a
bb connect share URL, not localhost.

Ports lists listening TCP ports on the BB server machine and can kill a listener by port or PID.
Share exposes a port over bb connect so a phone can hit it. Start binds Node
dev servers to 127.0.0.1 because Connect forwards to that address, not `[::1]`.

Source lives in this product root. The public host is `hungv47/bb-plugin-app-preview` through
`_hq/tools/publish-public-mirror.sh`.

## Boundaries

One preview process per worktree. Ports is a separate list/kill of what is already listening.
It is not logs, watch, or a general `ps`. Share and kill refuse Docker-published ports and system apps.
