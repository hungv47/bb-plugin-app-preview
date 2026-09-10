# App Preview

Hung's BB plugin for starting a worktree app and opening it in BB's in-app browser.
Canonical source is this repository: `hungv47/bb-plugin-app-preview`.
Live clone: `~/ipse-composed/forsvn/app-preview`.

## Commands

From `app/`:

```bash
npm install
npm test
bb plugin install .
bb plugin reload app-preview
```

Path-install from `app/`. After edits, `bb plugin reload app-preview`.

## Layout

- Horsemen and this file at the product root
- `app/` is the plugin package

## Source and publish

Edit and tag this origin. Do not run `scripts/publish-mirror.sh` from this clone;
that wrapper expects ipse `_hq/tools/publish-public-mirror.sh`.
Marketplace listing is `hungv47/marketplace` branch `submit-app-preview`
([get-bb/marketplace#194](https://github.com/get-bb/marketplace/pull/194)).
