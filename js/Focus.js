// Focus timer: Pomodoro-style rounds of focus, then a break, then "another
// round?". Pure and wall-clock based: every call takes `now` (epoch ms), so a
// suspend or a shell restart simply catches up on the next advance(). Every
// function returns a new state object and leaves its inputs alone.
//
//   idle -> focus -> break -> ask -> focus (again) | idle (stop, or no answer)
//
// Do Not Disturb is switched on at the start of focus only when it was off, and
// switched back off when focus ends only while it is still ours: turning it off
// by hand mid-focus releases it, and DND that was already on is never touched.
// Callers carry out the returned effects ("dnd-on", "dnd-off") and react to the
// events ("focus-done", "break-done", "ask-expired").
//
// Plain JS (no .pragma, no .import) so node tests can require() it.

var DND_GRACE_MS = 3000            // a DND-off reading this soon after we switched it on is the switch still landing
var ASK_MS = 10 * 60000            // how long "another round?" waits for an answer
var MAX_FOCUS_MIN = 180
var MAX_BREAK_MIN = 60
var DEFAULT_FOCUS_MIN = 25
var DEFAULT_BREAK_MIN = 5
var MIN = 60000
var PHASES = ["idle", "focus", "break", "ask"]
var DND_STATES = ["none", "ours", "released"]

function create() {
  return {
    v: 1, phase: "idle", startedAt: 0, endsAt: 0,
    focusMs: DEFAULT_FOCUS_MIN * MIN, breakMs: DEFAULT_BREAK_MIN * MIN,
    round: 0, dnd: "none", dndSetAt: 0, askedAt: 0
  }
}

function num(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback }

// A fresh object with every field, so callers can change it freely.
function copy(s) {
  var b = s && typeof s === "object" ? s : {}
  var d = create()
  return {
    v: 1,
    phase: PHASES.indexOf(b.phase) >= 0 ? b.phase : "idle",
    startedAt: num(b.startedAt, 0),
    endsAt: num(b.endsAt, 0),
    focusMs: num(b.focusMs, d.focusMs),
    breakMs: num(b.breakMs, d.breakMs),
    round: num(b.round, 0),
    dnd: DND_STATES.indexOf(b.dnd) >= 0 ? b.dnd : "none",
    dndSetAt: num(b.dndSetAt, 0),
    askedAt: num(b.askedAt, 0)
  }
}

function minutes(v, max, fallback) {
  var n = typeof v === "number" ? v : parseFloat(v)
  if (!isFinite(n)) n = fallback
  return n < 1 ? 1 : n > max ? max : n
}

// cfg: { focusMinutes, breakMinutes, dnd }. From idle this is round 1; from a
// break or "another round?" the next round; mid-focus a restart of the same
// round. A restart keeps DND that is already ours without switching it again;
// otherwise it is a fresh start for DND too.
function start(s, now, cfg, dndOn) {
  var prev = copy(s)
  var c = cfg || {}
  var n = copy(prev)
  var effects = []
  n.phase = "focus"
  n.focusMs = minutes(c.focusMinutes, MAX_FOCUS_MIN, DEFAULT_FOCUS_MIN) * MIN
  n.breakMs = minutes(c.breakMinutes, MAX_BREAK_MIN, DEFAULT_BREAK_MIN) * MIN
  n.startedAt = now
  n.endsAt = now + n.focusMs
  n.askedAt = 0
  if (prev.phase === "focus") n.round = Math.max(1, prev.round)
  else if (prev.phase === "idle") n.round = 1
  else n.round = prev.round + 1
  if (prev.phase === "focus" && prev.dnd === "ours") {
    n.dnd = "ours"
  } else if (c.dnd && !dndOn) {
    n.dnd = "ours"
    n.dndSetAt = now
    effects.push("dnd-on")
  } else {
    n.dnd = "none"
    n.dndSetAt = 0
  }
  return { state: n, effects: effects }
}

// "Another round?" answered yes (also works mid-break to cut it short).
function again(s, now, cfg, dndOn) {
  return start(s, now, cfg, dndOn)
}

function stop(s, now) {
  var prev = copy(s)
  var effects = []
  if (prev.phase === "focus" && prev.dnd === "ours") effects.push("dnd-off")
  var n = create()
  n.focusMs = prev.focusMs
  n.breakMs = prev.breakMs
  return { state: n, effects: effects }
}

