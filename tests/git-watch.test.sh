#!/usr/bin/env bash
# Tests helpers/git-watch.sh against real repositories in a temp folder:
# commits, amends, merges and pushes are reported; checkout, fetch, rebase and
# reset are not; history from before it started never counts; no subject,
# path or hash ever reaches its output. Polling mode always runs; inotify
# mode runs when inotifywait is installed.
#
#   bash tests/git-watch.test.sh

set -uo pipefail

TESTS_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WATCH="$(dirname -- "$TESTS_DIR")/helpers/git-watch.sh"
TMP=$(mktemp -d)
WPID=""
FAILS=0

cleanup() {
  if [[ -n $WPID ]]; then kill "$WPID" 2>/dev/null; wait "$WPID" 2>/dev/null; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

ok() { printf '  ok    %s\n' "$1"; }
bad() {
  FAILS=$((FAILS + 1))
  printf '  FAIL  %s\n' "$1"
  if [[ -n ${2:-} ]]; then printf '%s\n' "$2" | sed 's/^/        /'; fi
}

# Git without the user's config (no signing, hooks or templates), with a
# fixed identity and no prompts or editors.
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
export GIT_AUTHOR_NAME="Pixel Test" GIT_AUTHOR_EMAIL="pixel@example.invalid"
export GIT_COMMITTER_NAME="Pixel Test" GIT_COMMITTER_EMAIL="pixel@example.invalid"
export GIT_TERMINAL_PROMPT=0 GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

MARKER="pbsecret${RANDOM}x$$"   # in every commit subject; must never be printed
NAME="" ROOT="" WORK="" REMOTE="" OUT=""

g() { git -C "$WORK" "$@" >/dev/null 2>&1; }

# A work repo under ROOT (pushed initial commit, a feature branch, one unpushed
# commit on main) and a bare remote outside it. All before the watcher starts.
setup() {
  ROOT="$TMP/$NAME/root"
  REMOTE="$TMP/$NAME/remote.git"
  WORK="$ROOT/work"
  mkdir -p "$ROOT"
  git init -q --bare "$REMOTE"
  git init -q -b main "$WORK"
  echo one >"$WORK/a.txt"
  g add a.txt
  g commit -m "initial $MARKER"
  g remote add origin "$REMOTE"
  g push -u origin main
  g checkout -b feature
  echo feature >"$WORK/b.txt"
  g add b.txt
  g commit -m "feature $MARKER"
  g checkout main
  echo two >>"$WORK/a.txt"
  g commit -am "main two $MARKER"
}

count() { grep -cE "$1" "$OUT" 2>/dev/null || true; }

# Waits up to $3 seconds for at least $2 lines matching $1.
wait_for() {
  local deadline=$((SECONDS + $3))
  while (( SECONDS <= deadline )); do
    (( $(count "$1") >= $2 )) && return 0
    sleep 0.1
  done
  return 1
}

expect() {   # commits amends pushes label
  local c a r
  c=$(count '^C commit$')
  a=$(count '^C amend$')
  r=$(count '^R push$')
  if [[ $c == "$1" && $a == "$2" && $r == "$3" ]]; then ok "$4"
  else bad "$4" "got $c commit / $a amend / $r push lines, expected $1 / $2 / $3"; fi
}

run_mode() {   # name, quiet seconds, watcher options...
  NAME=$1
  local quiet=$2 rc=0
  shift 2
  setup
  OUT="$TMP/$NAME.out"
  : >"$OUT"
  bash "$WATCH" "$@" "$ROOT" >"$OUT" 2>"$TMP/$NAME.err" &
  WPID=$!
  if wait_for '^# repos 1$' 1 10; then ok "$NAME: announces # repos 1"
  else bad "$NAME: announces # repos 1" "$(cat "$OUT" "$TMP/$NAME.err")"; return; fi
  sleep "$quiet"

  # Touch the reflogs without adding to them: old entries must stay old.
  : >>"$WORK/.git/logs/HEAD"
  : >>"$WORK/.git/logs/refs/remotes/origin/main"
  sleep "$quiet"
  expect 0 0 0 "$NAME: earlier history never counts"

  g checkout -b scratch
  g checkout main
  g fetch origin
  g checkout feature
  g rebase main
  g checkout main
  g reset --hard HEAD
  sleep "$quiet"
  expect 0 0 0 "$NAME: checkout, fetch, rebase and reset print nothing"

  echo three >>"$WORK/a.txt"
  g commit -am "three $MARKER"
  wait_for '^C commit$' 1 10
  expect 1 0 0 "$NAME: a commit prints C commit"

  g commit --amend -m "three amended $MARKER"
  wait_for '^C amend$' 1 10
  expect 1 1 0 "$NAME: an amend prints C amend"

  g push origin main
  wait_for '^R push$' 1 10
  expect 1 1 1 "$NAME: a push prints R push"

  g merge --no-ff -m "merge $MARKER" feature
  wait_for '^C commit$' 2 10
  sleep "$quiet"
  expect 2 1 1 "$NAME: a real merge prints C commit, once"

  if grep -q "$MARKER" "$OUT" "$TMP/$NAME.err"; then bad "$NAME: no commit subject in the output" "$(cat "$OUT")"
  else ok "$NAME: no commit subject in the output"; fi
  if grep -qvE '^(# repos [0-9]+|C commit|C amend|R push)$' "$OUT"; then bad "$NAME: only protocol lines" "$(cat "$OUT")"
  else ok "$NAME: only protocol lines"; fi
  if grep -qF "$TMP" "$TMP/$NAME.err"; then bad "$NAME: no paths on stderr" "$(cat "$TMP/$NAME.err")"
  else ok "$NAME: no paths on stderr"; fi

  kill -TERM "$WPID"
  wait "$WPID" || rc=$?
  WPID=""
  if [[ $rc == 0 ]]; then ok "$NAME: SIGTERM stops it with exit 0"; else bad "$NAME: SIGTERM stops it with exit 0" "exit $rc"; fi
  sleep 0.2
  if pgrep -f "inotifywait.*$ROOT" >/dev/null 2>&1; then bad "$NAME: leaves no inotifywait behind"
  else ok "$NAME: leaves no inotifywait behind"; fi
}

expect_exit() {   # code label watcher-args...
  local want=$1 label=$2 got
  shift 2
  got=$(bash "$WATCH" "$@" >/dev/null 2>&1; echo "$?")
  if [[ $got == "$want" ]]; then ok "$label"; else bad "$label" "exit $got"; fi
}

echo "git-watch"
mkdir -p "$TMP/empty"
expect_exit 2 "no roots: exit 2"
expect_exit 2 "--poll 0: exit 2" --poll 0 "$TMP"
expect_exit 2 "--poll soon: exit 2" --poll soon "$TMP"
expect_exit 4 "no repositories: exit 4" --poll 1 "$TMP/empty" "$TMP/missing"

# Without inotifywait on PATH (and no --poll) it asks for polling mode.
mkdir -p "$TMP/bin"
for tool in env find stat tail date sleep grep cat; do
  if tool_path=$(command -v "$tool"); then ln -s "$tool_path" "$TMP/bin/$tool"; fi
done
code=$(PATH="$TMP/bin" "$BASH" "$WATCH" "$TMP/empty" >/dev/null 2>&1; echo "$?")
if [[ $code == 3 ]]; then ok "inotifywait missing: exit 3"; else bad "inotifywait missing: exit 3" "exit $code"; fi

run_mode poll 2.2 --poll 1
if command -v inotifywait >/dev/null 2>&1; then
  run_mode inotify 0.8
else
  printf '  skip  inotify mode (inotifywait not installed)\n'
fi

# A shell restart doesn't signal its children: when the process that started
# the watcher dies, the watcher must notice and exit by itself.
orphan_check() {   # label watcher-args...
  local label=$1 parent wpid i
  shift
  bash -c 'bash "$0" "$@" >/dev/null 2>&1 & echo "$!" >"$OUT_PID"; wait' "$WATCH" "$@" &
  parent=$!
  for _ in {1..50}; do [[ -s $OUT_PID ]] && break; sleep 0.1; done
  wpid=$(<"$OUT_PID")
  rm -f "$OUT_PID"
  sleep 0.5
  if ! kill -0 "$wpid" 2>/dev/null; then bad "$label: exits when its parent dies" "the watcher never started"; return; fi
  kill -9 "$parent" 2>/dev/null
  wait "$parent" 2>/dev/null
  for i in {1..100}; do kill -0 "$wpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$wpid" 2>/dev/null; then
    bad "$label: exits when its parent dies" "still running after 10 s"
    kill "$wpid" 2>/dev/null
  else
    ok "$label: exits when its parent dies"
  fi
}
OUT_PID="$TMP/watcher.pid"
export OUT_PID
orphan_check "poll mode" --poll 1 "$ROOT"
if command -v inotifywait >/dev/null 2>&1; then orphan_check "inotify mode" "$ROOT"; fi
sleep 0.2
if pgrep -f "inotifywait.*$TMP" >/dev/null 2>&1; then bad "orphans leave no inotifywait behind"; else ok "orphans leave no inotifywait behind"; fi

(( FAILS == 0 ))
