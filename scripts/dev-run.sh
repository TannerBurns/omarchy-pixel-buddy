#!/usr/bin/env bash
# Runs the plugin from this checkout in its own Quickshell instance, with live
# reload on save and a scratch settings file. Disable the installed copy first
# (omarchy plugin disable tannerburns.pixel-buddy) or you'll see two buddies.
#
#   bash scripts/dev-run.sh              # foreground; Ctrl+C to stop
#   qs ipc -p "$XDG_RUNTIME_DIR/pixel-buddy-dev" call pixel-buddy status
set -euo pipefail

REPO=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DEV="${XDG_RUNTIME_DIR:-/tmp}/pixel-buddy-dev"
SHELL_DIR="${OMARCHY_PATH:-/usr/share/omarchy}/shell"

mkdir -p "$DEV/state"
# Symlinks live here, outside the plugin folder (omarchy plugin validate
# refuses symlinks inside it).
ln -sfn "$SHELL_DIR/Commons" "$DEV/Commons"
ln -sfn "$SHELL_DIR/Ui" "$DEV/Ui"
ln -sfn "$REPO" "$DEV/plugin"
cp "$REPO/dev/harness.qml" "$DEV/shell.qml"
[[ -f $DEV/shell.json ]] || printf '{\n  "version": 1,\n  "plugins": [{ "id": "tannerburns.pixel-buddy" }]\n}\n' >"$DEV/shell.json"

export PIXEL_BUDDY_DEV="$DEV"
exec qs -p "$DEV" "$@"
