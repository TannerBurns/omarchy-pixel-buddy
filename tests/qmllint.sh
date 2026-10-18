#!/usr/bin/env bash
# Lints the plugin's QML with Qt's qmllint against the installed Omarchy shell
# modules (qs.Commons, qs.Ui), without starting a shell. Fails on missing
# imports/types, syntax errors and other hard errors; the many "member not
# found" warnings from Omarchy's dynamically typed theme objects are ignored.
# Local only: CI has no Omarchy install. Usage: bash tests/qmllint.sh
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
SHELL_DIR="${OMARCHY_PATH:-/usr/share/omarchy}/shell"
LINT=/usr/lib/qt6/bin/qmllint
[[ -x $LINT ]] || LINT=$(command -v qmllint)
[[ -d $SHELL_DIR/Commons && -n $LINT ]] || { echo "needs Omarchy and qmllint" >&2; exit 1; }

TMP=$(mktemp -d "${TMPDIR:-/tmp}/pixel-buddy-qmllint.XXXXXX")
trap 'rm -rf -- "$TMP"' EXIT
mkdir -p "$TMP/qs"
ln -s "$SHELL_DIR/Commons" "$TMP/qs/Commons"
ln -s "$SHELL_DIR/Ui" "$TMP/qs/Ui"

mapfile -t files < <(find "$ROOT" -maxdepth 1 -name '*.qml' | sort)
# Quickshell ships a few types qmllint cannot see (Toplevel, PendingRegion);
# those unresolved-type warnings are harmless. Any other one is a real typo.
"$LINT" -I "$TMP" --json "$TMP/report.json" "${files[@]}" >/dev/null 2>&1 || true
jq -r '
  .files[] as $f
  | $f.warnings[]
  | select(.type == "error"
      or (.id // "" | IN("import", "inheritance-cycle", "required", "syntax"))
      or (.id == "unresolved-type" and ((.message // "") | test("qs::|PendingRegion") | not)))
  | "\($f.filename | split("/") | last):\(.line // 0): \(.message)"
' "$TMP/report.json" | tee "$TMP/failures"
[[ ! -s $TMP/failures ]]
