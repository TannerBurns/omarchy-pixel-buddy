#!/usr/bin/env bash
# Watches the git repositories under the given folders and prints a token for
# each commit and push, for Pixel Buddy's git celebrations. It reads only the
# reflogs (git's local record of where HEAD and the remote-tracking branches
# moved) and only the action word of each entry. Commit subjects, branch
# names, paths, emails and hashes never leave this script.
#
#   git-watch.sh [--poll SECONDS] ROOT...
#
# stdout, one line per event, flushed as it happens:
#   # repos N    once, after discovery: how many repositories it watches
#   C commit     a commit (also the first one, a merge commit, a real merge)
#   C amend      git commit --amend
#   R push       a push moved a remote-tracking branch
# Fetch, pull, checkout, reset, rebase and the rest print nothing, and history
# from before it started never counts.
#
# Exit codes: 0 stopped by SIGTERM/SIGINT, 2 usage, 3 inotifywait is missing
# (run it again with --poll), 4 no repositories under the roots.

set -uo pipefail
export LC_ALL=C   # byte offsets: ${#var} must count bytes, not characters

usage() {
  echo "usage: git-watch.sh [--poll SECONDS] ROOT..." >&2
  exit 2
}

POLL=0
ROOTS=()
while (( $# > 0 )); do
  case $1 in
    --poll)
      [[ ${2:-} =~ ^[0-9]{1,4}$ ]] || usage
      POLL=$((10#$2))
      (( POLL >= 1 && POLL <= 3600 )) || usage
      shift 2
      ;;
    --) shift; ROOTS+=("$@"); break ;;
    -*) usage ;;
    *) ROOTS+=("$1"); shift ;;
  esac
