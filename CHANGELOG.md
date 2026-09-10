# App Preview changelog

## 2026-09-07

- Plugin 0.2.8: Open/share prefer Vite/Next `Local:` (and UI lines) over an earlier API listen URL. On a port change, share the new port before dropping the old connect expose.
- Plugin 0.2.7: **Open the in-app browser** is now `manual` (default) or `agent`. Start does not open a tab unless set to agent. Stop closes it only in agent mode. Upgrades default to `manual` regardless of the old auto-open toggle. Agents get a live open-mode line each turn.

## 2026-09-06

- Plugin 0.2.6: Preview Share/Unshare, Ports filter (preview-owned/shared first), cancelable kill confirm. Share stamps the preview row; Stop forgets the share cache.
- Preview panel Share exposes the running port over bb connect when start did not get a getbb.app URL.
- README: looping Preview panel demo (12s clip, 1.2 MB GIF).
- Plugin 0.2.5: git install builds again. The Ports panel no longer pulls `@get-bb/plugin-sdk` into the frontend bundle.
- Plugin 0.2.4: **Ports** sidebar plus `bb preview ports` / `share` / `unshare` / `kill`. Share is a bb connect URL. Share and kill refuse Docker-published ports and system apps. Start binds Node dev servers to 127.0.0.1 so Connect is not ECONNREFUSED on IPv6-only localhost.
- Plugin 0.2.3: setting **Automatically open and close the in-app browser** (default on). Turn it off to open and close the tab yourself.

## 2026-09-05

- Product root moved from `personal/app-preview/` to `forsvn/app-preview/`. Public host stays
  `hungv47/bb-plugin-app-preview`.
- Plugin 0.2.2: on this Mac, Preview Open uses `bb connect expose` (`https://hung--<port>.getbb.app`) instead of failing the plugin tunnel.
- Plugin 0.2.1: a retiring or gone worktree is explained in the panel instead of `HTTP 409: Environment unavailable`. Restart does not stop a preview that is already running there.
- Plugin 0.2.0: start opens BB's in-app browser; stop closes it. No extra click.
- Marketplace listing remains get-bb/marketplace#194.
