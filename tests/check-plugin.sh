#!/usr/bin/env bash
# Static checks for the plugin folder. Runs anywhere with bash and jq,
# including CI, where Omarchy itself isn't installed.
#
# The manifest rules mirror Omarchy's `omarchy plugin validate`
# (bin/omarchy-plugin-validate). The rest are this repo's own consistency checks.
# Usage: bash tests/check-plugin.sh [plugin-folder]   → prints problems, exits 1 if any

set -uo pipefail
DIR=${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)}
M="$DIR/manifest.json"
problems=0
bad() { printf '  - %s\n' "$*"; problems=$((problems + 1)); }

# ---- manifest (mirrors omarchy plugin validate)
if ! jq -e . "$M" >/dev/null 2>&1; then
  bad "manifest.json is missing or not valid JSON"
else
  jq -e '.schemaVersion == 1' "$M" >/dev/null || bad "schemaVersion must be the number 1"
  for field in id name version kinds entryPoints; do
    jq -e --arg f "$field" 'has($f)' "$M" >/dev/null || bad "manifest missing '$field'"
  done
  id=$(jq -r '.id // ""' "$M")
  [[ $id =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ && $id != *..* ]] || bad "invalid plugin id '$id'"
  [[ $id != omarchy.* ]] || bad "id uses the reserved omarchy.* namespace"
  jq -e '(.kinds | type) == "array" and (.kinds | length) > 0' "$M" >/dev/null || bad "'kinds' must be a non-empty array"
  jq -e '(.entryPoints | type) == "object"' "$M" >/dev/null || bad "'entryPoints' must be an object"
  while IFS= read -r ep; do
    [[ -n $ep && $ep != /* && $ep != *..* ]] || { bad "unsafe entry point '$ep'"; continue; }
    [[ -f $DIR/$ep ]] || bad "entry point not found: $ep"
  done < <(jq -r '.entryPoints[]' "$M")
  for pair in bar:bar bar-widget:barWidget menu:menu overlay:overlay panel:panel service:service; do
    kind=${pair%%:*}; key=${pair##*:}
    if jq -e --arg k "$kind" '.kinds | index($k) != null' "$M" >/dev/null; then
      jq -e --arg e "$key" '.entryPoints | has($e)' "$M" >/dev/null || bad "kind '$kind' needs entryPoints.$key"
    fi
  done
fi
link=$(find "$DIR" -name .git -prune -o -type l -print -quit)
[[ -z $link ]] || bad "symlink inside the plugin folder: ${link#"$DIR"/}"

# ---- versions agree (manifest, the running service, the README release line)
mv=$(jq -r '.version // ""' "$M" 2>/dev/null)
sv=$(sed -nE 's/^[[:space:]]*readonly property string version: "([^"]*)".*/\1/p' "$DIR/Service.qml" | head -n1)
[[ $mv == "$sv" ]] || bad "manifest version ($mv) != Service.qml version ($sv)"
if [[ -f $DIR/BarWidget.qml ]]; then
  bv=$(sed -nE 's/^[[:space:]]*readonly property string version: "([^"]*)".*/\1/p' "$DIR/BarWidget.qml" | head -n1)
  [[ $mv == "$bv" ]] || bad "manifest version ($mv) != BarWidget.qml version ($bv)"
  jq -e '.barWidget.allowMultiple == false and (.barWidget.defaultSection | IN("left", "center", "right"))' "$M" >/dev/null ||
    bad "barWidget needs allowMultiple false and a defaultSection"
fi

# ---- every JSON file parses (characters, fixtures, manifest)
while IFS= read -r f; do
  jq -e . "$f" >/dev/null 2>&1 || bad "invalid JSON: ${f#"$DIR"/}"
done < <(find "$DIR" -name .git -prune -o -name '*.json' -type f -print)

# ---- nothing writes into the plugin folder at runtime (the shell reloads every
# plugin on any write there). Only the state file in Service.qml is written.
writers=$(grep -l 'setText(' "$DIR"/*.qml 2>/dev/null | xargs -r -n1 basename | sort | tr '\n' ' ')
[[ $writers == "Service.qml " || -z $writers ]] || bad "unexpected file writes in: $writers(only Service.qml writes state)"
grep -n 'path: root.stateDir' "$DIR/Service.qml" >/dev/null || bad "Service.qml state file must live under stateDir"

# ---- shell scripts parse
while IFS= read -r f; do
  bash -n "$f" || bad "${f#"$DIR"/} has a bash syntax error"
done < <(find "$DIR/tests" "$DIR/scripts" "$DIR/hooks" "$DIR/helpers" -name '*.sh' -type f 2>/dev/null)

if (( problems )); then exit 1; fi
echo "  plugin checks passed"