done
(( ${#ROOTS[@]} > 0 )) || usage

if (( POLL == 0 )) && ! command -v inotifywait >/dev/null 2>&1; then
  echo "git-watch: inotifywait is not installed; run with --poll" >&2
  exit 3
fi

# Entries stamped before this (less a little clock slack) never count, even in
# a file it has never seen (a renamed remote, a reflog that appears later).
START=$EPOCHSECONDS
MAX_REPOS=200
PARENT=$PPID             # the shell; when it goes away, so does this

GITDIRS=()
COMMONS=()
declare -A SEEN=()
declare -A OFF=()        # reflog path -> bytes already read
WATCH_DIRS=()
INOTIFY_PID=""
GUARD_PID=""
SLEEP_PID=""

cleanup() {
  local pid
  for pid in "$INOTIFY_PID" "$GUARD_PID" "$SLEEP_PID"; do
    if [[ -n $pid ]]; then kill "$pid" 2>/dev/null; fi
  done
  return 0
}
trap cleanup EXIT
trap 'exit 0' TERM INT

# ---------------------------------------------------------------- discovery

# Resolves a .git entry to its gitdir and common dir (REPLY_GIT, REPLY_COMMON).
# A .git file (worktree, submodule) points at its gitdir; a worktree's gitdir
# names the shared common dir in its commondir file.
resolve() {
  local entry=$1 dir rel=""
  REPLY_GIT=""
  REPLY_COMMON=""
  if [[ -d $entry ]]; then
    dir=$entry
  elif [[ -f $entry ]]; then
    IFS= read -r rel <"$entry" || [[ -n $rel ]] || return 1
    rel=${rel%$'\r'}
    [[ $rel == "gitdir: "* ]] || return 1
    rel=${rel#gitdir: }
    [[ $rel == /* ]] || rel=${entry%/*}/$rel
    dir=$rel
  else
    return 1
  fi
  REPLY_GIT=$(cd -- "$dir" 2>/dev/null && pwd -P) || return 1
  REPLY_COMMON=$REPLY_GIT
  if [[ -f $REPLY_GIT/commondir ]]; then
    rel=""
    IFS= read -r rel <"$REPLY_GIT/commondir" || [[ -n $rel ]] || return 1
    rel=${rel%$'\r'}
    [[ $rel == /* ]] || rel=$REPLY_GIT/$rel
    REPLY_COMMON=$(cd -- "$rel" 2>/dev/null && pwd -P) || return 1
  fi
  return 0
}

# Reftable repositories keep their reflogs in binary tables: nothing to read.
reftable() {
  [[ -d $1/reftable ]] && return 0
  [[ -f $1/config ]] && grep -Eiq '^[[:space:]]*refstorage[[:space:]]*=[[:space:]]*reftable' "$1/config" 2>/dev/null
}

discover() {
  local roots=() root entry
  for root in "${ROOTS[@]}"; do
    if [[ $root == /* && -d $root ]]; then roots+=("$root"); fi
  done
  (( ${#roots[@]} > 0 )) || return 0
  while IFS= read -r -d '' entry <&3; do
    (( ${#GITDIRS[@]} < MAX_REPOS )) || break
    resolve "$entry" || continue
    [[ -z ${SEEN[$REPLY_GIT]:-} ]] || continue
    reftable "$REPLY_COMMON" && continue
    SEEN[$REPLY_GIT]=1
    GITDIRS+=("$REPLY_GIT")
    COMMONS+=("$REPLY_COMMON")
  done 3< <(find "${roots[@]}" -mindepth 1 -maxdepth 4 \
    \( -type d \( -name node_modules -o -name vendor -o -name target -o -name build -o -name dist \) -prune \) -o \
    \( -type d -name '.*' ! -name .git -prune \) -o \
    \( -name .git \( -type d -o -type f \) -print0 -prune \) 2>/dev/null)
}

# The reflogs worth reading: each worktree's HEAD and the remote-tracking
# branches. (Branch reflogs repeat what HEAD says; lock files are temporary.)
relevant() {
  case $1 in
    *.lock) return 1 ;;
    */logs/refs/remotes/*) return 0 ;;
    */logs/HEAD) return 0 ;;
    *) return 1 ;;
  esac
}

# Every logs folder that exists right now, once each.
logs_dirs() {
  local i d
  local -A had=()
  LOGS_DIRS=()
  for i in "${!GITDIRS[@]}"; do
    for d in "${GITDIRS[$i]}/logs" "${COMMONS[$i]}/logs"; do
      if [[ -d $d && -z ${had[$d]:-} ]]; then
        had[$d]=1
        LOGS_DIRS+=("$d")
      fi
    done
  done
}

# Lists relevant reflogs as "size path" records (NUL-separated) on stdout.
list_reflogs() {
  (( $# > 0 )) || return 0
  find "$@" \( -path '*/logs/HEAD' -o -path '*/logs/refs/remotes/*' \) -type f ! -name '*.lock' \
    -printf '%s %p\0' 2>/dev/null
}

# ---------------------------------------------------------------- reading

# Starts counting a reflog from its current end (startup, or a reflog that was
# rewritten or renamed into place).
remember() {
  local size
  relevant "$1" || return 0
  size=$(stat -c %s -- "$1" 2>/dev/null) || return 0
  OFF[$1]=$size
  return 0
}

# Prints the token for one reflog entry, if any. kind: head | remote.
classify() {
  local kind=$1 line=$2 header msg ts action rest
  [[ $line == *$'\t'* ]] || return 0
  header=${line%%$'\t'*}
  msg=${line#*$'\t'}
  ts=${header##*> }
  ts=${ts%% *}
  [[ $ts =~ ^[0-9]{1,12}$ ]] || return 0
  (( 10#$ts >= START - 5 )) || return 0
  if [[ $kind == remote ]]; then
    if [[ $msg == "update by push" ]]; then printf 'R push\n'; fi
    return 0
  fi
  action=${msg%%:*}
  case $action in
    commit | "commit (initial)" | "commit (merge)") printf 'C commit\n' ;;
    "commit (amend)") printf 'C amend\n' ;;
    "merge "*)
      rest=${msg#*: }
      if [[ $msg == *": "* && $rest != Fast-forward ]]; then printf 'C commit\n'; fi
      ;;
  esac
  return 0
}

# Reads the complete lines appended to a reflog since the last read. A file
# that shrank was rewritten: start again at its end without reporting.
read_new() {
  local file=$1 kind size off chunk complete line
  relevant "$file" || return 0
  case $file in
    */logs/refs/remotes/*) kind="remote" ;;
    *) kind="head" ;;
  esac
  size=$(stat -c %s -- "$file" 2>/dev/null) || return 0
  off=${OFF[$file]:-0}
  if (( size < off )); then
    OFF[$file]=$size
    return 0
  fi
  (( size > off )) || return 0
  chunk=$(tail -c +"$((off + 1))" -- "$file" 2>/dev/null; printf .)
  chunk=${chunk%.}
  [[ $chunk == *$'\n'* ]] || return 0
  complete=${chunk%$'\n'*}
  OFF[$file]=$((off + ${#complete} + 1))
  while IFS= read -r line; do
    classify "$kind" "$line"
  done <<<"$complete"
  return 0
}

init_offsets() {
  local rec
  logs_dirs
  WATCH_DIRS=("${LOGS_DIRS[@]}")
  while IFS= read -r -d '' rec <&3; do
    OFF[${rec#* }]=${rec%% *}
  done 3< <(list_reflogs "${LOGS_DIRS[@]}")
}

# ---------------------------------------------------------------- watching

# Ends the watcher when the shell that started it goes away (a shell restart
# doesn't signal its children: this script would only notice at its next
# write), and takes inotifywait down if this script is killed outright
# (SIGKILL skips the EXIT trap). Checks every 5 seconds without forking
# anything but the sleep.
guard() {
  local main=$1 parent=$2 child=${3:-} stat ppid
  while true; do
    sleep 5
    IFS= read -r stat 2>/dev/null <"/proc/$main/stat" || break
    stat=${stat##*) }
    stat=${stat#* }
    ppid=${stat%% *}
    [[ $ppid == "$parent" ]] || break
    if [[ -n $child ]] && ! kill -0 "$child" 2>/dev/null; then return 0; fi
  done
  kill -TERM "$main" 2>/dev/null
  if [[ -n $child ]]; then kill "$child" 2>/dev/null; fi
  return 0
}

# (Re)starts the guard; $1 is inotifywait's pid while it runs.
start_guard() {
  if [[ -n $GUARD_PID ]]; then kill "$GUARD_PID" 2>/dev/null; fi
  guard "$$" "$PARENT" "${1:-}" &
  GUARD_PID=$!
}

watch_inotify() {
  local event path
  exec 3< <(exec inotifywait -m -r -q -e close_write -e moved_to --format '%e %w%f' "${WATCH_DIRS[@]}" 2>/dev/null)
  INOTIFY_PID=$!
  start_guard "$INOTIFY_PID"
  while IFS=' ' read -r event path <&3; do
    case $event in
      *MOVED_TO*) remember "$path" ;;
      *CLOSE_WRITE*) read_new "$path" ;;
    esac
  done
  exec 3<&-
  # inotifywait stopped (watch limit, every watched folder removed): poll instead.
  INOTIFY_PID=""
  start_guard
}

# One polling pass: reads whatever grew, including reflogs and logs folders
# that appeared since the last pass.
poll_pass() {
  local rec size file
  logs_dirs
  (( ${#LOGS_DIRS[@]} > 0 )) || return 0
  while IFS= read -r -d '' rec <&3; do
    size=${rec%% *}
    file=${rec#* }
    [[ ${OFF[$file]:-} == "$size" ]] && continue
    read_new "$file"
  done 3< <(list_reflogs "${LOGS_DIRS[@]}")
}

# ---------------------------------------------------------------- main

discover
printf '# repos %d\n' "${#GITDIRS[@]}"
(( ${#GITDIRS[@]} > 0 )) || exit 4
init_offsets

if (( POLL == 0 )) && (( ${#WATCH_DIRS[@]} > 0 )); then watch_inotify; fi
(( POLL > 0 )) || POLL=30
[[ -n $GUARD_PID ]] || start_guard

while true; do
  sleep "$POLL" &
  SLEEP_PID=$!
  wait "$SLEEP_PID"
  SLEEP_PID=""
  poll_pass
done