// Moves through every phase boundary that has passed by `now` (several at once
// after a suspend). DND release is only detected by observeDnd() on a real DND
// change, never here: a reading taken while the shell is still starting could
// be stale, and mistaking it for a release would leave DND on for good.
// `dndOn` is accepted for symmetry with start().
function advance(s, now, dndOn) {
  var n = copy(s)
  var events = []
  var effects = []
  for (var guard = 0; guard < 4; guard++) {
    if (n.phase === "focus" && now >= n.endsAt) {
      if (n.dnd === "ours") effects.push("dnd-off")
      n.dnd = "none"
      n.dndSetAt = 0
      n.phase = "break"
      n.startedAt = n.endsAt
      n.endsAt = n.endsAt + n.breakMs
      events.push("focus-done")
    } else if (n.phase === "break" && now >= n.endsAt) {
      n.phase = "ask"
      n.askedAt = n.endsAt
      n.startedAt = n.endsAt
      n.endsAt = 0
      events.push("break-done")
    } else if (n.phase === "ask" && now >= n.askedAt + ASK_MS) {
      var last = n
      n = create()
      n.focusMs = last.focusMs
      n.breakMs = last.breakMs
      events.push("ask-expired")
    } else {
      break
    }
  }
  return { state: n, events: events, effects: effects }
}

// Call on a real DND change. During focus, DND going off (outside the grace
// window after we switched it on) means the user turned it off: it is theirs
// again and we won't switch it off at the end.
function observeDnd(s, now, dndOn) {
  var n = copy(s)
  if (n.phase === "focus" && n.dnd === "ours" && !dndOn && now - n.dndSetAt >= DND_GRACE_MS) n.dnd = "released"
  return n
}

// A saved state back into a valid one. Anything malformed or far in the
// future (a clock jump, a hand edit) becomes idle. DND stays ours across a
// restart so the end of focus still switches it off; run advance() next.
function restore(raw, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return create()
  if (raw.v !== 1 || PHASES.indexOf(raw.phase) < 0) return create()
  var fields = ["startedAt", "endsAt", "focusMs", "breakMs", "round", "dndSetAt", "askedAt"]
  for (var i = 0; i < fields.length; i++) {
    var v = raw[fields[i]]
    if (typeof v !== "number" || !isFinite(v) || v < 0) return create()
  }
  if (raw.focusMs < MIN || raw.focusMs > MAX_FOCUS_MIN * MIN) return create()
  if (raw.breakMs < MIN || raw.breakMs > MAX_BREAK_MIN * MIN) return create()
  var n = copy(raw)
  n.round = Math.floor(n.round)
  var horizon = now + (MAX_FOCUS_MIN + MAX_BREAK_MIN) * MIN
  if (n.phase === "idle") {
    var idle = create()
    idle.focusMs = n.focusMs
    idle.breakMs = n.breakMs
    return idle
  }
  if (n.phase === "focus" || n.phase === "break") {
    if (n.endsAt <= 0 || n.endsAt > horizon || n.startedAt > n.endsAt) return create()
    n.askedAt = 0
  } else {
    if (n.askedAt <= 0 || n.askedAt > horizon) return create()
    n.endsAt = 0
  }
  // Only a focus round can own DND.
  if (n.phase !== "focus") { n.dnd = "none"; n.dndSetAt = 0 }
  if (n.round < 1) n.round = 1
  return n
}

function serialize(s) { return copy(s) }

function counting(s) { return !!s && (s.phase === "focus" || s.phase === "break") }

// Whole minutes left, rounded up: 25:00 and 24:59.9 are both 25; 0 at the end.
function minutesLeft(s, now) {
  if (!counting(s)) return 0
  var ms = s.endsAt - now
  return ms > 0 ? Math.ceil(ms / MIN) : 0
}

// ms until minutesLeft() changes (at least 1); -1 when nothing is counting.
function msToNextMinute(s, now) {
  if (!counting(s)) return -1
  var ms = s.endsAt - now
  if (ms <= 0) return 1
  return Math.max(1, ms - (Math.ceil(ms / MIN) - 1) * MIN)
}

// ms until the next phase change; -1 when idle. Re-arm with min(this, 60000).
function nextEventIn(s, now) {
  if (!s || s.phase === "idle") return -1
  if (s.phase === "ask") return Math.max(0, s.askedAt + ASK_MS - now)
  return Math.max(0, s.endsAt - now)
}

function label(s, now) {
  if (!s) return ""
  if (s.phase === "focus") return "Focus · " + minutesLeft(s, now) + " min left"
  if (s.phase === "break") return "Break · " + minutesLeft(s, now) + " min left"
  if (s.phase === "ask") return "Another round?"
  return ""
}

function isRunning(s) { return !!s && PHASES.indexOf(s.phase) > 0 }

if (typeof module !== "undefined") module.exports = {
  DND_GRACE_MS: DND_GRACE_MS, ASK_MS: ASK_MS, MAX_FOCUS_MIN: MAX_FOCUS_MIN, MAX_BREAK_MIN: MAX_BREAK_MIN,
  DEFAULT_FOCUS_MIN: DEFAULT_FOCUS_MIN, DEFAULT_BREAK_MIN: DEFAULT_BREAK_MIN, PHASES: PHASES,
  create: create, start: start, again: again, stop: stop, advance: advance, observeDnd: observeDnd,
  restore: restore, serialize: serialize, minutesLeft: minutesLeft, msToNextMinute: msToNextMinute,
  nextEventIn: nextEventIn, label: label, isRunning: isRunning
}
