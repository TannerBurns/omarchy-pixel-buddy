#!/usr/bin/env bash
# Test suite. Usage: bash tests/run.sh
# Needs bash, jq and node (>= 20). qmllint runs too when Omarchy and Qt's
# qmllint are installed (local machines, not CI).

set -uo pipefail
TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PLUGIN_DIR=$(dirname -- "$TESTS_DIR")

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf '  ok    %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$1"; [[ -n ${2:-} ]] && printf '%s\n' "$2" | sed 's/^/        /'; }
skip() { printf '  skip  %s\n' "$1"; }

echo "static"
if out=$(bash "$TESTS_DIR/check-plugin.sh" "$PLUGIN_DIR" 2>&1); then pass "plugin checks (manifest, versions, JSON, scripts)"; else fail "plugin checks" "$out"; fi
if command -v shellcheck >/dev/null; then
  mapfile -t scripts < <(find "$PLUGIN_DIR/tests" "$PLUGIN_DIR/scripts" "$PLUGIN_DIR/hooks" "$PLUGIN_DIR/helpers" -name '*.sh' -type f)
  if out=$(shellcheck -S warning "${scripts[@]}" 2>&1); then pass "shellcheck"; else fail "shellcheck" "$out"; fi
else
  skip "shellcheck (not installed)"
fi

echo "unit"
if ! command -v node >/dev/null; then
  fail "node is required for the unit tests"
else
  shopt -s nullglob
  tests=("$TESTS_DIR"/js/*.test.cjs)
  if (( ${#tests[@]} == 0 )); then
    fail "no unit tests found"
  elif out=$(node --test --test-reporter=tap "${tests[@]}" 2>&1); then
    pass "node --test ($(sed -nE 's/^# pass ([0-9]+)/\1/p' <<<"$out") passed)"
  else
    fail "node --test" "$(grep -E 'not ok|Error|expected|actual|location' <<<"$out" | head -40)"
  fi
fi

echo "helpers"
if command -v git >/dev/null; then
  if out=$(bash "$TESTS_DIR/git-watch.test.sh" 2>&1); then
    pass "git watcher ($(grep -c '^  ok ' <<<"$out") checks)"
  else
    fail "git watcher" "$(grep -E '^  FAIL|rror' <<<"$out" | head -20)"
  fi
else
  skip "git watcher (needs git)"
fi

echo "characters"
if out=$(node "$PLUGIN_DIR/scripts/lint-characters.mjs" 2>&1); then pass "character lint ($(tail -n1 <<<"$out"))"; else fail "character lint" "$out"; fi

echo "qml"
QMLLINT=/usr/lib/qt6/bin/qmllint
if [[ -x $QMLLINT && -d /usr/share/omarchy/shell/Commons ]]; then
  if out=$(bash "$TESTS_DIR/qmllint.sh" 2>&1); then pass "qmllint (imports, types, syntax)"; else fail "qmllint" "$out"; fi
else
  skip "qmllint (needs Omarchy and qt6-declarative)"
fi

echo
echo "passed: $PASS  failed: $FAIL"
(( FAIL == 0 ))
