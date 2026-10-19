// Git celebrations: turns the watcher's tokens (helpers/git-watch.sh) into a
// few well-timed reactions. At most one celebration every 20 seconds and 40 a
// day; a push right after a celebrated commit upgrades that celebration; a
// burst of events (an agent committing in a loop) mutes it for a minute;
// nothing counts while the buddy isn't on screen; during focus it only
// sparkles. The watcher never sends subjects, branches or paths, so there's
// nothing private here to keep.
// Plain JS (no .pragma, no .import) so node tests can require() it.

var GAP_MS = 20000        // between celebrations
var UPGRADE_MS = 10000    // a push this soon after a commit upgrades it
var BURST = 5             // this many events...
var BURST_MS = 60000      // ...within this window...
var MUTE_MS = 60000       // ...mute it for this long
var DAILY_CAP = 40
var MAX_ROOTS = 5

// "C commit" | "C amend" | "R push" -> "commit" | "amend" | "push"; anything
// else (the "# repos N" status line included) -> null.
function parseLine(line) {
  var s = String(line === undefined || line === null ? "" : line).replace(/\s+$/, "")
  if (s === "C commit") return "commit"
  if (s === "C amend") return "amend"
  if (s === "R push") return "push"
  return null
}

function create() {
  return { v: 1, lastAt: 0, lastKind: "", recent: [], mutedUntil: 0, day: "", count: 0 }
}

function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0 }

// A clean copy: decide() never mutates the state it's given.
function copy(state) {
  var s = state && typeof state === "object" ? state : create()
  return {
    v: 1,
    lastAt: num(s.lastAt),
    lastKind: typeof s.lastKind === "string" ? s.lastKind : "",
    recent: Array.isArray(s.recent) ? s.recent.filter(function (t) { return num(t) > 0 }) : [],
    mutedUntil: num(s.mutedUntil),
    day: typeof s.day === "string" ? s.day : "",
    count: Math.floor(num(s.count))
  }
}

// kind: "commit" | "amend" | "push"; now: ms; ctx: { visible, focus, dayKey }.
// Returns { state, action }, action null | "commit" | "push" | "upgrade" | "sparkle".
function decide(state, kind, now, ctx) {
  var c = ctx || {}
  var s = copy(state)
  if (!c.visible) return { state: s, action: null }
  if (kind !== "commit" && kind !== "amend" && kind !== "push") return { state: s, action: null }
  // A clock that went backwards must not block celebrations for good.
  if (s.lastAt > now) s.lastAt = 0
  if (s.mutedUntil - now > MUTE_MS) s.mutedUntil = 0

  s.recent = s.recent.filter(function (t) { return t <= now && now - t < BURST_MS })
  s.recent.push(now)
  if (s.recent.length >= BURST) {
    s.mutedUntil = now + MUTE_MS
    return { state: s, action: null }
  }
  if (now < s.mutedUntil) return { state: s, action: null }

  var day = typeof c.dayKey === "string" ? c.dayKey : ""
  if (day !== s.day) { s.day = day; s.count = 0 }
  if (s.count >= DAILY_CAP) return { state: s, action: null }

  if (kind === "push" && s.lastKind === "commit" && s.lastAt > 0 && now - s.lastAt <= UPGRADE_MS) {
    // The commit's celebration grows into the push one. Not during focus,
    // where the commit only sparkled and a hop would be a distraction.
    s.lastKind = "push"
    return { state: s, action: c.focus ? null : "upgrade" }
  }
  if (s.lastAt > 0 && now - s.lastAt < GAP_MS) return { state: s, action: null }

  var action = c.focus ? "sparkle" : kind === "commit" ? "commit" : kind === "push" ? "push" : "sparkle"
  s.count += 1
  s.lastAt = now
  s.lastKind = kind
  return { state: s, action: action }
}

// The gitRoots setting: "~/Work,~/Code" -> absolute folders. `~` expands to
// home; anything relative, with a `..` segment, or the whole filesystem is
// dropped. Deduplicated, at most five.
function parseRoots(text, home) {
  var h = String(home === undefined || home === null ? "" : home).replace(/\/+$/, "")
  var parts = String(text === undefined || text === null ? "" : text).split(",")
  var out = []
  for (var i = 0; i < parts.length && out.length < MAX_ROOTS; i++) {
    var p = parts[i].trim()
    if (!p || /[\x00-\x1f]/.test(p)) continue
    if (p === "~" || p.indexOf("~/") === 0) {
      if (h.charAt(0) !== "/") continue
      p = h + p.slice(1)
    }
    if (p.charAt(0) !== "/") continue
    var segs = p.split("/")
    if (segs.indexOf("..") >= 0) continue
    segs = segs.filter(function (seg) { return seg !== "" && seg !== "." })
    if (segs.length === 0) continue
    p = "/" + segs.join("/")
    if (out.indexOf(p) < 0) out.push(p)
  }
  return out
}

if (typeof module !== "undefined") module.exports = {
  GAP_MS: GAP_MS, UPGRADE_MS: UPGRADE_MS, BURST: BURST, BURST_MS: BURST_MS, MUTE_MS: MUTE_MS,
  DAILY_CAP: DAILY_CAP, MAX_ROOTS: MAX_ROOTS,
  parseLine: parseLine, create: create, decide: decide, parseRoots: parseRoots
}
