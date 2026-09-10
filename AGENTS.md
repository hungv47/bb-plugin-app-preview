# App Preview

Hung's BB plugin for starting a worktree app and opening it in BB's in-app browser. Canonical
source is this product root. Public archive is hungv47/bb-plugin-app-preview.

## Commands

From `forsvn/app-preview/app`:

```bash
npm install
npm test
bb plugin install .
bb plugin reload app-preview
```

Path-install from `app/`. After edits, `bb plugin reload app-preview`.

## Layout

- Horsemen and this file at the product root
- `app/` is the plugin package and the public export source
- `scripts/publish-mirror.sh` wraps `_hq/tools/publish-public-mirror.sh` for name `app-preview`

## Source and publish

Edit in ipse worktrees. The product lives as ordinary files inside hungv47/ipse. Publish only
through `scripts/publish-mirror.sh` or `_hq/tools/publish-public-mirror.sh` after Hung approves
push. Nested git is forbidden. Push and `publish-public-mirror.sh push` wait on that approval.
